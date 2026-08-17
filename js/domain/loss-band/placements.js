/**
 * 敗戦帯の順位検証・集計（純関数）
 * 表示文言は formatLossBandPlacementLabel に分離する。
 */
import { LOSS_BAND_TEAM_COUNT, R5_PLACEMENT_SPEC } from "./constants.js";
import { groupByFinalPlacement, listActiveEntryIds } from "./state.js";

/**
 * @param {{ thirdPlaceMatch?: boolean }} [options]
 * @returns {Map<number, number>} placement → expected count
 */
export function expectedFinalPlacementCounts(options = {}) {
  const thirdPlaceMatch = options.thirdPlaceMatch === true;
  const map = new Map([
    [1, 1],
    [2, 1],
  ]);

  if (thirdPlaceMatch) {
    map.set(3, 1);
    map.set(4, 1);
  }

  for (const spec of R5_PLACEMENT_SPEC) {
    if (spec.placement == null) {
      continue;
    }
    if (
      thirdPlaceMatch &&
      spec.lossCount === 0 &&
      spec.outcome === "loser" &&
      spec.placement === 3
    ) {
      continue;
    }
    map.set(spec.placement, (map.get(spec.placement) ?? 0) + spec.count);
  }
  return map;
}

/**
 * R5 後に期待されるタイ配置人数（決勝進出は含まない）
 * thirdPlaceMatch=false 時の 3位タイを含む。
 * @param {{ thirdPlaceMatch?: boolean }} [options]
 * @returns {Map<number, number>}
 */
export function expectedR5TiePlacementCounts(options = {}) {
  const thirdPlaceMatch = options.thirdPlaceMatch === true;
  const map = new Map();
  for (const spec of R5_PLACEMENT_SPEC) {
    if (spec.placement == null) {
      continue;
    }
    if (
      thirdPlaceMatch &&
      spec.lossCount === 0 &&
      spec.outcome === "loser" &&
      spec.placement === 3
    ) {
      continue;
    }
    map.set(spec.placement, (map.get(spec.placement) ?? 0) + spec.count);
  }
  return map;
}

/**
 * domain 用タイ判定（表示文言は持たない）
 * @param {number} placement
 * @param {Map<number, number>} placementCounts
 */
export function isTiedPlacement(placement, placementCounts) {
  return (placementCounts.get(placement) ?? 0) > 1;
}

/**
 * 表示用ラベル（UI 向け。domain 永続化には使わない）
 * @param {number} placement
 * @param {boolean} isTied
 */
export function formatLossBandPlacementLabel(placement, isTied) {
  if (!Number.isInteger(placement) || placement < 1) {
    return "—";
  }
  return isTied ? `${placement}位タイ` : `${placement}位`;
}

/**
 * @param {object} state
 * @returns {Array<{
 *   entryId: string,
 *   placement: number,
 *   isTied: boolean,
 *   tiedCount: number,
 *   lossCount: number
 * }>}
 */
export function buildPlacementRecords(state) {
  const groups = groupByFinalPlacement(state);
  const placementCounts = new Map();
  for (const [placement, ids] of groups) {
    placementCounts.set(placement, ids.length);
  }

  const rows = [];
  for (const entryId of listActiveEntryIds(state)) {
    const team = state.teams[entryId];
    const placement = team.finalPlacement;
    if (placement == null) {
      continue;
    }
    const tiedCount = placementCounts.get(placement) ?? 1;
    rows.push({
      entryId,
      placement,
      isTied: tiedCount > 1,
      tiedCount,
      lossCount: team.lossCount,
    });
  }

  rows.sort((a, b) => {
    if (a.placement !== b.placement) {
      return a.placement - b.placement;
    }
    return a.entryId.localeCompare(b.entryId, "en");
  });
  return rows;
}

/**
 * @param {object} state complete 後
 * @param {{ thirdPlaceMatch?: boolean }} [options]
 * @returns {{ valid: boolean, errors: string[], placementCounts: Map<number, number> }}
 */
export function validateCompletePlacements(state, options = {}) {
  const thirdPlaceMatch =
    options.thirdPlaceMatch === true || state.thirdPlaceMatch === true;
  const errors = [];
  const groups = groupByFinalPlacement(state);
  const placementCounts = new Map();

  for (const [placement, ids] of groups) {
    placementCounts.set(placement, ids.length);
  }

  const allIds = listActiveEntryIds(state);
  if (allIds.length !== LOSS_BAND_TEAM_COUNT) {
    errors.push(`team count ${allIds.length} !== ${LOSS_BAND_TEAM_COUNT}`);
  }

  const placed = allIds.filter((id) => state.teams[id].finalPlacement != null);
  if (placed.length !== LOSS_BAND_TEAM_COUNT) {
    errors.push(`placed count ${placed.length} !== ${LOSS_BAND_TEAM_COUNT}`);
  }

  const uniquePlaced = new Set(placed);
  if (uniquePlaced.size !== placed.length) {
    errors.push("duplicate entry among placed teams");
  }

  // 同一 entry が複数 placement に入っていないこと（teams map の一意性）
  const seen = new Set();
  for (const entryId of placed) {
    if (seen.has(entryId)) {
      errors.push(`duplicate placement registration: ${entryId}`);
    }
    seen.add(entryId);
  }

  const expected = expectedFinalPlacementCounts({ thirdPlaceMatch });
  for (const [placement, count] of expected) {
    if ((placementCounts.get(placement) ?? 0) !== count) {
      errors.push(
        `placement ${placement} count=${placementCounts.get(placement) ?? 0}, expected ${count}`
      );
    }
  }

  for (const placement of placementCounts.keys()) {
    if (!expected.has(placement)) {
      errors.push(`unexpected placement value: ${placement}`);
    }
  }

  let sum = 0;
  for (const count of placementCounts.values()) {
    sum += count;
  }
  if (sum !== LOSS_BAND_TEAM_COUNT) {
    errors.push(`sum of placement counts ${sum} !== ${LOSS_BAND_TEAM_COUNT}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    placementCounts,
  };
}

/**
 * @param {object} state
 * @returns {Array<{ entryId: string, lossCount: number, finalPlacement: number|null }>}
 */
export function listPlacementRows(state) {
  return listActiveEntryIds(state).map((entryId) => ({
    entryId,
    lossCount: state.teams[entryId].lossCount,
    finalPlacement: state.teams[entryId].finalPlacement,
  }));
}
