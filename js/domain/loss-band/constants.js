/**
 * 敗戦帯（loss_band）方式 — Phase 1 定数
 * 64 チーム固定・BYE なし・純 domain
 */

/** bracketMatchConfig.main.rankingMode の値（未設定時は single_elimination 扱い） */
export const RankingMode = Object.freeze({
  SINGLE_ELIMINATION: "single_elimination",
  LOSS_BAND: "loss_band",
});

/** Phase 1 固定チーム数 */
export const LOSS_BAND_TEAM_COUNT = 64;

/** 順位決定ラウンド数（決勝を含まない） */
export const LOSS_BAND_RANKING_ROUND_COUNT = 5;

/** 決勝ラウンド番号（表示・識別用） */
export const LOSS_BAND_FINAL_ROUND_NUMBER = 6;

/**
 * 各順位決定ラウンド開始時の敗戦帯人数（lossCount → count）
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
 * R5 終了後の順位タイ（placement → 人数）
 * placement はタイの先頭順位（例: 3位タイ → 3）
 * @type {ReadonlyArray<{ lossCount: number, outcome: 'winner'|'loser', placement: number, count: number }>}
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
  /** 順位決定ラウンド（R1–R5）待ち / 進行中 */
  RANKING: "ranking",
  /** R5 完了・決勝待ち */
  FINAL: "final",
  /** 全順位確定 */
  COMPLETE: "complete",
});
