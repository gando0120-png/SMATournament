/**
 * 予選自動進行 Firestore 操作（E2E テスト支援・DOM 非依存）
 */
import {
  doc,
  writeBatch,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { getFirebaseDb, isFirebaseConfigured } from "../lib/firebase-app.js";
import { ConfigUnconfiguredError } from "../lib/errors.js";
import {
  buildQualifyingAutoProgressPlan,
  summarizeQualifyingAutoProgressOutcome,
  validateQualifyingAutoProgress,
} from "../domain/qualifying-auto-progress.js";
import { QualifyingSimulationMode } from "../domain/qualifying-match-result-generator.js";
import {
  buildQualifyingMatchResultPayload,
} from "../domain/qualifying-match-result-payload.js";
import { getQualifyingMatchResults } from "./qualifying-match-result-service.js";
import { getQualifyingSchedule } from "./qualifying-schedule-service.js";
import { getBlockDraw } from "./block-draw-service.js";
import { getFinalsAdvancement } from "./finals-advancement-service.js";
import { getTournament, requireOpenTournament } from "./tournament-service.js";
import { listEntries } from "./entry-service.js";
import { loadTournamentStructureState } from "./dummy-entry-service.js";
import { assertQualifyingResultsEditable } from "../lib/qualifying-results-lock.js";
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
export async function loadQualifyingAutoProgressContext(tournamentId) {
  const [
    tournament,
    entries,
    blockDraw,
    schedule,
    existingResults,
    structureState,
    advancement,
  ] = await Promise.all([
    getTournament(tournamentId),
    listEntries(tournamentId),
    getBlockDraw(tournamentId),
    getQualifyingSchedule(tournamentId),
    getQualifyingMatchResults(tournamentId),
    loadTournamentStructureState(tournamentId),
    getFinalsAdvancement(tournamentId),
  ]);

  const structureWithAdvancement = {
    ...structureState,
    hasFinalsAdvancement: structureState.hasFinalsAdvancement || Boolean(advancement),
  };

  return {
    tournament,
    entries,
    blockDraw,
    schedule,
    existingResults,
    structureState: structureWithAdvancement,
  };
}

/**
 * @param {string} tournamentId
 * @param {{ simulationSeed?: number|string, mode?: string, onProgress?: (progress: object) => void }} [options]
 */
export async function runQualifyingAutoProgress(tournamentId, options = {}) {
  await requireOpenTournament(tournamentId);

  const context = await loadQualifyingAutoProgressContext(tournamentId);
  const { tournament, entries, blockDraw, schedule, existingResults, structureState } = context;

  const eligibility = validateQualifyingAutoProgress({
    tournament,
    canManage: true,
    entries,
    blockDraw,
    schedule,
    structureState,
    existingResults,
  });

  if (!eligibility.allowed) {
    const error = new Error(eligibility.reason || "Cannot run qualifying auto progress");
    error.code = "qualifying-auto-progress/not-allowed";
    throw error;
  }

  const mode = options.mode ?? QualifyingSimulationMode.STANDARD;
  const plan = buildQualifyingAutoProgressPlan({
    tournament,
    canManage: true,
    entries,
    blockDraw,
    schedule,
    structureState,
    existingResults,
    simulationSeed: options.simulationSeed,
    mode,
    tournamentId,
  });

  if (!plan.valid) {
    const error = new Error(plan.message || "Cannot build qualifying auto progress plan");
    error.code = "qualifying-auto-progress/invalid-plan";
    throw error;
  }

  const advancement = await getFinalsAdvancement(tournamentId);
  assertQualifyingResultsEditable(advancement);

  const latestResults = await getQualifyingMatchResults(tournamentId);
  if (latestResults.size > 0) {
    const error = new Error(
      "予選結果がすでに入力されています。手動結果と自動結果の混在を防ぐため、自動進行できません。"
    );
    error.code = "qualifying-auto-progress/existing-results";
    throw error;
  }

  const { generated, simulationSeed: resolvedSeed } = plan;
  const matchEntries = [...generated.results.entries()];
  const totalMatches = matchEntries.length;
  const onProgress = options.onProgress;

  onProgress?.({
    phase: "generating",
    processedMatches: totalMatches,
    totalMatches,
  });

  const db = requireDb();
  const batch = writeBatch(db);
  const timestamp = serverTimestamp();
  const failedMatchIds = [];

  for (let index = 0; index < matchEntries.length; index += 1) {
    const [matchId, item] = matchEntries[index];
    try {
      const payload = buildQualifyingMatchResultPayload(matchId, item.scheduleMatch, item.validated);
      const docRef = doc(db, "tournaments", tournamentId, "qualifyingMatchResults", matchId);
      batch.set(docRef, {
        ...payload,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    } catch (error) {
      failedMatchIds.push(matchId);
    }

    onProgress?.({
      phase: "preparing",
      processedMatches: index + 1,
      totalMatches,
    });
  }

  if (failedMatchIds.length > 0) {
    const error = new Error(
      `予選結果の生成に失敗しました: ${failedMatchIds.slice(0, 3).join(", ")}`
    );
    error.code = "qualifying-auto-progress/generation-failed";
    error.failedMatchIds = failedMatchIds;
    throw error;
  }

  onProgress?.({
    phase: "saving",
    processedMatches: totalMatches,
    totalMatches,
  });

  try {
    await batch.commit();
  } catch (error) {
    error.code = error.code ?? "qualifying-auto-progress/save-failed";
    throw error;
  }

  const savedResults = await getQualifyingMatchResults(tournamentId);
  const outcome = summarizeQualifyingAutoProgressOutcome(schedule, savedResults);

  onProgress?.({
    phase: "done",
    processedMatches: totalMatches,
    totalMatches,
  });

  return withPublicSnapshotRebuild(tournamentId, {
    matchCount: totalMatches,
    blockCount: outcome.blockCount,
    teamCount: outcome.teamCount,
    simulationSeed: resolvedSeed,
    mode: plan.mode,
    remainingMatches: outcome.remainingMatches,
    complete: outcome.complete,
    standings: outcome.standings,
  });
}
