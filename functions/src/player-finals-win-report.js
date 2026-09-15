/**
 * プレイヤー決勝（main H2H）勝利報告 — Admin SDK
 */
import { FieldValue } from "firebase-admin/firestore";
import {
  FINALS_ADVANCEMENT_DOC_ID,
  MatchResultStatus,
  MatchSessionStatus,
} from "../vendor/domain/constants.js";
import { findFeederMatches } from "../vendor/domain/finals-match-progress.js";
import {
  formatTeamNumber,
  teamNumberDisplayWidth,
} from "../vendor/domain/player-qualifying-submission.js";
import {
  PLAYER_FINALS_ALREADY_OFFICIAL_MESSAGE,
  PlayerFinalsPageMode,
  evaluatePlayerFinalsWinReport,
  resolvePlayerFinalsMatchView,
  resolvePlayerFinalsPageMode,
  toPlayerFinalsMatchListPayload,
} from "../vendor/domain/player-finals-win-report.js";
import {
  loadTournament,
  rebuildPublicSnapshotAdmin,
  removeUndefinedFields,
  resolvePlayerIdentity,
  tournamentRef,
} from "./player-qualifying-results.js";

const MAIN_RESULTS_COLLECTION = "finalsMatchResults";
const MAIN_SESSIONS_COLLECTION = "finalsMatchSessions";
const MAIN_BRACKET_COLLECTION = "finalsBracket";
const MAIN_BRACKET_DOC_ID = "current";

async function loadCollectionMap(db, tournamentId, collectionName) {
  const snap = await tournamentRef(db, tournamentId).collection(collectionName).get();
  const map = new Map();
  snap.docs.forEach((docSnap) => {
    map.set(docSnap.id, { id: docSnap.id, ...docSnap.data() });
  });
  return map;
}

async function loadFinalsBracket(db, tournamentId) {
  const snap = await tournamentRef(db, tournamentId)
    .collection(MAIN_BRACKET_COLLECTION)
    .doc(MAIN_BRACKET_DOC_ID)
    .get();
  if (!snap.exists) {
    return null;
  }
  return { id: snap.id, ...snap.data() };
}

async function loadFinalsAdvancement(db, tournamentId) {
  const snap = await tournamentRef(db, tournamentId)
    .collection("finalsAdvancement")
    .doc(FINALS_ADVANCEMENT_DOC_ID)
    .get();
  if (!snap.exists) {
    return null;
  }
  return { id: snap.id, ...snap.data() };
}

function throwCoded(message, code) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function identityPayload(tournament, resolved, entryData) {
  const teamName = entryData.teamName || resolved.teamName || resolved.entryId;
  const teamNumber =
    resolved.teamNumber ??
    (Number.isInteger(entryData.teamNumber) ? entryData.teamNumber : null);
  const numberWidth = teamNumberDisplayWidth(tournament.maxTeams);
  return {
    tournamentId: tournament.id || null,
    tournamentName: tournament.name || "",
    entryId: resolved.entryId,
    teamName,
    teamNumber,
    teamNumberLabel:
      teamNumber != null ? formatTeamNumber(teamNumber, numberWidth) : null,
    participantResultEntryEnabled: tournament.participantResultEntryEnabled === true,
  };
}

/**
 * @param {object} db
 * @param {string} tournamentId
 * @param {{ teamNumber?: unknown, teamToken?: string }} identity
 */
export async function listMyCurrentFinalsMatch(db, tournamentId, identity) {
  const tournament = await loadTournament(db, tournamentId);
  const resolved = await resolvePlayerIdentity(db, tournamentId, identity || {});
  const entrySnap = await tournamentRef(db, tournamentId)
    .collection("entries")
    .doc(resolved.entryId)
    .get();
  const entryData = entrySnap.exists ? entrySnap.data() : {};
  const base = identityPayload({ ...tournament, id: tournamentId }, resolved, {
    ...entryData,
    teamName: entryData.teamName || resolved.teamName,
  });

  const [finalsAdvancement, bracket] = await Promise.all([
    loadFinalsAdvancement(db, tournamentId),
    loadFinalsBracket(db, tournamentId),
  ]);
  const page = resolvePlayerFinalsPageMode({
    tournament,
    finalsAdvancement,
    finalsBracket: bracket,
  });

  if (page.pageMode !== PlayerFinalsPageMode.FINALS) {
    return {
      ...base,
      pageMode: page.pageMode,
      state: "unavailable",
      message: page.reason,
      roundLabel: null,
      opponentName: null,
      matchId: null,
      canReport: false,
    };
  }

  const [resultsMap, sessionsMap] = await Promise.all([
    loadCollectionMap(db, tournamentId, MAIN_RESULTS_COLLECTION),
    loadCollectionMap(db, tournamentId, MAIN_SESSIONS_COLLECTION),
  ]);
  const view = resolvePlayerFinalsMatchView({
    entryId: resolved.entryId,
    tournament,
    finalsAdvancement,
    bracket,
    resultsMap,
    sessionsMap,
  });
  return {
    ...base,
    ...toPlayerFinalsMatchListPayload(view, {
      teamName: view.teamName || base.teamName,
    }),
  };
}

/**
 * @param {object} db
 * @param {string} tournamentId
 * @param {{
 *   teamNumber?: unknown,
 *   teamToken?: string,
 *   matchId?: string|null,
 *   winnerEntryId?: unknown,
 * }} input
 */
