/**
 * 公開大会スナップショット Firestore 操作（operator 書き込み）
 */
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { getFirebaseDb, isFirebaseConfigured } from "../lib/firebase-app.js";
import { ConfigUnconfiguredError, TournamentNotFoundError } from "../lib/errors.js";
import {
  buildPublicTournamentSnapshot as buildPublicTournamentSnapshotInternal,
  PUBLIC_SNAPSHOT_DOC_ID,
} from "../domain/public-tournament-snapshot.js";
import { getTournament } from "./tournament-service.js";
import { listEntries } from "./entry-service.js";
import { getBlockDraw } from "./block-draw-service.js";
import { getQualifyingSchedule } from "./qualifying-schedule-service.js";
import { getQualifyingMatchResults } from "./qualifying-match-result-service.js";
import { getQualifyingMatchSession } from "./qualifying-match-session-service.js";
import { getFinalsAdvancement } from "./finals-advancement-service.js";
import { getFinalsBracket } from "./finals-bracket-service.js";
import { getFinalsMatchResults } from "./finals-match-result-service.js";
import { getFinalsMatchSessions } from "./finals-match-session-service.js";
import { getTournamentResults } from "./tournament-results-service.js";
import { getConsolationBracket } from "./consolation-bracket-service.js";
import { BracketKind } from "../domain/bracket-collections.js";

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

/**
 * operator 用データ読み込み（スナップショット生成専用）
 * @param {string} tournamentId
 */
export async function loadOperatorTournamentData(tournamentId) {
  const tournament = await getTournament(tournamentId);

  const [
    entries,
    blockDraw,
    schedule,
    qualifyingResultsMap,
    finalsAdvancement,
    finalsBracket,
    finalsResultsMap,
    finalsSessionsMap,
    tournamentResults,
    consolationBracket,
    consolationResultsMap,
    consolationSessionsMap,
  ] = await Promise.all([
    listEntries(tournamentId),
    getBlockDraw(tournamentId),
    getQualifyingSchedule(tournamentId),
    getQualifyingMatchResults(tournamentId),
    getFinalsAdvancement(tournamentId),
    getFinalsBracket(tournamentId),
    getFinalsMatchResults(tournamentId),
    getFinalsMatchSessions(tournamentId),
    getTournamentResults(tournamentId),
    getConsolationBracket(tournamentId),
    getFinalsMatchResults(tournamentId, { bracketKind: BracketKind.CONSOLATION }),
    getFinalsMatchSessions(tournamentId, { bracketKind: BracketKind.CONSOLATION }),
  ]);

  const qualifyingSessionsMap = new Map();
  if (schedule?.finalized) {
    const sessionIds = new Set();
    for (const block of schedule.blocks ?? []) {
      for (const round of block.rounds ?? []) {
        for (const match of round.matches ?? []) {
          if (match.matchId) {
            sessionIds.add(match.matchId);
          }
        }
      }
    }
    await Promise.all(
      [...sessionIds].map(async (matchId) => {
        const session = await getQualifyingMatchSession(tournamentId, matchId);
        if (session) {
          qualifyingSessionsMap.set(matchId, session);
        }
      })
    );
  }

  return {
    tournament,
    entries,
    blockDraw,
    schedule,
    qualifyingResultsMap,
    qualifyingSessionsMap,
    finalsAdvancement,
    finalsBracket,
    finalsResultsMap,
    finalsSessionsMap,
    tournamentResults,
    consolationBracket,
    consolationResultsMap,
    consolationSessionsMap,
  };
}

/**
 * @param {object} operatorData
 */
export function buildPublicTournamentSnapshot(operatorData) {
  return buildPublicTournamentSnapshotFromOperatorData(operatorData);
}

/**
 * @param {object} operatorData
 */
export function buildPublicTournamentSnapshotFromOperatorData(operatorData) {
  return buildPublicTournamentSnapshotInternal(operatorData);
}

/**
 * @param {string} tournamentId
 * @param {object} snapshot
 */
export async function savePublicTournamentSnapshot(tournamentId, snapshot) {
  const db = requireDb();
  const ref = doc(db, "tournaments", tournamentId, "publicSnapshot", PUBLIC_SNAPSHOT_DOC_ID);

  await setDoc(ref, {
    ...snapshot,
    updatedAt: serverTimestamp(),
  });
}

/**
 * @param {string} tournamentId
 */
export async function rebuildPublicTournamentSnapshot(tournamentId) {
  const operatorData = await loadOperatorTournamentData(tournamentId);
  if (!operatorData.tournament) {
    throw new TournamentNotFoundError();
  }

  const snapshot = buildPublicTournamentSnapshotFromOperatorData(operatorData);
  await savePublicTournamentSnapshot(tournamentId, snapshot);
  return snapshot;
}

/**
 * @param {string} tournamentId
 */
export async function getPublicTournamentSnapshot(tournamentId) {
  const db = requireDb();
  const snap = await getDoc(
    doc(db, "tournaments", tournamentId, "publicSnapshot", PUBLIC_SNAPSHOT_DOC_ID)
  );
  if (!snap.exists()) {
    return null;
  }
  return snap.data();
}
