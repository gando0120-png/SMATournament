/**
 * 決勝試合セッション Firestore 操作（DOM 非依存）
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
  MatchResultStatus,
  MatchSessionStatus,
} from "../domain/constants.js";
import {
  evaluateFinalsMatchStart,
  findBracketMatch,
} from "../domain/finals-match-progress.js";
import { getFinalsBracket } from "./finals-bracket-service.js";
import { getFinalsMatchResults } from "./finals-match-result-service.js";
import { requireOpenTournament } from "./tournament-service.js";

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

function mapSessionDoc(docSnap) {
  return { id: docSnap.id, ...docSnap.data() };
}

/**
 * @param {string} tournamentId
 * @returns {Promise<Map<string, object>>}
 */
export async function getFinalsMatchSessions(tournamentId) {
  const db = requireDb();
  const snapshot = await getDocs(
    collection(db, "tournaments", tournamentId, "finalsMatchSessions")
  );
  const sessions = new Map();
  snapshot.docs.forEach((docSnap) => {
    sessions.set(docSnap.id, mapSessionDoc(docSnap));
  });
  return sessions;
}

/**
 * @param {string} tournamentId
 * @param {string} matchId
 */
export async function getFinalsMatchSession(tournamentId, matchId) {
  const db = requireDb();
  const snap = await getDoc(
    doc(db, "tournaments", tournamentId, "finalsMatchSessions", matchId)
  );
  if (!snap.exists()) {
    return null;
  }
  return mapSessionDoc(snap);
}

/**
 * @param {string} tournamentId
 * @param {string} matchId
 */
export async function startFinalsMatchSession(tournamentId, matchId) {
  await requireOpenTournament(tournamentId);
  const bracket = await getFinalsBracket(tournamentId);
  if (!bracket?.finalized) {
    const error = new Error("Finals bracket not finalized");
    error.code = "finals-match-session/no-bracket";
    throw error;
  }

  const match = findBracketMatch(bracket, matchId);
  if (!match) {
    const error = new Error("Match not found in finals bracket");
    error.code = "finals-match-session/invalid-match";
    throw error;
  }

  const [resultsMap, sessionsMap] = await Promise.all([
    getFinalsMatchResults(tournamentId),
    getFinalsMatchSessions(tournamentId),
  ]);

  const existingResult = resultsMap.get(matchId);
  if (existingResult?.status === MatchResultStatus.FINISHED) {
    const error = new Error("Match already finished");
    error.code = "finals-match-session/already-finished";
    throw error;
  }

  const evaluation = evaluateFinalsMatchStart({
    match,
    bracket,
    resultsMap,
    sessionsMap,
  });

  if (!evaluation.canStart) {
    const error = new Error(evaluation.message || "Cannot start finals match");
    error.code = evaluation.isBye
      ? "finals-match-session/bye-match"
      : "finals-match-session/not-ready";
    throw error;
  }

  const db = requireDb();
  const docRef = doc(db, "tournaments", tournamentId, "finalsMatchSessions", matchId);

  const transactionResult = await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(docRef);

    if (snap.exists()) {
      const existing = snap.data();
      if (existing.status === MatchSessionStatus.PLAYING) {
        return { alreadyStarted: true, session: mapSessionDoc(snap) };
      }
    }

    const payload = {
      matchId,
      roundNumber: match.roundNumber,
      matchNumber: match.matchNumber,
      status: MatchSessionStatus.PLAYING,
      team1: evaluation.team1,
      team2: evaluation.team2,
      startedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    if (snap.exists()) {
      transaction.update(docRef, payload);
    } else {
      transaction.set(docRef, payload);
    }

    return { alreadyStarted: false, session: null };
  });

  if (transactionResult.alreadyStarted) {
    return transactionResult.session;
  }

  const saved = await getDoc(docRef);
  return mapSessionDoc(saved);
}
