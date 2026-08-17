/**
 * loss-band 専用の完了判定（SE の canFinalizeTournament は変更しない）
 */
import { LossBandPhase } from "./constants.js";
import { rankingRoundCountFromState } from "./bracket.js";
import {
  allTeamsMeetGuaranteedMatches,
  validateGuaranteedMatchCounts,
} from "./exchange.js";
import { validateCompletePlacements } from "./placements.js";
import { listUnplacedEntryIds } from "./state.js";

export const LossBandCompletionReasonCode = Object.freeze({
  COMPLETE: "loss_band_complete",
  R5_INCOMPLETE: "loss_band_r5_incomplete",
  FINAL_INCOMPLETE: "loss_band_final_incomplete",
  THIRD_PLACE_INCOMPLETE: "loss_band_third_place_incomplete",
  EXCHANGE_INCOMPLETE: "loss_band_exchange_incomplete",
  PLACEMENTS_INVALID: "loss_band_placements_invalid",
  WRONG_PHASE: "loss_band_wrong_phase",
});

/**
 * ranking phase（loss-band 内部）の完了可否。
 * @param {object} state domain state
 * @param {{ thirdPlaceMatch?: boolean }} [options]
 */
export function evaluateLossBandRankingCompletion(state, options = {}) {
  if (!state || typeof state !== "object") {
    return {
      complete: false,
      canComplete: false,
      reasonCode: LossBandCompletionReasonCode.WRONG_PHASE,
      message: "loss-band state がありません。",
      errors: ["state required"],
    };
  }

  const thirdPlaceMatch =
    options.thirdPlaceMatch === true || state.thirdPlaceMatch === true;

  const rankingRounds = rankingRoundCountFromState(state);
  if (state.completedRankingRound < rankingRounds) {
    return {
      complete: false,
      canComplete: false,
      reasonCode: LossBandCompletionReasonCode.R5_INCOMPLETE,
      message: `最終順位決定ラウンド（R${rankingRounds}）が未完了です。`,
      errors: [`completedRankingRound=${state.completedRankingRound}`],
    };
  }

  if (
    state.phase === LossBandPhase.RANKING ||
    state.phase === LossBandPhase.FINAL
  ) {
    return {
      complete: false,
      canComplete: false,
      reasonCode: LossBandCompletionReasonCode.FINAL_INCOMPLETE,
      message: "決勝が未完了です。",
      errors: [`phase=${state.phase}`],
    };
  }

  if (thirdPlaceMatch && state.phase === LossBandPhase.THIRD_PLACE) {
    return {
      complete: false,
      canComplete: false,
      reasonCode: LossBandCompletionReasonCode.THIRD_PLACE_INCOMPLETE,
      message: "3位決定戦が未完了です。",
      errors: [`phase=${state.phase}`],
    };
  }

  if (state.phase !== LossBandPhase.COMPLETE) {
    return {
      complete: false,
      canComplete: false,
      reasonCode: LossBandCompletionReasonCode.WRONG_PHASE,
      message: `予期しない phase: ${state.phase}`,
      errors: [`phase=${state.phase}`],
    };
  }

  const unplaced = listUnplacedEntryIds(state);
  if (unplaced.length !== 0) {
    return {
      complete: false,
      canComplete: false,
      reasonCode: LossBandCompletionReasonCode.PLACEMENTS_INVALID,
      message: "未確定チームが残っています。",
      errors: unplaced.map((id) => `unplaced:${id}`),
    };
  }

  const validation = validateCompletePlacements(state, { thirdPlaceMatch });
  if (!validation.valid) {
    return {
      complete: false,
      canComplete: false,
      reasonCode: LossBandCompletionReasonCode.PLACEMENTS_INVALID,
      message: "順位データが不正です。",
      errors: validation.errors,
      placementCounts: validation.placementCounts,
    };
  }

  return {
    complete: true,
    canComplete: true,
    reasonCode: LossBandCompletionReasonCode.COMPLETE,
    message: null,
    errors: [],
    placementCounts: validation.placementCounts,
  };
}

/**
 * @param {object} state
 * @param {{ thirdPlaceMatch?: boolean }} [options]
 */
export function canCompleteLossBandRanking(state, options = {}) {
  return evaluateLossBandRankingCompletion(state, options).canComplete;
}

/**
 * ranking + 交流戦を含む loss-band 大会完了判定
 * @param {object} state domain state（matchLog に交流戦含む）
 * @param {{
 *   thirdPlaceMatch?: boolean,
 *   exchangeMatches?: boolean,
 *   openExchangeRound?: object|null
 * }} [options]
 */
export function evaluateLossBandTournamentCompletion(state, options = {}) {
  const ranking = evaluateLossBandRankingCompletion(state, options);
  if (!ranking.complete) {
    return {
      ...ranking,
      tournamentComplete: false,
    };
  }

  const exchangeMatches = options.exchangeMatches === true;
  if (!exchangeMatches) {
    return {
      complete: true,
      canComplete: true,
      tournamentComplete: true,
      reasonCode: LossBandCompletionReasonCode.COMPLETE,
      message: null,
      errors: [],
      placementCounts: ranking.placementCounts,
    };
  }

  if (
    options.openExchangeRound &&
    options.openExchangeRound.status !== "complete"
  ) {
    return {
      complete: false,
      canComplete: false,
      tournamentComplete: false,
      reasonCode: LossBandCompletionReasonCode.EXCHANGE_INCOMPLETE,
      message: "交流戦ラウンドが未完了です。",
      errors: ["open exchange round"],
    };
  }

  const thirdPlaceMatch =
    options.thirdPlaceMatch === true || state.thirdPlaceMatch === true;
  if (
    !allTeamsMeetGuaranteedMatches(state, state.matchLog, {
      thirdPlaceMatch,
      exchangeMatches: true,
      guaranteedMatchCount:
        options.guaranteedMatchCount ?? state.guaranteedMatchCount,
    })
  ) {
    return {
      complete: false,
      canComplete: false,
      tournamentComplete: false,
      reasonCode: LossBandCompletionReasonCode.EXCHANGE_INCOMPLETE,
      message: "最低保証実試合数未達のチームがあります。",
      errors: validateGuaranteedMatchCounts(state, state.matchLog, {
        guaranteedMatchCount:
          options.guaranteedMatchCount ?? state.guaranteedMatchCount,
      }).errors,
    };
  }

  return {
    complete: true,
    canComplete: true,
    tournamentComplete: true,
    reasonCode: LossBandCompletionReasonCode.COMPLETE,
    message: null,
    errors: [],
    placementCounts: ranking.placementCounts,
  };
}

/**
 * @param {object} state
 * @param {object} [options]
 */
export function canCompleteLossBandTournament(state, options = {}) {
  return (
    evaluateLossBandTournamentCompletion(state, options).tournamentComplete ===
    true
  );
}
