/**
 * R5 / 最終順位決定ラウンドの動的 Olympic（standard competition）順位
 * - winner + BYE = 敗戦帯維持組（同順位帯）
 * - loser = 1段下降組
 * - 同順位人数分だけ次順位をスキップ
 * 32 / 64 / 128 すべて本関数が本番経路。
 * 64 固定 R5_PLACEMENT_SPEC は回帰用（Olympic 結果が一致することをテストで証明）。
 */
import { R5_PLACEMENT_SPEC } from "./constants.js";

/**
 * @param {{
 *   stayersByLoss: Map<number, string[]>,
 *   losersByLoss: Map<number, string[]>,
 *   thirdPlaceMatch?: boolean,
 *   teamCount?: number
 * }} params
 * @returns {{
 *   finalists: string[],
 *   thirdPlaceFinalists: string[],
 *   autoThirdPlaceEntryIds: string[],
 *   placements: Array<{ entryId: string, placement: number, lossCount: number, kind: 'stay'|'drop' }>,
 *   groups: Array<{ lossCount: number, kind: 'stay'|'drop', placement: number|null, entryIds: string[] }>
 * }}
 */
export function buildOlympicR5PlacementPlan(params) {
  const {
    stayersByLoss,
    losersByLoss,
    thirdPlaceMatch = false,
  } = params;

  const lossKeys = [
    ...new Set([
      ...stayersByLoss.keys(),
      ...losersByLoss.keys(),
    ]),
  ].sort((a, b) => a - b);

  const finalists = [...(stayersByLoss.get(0) ?? [])].sort((a, b) =>
    a.localeCompare(b, "en")
  );

  const zeroLosers = [...(losersByLoss.get(0) ?? [])].sort((a, b) =>
    a.localeCompare(b, "en")
  );

  /** @type {string[]} */
  let thirdPlaceFinalists = [];
  /** @type {string[]} */
  let autoThirdPlaceEntryIds = [];

  /** @type {Array<{ lossCount: number, kind: 'stay'|'drop', entryIds: string[] }>} */
  const orderedGroups = [];

  if (thirdPlaceMatch) {
    if (zeroLosers.length >= 2) {
      thirdPlaceFinalists = zeroLosers.slice(0, 2);
      const rest = zeroLosers.slice(2);
      if (rest.length) {
        orderedGroups.push({ lossCount: 0, kind: "drop", entryIds: rest });
      }
    } else if (zeroLosers.length === 1) {
      autoThirdPlaceEntryIds = zeroLosers;
    }
  } else if (zeroLosers.length > 0) {
    orderedGroups.push({ lossCount: 0, kind: "drop", entryIds: zeroLosers });
  }

  for (const lossCount of lossKeys) {
    if (lossCount === 0) continue;
    const stayers = [...(stayersByLoss.get(lossCount) ?? [])].sort((a, b) =>
      a.localeCompare(b, "en")
    );
    const losers = [...(losersByLoss.get(lossCount) ?? [])].sort((a, b) =>
      a.localeCompare(b, "en")
    );
    if (stayers.length) {
      orderedGroups.push({ lossCount, kind: "stay", entryIds: stayers });
    }
    if (losers.length) {
      orderedGroups.push({ lossCount, kind: "drop", entryIds: losers });
    }
  }

  /** @type {Array<{ entryId: string, placement: number, lossCount: number, kind: 'stay'|'drop' }>} */
  const placements = [];
  /** @type {Array<{ lossCount: number, kind: 'stay'|'drop', placement: number|null, entryIds: string[] }>} */
  const groups = [];

  if (autoThirdPlaceEntryIds.length === 1) {
    const entryId = autoThirdPlaceEntryIds[0];
    placements.push({
      entryId,
      placement: 3,
      lossCount: 0,
      kind: "drop",
    });
    groups.push({
      lossCount: 0,
      kind: "drop",
      placement: 3,
      entryIds: [entryId],
    });
  }

  let nextRank = 3;
  if (thirdPlaceFinalists.length === 2) {
    nextRank = 5;
  } else if (autoThirdPlaceEntryIds.length === 1) {
    nextRank = 4;
  }

  for (const g of orderedGroups) {
    const placement = nextRank;
    groups.push({
      lossCount: g.lossCount,
      kind: g.kind,
      placement,
      entryIds: g.entryIds,
    });
    for (const entryId of g.entryIds) {
      placements.push({
        entryId,
        placement,
        lossCount: g.lossCount,
        kind: g.kind,
      });
    }
    nextRank += g.entryIds.length;
  }

  return {
    finalists,
    thirdPlaceFinalists,
    autoThirdPlaceEntryIds,
    placements,
    groups,
  };
}

/**
 * 64チーム固定仕様の期待値（回帰用）
 * @param {{ thirdPlaceMatch?: boolean }} [options]
 */
export function expectedFixed64R5PlacementCounts(options = {}) {
  const thirdPlaceMatch = options.thirdPlaceMatch === true;
  const map = new Map();
  for (const spec of R5_PLACEMENT_SPEC) {
    if (spec.placement == null) continue;
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
 * @deprecated Phase 9-1: 本番は常に Olympic。回帰互換のため残す（常に false）。
 * @param {number} [_teamCount]
 */
export function usesFixed64PlacementSpec(_teamCount) {
  return false;
}
