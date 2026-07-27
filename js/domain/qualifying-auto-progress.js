/**
 * 予選自動進行の実行可否・計画（E2E テスト支援・DOM / Firestore 非依存）
 */
import { EntryStatus } from "./constants.js";
import { isBlockDrawFinalized } from "./block-draw-state.js";
import { TournamentFormat } from "./tournament-format.js";
import { canUseTournamentTestTools } from "./test-tournament-access.js";
import { buildScheduleMatchIndex } from "./qualifying-match-result.js";
import { getQualifyingCompletionStatus } from "./finals-advancement.js";
import { buildQualifyingStandings } from "./qualifying-standings.js";
import {
  generateQualifyingMatchResults,
  QualifyingSimulationMode,
} from "./qualifying-match-result-generator.js";
import { deriveDefaultSimulationSeed } from "./seeded-random.js";
import { getDummyEntryStats } from "./dummy-entries.js";

/**
 * @param {Array<object>} entries
 */
export function areAllConfirmedEntriesDummy(entries) {
  const confirmed = entries.filter((entry) => entry.status === EntryStatus.CONFIRMED);
  if (confirmed.length === 0) {
    return false;
  }
  return confirmed.every((entry) => entry.isDummy === true);
}

/**
 * @param {object|null|undefined} schedule
 * @param {Map<string, object>} existingResults
 */
export function countQualifyingMatchProgress(schedule, existingResults = new Map()) {
  const matchIndex = buildScheduleMatchIndex(schedule);
  const completion = getQualifyingCompletionStatus(schedule, existingResults);
  return {
    totalMatches: matchIndex.size,
    finishedMatches: completion.finishedMatches,
    remainingMatches: completion.remainingMatches,
    complete: completion.complete,
  };
}

/**
 * @param {object} params
 */
export function validateQualifyingAutoProgress({
  tournament,
  canManage = false,
  entries = [],
  blockDraw = null,
  schedule = null,
  structureState = null,
  existingResults = new Map(),
}) {
  const access = canUseTournamentTestTools({ tournament, canManage });
  if (!access.allowed) {
    return { allowed: false, reason: access.reason };
  }

  if (tournament?.tournamentFormat !== TournamentFormat.QUALIFYING_AND_FINALS) {
    return {
      allowed: false,
      reason: "予選自動進行は大会形式「予選＋決勝」（qualifying_and_finals）のみ利用できます。",
    };
  }

  const stats = getDummyEntryStats(entries);
  if (stats.confirmedCount === 0) {
    return { allowed: false, reason: "確定参加者がいません。" };
  }

  if (!areAllConfirmedEntriesDummy(entries)) {
    return {
      allowed: false,
      reason: "実参加者が含まれているため、予選自動進行は実行できません。",
    };
  }

  if (!isBlockDrawFinalized(blockDraw)) {
    return { allowed: false, reason: "ブロック抽選が確定していません。" };
  }

  if (!schedule?.finalized) {
    return { allowed: false, reason: "予選対戦表が確定していません。" };
  }

  if (structureState?.hasFinalsAdvancement) {
    return {
      allowed: false,
      reason: "決勝進出が確定済みのため、予選自動進行は実行できません。",
    };
  }

  if (structureState?.hasFinalsBracket) {
    return {
      allowed: false,
      reason: "決勝トーナメントが作成済みのため、予選自動進行は実行できません。",
    };
  }

  if (structureState?.hasTournamentResults) {
    return {
      allowed: false,
      reason: "大会結果が確定済みのため、予選自動進行は実行できません。",
    };
  }

  if (existingResults.size > 0) {
    return {
      allowed: false,
      reason:
        "予選結果がすでに入力されています。手動結果と自動結果の混在を防ぐため、自動進行できません。",
    };
  }

  const progress = countQualifyingMatchProgress(schedule, existingResults);
  if (progress.totalMatches === 0) {
    return { allowed: false, reason: "予選試合がありません。" };
  }

  return {
    allowed: true,
    reason: null,
    progress,
    stats,
  };
}

/**
 * @param {object} params
 */
export function buildQualifyingAutoProgressPlan({
  tournament,
  canManage = false,
  entries = [],
  blockDraw = null,
  schedule = null,
  structureState = null,
  existingResults = new Map(),
  simulationSeed,
  mode = QualifyingSimulationMode.STANDARD,
  tournamentId = null,
}) {
  const validation = validateQualifyingAutoProgress({
    tournament,
    canManage,
    entries,
    blockDraw,
    schedule,
    structureState,
    existingResults,
  });

  if (!validation.allowed) {
    return {
      valid: false,
      message: validation.reason,
      generated: null,
      simulationSeed: null,
      mode,
    };
  }

  const resolvedSeed =
    simulationSeed != null && simulationSeed !== ""
      ? Number(simulationSeed)
      : deriveDefaultSimulationSeed(tournamentId ?? tournament?.id);

  if (!Number.isFinite(resolvedSeed)) {
    return {
      valid: false,
      message: "simulationSeed は数値で指定してください。",
      generated: null,
      simulationSeed: null,
      mode,
    };
  }

  const normalizedMode =
    mode === QualifyingSimulationMode.INCLUDE_DRAWS
      ? QualifyingSimulationMode.INCLUDE_DRAWS
      : QualifyingSimulationMode.STANDARD;

  const generated = generateQualifyingMatchResults({
    schedule,
    simulationSeed: resolvedSeed,
    mode: normalizedMode,
  });

  if (generated.errors.length > 0) {
    return {
      valid: false,
      message: generated.errors[0]?.message ?? "予選結果の生成に失敗しました。",
      generated: null,
      simulationSeed: resolvedSeed,
      mode: normalizedMode,
    };
  }

  if (generated.results.size !== generated.matchCount) {
    return {
      valid: false,
      message: "予選試合の結果をすべて生成できませんでした。",
      generated: null,
      simulationSeed: resolvedSeed,
      mode: normalizedMode,
    };
  }

  return {
    valid: true,
    message: null,
    generated,
    simulationSeed: resolvedSeed,
    mode: normalizedMode,
    progress: validation.progress,
    stats: validation.stats,
  };
}

/**
 * @param {object|null|undefined} schedule
 * @param {Map<string, object>} resultsMap
 */
export function summarizeQualifyingAutoProgressOutcome(schedule, resultsMap) {
  const progress = countQualifyingMatchProgress(schedule, resultsMap);
  const standings = buildQualifyingStandings(schedule, resultsMap);
  const blockCount = standings?.blocks?.length ?? schedule?.blocks?.length ?? 0;
  const teamCount = (schedule?.blocks ?? []).reduce(
    (sum, block) => sum + (block.teamCount ?? block.teams?.length ?? 0),
    0
  );

  return {
    ...progress,
    blockCount,
    teamCount,
    standings,
  };
}
