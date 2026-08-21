/**
 * 敗戦帯（loss_band）エンジン — Phase 1–9 公開 API
 */
export {
  RankingMode,
  LOSS_BAND_TEAM_COUNT,
  LOSS_BAND_MIN_TEAM_COUNT,
  LOSS_BAND_MAX_TEAM_COUNT,
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
  LOSS_BAND_ALLOWED_BRACKET_SIZES,
  isLossBandBracketSize,
  resolveLossBandBracketSize,
  teamCountRangeForBracketSize,
  resolveAndValidateLossBandSize,
  rankingRoundCount,
  finalRoundNumber,
  thirdPlaceRoundNumber,
  defaultGuaranteedMatchCount,
  binomialCoefficient,
  expectedBandCountsAtRoundStart,
  buildExpectedBandCountsTable,
  bracketSizeFromState,
  rankingRoundCountFromState,
} from "./bracket.js";

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
  buildOlympicR5PlacementPlan,
  expectedFixed64R5PlacementCounts,
  usesFixed64PlacementSpec,
} from "./olympic-placements.js";

export {
  pickByeEntryId,
  selectByeAndPlayingEntryIds,
  buildByeAssignment,
  buildLossBandByeMatchId,
  isLossBandByeRecord,
  buildByeCountsFromState,
  buildByeCountsFromMatchLog,
} from "./bye.js";

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
  LOSS_BAND_MATCH_SESSION_REQUIRED_FIELDS,
  validateLossBandMatchSessionStructure,
  hasLossBandMatchSessionCreateShape,
  resolveLossBandSessionBackfillFromRounds,
  isLossBandSessionStartedForLock,
  isLossBandNextRoundStartedForEditLock,
  LOSS_BAND_RESULT_EDIT_LOCKED_MESSAGE,
  LOSS_BAND_CORRECTION_FIRESTORE_OP_SOFT_LIMIT,
  isLossBandRankingRoundDoc,
  isLossBandByeResult,
  assessLossBandRankingResultCorrection,
  planCorrectLossBandRankingResult,
  isLossBandExchangeStartedForEditLock,
  isLossBandSpecialRoundDoc,
  assessLossBandFinalResultCorrection,
  assessLossBandThirdPlaceResultCorrection,
  assessLossBandMatchResultCorrection,
  planCorrectLossBandFinalResult,
  planCorrectLossBandThirdPlaceResult,
  resolveLossBandMatchSessionDisplay,
  buildValidatedLossBandMatchResult,
  buildLossBandByeResultDoc,
  isLossBandRoundComplete,
  winnersMapFromResults,
  rebuildDomainStateFromCompletedRounds,
  planLossBandInitialize,
  planAfterLossBandMatchSaved,
  planAfterRankingFullyPlaced,
  planAfterExchangeMatchSaved,
  validateRoundTeamUniqueness,
} from "./persistence.js";
