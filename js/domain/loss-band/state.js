/**
 * 敗戦帯 state の生成・照会（純関数）
 */
import {
  LOSS_BAND_TEAM_COUNT,
  LossBandPhase,
} from "./constants.js";

/**
 * @param {string[]} entryIds
 * @returns {{ valid: true, values: string[] } | { valid: false, error: string }}
 */
export function normalizeEntryIds(entryIds) {
  if (!Array.isArray(entryIds)) {
    return { valid: false, error: "entryIds must be an array" };
  }
  if (entryIds.length !== LOSS_BAND_TEAM_COUNT) {
    return {
      valid: false,
      error: `entryIds length must be ${LOSS_BAND_TEAM_COUNT}, got ${entryIds.length}`,
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
 * 64 チーム初期 state（全員 0 敗・未順位）
 * @param {string[]} entryIds
 * @param {{ thirdPlaceMatch?: boolean, rematchAvoidance?: boolean }} [options]
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
      finalPlacement: null,
    };
  }

  return {
    teamCount: LOSS_BAND_TEAM_COUNT,
    teams,
    /** 完了済み順位決定ラウンド番号（0 = 未実施） */
    completedRankingRound: 0,
    phase: LossBandPhase.RANKING,
    /** 決勝進出者（R5 後に設定、entryId 昇順） */
    finalists: null,
    /** 3位決定戦対象（thirdPlaceMatch=true 時、R5 0敗敗者） */
    thirdPlaceFinalists: null,
    thirdPlaceMatch: options.thirdPlaceMatch === true,
    rematchAvoidance: options.rematchAvoidance === true,
    /** 実施済み試合ログ（対戦履歴の正） */
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
 * @returns {string[]} 昇順
 */
export function listEntryIdsInBand(state, lossCount) {
  return listActiveEntryIds(state).filter(
    (entryId) =>
      state.teams[entryId].finalPlacement == null &&
      state.teams[entryId].lossCount === lossCount
  );
}

/**
 * 未確定チームのみの敗戦帯人数
 * @param {object} state
 * @returns {Record<number, number>}
 */
export function getActiveBandCounts(state) {
  const counts = {};
  for (const entryId of listUnplacedEntryIds(state)) {
    const loss = state.teams[entryId].lossCount;
    counts[loss] = (counts[loss] ?? 0) + 1;
  }
  return counts;
}

/**
 * @param {Record<number, number>} actual
 * @param {Record<number, number>} expected
 */
export function bandCountsEqual(actual, expected) {
  const actualKeys = Object.keys(actual)
    .map(Number)
    .filter((k) => (actual[k] ?? 0) > 0)
    .sort((a, b) => a - b);
  const expectedKeys = Object.keys(expected)
    .map(Number)
    .filter((k) => (expected[k] ?? 0) > 0)
    .sort((a, b) => a - b);
  if (actualKeys.length !== expectedKeys.length) {
    return false;
  }
  for (let i = 0; i < actualKeys.length; i += 1) {
    if (actualKeys[i] !== expectedKeys[i]) {
      return false;
    }
    if ((actual[actualKeys[i]] ?? 0) !== (expected[expectedKeys[i]] ?? 0)) {
      return false;
    }
  }
  return true;
}

/**
 * @param {object} state
 * @returns {Map<number, string[]>} placement → entryIds
 */
export function groupByFinalPlacement(state) {
  const groups = new Map();
  for (const entryId of listActiveEntryIds(state)) {
    const placement = state.teams[entryId].finalPlacement;
    if (placement == null) {
      continue;
    }
    if (!groups.has(placement)) {
      groups.set(placement, []);
    }
    groups.get(placement).push(entryId);
  }
  for (const ids of groups.values()) {
    ids.sort((a, b) => a.localeCompare(b, "en"));
  }
  return groups;
}