export async function reportMyFinalsWin(db, tournamentId, input = {}) {
  const tournament = await loadTournament(db, tournamentId);
  const resolved = await resolvePlayerIdentity(db, tournamentId, {
    teamNumber: input.teamNumber,
    teamToken: input.teamToken,
  });
  const clientMatchId =
    typeof input.matchId === "string" && input.matchId.trim()
      ? input.matchId.trim()
      : null;

  const [finalsAdvancement, bracket, resultsMap] = await Promise.all([
    loadFinalsAdvancement(db, tournamentId),
    loadFinalsBracket(db, tournamentId),
    loadCollectionMap(db, tournamentId, MAIN_RESULTS_COLLECTION),
  ]);

  const firstPass = evaluatePlayerFinalsWinReport({
    tournament,
    finalsAdvancement,
    bracket,
    resultsMap,
    entryId: resolved.entryId,
    clientMatchId,
    clientWinnerEntryId: input.winnerEntryId,
  });
  if (!firstPass.ok) {
    throwCoded(firstPass.message, firstPass.code);
  }

  const match = firstPass.view.match;
  const resultRef = tournamentRef(db, tournamentId)
    .collection(MAIN_RESULTS_COLLECTION)
    .doc(match.matchId);
  const sessionRef = tournamentRef(db, tournamentId)
    .collection(MAIN_SESSIONS_COLLECTION)
    .doc(match.matchId);
  const tournamentDocRef = tournamentRef(db, tournamentId);
  const bracketRef = tournamentRef(db, tournamentId)
    .collection(MAIN_BRACKET_COLLECTION)
    .doc(MAIN_BRACKET_DOC_ID);
  const feederMatches = findFeederMatches(bracket, match.matchId);
  const feederRefs = feederMatches.map((feeder) =>
    tournamentRef(db, tournamentId).collection(MAIN_RESULTS_COLLECTION).doc(feeder.matchId)
  );

  await db.runTransaction(async (transaction) => {
    const [tournamentSnap, bracketSnap, resultSnap, sessionSnap, ...feederSnaps] =
      await Promise.all([
        transaction.get(tournamentDocRef),
        transaction.get(bracketRef),
        transaction.get(resultRef),
        transaction.get(sessionRef),
        ...feederRefs.map((ref) => transaction.get(ref)),
      ]);

    if (!tournamentSnap.exists) {
      throwCoded("大会が見つかりません。", "not-found");
    }
    if (!bracketSnap.exists) {
      throwCoded("決勝トーナメント表がまだ確定していません。", "player-finals/no-bracket");
    }

    const liveTournament = { id: tournamentSnap.id, ...tournamentSnap.data() };
    const liveBracket = { id: bracketSnap.id, ...bracketSnap.data() };
    const liveResults = new Map(resultsMap);
    if (resultSnap.exists) {
      liveResults.set(resultSnap.id, { id: resultSnap.id, ...resultSnap.data() });
    }
    feederSnaps.forEach((snap) => {
      if (snap.exists) {
        liveResults.set(snap.id, { id: snap.id, ...snap.data() });
      }
    });

    if (resultSnap.exists && resultSnap.data()?.status === MatchResultStatus.FINISHED) {
      throwCoded(PLAYER_FINALS_ALREADY_OFFICIAL_MESSAGE, "player-finals/already-official");
    }

    const liveAdvancement = finalsAdvancement;
    const evaluated = evaluatePlayerFinalsWinReport({
      tournament: liveTournament,
      finalsAdvancement: liveAdvancement,
      bracket: liveBracket,
      resultsMap: liveResults,
      entryId: resolved.entryId,
      clientMatchId,
      clientWinnerEntryId: input.winnerEntryId,
    });
    if (!evaluated.ok) {
      throwCoded(evaluated.message, evaluated.code);
    }
    if (evaluated.view.matchId !== match.matchId) {
      throwCoded(PLAYER_FINALS_ALREADY_OFFICIAL_MESSAGE, "player-finals/already-official");
    }

    const now = FieldValue.serverTimestamp();
    const resultPayload = removeUndefinedFields({
      ...evaluated.payload,
      updatedAt: now,
    });
    if (resultSnap.exists) {
      transaction.update(resultRef, {
        ...resultPayload,
        createdAt: resultSnap.data().createdAt,
      });
    } else {
      transaction.set(resultRef, {
        ...resultPayload,
        createdAt: now,
      });
    }

    const sessionFields = evaluated.sessionFields;
    const existingSession = sessionSnap.exists ? sessionSnap.data() : null;
    const sessionPayload = removeUndefinedFields({
      ...sessionFields,
      status: MatchSessionStatus.FINISHED,
      startedAt: existingSession?.startedAt || now,
      finishedAt: now,
      updatedAt: now,
    });
    if (sessionSnap.exists) {
      transaction.update(sessionRef, sessionPayload);
    } else {
      transaction.set(sessionRef, sessionPayload);
    }
  });

  await rebuildPublicSnapshotAdmin(db, tournamentId);
  return {
    ok: true,
    matchId: match.matchId,
    message: "勝利を報告しました。トーナメント表に反映されました。",
  };
}

export { MAIN_RESULTS_COLLECTION, MAIN_SESSIONS_COLLECTION };
