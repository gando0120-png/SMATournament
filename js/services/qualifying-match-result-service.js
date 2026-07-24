/**
 * 予選試合結果 Firestore 操作（DOM 非依存）
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
import { MatchResultStatus, MatchSessionStatus } from "../domain/constants.js";
import {
  buildScheduleMatchIndex,
  validateMatchResultInput,
} from "../domain/qualifying-match-result.js";
import { getQualifyingSchedule } from "./qualifying-schedule-service.js";
import { getFinalsAdvancement } from "./finals-advancement-service.js";
import { assertQualifyingResultsEditable } from "../lib/qualifying-results-lock.js";
import { requireOpenTournament } from "./tournament-service.js";
import { withPublicSnapshotRebuild } from "../lib/public-snapshot-hook.js";
import { FINALS_ADVANCEMENT_DOC_ID } from "../domain/constants.js";

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
export async function getQualifyingMatchResults(tournamentId) {
  const db = requireDb();
  const snapshot = await getDocs(
    collection(db, "tournaments", tournamentId, "qualifyingMatchResults")
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
export async function getQualifyingMatchResult(tournamentId, matchId) {
  const db = requireDb();
  const snap = await getDoc(
    doc(db, "tournaments", tournamentId, "qualifyingMatchResults", matchId)
  );
  if (!snap.exists()) {
    return null;
  }
  return mapResultDoc(snap);
}

/**
 * @param {string} tournamentId
 * @param {string} matchId
 * @param {object} input
 */
export async function saveQualifyingMatchResult(tournamentId, matchId, input) {
  await requireOpenTournament(tournamentId);

  const [schedule, advancement] = await Promise.all([
    getQualifyingSchedule(tournamentId),
    getFinalsAdvancement(tournamentId),
  ]);

  assertQualifyingResultsEditable(advancement);

  if (!schedule?.finalized) {
    const error = new Error("Finalized qualifying schedule not found");
    error.code = "qualifying-match-result/no-schedule";
    throw error;
  }

  const scheduleMatch = buildScheduleMatchIndex(schedule).get(matchId);
  if (!scheduleMatch) {
    const error = new Error("Match not found in qualifying schedule");
    error.code = "qualifying-match-result/invalid-match";
    throw error;
  }

  const validation = validateMatchResultInput(input);
  if (!validation.valid) {
    const error = new Error(validation.message);
    error.code = "qualifying-match-result/invalid-input";
    throw error;
  }

  const { sets, team1Stats, team2Stats } = validation.data;

  const payload = {
    matchId,
    blockId: scheduleMatch.blockId,
    roundNumber: scheduleMatch.roundNumber,
    courtNumber: scheduleMatch.courtNumber,
    team1: {
      entryId: scheduleMatch.team1.entryId,
      teamName: scheduleMatch.team1.teamName,
    },
    team2: {
      entryId: scheduleMatch.team2.entryId,
      teamName: scheduleMatch.team2.teamName,
    },
    sets,
    team1Stats,
    team2Stats,
    status: MatchResultStatus.FINISHED,
    updatedAt: serverTimestamp(),
  };

  const db = requireDb();
  const docRef = doc(db, "tournaments", tournamentId, "qualifyingMatchResults", matchId);
  const sessionRef = doc(db, "tournaments", tournamentId, "qualifyingMatchSessions", matchId);
  const advancementRef = doc(
    db,
    "tournaments",
    tournamentId,
    "finalsAdvancement",
    FINALS_ADVANCEMENT_DOC_ID
  );

  await runTransaction(db, async (transaction) => {
    const [resultSnap, sessionSnap, advancementSnap] = await Promise.all([
      transaction.get(docRef),
      transaction.get(sessionRef),
      transaction.get(advancementRef),
    ]);

    if (advancementSnap.exists()) {
      throw Object.assign(
        new Error("決勝進出チームが確定済みのため、予選結果は修正できません。"),
        { code: "qualifying-match-result/advancement-finalized" }
      );
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
