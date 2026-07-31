/**
 * 複数チーム・2セット合計の試合結果保存
 */
import {
  deleteField,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { getFirebaseDb, isFirebaseConfigured } from "../lib/firebase-app.js";
import { ConfigUnconfiguredError } from "../lib/errors.js";
import {
  FinalsMatchResolution,
  MatchResultStatus,
  MatchSessionStatus,
} from "../domain/constants.js";
import { MatchFormat } from "../domain/aggregate-match-format.js";
import {
  BracketKind,
  resolveBracketCollections,
  resolveOptionsBracketKind,
} from "../domain/bracket-collections.js";
import {
  buildMultiTeamMatchResultPayload,
  validateMultiTeamMatchResultInput,
} from "../domain/multi-team-match-result.js";
import { isMultiTeamFinalMatch } from "../domain/multi-team-bracket.js";
import {
  isMultiTeamMatchReady,
  resolveMultiTeamMatchParticipants,
} from "../domain/multi-team-progress.js";
import { findBracketMatch } from "../domain/finals-match-progress.js";
import { getFinalsBracket } from "./finals-bracket-service.js";
import { getConsolationBracket } from "./consolation-bracket-service.js";
import { getFinalsMatchResults } from "./finals-match-result-service.js";
import { requireOpenTournament } from "./tournament-service.js";
import { withPublicSnapshotRebuild } from "../lib/public-snapshot-hook.js";

function requireDb() {
  if (!isFirebaseConfigured()) {
    throw new ConfigUnconfiguredError();
  }
  const db = getFirebaseDb();
  if (!db) {
    throw new ConfigUnconfiguredError();
  }
  return db;
}

function mapResultDoc(docSnap) {
  return { id: docSnap.id, ...docSnap.data() };
}

function sameIdList(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
    return false;
  }
  return a.every((id, i) => id === b[i]);
}

/**
 * @param {string} tournamentId
 * @param {string} bracketKind
 * @param {{ source?: string }} [options]
 */
async function getBracketForKind(tournamentId, bracketKind, options = {}) {
  if (bracketKind === BracketKind.CONSOLATION) {
    return getConsolationBracket(tournamentId, options);
  }
  return getFinalsBracket(tournamentId, options);
}

/**
 * @param {string} tournamentId
 * @param {string} matchId
 * @param {{
 *   scores: Record<string, unknown>,
 *   manualRankingEntryIds?: string[]|null,
 *   bracketKind?: string,
 * }} input
 */
export async function saveMultiTeamMatchResult(tournamentId, matchId, input = {}) {
  await requireOpenTournament(tournamentId);
  const bracketKind = resolveOptionsBracketKind(input);
  const collections = resolveBracketCollections(bracketKind);

  const [bracket, resultsMap] = await Promise.all([
    getBracketForKind(tournamentId, bracketKind, { source: "server" }),
    getFinalsMatchResults(tournamentId, { bracketKind }),
  ]);
  if (!bracket?.finalized) {
    throw Object.assign(new Error("Bracket not finalized"), {
      code: "multi-team-match-result/no-bracket",
    });
  }

  const match = findBracketMatch(bracket, matchId);
  if (!match || match.matchFormat !== MatchFormat.MULTI_TEAM_TOTAL) {
    throw Object.assign(new Error("Match not found or not multi-team format"), {
      code: "multi-team-match-result/invalid-match",
    });
  }

  const participants = resolveMultiTeamMatchParticipants({
    match,
    bracket,
    resultsMap,
  });
  if (!isMultiTeamMatchReady(match, bracket, resultsMap)) {
    throw Object.assign(new Error("Match participants are not ready"), {
      code: "multi-team-match-result/not-ready",
    });
  }

  const participantEntryIds = participants.map((p) => p.entryId).filter(Boolean);
  const isFinalRound = isMultiTeamFinalMatch(match, bracket);

  const validation = validateMultiTeamMatchResultInput({
    participantEntryIds,
    scores: input.scores,
    qualifiersCount: match.qualifiersCount,
    manualRankingEntryIds: input.manualRankingEntryIds ?? null,
    isFinalRound,
  });

  if (!validation.valid) {
    throw Object.assign(new Error(validation.message || "Invalid multi-team result"), {
      code: validation.needsManualTieBreak
        ? "multi-team-match-result/needs-tie-break"
        : "multi-team-match-result/invalid-input",
      needsManualTieBreak: Boolean(validation.needsManualTieBreak),
      values: validation.values ?? null,
    });
  }

  const built = buildMultiTeamMatchResultPayload({
    match: { ...match, participantEntryIds, participants },
    validated: validation.values,
  });
  /** @type {Record<string, unknown>} */
  const payload = {
    ...built,
    updatedAt: serverTimestamp(),
  };
  if (bracketKind === BracketKind.CONSOLATION) {
    payload.bracketKind = BracketKind.CONSOLATION;
  }

  const db = requireDb();
  const resultRef = doc(db, "tournaments", tournamentId, collections.results, matchId);
  const sessionRef = doc(db, "tournaments", tournamentId, collections.sessions, matchId);

  await runTransaction(db, async (transaction) => {
    const [resultSnap, sessionSnap] = await Promise.all([
      transaction.get(resultRef),
      transaction.get(sessionRef),
    ]);

    const existing = resultSnap.exists() ? resultSnap.data() : null;
    if (existing?.resolution === FinalsMatchResolution.BYE) {
      throw Object.assign(new Error("BYE通過結果は修正できません。"), {
        code: "multi-team-match-result/modify-blocked",
      });
    }

    const oldQualifiers = existing?.qualifierEntryIds || [];
    const newQualifiers = payload.qualifierEntryIds || [];
    const qualifiersChanged = !sameIdList(oldQualifiers, newQualifiers);

    if (existing && qualifiersChanged && match.nextMatchId && !isFinalRound) {
      let nextMatchId = match.nextMatchId;
      while (nextMatchId) {
        const nextResultRef = doc(
          db,
          "tournaments",
          tournamentId,
          collections.results,
          nextMatchId
        );
        const nextSessionRef = doc(
          db,
          "tournaments",
          tournamentId,
          collections.sessions,
          nextMatchId
        );
        const [nextResultSnap, nextSessionSnap] = await Promise.all([
          transaction.get(nextResultRef),
          transaction.get(nextSessionRef),
        ]);
        if (nextResultSnap.exists() || nextSessionSnap.exists()) {
          throw Object.assign(
            new Error("次の試合がすでに開始されているため、進出チームが変わる修正はできません。"),
            { code: "multi-team-match-result/modify-blocked" }
          );
        }
        const nextMatch = findBracketMatch(bracket, nextMatchId);
        nextMatchId = nextMatch?.nextMatchId ?? null;
      }
    }

    if (resultSnap.exists()) {
      /** @type {Record<string, unknown>} */
      const updateData = {
        ...payload,
        createdAt: resultSnap.data().createdAt,
        status: MatchResultStatus.FINISHED,
      };
      if (isFinalRound) {
        updateData.qualifierEntryIds = deleteField();
      }
      transaction.update(resultRef, updateData);
    } else {
      transaction.set(resultRef, {
        ...payload,
        createdAt: serverTimestamp(),
      });
    }

    if (
      sessionSnap.exists() &&
      sessionSnap.data().status === MatchSessionStatus.PLAYING
    ) {
      transaction.update(sessionRef, {
        status: MatchSessionStatus.FINISHED,
        finishedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  });

  const saved = await getDoc(resultRef);
  return withPublicSnapshotRebuild(tournamentId, mapResultDoc(saved));
}
