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
import {
  BracketKind,
  resolveBracketCollections,
  resolveOptionsBracketKind,
} from "../domain/bracket-collections.js";
import { getFinalsBracket } from "./finals-bracket-service.js";
import { getConsolationBracket } from "./consolation-bracket-service.js";
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
 * @param {string} bracketKind
 * @param {{ source?: 'default' | 'server' }} [options]
 */
async function getBracketForKind(tournamentId, bracketKind, options = {}) {
  if (bracketKind === BracketKind.CONSOLATION) {
    return getConsolationBracket(tournamentId, options);
  }
  return getFinalsBracket(tournamentId, options);
}

/**
 * @param {string} tournamentId
 * @param {string} bracketKind
 */
function sessionsCollection(db, tournamentId, bracketKind) {
  const { sessions } = resolveBracketCollections(bracketKind);
  return collection(db, "tournaments", tournamentId, sessions);
}

/**
 * @param {string} tournamentId
 * @param {string} matchId
 * @param {string} bracketKind
 */
function sessionDocRef(db, tournamentId, matchId, bracketKind) {
  const { sessions } = resolveBracketCollections(bracketKind);
  return doc(db, "tournaments", tournamentId, sessions, matchId);
}

/**
 * @param {string} tournamentId
 * @param {{ bracketKind?: string }} [options]
 * @returns {Promise<Map<string, object>>}
 */
export async function getFinalsMatchSessions(tournamentId, options = {}) {
  const bracketKind = resolveOptionsBracketKind(options);
  const db = requireDb();
  const snapshot = await getDocs(sessionsCollection(db, tournamentId, bracketKind));
  const sessions = new Map();
  snapshot.docs.forEach((docSnap) => {
    sessions.set(docSnap.id, mapSessionDoc(docSnap));
  });
  return sessions;
}

/**
 * @param {string} tournamentId
 * @param {string} matchId
 * @param {{ bracketKind?: string }} [options]
 */
export async function getFinalsMatchSession(tournamentId, matchId, options = {}) {
  const bracketKind = resolveOptionsBracketKind(options);
  const db = requireDb();
  const snap = await getDoc(sessionDocRef(db, tournamentId, matchId, bracketKind));
  if (!snap.exists()) {
    return null;
  }
  return mapSessionDoc(snap);
}

/**
 * @param {string} tournamentId
 * @param {string} matchId
 * @param {{ bracketKind?: string }} [options]
 */
export async function startFinalsMatchSession(tournamentId, matchId, options = {}) {
  const bracketKind = resolveOptionsBracketKind(options);
  await requireOpenTournament(tournamentId);
  const bracket = await getBracketForKind(tournamentId, bracketKind);
  if (!bracket?.finalized) {
    const error = new Error("Bracket not finalized");
    error.code =
      bracketKind === BracketKind.CONSOLATION
        ? "consolation-match-session/no-bracket"
        : "finals-match-session/no-bracket";
    throw error;
  }

  const match = findBracketMatch(bracket, matchId);
  if (!match) {
    const error = new Error("Match not found in bracket");
    error.code =
      bracketKind === BracketKind.CONSOLATION
        ? "consolation-match-session/invalid-match"
        : "finals-match-session/invalid-match";
    throw error;
  }

  const [resultsMap, sessionsMap] = await Promise.all([
    getFinalsMatchResults(tournamentId, { bracketKind }),
    getFinalsMatchSessions(tournamentId, { bracketKind }),
  ]);

  const existingResult = resultsMap.get(matchId);
  if (existingResult?.status === MatchResultStatus.FINISHED) {
    const error = new Error("Match already finished");
    error.code =
      bracketKind === BracketKind.CONSOLATION
        ? "consolation-match-session/already-finished"
        : "finals-match-session/already-finished";
    throw error;
  }

  const evaluation = evaluateFinalsMatchStart({
    match,
    bracket,
    resultsMap,
    sessionsMap,
  });

  if (!evaluation.canStart) {
    const error = new Error(evaluation.message || "Cannot start match");
    if (evaluation.isBye) {
      error.code =
        bracketKind === BracketKind.CONSOLATION
          ? "consolation-match-session/bye-match"
          : "finals-match-session/bye-match";
    } else {
      error.code =
        bracketKind === BracketKind.CONSOLATION
          ? "consolation-match-session/not-ready"
          : "finals-match-session/not-ready";
    }
    throw error;
  }

  const db = requireDb();
  const docRef = sessionDocRef(db, tournamentId, matchId, bracketKind);

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

    if (bracketKind === BracketKind.CONSOLATION) {
      payload.bracketKind = BracketKind.CONSOLATION;
    }

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
