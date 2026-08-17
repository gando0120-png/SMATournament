/**
 * 敗戦帯の順位検証・集計（純関数）
 */
import { LOSS_BAND_TEAM_COUNT, R5_PLACEMENT_SPEC } from "./constants.js";
import { groupByFinalPlacement, listActiveEntryIds } from "./state.js";

/**
 * R5 後に期待されるタイ配置人数（決勝進出は含まない）
 * @returns {Map<number, number>}
 */
export function expectedR5TiePlacementCounts() {
  const map = new Map();
  for (const spec of R5_PLACEMENT_SPEC) {
    if (spec.placement == null) {
      continue;
    }
    map.set(spec.placement, (map.get(spec.placement) ?? 0) + spec.count);
  }
  return map;
}

/**
 * @param {object} state complete 後
 * @returns {{ valid: boolean, errors: string[], placementCounts: Map<number, number> }}
 */
export function validateCompletePlacements(state) {
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

  // 1,2 は単独。タイは R5 仕様どおり。
  if ((placementCounts.get(1) ?? 0) !== 1) {
    errors.push(`placement 1 count=${placementCounts.get(1) ?? 0}, expected 1`);
  }
  if ((placementCounts.get(2) ?? 0) !== 1) {
    errors.push(`placement 2 count=${placementCounts.get(2) ?? 0}, expected 1`);
  }

  const expectedTies = expectedR5TiePlacementCounts();
  for (const [placement, count] of expectedTies) {
    if ((placementCounts.get(placement) ?? 0) !== count) {
      errors.push(
        `placement ${placement} count=${placementCounts.get(placement) ?? 0}, expected ${count}`
      );
    }
  }

  // 余分な placement がないこと
  for (const placement of placementCounts.keys()) {
    if (placement === 1 || placement === 2) {
      continue;
    }
    if (!expectedTies.has(placement)) {
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
