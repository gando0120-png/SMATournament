/**
 * 敗戦帯（loss_band）エンジン — Phase 1–3 公開 API
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
  resolveRankingMode,
  resolveMainRankingMode,
  validateSideRankingMode,
} from "./config.js";

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
  pairEntryIdsWithRematchAvoidance,
  buildOpponentHistoryFromMatchLog,
  normalizeOpponentHistory,
  countRematchesInPairs,
  havePlayedBefore,
} from "./pairing.js";

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

export {
  LOSS_BAND_STATE_DOC_ID,
  LOSS_BAND_STATE_VERSION,
  LOSS_BAND_PAIRING_VERSION,
  LossBandTournamentStatus,
  LossBandRoundStatus,
  buildLossBandRoundId,
  buildLossBandStateDoc,
  buildLossBandRoundDoc,
  pairingsFromRoundDoc,
  buildLossBandMatchSessionDoc,
  buildValidatedLossBandMatchResult,
  isLossBandRoundComplete,
  winnersMapFromResults,
  rebuildDomainStateFromCompletedRounds,
  planLossBandInitialize,
  planAfterLossBandMatchSaved,
  validateRoundTeamUniqueness,
} from "./persistence.js";
