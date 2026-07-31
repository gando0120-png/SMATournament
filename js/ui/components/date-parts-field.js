/**
 * 年・月・日分割日付フィールド
 */
import {
  composeDateParts,
  formatDatePartsRaw,
  normalizeDigits,
  parsePastedDate,
  splitDateString,
  validateDatePartsInput,
} from "../../domain/date-parts.js";

/**
 * @typedef {object} DatePartsFieldController
 * @property {(value: string) => void} setValue
 * @property {() => string} getValue
 * @property {() => { valid: boolean, message: string|null, value: string }} validate
 * @property {() => void} focus
 * @property {(disabled: boolean) => void} setDisabled
 * @property {(message: string|null) => void} setError
 * @property {() => void} clearError
 * @property {() => void} destroy
 * @property {HTMLElement} container
 */

/**
 * @param {object} options
 * @param {HTMLElement} options.container
 * @param {string} [options.idPrefix]
 * @param {string} [options.initialValue]
 * @param {boolean} [options.required]
 * @param {string} [options.label]
 * @param {HTMLInputElement|null} [options.hiddenInput]
 * @param {() => (HTMLElement|null|undefined)} [options.getNextFocusElement]
 * @param {{ required?: string, invalid?: string }} [options.messages]
 * @returns {DatePartsFieldController}
 */
