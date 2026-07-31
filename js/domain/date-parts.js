/**
 * 年・月・日分割入力のドメイン（DOM 非依存）
 */

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const SLASH_DATE_PATTERN = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/;
const COMPACT_DATE_PATTERN = /^(\d{4})(\d{2})(\d{2})$/;

/**
 * 全角数字などを半角へ正規化
 * @param {unknown} value
 */
export function normalizeDigits(value) {
  if (value == null) return "";
  return String(value)
    .normalize("NFKC")
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xff10 + 0x30))
    .replace(/[^\d]/g, "");
}

/**
 * @param {unknown} year
 * @param {unknown} month
 * @param {unknown} day
 * @returns {{ year: number, month: number, day: number }|null}
 */
export function parseDateParts(year, month, day) {
  const y = Number(normalizeDigits(year));
  const m = Number(normalizeDigits(month));
  const d = Number(normalizeDigits(day));
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) {
    return null;
  }
  if (String(normalizeDigits(year)).length !== 4) {
    return null;
  }
  return { year: y, month: m, day: d };
}

/**
 * 実在するカレンダー日付か（Date のロールオーバーを拒否）
 * @param {number} year
 * @param {number} month 1-12
 * @param {number} day
 */
export function isValidCalendarDate(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false;
  }
  if (year < 1000 || year > 9999) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

/**
 * @param {string|null|undefined} value YYYY-MM-DD
 */
export function isValidCalendarDateString(value) {
  if (typeof value !== "string") return false;
  const match = value.trim().match(ISO_DATE_PATTERN);
  if (!match) return false;
  return isValidCalendarDate(Number(match[1]), Number(match[2]), Number(match[3]));
}

/**
 * @param {{ year?: unknown, month?: unknown, day?: unknown }|null|undefined} parts
 * @returns {string|null} YYYY-MM-DD
 */
export function composeDateParts(parts) {
  if (!parts) return null;
  const parsed = parseDateParts(parts.year, parts.month, parts.day);
  if (!parsed) return null;
  if (!isValidCalendarDate(parsed.year, parsed.month, parsed.day)) {
    return null;
  }
  const pad = (n) => String(n).padStart(2, "0");
  return `${parsed.year}-${pad(parsed.month)}-${pad(parsed.day)}`;
}

/**
 * 未検証のままゼロ埋め結合（検証前の表示・中間値用）
 * @param {{ year?: unknown, month?: unknown, day?: unknown }} parts
 */
export function formatDatePartsRaw(parts) {
  const y = normalizeDigits(parts?.year ?? "");
  const m = normalizeDigits(parts?.month ?? "");
  const d = normalizeDigits(parts?.day ?? "");
  if (!y && !m && !d) return "";
  if (y.length !== 4 || !m || !d) return "";
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

/**
 * @param {string|null|undefined} value YYYY-MM-DD
 * @returns {{ year: string, month: string, day: string }}
 */
export function splitDateString(value) {
  if (typeof value !== "string") {
    return { year: "", month: "", day: "" };
  }
  const match = value.trim().match(ISO_DATE_PATTERN);
  if (!match) {
    return { year: "", month: "", day: "" };
  }
  return {
    year: match[1],
    month: match[2],
    day: match[3],
  };
}

/**
 * 貼り付け文字列を年・月・日に分解
 * @param {unknown} raw
 * @returns {{ valid: true, parts: { year: string, month: string, day: string }, value: string }|{ valid: false, message: string }}
 */
export function parsePastedDate(raw) {
  if (raw == null) {
    return { valid: false, message: "日付を貼り付けてください。" };
  }
  const text = String(raw).normalize("NFKC").trim();
  if (!text) {
    return { valid: false, message: "日付を貼り付けてください。" };
  }

  let year;
  let month;
  let day;

  let match = text.match(ISO_DATE_PATTERN);
  if (match) {
    year = match[1];
    month = match[2];
    day = match[3];
  } else {
    match = text.match(SLASH_DATE_PATTERN);
    if (match) {
      year = match[1];
      month = match[2].padStart(2, "0");
      day = match[3].padStart(2, "0");
    } else {
      const digits = normalizeDigits(text);
      match = digits.match(COMPACT_DATE_PATTERN);
      if (!match) {
        return { valid: false, message: "日付の形式が正しくありません。" };
      }
      year = match[1];
      month = match[2];
      day = match[3];
    }
  }

  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!isValidCalendarDate(y, m, d)) {
    return { valid: false, message: "存在しない日付です。" };
  }

  const pad = (n) => String(n).padStart(2, "0");
  const value = `${y}-${pad(m)}-${pad(d)}`;
  return {
    valid: true,
    parts: { year: String(y), month: pad(m), day: pad(d) },
    value,
  };
}

/**
 * @param {string|null|undefined} datePart YYYY-MM-DD
 * @param {string|null|undefined} timePart HH:mm
 * @returns {string} YYYY-MM-DDTHH:mm or ""
 */
export function composeDateTimeLocal(datePart, timePart) {
  const date = typeof datePart === "string" ? datePart.trim() : "";
  const time = typeof timePart === "string" ? timePart.trim() : "";
  if (!date && !time) return "";
  if (!date || !time) return "";
  if (!/^\d{2}:\d{2}$/.test(time) && !/^\d{2}:\d{2}:\d{2}$/.test(time)) {
    return "";
  }
  const hhmm = time.slice(0, 5);
  if (!isValidCalendarDateString(date)) {
    return "";
  }
  return `${date}T${hhmm}`;
}

/**
 * @param {string|null|undefined} value YYYY-MM-DDTHH:mm
 */
export function splitDateTimeLocal(value) {
  if (typeof value !== "string" || !value.trim()) {
    return { date: "", time: "" };
  }
  const [date = "", time = ""] = value.trim().split("T");
  return {
    date: date || "",
    time: time ? time.slice(0, 5) : "",
  };
}

/**
 * @param {{ year?: unknown, month?: unknown, day?: unknown }} parts
 * @param {{ required?: boolean, label?: string }} [options]
 */
export function validateDatePartsInput(parts, options = {}) {
  const { required = false, label = "日付" } = options;
  const y = normalizeDigits(parts?.year ?? "");
  const m = normalizeDigits(parts?.month ?? "");
  const d = normalizeDigits(parts?.day ?? "");
  const any = Boolean(y || m || d);
  const all = Boolean(y && m && d);

  if (!any) {
    if (required) {
      return { valid: false, message: `${label}を入力してください。` };
    }
    return { valid: true, value: "", message: null };
  }

  if (!all || y.length !== 4) {
    return { valid: false, message: `${label}の形式が正しくありません。` };
  }

  const composed = composeDateParts({ year: y, month: m, day: d });
  if (!composed) {
    return { valid: false, message: `${label}に存在しない日付が入力されています。` };
  }

  return { valid: true, value: composed, message: null };
}
