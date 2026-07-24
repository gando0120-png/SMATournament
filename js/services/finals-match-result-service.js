/**
 * 決勝試合結果 Firestore 操作（DOM 非依存）
 */
import {
  doc,
  getDoc,
  getDocs,
  collection,
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
import {
  buildByeMatchResultPayload,
  buildPlayedFinalsMatchResultTeams,
  canModifyFinalsMatchResult,
  findBracketMatch,
  listByeMatchesNeedingResults,
  listDoubleByeMatches,
} from "../domain/finals-match-progress.js";
import { getByeWinnerTeam } from "../domain/finals-match-bye.js";
import { validateFinalsMatchResultInput } from "../domain/finals-match-result.js";
import { getFinalsBracket } from "./finals-bracket-service.js";
import { getFinalsMatchSessions, getFinalsMatchSession } from "./finals-match-session-service.js";
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

/**
 * @param {string} tournamentId
 * @returns {Promise<Map<string, object>>}
 */
export async function getFinalsMatchResults(tournamentId) {
  const db = requireDb();
  const snapshot = await getDocs(
    collection(db, "tournaments", tournamentId, "finalsMatchResults")
  );
  const results = new Map();
  snapshot.docs.forEach((docSnap) => {
    results.set(docSnap.id, mapResultDoc(docSnap));
  });
  return results;
}

/**
 * @param {string} tournamentId
 * @param {string} matchId
 */
export async function getFinalsMatchResult(tournamentId, matchId) {
  const db = requireDb();
  const snap = await getDoc(
    doc(db, "tournaments", tournamentId, "finalsMatchResults", matchId)
  );
  if (!snap.exists()) {
    return null;
  }
  return mapResultDoc(snap);
}

/**
 * @param {string} tournamentId
 */
export async function ensureFinalsByeResults(tournamentId) {
  await requireOpenTournament(tournamentId);
  const bracket = await getFinalsBracket(tournamentId);
  if (!bracket?.finalized) {
    return { created: 0 };
  }

  const doubleByeMatches = listDoubleByeMatches(bracket);
  if (doubleByeMatches.length > 0) {
    const error = new Error("Invalid double-bye match in finals bracket");
    error.code = "finals-match-result/invalid-bye";
    throw error;
  }

  const byeMatches = listByeMatchesNeedingResults(bracket);
  if (byeMatches.length === 0) {
    return { created: 0 };
  }

  const db = requireDb();
  let created = 0;

  for (const match of byeMatches) {
    const docRef = doc(db, "tournaments", tournamentId, "finalsMatchResults", match.matchId);
    const winner = getByeWinnerTeam(match.team1, match.team2);
    if (!winner) {
      continue;
    }

    const payload = buildByeMatchResultPayload(match, winner);

    const didCreate = await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(docRef);
      if (snap.exists()) {
        return false;
      }

      transaction.set(docRef, {
        ...payload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return true;
    });

    if (didCreate) {
      created += 1;
    }
  }

  return { created };
}

/**
 * @param {string} tournamentId
 * @param {string} matchId
 * @param {object} input
 */
export async function saveFinalsMatchResult(tournamentId, matchId, input) {
  await requireOpenTournament(tournamentId);
  const bracket = await getFinalsBracket(tournamentId);
  if (!bracket?.finalized) {
    const error = new Error("Finals bracket not finalized");
    error.code = "finals-match-result/no-bracket";
    throw error;
  }

  const match = findBracketMatch(bracket, matchId);
  if (!match) {
    const error = new Error("Match not found in finals bracket");
    error.code = "finals-match-result/invalid-match";
    throw error;
  }

  const [session, existingResult] = await Promise.all([
    getFinalsMatchSession(tournamentId, matchId),
    getFinalsMatchResult(tournamentId, matchId),
  ]);

  const isInitialSave =
    session?.status === MatchSessionStatus.PLAYING && !existingResult;
  const isScoreEdit =
    existingResult?.status === MatchResultStatus.FINISHED &&
    existingResult?.resolution === FinalsMatchResolution.PLAYED &&
    (session?.status === MatchSessionStatus.FINISHED ||
      session?.status === MatchSessionStatus.PLAYING);

  if (!isInitialSave && !isScoreEdit) {
    const error = new Error("Match session not started");
    error.code = "finals-match-result/not-started";
    throw error;
  }

  const validation = validateFinalsMatchResultInput(input);
  if (!validation.valid) {
    const error = new Error(validation.message);
    error.code = "finals-match-result/invalid-input";
    throw error;
  }

  const team1 = session?.team1 ?? existingResult?.team1;
  const team2 = session?.team2 ?? existingResult?.team2;
  const { sets, team1SetWins, team2SetWins, winnerSide } = validation.data;
  const { winner, loser } = buildPlayedFinalsMatchResultTeams(team1, team2, winnerSide);

  const payload = {
    matchId,
    roundNumber: match.roundNumber,
    matchNumber: match.matchNumber,
    status: MatchResultStatus.FINISHED,
    resolution: FinalsMatchResolution.PLAYED,
    team1,
    team2,
    sets,
    team1SetWins,
    team2SetWins,
    winnerSide,
    winner,
    loser,
    updatedAt: serverTimestamp(),
  };

  const db = requireDb();
  const docRef = doc(db, "tournaments", tournamentId, "finalsMatchResults", matchId);
  const sessionRef = doc(db, "tournaments", tournamentId, "finalsMatchSessions", matchId);

  await runTransaction(db, async (transaction) => {
    const resultSnap = await transaction.get(docRef);
    const sessionSnap = await transaction.get(sessionRef);
    const existing = resultSnap.exists() ? resultSnap.data() : null;

    if (existing?.resolution === FinalsMatchResolution.BYE) {
      throw Object.assign(new Error("BYE通過結果は修正できません。"), {
        code: "finals-match-result/modify-blocked",
      });
    }

    const oldWinnerId = existing?.winner?.entryId ?? null;
    if (oldWinnerId && oldWinnerId !== winner.entryId) {
      let nextMatchId = match.nextMatchId;
      while (nextMatchId) {
        const nextResultRef = doc(
          db,
          "tournaments",
          tournamentId,
          "finalsMatchResults",
          nextMatchId
        );
        const nextSessionRef = doc(
          db,
          "tournaments",
          tournamentId,
          "finalsMatchSessions",
          nextMatchId
        );
        const [nextResultSnap, nextSessionSnap] = await Promise.all([
          transaction.get(nextResultRef),
          transaction.get(nextSessionRef),
        ]);

        if (nextResultSnap.exists() || nextSessionSnap.exists()) {
          throw Object.assign(
            new Error("次の試合がすでに開始されているため、勝者が変わる修正はできません。"),
            { code: "finals-match-result/modify-blocked" }
          );
        }

        const nextMatch = findBracketMatch(bracket, nextMatchId);
        nextMatchId = nextMatch?.nextMatchId ?? null;
      }
    }

    if (resultSnap.exists()) {
      transaction.update(docRef, {
        ...payload,
        createdAt: resultSnap.data().createdAt,
      });
    } else {
      transaction.set(docRef, {
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

  const saved = await getDoc(docRef);
  return withPublicSnapshotRebuild(tournamentId, mapResultDoc(saved));
}

/**
 * @param {string} tournamentId
 */
export async function loadFinalsMatchProgressData(tournamentId) {
  const [bracket, resultsMap, sessionsMap] = await Promise.all([
    getFinalsBracket(tournamentId),
    getFinalsMatchResults(tournamentId),
    getFinalsMatchSessions(tournamentId),
  ]);

  return { bracket, resultsMap, sessionsMap };
}