export function mountDatePartsField({
  container,
  idPrefix = "date",
  initialValue = "",
  required = false,
  label = "日付",
  hiddenInput = null,
  getNextFocusElement = null,
  messages = {},
} = {}) {
  if (!container) {
    throw new Error("mountDatePartsField: container is required");
  }

  const requiredMessage = messages.required || `${label}を入力してください。`;
  const invalidMessage = messages.invalid || `${label}に存在しない日付が入力されています。`;
  const errorId = `${idPrefix}-error`;

  container.classList.add("date-parts-field");
  container.innerHTML = `
    <div class="date-parts-field__row" role="group" aria-labelledby="${idPrefix}-group-label">
      <span class="date-parts-field__group-label sr-only" id="${idPrefix}-group-label">${escapeHtml(label)}</span>
      <label class="date-parts-field__part" for="${idPrefix}-year">
        <input
          class="field__input date-parts-field__input date-parts-field__input--year"
          type="text"
          inputmode="numeric"
          pattern="[0-9]*"
          id="${idPrefix}-year"
          name="${idPrefix}Year"
          maxlength="4"
          autocomplete="off"
          aria-label="${escapeAttr(label)}の年"
          data-date-part="year"
        >
        <span class="date-parts-field__suffix" aria-hidden="true">年</span>
      </label>
      <label class="date-parts-field__part" for="${idPrefix}-month">
        <input
          class="field__input date-parts-field__input date-parts-field__input--month"
          type="text"
          inputmode="numeric"
          pattern="[0-9]*"
          id="${idPrefix}-month"
          name="${idPrefix}Month"
          maxlength="2"
          autocomplete="off"
          aria-label="${escapeAttr(label)}の月"
          data-date-part="month"
        >
        <span class="date-parts-field__suffix" aria-hidden="true">月</span>
      </label>
      <label class="date-parts-field__part" for="${idPrefix}-day">
        <input
          class="field__input date-parts-field__input date-parts-field__input--day"
          type="text"
          inputmode="numeric"
          pattern="[0-9]*"
          id="${idPrefix}-day"
          name="${idPrefix}Day"
          maxlength="2"
          autocomplete="off"
          aria-label="${escapeAttr(label)}の日"
          data-date-part="day"
        >
        <span class="date-parts-field__suffix" aria-hidden="true">日</span>
      </label>
    </div>
    <p class="date-parts-field__error hidden" id="${errorId}" role="alert"></p>
  `;

  const yearInput = container.querySelector(`#${CSS.escape(idPrefix)}-year`);
  const monthInput = container.querySelector(`#${CSS.escape(idPrefix)}-month`);
  const dayInput = container.querySelector(`#${CSS.escape(idPrefix)}-day`);
  const errorEl = container.querySelector(`#${CSS.escape(errorId)}`);
  const inputs = [yearInput, monthInput, dayInput];

  let composing = false;
  let destroyed = false;

  function readParts() {
    return {
      year: yearInput.value,
      month: monthInput.value,
      day: dayInput.value,
    };
  }

  function syncHidden() {
    if (!hiddenInput) return;
    const raw = formatDatePartsRaw(readParts());
    const valid = composeDateParts(readParts());
    hiddenInput.value = valid || raw || "";
  }

  function setError(message) {
    if (!errorEl) return;
    if (!message) {
      clearError();
      return;
    }
    errorEl.textContent = message;
    errorEl.classList.remove("hidden");
    inputs.forEach((input) => {
      input.classList.add("field__input--error");
      input.setAttribute("aria-invalid", "true");
      input.setAttribute("aria-describedby", errorId);
    });
  }

  function clearError() {
    if (!errorEl) return;
    errorEl.textContent = "";
    errorEl.classList.add("hidden");
    inputs.forEach((input) => {
      input.classList.remove("field__input--error");
      input.removeAttribute("aria-invalid");
      input.removeAttribute("aria-describedby");
    });
  }

  function setValue(value) {
    const parts = splitDateString(value || "");
    yearInput.value = parts.year;
    monthInput.value = parts.month;
    dayInput.value = parts.day;
    syncHidden();
    clearError();
  }

  function getValue() {
    return composeDateParts(readParts()) || formatDatePartsRaw(readParts()) || "";
  }

  function validate({ force = false } = {}) {
    const parts = readParts();
    const y = normalizeDigits(parts.year);
    const m = normalizeDigits(parts.month);
    const d = normalizeDigits(parts.day);
    const any = Boolean(y || m || d);
    const complete = y.length === 4 && m.length >= 1 && d.length >= 1;

    if (!force && any && !complete) {
      return { valid: true, message: null, value: "" };
    }

    const result = validateDatePartsInput(parts, { required, label });
    if (!result.valid) {
      const message =
        result.message?.includes("存在しない")
          ? invalidMessage
          : result.message?.includes("入力してください")
            ? requiredMessage
            : result.message;
      setError(message);
      return { valid: false, message, value: "" };
    }
    clearError();
    if (result.value) {
      setValue(result.value);
    }
    return { valid: true, message: null, value: result.value };
  }

  function focusNextFrom(part) {
    if (part === "year") {
      monthInput.focus();
      monthInput.select?.();
      return;
    }
    if (part === "month") {
      dayInput.focus();
      dayInput.select?.();
      return;
    }
    if (part === "day") {
      const next =
        typeof getNextFocusElement === "function" ? getNextFocusElement() : null;
      if (next && typeof next.focus === "function") {
        next.focus();
      }
    }
  }

  function sanitizeInput(input, maxLen) {
    const digits = normalizeDigits(input.value).slice(0, maxLen);
    if (input.value !== digits) {
      input.value = digits;
    }
    return digits;
  }

  function onPartInput(event) {
    if (composing || destroyed) return;
    const input = event.target;
    const part = input.dataset.datePart;
    const maxLen = part === "year" ? 4 : 2;
    const beforeLen = normalizeDigits(input.dataset.prevValue || "").length;
    const digits = sanitizeInput(input, maxLen);
    input.dataset.prevValue = digits;
    syncHidden();

    // 桁が増えて上限に達したときだけ自動移動（Backspace では動かない）
    if (digits.length === maxLen && digits.length > beforeLen) {
      focusNextFrom(part);
    }
  }

  function onPartBlur(event) {
    if (destroyed) return;
    const input = event.target;
    const part = input.dataset.datePart;
    if (part === "month" || part === "day") {
      const digits = normalizeDigits(input.value);
      if (digits.length === 1) {
        input.value = digits.padStart(2, "0");
        input.dataset.prevValue = input.value;
      }
    }
    syncHidden();

    const related = event.relatedTarget;
    if (related && container.contains(related)) {
      return;
    }
    const parts = readParts();
    const complete =
      normalizeDigits(parts.year).length === 4 &&
      normalizeDigits(parts.month).length >= 1 &&
      normalizeDigits(parts.day).length >= 1;
    if (complete || required) {
      validate({ force: complete || Boolean(normalizeDigits(parts.year + parts.month + parts.day)) });
    }
  }

  function applyPasteText(text) {
    const parsed = parsePastedDate(text);
    if (!parsed.valid) {
      setError(parsed.message || `${label}の形式が正しくありません。`);
      return false;
    }
    setValue(parsed.value);
    clearError();
    return true;
  }

  function onPaste(event) {
    const text = event.clipboardData?.getData("text") ?? "";
    if (!text.trim()) return;
    // 日付らしき貼り付けのみインターセプト
    const normalized = text.normalize("NFKC").trim();
    const looksLikeDate =
      /^\d{4}[/-]\d{1,2}[/-]\d{1,2}$/.test(normalized) ||
      /^\d{8}$/.test(normalizeDigits(normalized));
    if (!looksLikeDate) return;
    event.preventDefault();
    applyPasteText(text);
  }

  function onKeyDown(event) {
    // 矢印・Tab はブラウザ標準に任せる
    if (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "Tab") {
      return;
    }
  }

  inputs.forEach((input) => {
    input.addEventListener("compositionstart", () => {
      composing = true;
    });
    input.addEventListener("compositionend", (event) => {
      composing = false;
      onPartInput(event);
    });
    input.addEventListener("input", onPartInput);
    input.addEventListener("blur", onPartBlur);
    input.addEventListener("paste", onPaste);
    input.addEventListener("keydown", onKeyDown);
    input.dataset.prevValue = "";
  });

  container.addEventListener("paste", (event) => {
    if (event.target !== container && !inputs.includes(event.target)) {
      return;
    }
    onPaste(event);
  });

  setValue(initialValue || "");

  return {
    container,
    setValue,
    getValue,
    validate,
    focus() {
      yearInput.focus();
    },
    setDisabled(disabled) {
      inputs.forEach((input) => {
        input.disabled = Boolean(disabled);
        input.setAttribute("aria-disabled", disabled ? "true" : "false");
      });
      if (hiddenInput) {
        hiddenInput.disabled = Boolean(disabled);
      }
    },
    setError,
    clearError,
    destroy() {
      destroyed = true;
      container.innerHTML = "";
    },
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}
