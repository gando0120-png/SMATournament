/**
 * ダミー参加者 Firestore 操作（E2E テスト支援・DOM 非依存）
 */
import {
  collection,
  doc,
  writeBatch,
  serverTimestamp,
  deleteDoc,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { getFirebaseDb, isFirebaseConfigured } from "../lib/firebase-app.js";
import { ConfigUnconfiguredError } from "../lib/errors.js";
import {
  buildDummyEntryPayload,
  generateDummyBatchId,
  getDummyEntryStats,
  validateDummyEntryDeletion,
  validateDummyEntryFill,
} from "../domain/dummy-entries.js";
import { buildTournamentStructureState } from "../domain/tournament-structure-state.js";
import { resolveTeamSizeFromTournament } from "../domain/entry-members.js";
import { listEntries } from "./entry-service.js";
import { getBlockDraw } from "./block-draw-service.js";
import { getQualifyingSchedule } from "./qualifying-schedule-service.js";
import { getFinalsAdvancement } from "./finals-advancement-service.js";
import { getFinalsBracket } from "./finals-bracket-service.js";
import { getFinalsMatchResults } from "./finals-match-result-service.js";
import { getTournamentResults } from "./tournament-results-service.js";
import { getTournament, requireOpenTournament } from "./tournament-service.js";
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

/**
 * @param {string} tournamentId
 */
export async function loadTournamentStructureState(tournamentId) {
  const [
    blockDraw,
    qualifyingSchedule,
    finalsAdvancement,
    finalsBracket,
    finalsMatchResults,
    tournamentResults,
  ] = await Promise.all([
    getBlockDraw(tournamentId),
    getQualifyingSchedule(tournamentId),
    getFinalsAdvancement(tournamentId),
    getFinalsBracket(tournamentId),
    getFinalsMatchResults(tournamentId),
    getTournamentResults(tournamentId),
  ]);

  return buildTournamentStructureState({
    blockDraw,
    qualifyingSchedule,
    finalsAdvancement,
    finalsBracket,
    finalsMatchResultsCount: finalsMatchResults.size,
    tournamentResults,
  });
}

/**
 * @param {string} tournamentId
 * @param {{ canManage?: boolean }} [options]
 */
export async function loadDummyEntryToolContext(tournamentId, options = {}) {
  const { canManage = true } = options;
  const [tournament, entries, structureState] = await Promise.all([
    getTournament(tournamentId),
    listEntries(tournamentId),
    loadTournamentStructureState(tournamentId),
  ]);
  const stats = getDummyEntryStats(entries);

  return {
    tournament,
    entries,
    structureState,
    stats,
    canManage,
  };
}

/**
 * @param {string} tournamentId
 * @param {number} targetCount
 */
export async function fillDummyEntriesToTarget(tournamentId, targetCount) {
  await requireOpenTournament(tournamentId);
  const context = await loadDummyEntryToolContext(tournamentId);
  const { tournament, entries, structureState, stats } = context;
  const maxTeams = tournament.maxTeams ?? stats.confirmedCount;

  const validation = validateDummyEntryFill({
    tournament,
    canManage: true,
    structureState,
    targetCount,
    confirmedCount: stats.confirmedCount,
    maxTeams,
    existingEntries: entries,
  });

  if (!validation.valid) {
    const error = new Error(validation.message || "Cannot fill dummy entries");
    error.code = "dummy-entries/invalid-request";
    throw error;
  }

  const { plan } = validation;
  if (plan.toAdd === 0) {
    return withPublicSnapshotRebuild(tournamentId, {
      addedCount: 0,
      targetCount: plan.targetCount,
      dummyBatchId: null,
    });
  }

  const dummyBatchId = generateDummyBatchId();
  const teamSize = resolveTeamSizeFromTournament(tournament);
  const db = requireDb();
  const batch = writeBatch(db);
  const entriesRef = collection(db, "tournaments", tournamentId, "entries");

  plan.teamNames.forEach((teamName, index) => {
    const dummyIndex = index + 1;
    const entryRef = doc(entriesRef);
    const payload = {
      ...buildDummyEntryPayload({
        teamName,
        dummyBatchId,
        dummyIndex,
        teamSize,
      }),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    batch.set(entryRef, payload);
  });

  await batch.commit();

  return withPublicSnapshotRebuild(tournamentId, {
    addedCount: plan.toAdd,
    targetCount: plan.targetCount,
    dummyBatchId,
  });
}

/**
 * @param {string} tournamentId
 * @param {"latest-batch"|"all"} mode
 */
export async function deleteDummyEntries(tournamentId, mode) {
  await requireOpenTournament(tournamentId);
  const context = await loadDummyEntryToolContext(tournamentId);
  const { tournament, entries, structureState } = context;

  const validation = validateDummyEntryDeletion({
    tournament,
    canManage: true,
    structureState,
    entries,
    mode,
  });

  if (!validation.valid) {
    const error = new Error(validation.message || "Cannot delete dummy entries");
    error.code = "dummy-entries/invalid-request";
    throw error;
  }

  const db = requireDb();
  const batch = writeBatch(db);

  for (const entry of validation.targets) {
    if (entry.isDummy !== true) {
      const error = new Error("Refusing to delete non-dummy entry");
      error.code = "dummy-entries/non-dummy-target";
      throw error;
    }
    batch.delete(doc(db, "tournaments", tournamentId, "entries", entry.id));
  }

  await batch.commit();

  return withPublicSnapshotRebuild(tournamentId, {
    deletedCount: validation.targets.length,
    batchId: validation.batchId ?? null,
    mode,
  });
}
