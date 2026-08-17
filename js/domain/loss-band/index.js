/**
 * 敗戦帯（loss_band）エンジン — Phase 1–5 公開 API
 */
export {
  RankingMode,
  LOSS_BAND_TEAM_COUNT,
  LOSS_BAND_DEFAULT_GUARANTEED_MATCH_COUNT,
  LOSS_BAND_RANKING_ROUND_COUNT,
  LOSS_BAND_FINAL_ROUND_NUMBER,
  LOSS_BAND_THIRD_PLACE_ROUND_NUMBER,
  EXPECTED_BAND_COUNTS_AT_ROUND_START,
  R5_PLACEMENT_SPEC,
  LossBandPhase,
  LossBandMatchPurpose,
} from "./constants.js";

export {
  resolveRankingMode,
  resolveMainRankingMode,
  validateSideRankingMode,
  normalizeLossBandSideOptions,
  formatLossBandTournamentStatusLabel,
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
  buildThirdPlacePairing,
  applyThirdPlaceResult,
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
  expectedFinalPlacementCounts,
  isTiedPlacement,
  formatLossBandPlacementLabel,
  buildPlacementRecords,
  validateCompletePlacements,
  listPlacementRows,
} from "./placements.js";

export {
  LossBandCompletionReasonCode,
  evaluateLossBandRankingCompletion,
  canCompleteLossBandRanking,
  evaluateLossBandTournamentCompletion,
  canCompleteLossBandTournament,
} from "./completion.js";

export {
  resolveGuaranteedMatchCount,
  countPlayedMatchesForEntry,
  buildPlayedMatchCounts,
  listExchangeEligibleEntryIds,
  buildSitOutCountsFromExchangeRounds,
  pickExchangeSitOutEntryId,
  pairExchangeEntryIds,
  buildExchangeMatchId,
  planExchangeRound,
  appendExchangeResultsToMatchLog,
  allTeamsMeetGuaranteedMatches,
  validateGuaranteedMatchCounts,
  LOSS_BAND_EXCHANGE_PAIRING_VERSION,
} from "./exchange.js";

export {
  validateLossBandStateInvariants,
  validateBandCountsAtRoundStart,
  validatePairingsCoverage,
} from "./validate.js";

export {
  buildLossBandTournamentResults,
  canFinalizeLossBandTournament,
  buildPersistedLossBandTournamentResults,
} from "./tournament-results.js";

export {
  formatLossBandBandLabel,
  formatLossBandPublicRoundLabel,
  buildLossBandPublicSection,
} from "./public-view.js";

export {
  LOSS_BAND_STATE_DOC_ID,
  LOSS_BAND_PLACEMENTS_DOC_ID,
  LOSS_BAND_STATE_VERSION,
  LOSS_BAND_PLACEMENTS_VERSION,
  LOSS_BAND_PAIRING_VERSION,
  LossBandTournamentStatus,
  LossBandRoundStatus,
  buildLossBandRoundId,
  buildLossBandStateDoc,
  buildLossBandRoundDoc,
  buildSpecialMatchRoundDoc,
  buildLossBandPlacementsDoc,
  buildExchangeRoundDoc,
  buildExchangeMatchSessionDoc,
  pairingsFromRoundDoc,
  buildLossBandMatchSessionDoc,
  buildValidatedLossBandMatchResult,
  isLossBandRoundComplete,
  winnersMapFromResults,
  rebuildDomainStateFromCompletedRounds,
  planLossBandInitialize,
  planAfterLossBandMatchSaved,
  planAfterRankingFullyPlaced,
  planAfterExchangeMatchSaved,
  validateRoundTeamUniqueness,
} from "./persistence.js";
