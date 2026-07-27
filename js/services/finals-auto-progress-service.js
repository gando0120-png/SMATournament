/**
 * 決勝トーナメント自動進行 Firestore 操作（E2E テスト支援・DOM 非依存）
 */
import {
  doc,
  writeBatch,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { getFirebaseDb, isFirebaseConfigured } from "../lib/firebase-app.js";
import { ConfigUnconfiguredError } from "../lib/errors.js";
import { MatchSessionStatus } from "../domain/constants.js";
import {
  buildFinalsAutoProgressPlan,
  summarizeFinalsAutoProgressOutcome,
  validateFinalsAutoProgress,
} from "../domain/finals-auto-progress.js";
import { FinalsSimulationMode } from "../domain/finals-match-result-generator.js";
import { getFinalsMatchResults } from "./finals-match-result-service.js";
import { getFinalsBracket } from "./finals-bracket-service.js";
import { getFinalsAdvancement } from "./finals-advancement-service.js";
import { getTournamentResults } from "./tournament-results-service.js";
import { getTournament, requireOpenTournament } from "./tournament-service.js";
import { listEntries } from "./entry-service.js";
import { loadTournamentStructureState } from "./dummy-entry-service.js";
import { withPublicSnapshotRebuild } from "../lib/public-snapshot-hook.js";

const FIRESTORE_BATCH_OP_LIMIT = 450;

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
export async function loadFinalsAutoProgressContext(tournamentId) {
  const [
    tournament,
    entries,
    bracket,
    finalsAdvancement,
    existingResults,
    structureState,
    tournamentResults,
  ] = await Promise.all([
    getTournament(tournamentId),
    listEntries(tournamentId),
    getFinalsBracket(tournamentId),
    getFinalsAdvancement(tournamentId),
    getFinalsMatchResults(tournamentId),
    loadTournamentStructureState(tournamentId),
    getTournamentResults(tournamentId),
  ]);

  const structureWithResults = {
    ...structureState,
    hasTournamentResults: structureState.hasTournamentResults || Boolean(tournamentResults),
  };

  return {
    tournament,
    entries,
    bracket,
    finalsAdvancement,
    existingResults,
    structureState: structureWithResults,
  };
}

/**
 * @param {import("https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js").Firestore} db
 * @param {string} tournamentId
 * @param {object} plan
 */
async function commitFinalsAutoProgressPlan(db, tournamentId, plan) {
  const { simulation } = plan;
  const timestamp = serverTimestamp();
  const operations = [];

  for (const byePlan of simulation.byeResults) {
    operations.push({
      type: "result",
      matchId: byePlan.matchId,
      payload: byePlan.payload,
    });
  }

  for (const playedPlan of simulation.playedPlans) {
    operations.push({
      type: "session-create",
      matchId: playedPlan.matchId,
      payload: {
        ...playedPlan.sessionBase,
        status: MatchSessionStatus.PLAYING,
      },
    });
    operations.push({
      type: "session-finish",
      matchId: playedPlan.matchId,
    });
    operations.push({
      type: "result",
      matchId: playedPlan.matchId,
      payload: playedPlan.resultPayload,
    });
  }

  for (let offset = 0; offset < operations.length; offset += FIRESTORE_BATCH_OP_LIMIT) {
    const chunk = operations.slice(offset, offset + FIRESTORE_BATCH_OP_LIMIT);
    const batch = writeBatch(db);

    for (const operation of chunk) {
      if (operation.type === "session-create") {
        const sessionRef = doc(
          db,
          "tournaments",
          tournamentId,
          "finalsMatchSessions",
          operation.matchId
        );
        batch.set(sessionRef, {
          ...operation.payload,
          startedAt: timestamp,
          updatedAt: timestamp,
        });
        continue;
      }

      if (operation.type === "session-finish") {
        const sessionRef = doc(
          db,
          "tournaments",
          tournamentId,
          "finalsMatchSessions",
          operation.matchId
        );
        batch.update(sessionRef, {
          status: MatchSessionStatus.FINISHED,
          finishedAt: timestamp,
          updatedAt: timestamp,
        });
        continue;
      }

      const resultRef = doc(
        db,
        "tournaments",
        tournamentId,
        "finalsMatchResults",
        operation.matchId
      );
      batch.set(resultRef, {
        ...operation.payload,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }

    await batch.commit();
  }
}

/**
 * @param {string} tournamentId
 * @param {{ simulationSeed?: number|string, mode?: string, onProgress?: (progress: object) => void }} [options]
 */
export async function runFinalsAutoProgress(tournamentId, options = {}) {
  await requireOpenTournament(tournamentId);

  const context = await loadFinalsAutoProgressContext(tournamentId);
  const {
    tournament,
    entries,
    bracket,
    finalsAdvancement,
    existingResults,
    structureState,
  } = context;

  const eligibility = validateFinalsAutoProgress({
    tournament,
    canManage: true,
    entries,
    bracket,
    finalsAdvancement,
    existingResults,
    structureState,
  });

  if (!eligibility.allowed) {
    const error = new Error(eligibility.reason || "Cannot run finals auto progress");
    error.code = "finals-auto-progress/not-allowed";
    throw error;
  }

  const mode = options.mode ?? FinalsSimulationMode.STANDARD;
  const plan = buildFinalsAutoProgressPlan({
    tournament,
    canManage: true,
    entries,
    bracket,
    finalsAdvancement,
    existingResults,
    structureState,
    simulationSeed: options.simulationSeed,
    mode,
    tournamentId,
  });

  if (!plan.valid) {
    const error = new Error(plan.message || "Cannot build finals auto progress plan");
    error.code = "finals-auto-progress/invalid-plan";
    throw error;
  }

  const latestResults = await getFinalsMatchResults(tournamentId);
  if (latestResults.size > 0) {
    const error = new Error(
      "決勝結果がすでに入力されています。手動結果と自動結果の混在を防ぐため、自動進行できません。"
    );
    error.code = "finals-auto-progress/existing-results";
    throw error;
  }

  const onProgress = options.onProgress;
  const totalMatches = plan.simulation.playedPlans.length;
  onProgress?.({
    phase: "simulating",
    processedMatches: totalMatches,
    totalMatches,
    currentRound: plan.simulation.progress.roundCount,
  });

  const db = requireDb();

  onProgress?.({
    phase: "saving",
    processedMatches: 0,
    totalMatches,
    currentRound: null,
  });

  try {
    await commitFinalsAutoProgressPlan(db, tournamentId, plan);
  } catch (error) {
    error.code = error.code ?? "finals-auto-progress/save-failed";
    throw error;
  }

  const savedResults = await getFinalsMatchResults(tournamentId);
  const outcome = summarizeFinalsAutoProgressOutcome(bracket, savedResults);

  onProgress?.({
    phase: "done",
    processedMatches: totalMatches,
    totalMatches,
    currentRound: outcome.roundCount,
  });

  return withPublicSnapshotRebuild(tournamentId, {
    playedMatchCount: outcome.finishedPlayedMatches,
    participantCount: outcome.participantCount,
    roundCount: outcome.roundCount,
    simulationSeed: plan.simulationSeed,
    mode: plan.mode,
    champion: outcome.champion,
    runnerUp: outcome.runnerUp,
    remainingMatches: outcome.remainingPlayedMatches,
    complete: outcome.complete,
    canPreviewTournamentResults: outcome.canPreviewTournamentResults,
  });
}
