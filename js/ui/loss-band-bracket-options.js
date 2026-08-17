/**
 * loss-band 枠サイズ UI 共通（文言・デフォルト保証試合数）
 */
import {
  defaultGuaranteedMatchCount,
  isLossBandBracketSize,
  resolveLossBandBracketSize,
  teamCountRangeForBracketSize,
} from "../domain/loss-band/bracket.js";

export const LOSS_BAND_BRACKET_SIZE_OPTIONS = Object.freeze([
  Object.freeze({ value: 32, label: "32チーム枠" }),
  Object.freeze({ value: 64, label: "64チーム枠" }),
  Object.freeze({ value: 128, label: "128チーム枠" }),
]);

/**
 * @param {32|64|128} bracketSize
 */
export function describeLossBandBracketSize(bracketSize) {
  const { min, max } = teamCountRangeForBracketSize(bracketSize);
  const guaranteed = defaultGuaranteedMatchCount(bracketSize);
  return {
    min,
    max,
    guaranteed,
    rangeLabel: `${min}〜${max}チーム`,
    hint: `参加可能 ${min}〜${max}チーム / 標準保証 ${guaranteed} 試合`,
  };
}

/**
 * @param {unknown} value
 * @param {number|null|undefined} [teamCount]
 * @returns {32|64|128}
 */
export function resolveUiBracketSize(value, teamCount = null) {
  if (isLossBandBracketSize(value)) return value;
  if (Number.isInteger(teamCount)) {
    return resolveLossBandBracketSize(teamCount) ?? 64;
  }
  return 64;
}

/**
 * @param {{
 *   name: string,
 *   selected: 32|64|128,
 *   locked?: boolean,
 *   idPrefix?: string
 * }} params
 */
export function renderLossBandBracketSizeRadios(params) {
  const { name, selected, locked = false, idPrefix = name } = params;
  const disabledAttr = locked ? "disabled" : "";
  const radios = LOSS_BAND_BRACKET_SIZE_OPTIONS.map((opt) => {
    const id = `${idPrefix}${opt.value}`;
    return `
      <label class="field field--inline" for="${id}">
        <input type="radio" id="${id}" name="${name}" value="${opt.value}" ${
          selected === opt.value ? "checked" : ""
        } ${disabledAttr}>
        <span>${opt.label}</span>
      </label>`;
  }).join("");
  const desc = describeLossBandBracketSize(selected);
  return `
    <fieldset class="field" data-loss-band-bracket-size>
      <legend class="field__label">順位決定方式の枠サイズ</legend>
      ${radios}
      <p class="field__hint" data-bracket-size-hint>${desc.hint}</p>
    </fieldset>
  `;
}

export { defaultGuaranteedMatchCount };
