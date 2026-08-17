/**
 * 敗戦帯 state の生成・照会（純関数）
 */
import {
  LOSS_BAND_MIN_TEAM_COUNT,
  LOSS_BAND_MAX_TEAM_COUNT,
  LOSS_BAND_DEFAULT_GUARANTEED_MATCH_COUNT,
  LossBandPhase,
} from "./constants.js";

/**
 * @param {string[]} entryIds
 * @param {{ min?: number, max?: number }} [options]
 * @returns {{ valid: true, values: string[] } | { valid: false, error: string }}
 */
export function normalizeEntryIds(entryIds, options = {}) {
  const min = options.min ?? LOSS_BAND_MIN_TEAM_COUNT;
  const max = options.max ?? LOSS_BAND_MAX_TEAM_COUNT;

  if (!Array.isArray(entryIds)) {
    return { valid: false, error: "entryIds must be an array" };
  }
  if (entryIds.length < min || entryIds.length > max) {
    return {
      valid: false,
      error: `entryIds length must be ${min}..${max}, got ${entryIds.length}`,
    };
  }

  const normalized = [];
  const seen = new Set();
  for (const raw of entryIds) {
    if (typeof raw !== "string" || !raw.trim()) {
      return { valid: false, error: "each entryId must be a non-empty string" };
    }
    const id = raw.trim();
    if (seen.has(id)) {
      return { valid: false, error: `duplicate entryId: ${id}` };
    }
    seen.add(id);
    normalized.push(id);
  }

  return { valid: true, values: normalized };
}

/**
 * 初期 state（全員 0 敗・未順位）
 * @param {string[]} entryIds
 * @param {{ thirdPlaceMatch?: boolean, rematchAvoidance?: boolean, guaranteedMatchCount?: number }} [options]
 */
export function createInitialLossBandState(entryIds, options = {}) {
  const normalized = normalizeEntryIds(entryIds);
  if (!normalized.valid) {
    const error = new Error(normalized.error);
    error.code = "loss-band/invalid-entry-ids";
    throw error;
  }

  const teams = {};
  for (const entryId of normalized.values) {
    teams[entryId] = {
      entryId,
      lossCount: 0,
      byeCount: 0,
      finalPlacement: null,
    };
  }

  const guaranteed =
    Number.isInteger(options.guaranteedMatchCount) &&
    options.guaranteedMatchCount >= 1
      ? options.guaranteedMatchCount
      : LOSS_BAND_DEFAULT_GUARANTEED_MATCH_COUNT;

  return {
    teamCount: normalized.values.length,
    teams,
    /** 完了済み順位決定ラウンド番号（0 = 未実施） */
    completedRankingRound: 0,
    phase: LossBandPhase.RANKING,
    /** 決勝進出者（R5 後に設定、entryId 昇順） */
    finalists: null,
    /** 3位決定戦対象（thirdPlaceMatch=true 時、0敗敗者2人） */
    thirdPlaceFinalists: null,
    thirdPlaceMatch: options.thirdPlaceMatch === true,
    rematchAvoidance: options.rematchAvoidance === true,
    guaranteedMatchCount: guaranteed,
    /** 実施済み試合ログ（対戦履歴の正。BYE は resolution=bye） */
    matchLog: [],
  };
}

/**
 * @param {object} state
 * @returns {string[]}
 */
export function listActiveEntryIds(state) {
  return Object.keys(state?.teams ?? {}).sort((a, b) => a.localeCompare(b, "en"));
}

/**
 * finalPlacement 未確定のチーム（決勝進出者含む）
 * @param {object} state
 * @returns {string[]}
 */
export function listUnplacedEntryIds(state) {
  return listActiveEntryIds(state).filter(
    (entryId) => state.teams[entryId].finalPlacement == null
  );
}

/**
 * @param {object} state
 * @param {number} lossCount
 * @returns {string[]}
 */
export function listEntryIdsInBand(state, lossCount) {
  return listActiveEntryIds(state).filter(
    (entryId) =>
      state.teams[entryId].finalPlacement == null &&
      state.teams[entryId].lossCount === lossCount
  );
}

/**
 * @param {object} state
 * @returns {Record<number, number>}
 */
export function getActiveBandCounts(state) {
  /** @type {Record<number, number>} */
  const counts = {};
  for (const entryId of listUnplacedEntryIds(state)) {
    const lossCount = state.teams[entryId].lossCount;
    counts[lossCount] = (counts[lossCount] ?? 0) + 1;
  }
  return counts;
}

/**
 * @param {Record<number, number>|object} a
 * @param {Record<number, number>|object} b
 */
export function bandCountsEqual(a, b) {
  const keys = new Set([
    ...Object.keys(a ?? {}).map(Number),
    ...Object.keys(b ?? {}).map(Number),
  ]);
  for (const key of keys) {
    if ((a?.[key] ?? 0) !== (b?.[key] ?? 0)) {
      return false;
    }
  }
  return true;
}

/**
 * @param {object} state
 * @returns {Map<number, string[]>}
 */
export function groupByFinalPlacement(state) {
  /** @type {Map<number, string[]>} */
  const groups = new Map();
  for (const entryId of listActiveEntryIds(state)) {
    const placement = state.teams[entryId].finalPlacement;
    if (placement == null) continue;
    if (!groups.has(placement)) groups.set(placement, []);
    groups.get(placement).push(entryId);
  }
  for (const [, ids] of groups) {
    ids.sort((a, b) => a.localeCompare(b, "en"));
  }
  return groups;
}
