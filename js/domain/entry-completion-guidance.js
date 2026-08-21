/**
 * エントリー完了後の大会案内（DOM / Firestore 非依存）
 * 任意フィールド。未設定時は完了画面に何も出さない。
 *
 * 永続化先: tournaments/{id}/entryCompletionGuidance/current
 * （大会本体の Settings Rules 評価式上限を避けるため独立サブコレクション）
 */
export const ENTRY_COMPLETION_GUIDANCE_COLLECTION = "entryCompletionGuidance";
export const ENTRY_COMPLETION_GUIDANCE_DOC_ID = "current";

export const ENTRY_COMPLETION_DEFAULT_LINK_LABEL = "詳しく見る";

export const EntryCompletionLimits = Object.freeze({
  message: { maxLength: 2000 },
  linkUrl: { maxLength: 2000 },
  linkLabel: { maxLength: 40 },
});

/**
 * https:// のみ許可。空文字は「未設定」として許容。
 * @param {unknown} value
 */
export function isAllowedEntryCompletionLinkUrl(value) {
  if (value == null) return true;
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (trimmed.length > EntryCompletionLimits.linkUrl.maxLength) return false;
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }
  return parsed.protocol === "https:";
}

/**
 * @param {unknown} value
 * @param {{ maxLength: number }} limit
 */
function normalizeOptionalTrimmedString(value, limit) {
  if (value == null) return "";
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length > limit.maxLength) return null;
  return trimmed;
}

/**
 * 案内文は改行を保持（先頭末尾の余分な空白行を除去）
 * @param {unknown} value
 */
function normalizeOptionalMessage(value) {
  if (value == null) return "";
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const trimmed = normalized.replace(/^\n+|\n+$/g, "").trimEnd();
  const startTrimmed = trimmed.replace(/^\s+/, "");
  if (startTrimmed.length > EntryCompletionLimits.message.maxLength) return null;
  return startTrimmed;
}

/**
 * フォーム / Firestore 向けに正規化・検証
 * @param {object} input
 */
export function validateEntryCompletionGuidanceInput(input = {}) {
  const errors = {};

  const message = normalizeOptionalMessage(input.entryCompletionMessage);
  if (message === null) {
    errors.entryCompletionMessage = `案内文は${EntryCompletionLimits.message.maxLength}文字以内で入力してください。`;
  }

  const rawUrl =
    typeof input.entryCompletionLinkUrl === "string"
      ? input.entryCompletionLinkUrl.trim()
      : input.entryCompletionLinkUrl == null
        ? ""
        : null;
  if (rawUrl === null) {
    errors.entryCompletionLinkUrl = "案内リンクURLの形式が正しくありません。";
  } else if (rawUrl && !isAllowedEntryCompletionLinkUrl(rawUrl)) {
    errors.entryCompletionLinkUrl =
      "案内リンクURLは https:// から始まるURLを入力してください。";
  } else if (rawUrl.length > EntryCompletionLimits.linkUrl.maxLength) {
    errors.entryCompletionLinkUrl = `案内リンクURLは${EntryCompletionLimits.linkUrl.maxLength}文字以内で入力してください。`;
  }

  const label = normalizeOptionalTrimmedString(
    input.entryCompletionLinkLabel,
    EntryCompletionLimits.linkLabel
  );
  if (label === null) {
    errors.entryCompletionLinkLabel = `リンクボタン名は${EntryCompletionLimits.linkLabel.maxLength}文字以内で入力してください。`;
  }

  if (Object.keys(errors).length > 0) {
    return { valid: false, errors, values: null };
  }

  return {
    valid: true,
    errors: {},
    values: {
      entryCompletionMessage: message || "",
      entryCompletionLinkUrl: rawUrl || "",
      entryCompletionLinkLabel: label || "",
    },
  };
}

/**
 * 完了画面表示用モデル（危険URLはボタン非表示）
 * @param {object|null|undefined} source tournament または guidance doc
 */
export function buildEntryCompletionGuidanceView(source) {
  const message =
    typeof source?.entryCompletionMessage === "string"
      ? source.entryCompletionMessage.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim()
      : "";
  const rawUrl =
    typeof source?.entryCompletionLinkUrl === "string"
      ? source.entryCompletionLinkUrl.trim()
      : "";
  const rawLabel =
    typeof source?.entryCompletionLinkLabel === "string"
      ? source.entryCompletionLinkLabel.trim()
      : "";

  const safeUrl =
    rawUrl && isAllowedEntryCompletionLinkUrl(rawUrl) ? rawUrl : "";
  const hasMessage = message.length > 0;
  const hasLink = safeUrl.length > 0;

  return {
    visible: hasMessage || hasLink,
    message: hasMessage ? message : null,
    linkUrl: hasLink ? safeUrl : null,
    linkLabel: hasLink
      ? rawLabel || ENTRY_COMPLETION_DEFAULT_LINK_LABEL
      : null,
  };
}

/**
 * 永続化ドキュメント本体（timestamps は呼び出し側）
 * 空の案内は null（呼び出し側で delete）
 * @param {{
 *   entryCompletionMessage?: string,
 *   entryCompletionLinkUrl?: string,
 *   entryCompletionLinkLabel?: string,
 * }} values
 */
export function buildEntryCompletionGuidanceDoc(values) {
  const message = values.entryCompletionMessage || "";
  const linkUrl = values.entryCompletionLinkUrl || "";
  const linkLabel = values.entryCompletionLinkLabel || "";
  if (!message && !linkUrl && !linkLabel) {
    return null;
  }
  return {
    entryCompletionMessage: message,
    entryCompletionLinkUrl: linkUrl,
    entryCompletionLinkLabel: linkLabel,
  };
}

/**
 * snapshot.tournament へ載せる公開可能な案内フィールドのみ
 * @param {object|null|undefined} source
 */
export function pickEntryCompletionFieldsForPublicSnapshot(source) {
  const view = buildEntryCompletionGuidanceView(source);
  if (!view.visible) {
    return {
      entryCompletionMessage: null,
      entryCompletionLinkUrl: null,
      entryCompletionLinkLabel: null,
    };
  }
  return {
    entryCompletionMessage: view.message,
    entryCompletionLinkUrl: view.linkUrl,
    entryCompletionLinkLabel: view.linkLabel,
  };
}
