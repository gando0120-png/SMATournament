/**
 * エントリー選手欄の描画（公開フォーム / 運営編集共通）
 */
import {
  getAdditionalMemberFieldKeys,
  getMemberFieldLabel,
} from "../domain/entry-members.js";

/**
 * @param {HTMLElement} container
 * @param {number} teamSize
 * @param {{ values?: Record<string, string>, idPrefix?: string, required?: boolean }} [options]
 */
export function renderAdditionalMemberFields(container, teamSize, options = {}) {
  const values = options.values ?? {};
  const idPrefix = options.idPrefix ?? "";
  const required = options.required !== false;
  container.innerHTML = "";

  for (const fieldKey of getAdditionalMemberFieldKeys(teamSize)) {
    const fieldId = `${idPrefix}${fieldKey}`;
    const label = document.createElement("label");
    label.className = "field";
    label.htmlFor = fieldId;

    const labelText = document.createElement("span");
    labelText.className = "field__label";
    labelText.textContent = getMemberFieldLabel(fieldKey);

    const input = document.createElement("input");
    input.className = "field__input";
    input.type = "text";
    input.id = fieldId;
    input.name = fieldKey;
    input.required = required;
    input.value = values[fieldKey] ?? "";

    label.append(labelText, input);
    container.appendChild(label);
  }
}

/**
 * @param {HTMLSelectElement} selectEl
 * @param {{ min: number, max: number }} range
 * @param {number} selected
 */
export function fillTeamSizeSelect(selectEl, range, selected) {
  selectEl.innerHTML = "";
  for (let size = range.min; size <= range.max; size += 1) {
    const option = document.createElement("option");
    option.value = String(size);
    option.textContent = `${size}人`;
    if (size === selected) {
      option.selected = true;
    }
    selectEl.appendChild(option);
  }
}

/**
 * @param {ParentNode} root
 * @param {string[]} fieldKeys
 * @param {string} [idPrefix]
 */
export function readMemberFieldValues(root, fieldKeys, idPrefix = "") {
  const values = {};
  for (const fieldKey of fieldKeys) {
    const field = root.querySelector(`#${idPrefix}${fieldKey}`) || root.querySelector(`[name="${fieldKey}"]`);
    if (field) {
      values[fieldKey] = field.value;
    }
  }
  return values;
}
