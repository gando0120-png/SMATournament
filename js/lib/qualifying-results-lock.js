/**
 * 決勝進出確定後の予選結果修正ロック（DOM 非依存）
 */

export const QUALIFYING_RESULTS_LOCKED_MESSAGE =
  "決勝進出チームが確定済みのため、予選結果は修正できません。";

/**
 * @param {object|null|undefined} advancement - finalsAdvancement/current
 */
export function isQualifyingResultsLocked(advancement) {
  return Boolean(advancement);
}

/**
 * @param {object|null|undefined} advancement
 */
export function assertQualifyingResultsEditable(advancement) {
  if (isQualifyingResultsLocked(advancement)) {
    const error = new Error(QUALIFYING_RESULTS_LOCKED_MESSAGE);
    error.code = "qualifying-match-result/advancement-finalized";
    throw error;
  }
}
