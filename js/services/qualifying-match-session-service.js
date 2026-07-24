/**
 * 予選試合セッション Firestore 操作（DOM 非依存）
 */
import {
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { getFirebaseDb, isFirebaseConfigured } from "../lib/firebase-app.js";
import { ConfigUnconfiguredError } from "../lib/errors.js";
import { MatchResultStatus, MatchSessionStatus } from "../domain/constants.js";
import { buildScheduleMatchIndex } from "../domain/qualifying-match-result.js";
import { getQualifyingSchedule } from "./qualifying-schedule-service.js";
import { getQualifyingMatchResult } from "./qualifying-match-result-service.js";
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
 * @param {string} matchId
 */
export async function getQualifyingMatchSession(tournamentId, matchId) {
  const db = requireDb();
  const snap = await getDoc(
    doc(db, "tournaments", tournamentId, "qualifyingMatchSessions", matchId)
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
export async function startQualifyingMatchSession(tournamentId, matchId) {
  await requireOpenTournament(tournamentId);
  const schedule = await getQualifyingSchedule(tournamentId);
  if (!schedule?.finalized) {
    const error = new Error("Finalized qualifying schedule not found");
    error.code = "qualifying-match-session/no-schedule";
    throw error;
  }

  if (!buildScheduleMatchIndex(schedule).has(matchId)) {
    const error = new Error("Match not found in qualifying schedule");
    error.code = "qualifying-match-session/invalid-match";
    throw error;
  }

  const existingResult = await getQualifyingMatchResult(tournamentId, matchId);
  if (existingResult?.status === MatchResultStatus.FINISHED) {
    const error = new Error("Match already finished");
    error.code = "qualifying-match-session/already-finished";
    throw error;
  }

  const db = requireDb();
  const docRef = doc(db, "tournaments", tournamentId, "qualifyingMatchSessions", matchId);
  const resultRef = doc(db, "tournaments", tournamentId, "qualifyingMatchResults", matchId);

  const transactionResult = await runTransaction(db, async (transaction) => {
    const [snap, resultSnap] = await Promise.all([
      transaction.get(docRef),
      transaction.get(resultRef),
    ]);

    if (resultSnap.exists() && resultSnap.data().status === MatchResultStatus.FINISHED) {
      throw Object.assign(new Error("Match already finished"), {
        code: "qualifying-match-session/already-finished",
      });
    }

    if (snap.exists() && snap.data().status === MatchSessionStatus.PLAYING) {
      return {
        alreadyStarted: true,
        session: mapSessionDoc(snap),
      };
    }

    const payload = {
      matchId,
      status: MatchSessionStatus.PLAYING,
      startedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    if (snap.exists()) {
      transaction.update(docRef, payload);
    } else {
      transaction.set(docRef, payload);
    }

    return {
      alreadyStarted: false,
      session: null,
    };
  });

  if (transactionResult.alreadyStarted) {
    return transactionResult.session;
  }

  const saved = await getDoc(docRef);
  return mapSessionDoc(saved);
}
