/**
 * 敗戦帯（loss_band）エンジン — Phase 1 公開 API
 */
export {
  RankingMode,
  LOSS_BAND_TEAM_COUNT,
  LOSS_BAND_RANKING_ROUND_COUNT,
  LOSS_BAND_FINAL_ROUND_NUMBER,
  EXPECTED_BAND_COUNTS_AT_ROUND_START,
  R5_PLACEMENT_SPEC,
  LossBandPhase,
} from "./constants.js";

export {
  normalizeEntryIds,
  createInitialLossBandState,
  listActiveEntryIds,
  listUnplacedEntryIds,
  listEntryIdsInBand,
  getActiveBandCounts,
  bandCountsEqual,
  groupByFinalPlacement,
} from "./state.js";

export {
  pairEntryIdsDeterministic,
  buildLossBandMatchId,
  buildRankingRoundPairings,
  applyRankingRoundResults,
  applyFinalRankingRoundResults,
  buildFinalPairing,
  applyFinalResult,
  buildDeterministicTeam1WinsResults,
} from "./progression.js";

export {
  expectedR5TiePlacementCounts,
  validateCompletePlacements,
  listPlacementRows,
} from "./placements.js";

export {
  validateLossBandStateInvariants,
  validateBandCountsAtRoundStart,
  validatePairingsCoverage,
} from "./validate.js";
