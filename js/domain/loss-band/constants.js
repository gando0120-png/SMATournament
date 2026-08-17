/**
 * 敗戦帯（loss_band）方式 — 定数
 * Phase 9: 枠 32 / 64 / 128。実行時のラウンド数・帯人数は bracket.js の一般式を使う。
 * 本ファイルの 64 固定テーブルは回帰テスト用。
 */

/** bracketMatchConfig.main.rankingMode の値（未設定時は single_elimination 扱い） */
export const RankingMode = Object.freeze({
  SINGLE_ELIMINATION: "single_elimination",
  LOSS_BAND: "loss_band",
});

/** 標準枠（後方互換・回帰の既定） */
export const LOSS_BAND_TEAM_COUNT = 64;

/** 実参加の絶対最小（32枠の下限） */
export const LOSS_BAND_MIN_TEAM_COUNT = 17;

/** 実参加の絶対最大（128枠の上限） */
export const LOSS_BAND_MAX_TEAM_COUNT = 128;

/**
 * 64チーム標準の最低保証実試合数（BYEなし）。
 * 実行時デフォルトは rankingRoundCount(bracketSize)。回帰・未指定フォールバック用に残す。
 */
export const LOSS_BAND_DEFAULT_GUARANTEED_MATCH_COUNT = 5;

/**
 * 64チームの順位決定ラウンド数（決勝を含まない）。
 * 実行時は rankingRoundCount(bracketSize) を使う。回帰用。
 */
export const LOSS_BAND_RANKING_ROUND_COUNT = 5;

/**
 * 64チームの決勝ラウンド番号。実行時は finalRoundNumber(bracketSize)。
 */
export const LOSS_BAND_FINAL_ROUND_NUMBER = 6;

/**
 * 64チームの3位決定戦ラウンド番号。実行時は thirdPlaceRoundNumber(bracketSize)。
 */
export const LOSS_BAND_THIRD_PLACE_ROUND_NUMBER = 7;

/** 試合目的 */
export const LossBandMatchPurpose = Object.freeze({
  RANKING: "ranking",
  FINAL: "final",
  THIRD_PLACE: "third_place",
  EXCHANGE: "exchange",
});

/**
 * 64チーム・BYEなし時の各順位決定ラウンド開始時の敗戦帯人数（lossCount → count）
 * 回帰・期待値用。本番進行は expectedBandCountsAtRoundStart(bracketSize, r) を使う。
 * @type {Readonly<Record<number, Readonly<Record<number, number>>>>}
 */
export const EXPECTED_BAND_COUNTS_AT_ROUND_START = Object.freeze({
  1: Object.freeze({ 0: 64 }),
  2: Object.freeze({ 0: 32, 1: 32 }),
  3: Object.freeze({ 0: 16, 1: 32, 2: 16 }),
  4: Object.freeze({ 0: 8, 1: 24, 2: 24, 3: 8 }),
  5: Object.freeze({ 0: 4, 1: 16, 2: 24, 3: 16, 4: 4 }),
});

/**
 * 64チーム・BYEなし 最終順位決定ラウンド後の順位タイ（placement → 人数）
 * placement はタイの先頭順位（例: 3位タイ → 3）
 * 0敗敗者の placement=3 は thirdPlaceMatch=false 時のみ適用
 * 回帰用。本番は Olympic 動的順位。
 * @type {ReadonlyArray<{ lossCount: number, outcome: 'winner'|'loser', placement: number|null, count: number }>}
 */
export const R5_PLACEMENT_SPEC = Object.freeze([
  Object.freeze({ lossCount: 0, outcome: "winner", placement: null, count: 2 }), // 決勝進出
  Object.freeze({ lossCount: 0, outcome: "loser", placement: 3, count: 2 }),
  Object.freeze({ lossCount: 1, outcome: "winner", placement: 5, count: 8 }),
  Object.freeze({ lossCount: 1, outcome: "loser", placement: 13, count: 8 }),
  Object.freeze({ lossCount: 2, outcome: "winner", placement: 21, count: 12 }),
  Object.freeze({ lossCount: 2, outcome: "loser", placement: 33, count: 12 }),
  Object.freeze({ lossCount: 3, outcome: "winner", placement: 45, count: 8 }),
  Object.freeze({ lossCount: 3, outcome: "loser", placement: 53, count: 8 }),
  Object.freeze({ lossCount: 4, outcome: "winner", placement: 61, count: 2 }),
  Object.freeze({ lossCount: 4, outcome: "loser", placement: 63, count: 2 }),
]);

export const LossBandPhase = Object.freeze({
  /** 順位決定ラウンド待ち / 進行中 */
  RANKING: "ranking",
  /** 最終順位決定ラウンド完了・決勝待ち */
  FINAL: "final",
  /** 決勝完了・3位決定戦待ち（thirdPlaceMatch=true のみ） */
  THIRD_PLACE: "third_place",
  /** 全順位確定 */
  COMPLETE: "complete",
});
