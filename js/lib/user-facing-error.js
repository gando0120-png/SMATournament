/**
 * 利用者向けエラー変換。内部 code / raw message は UI に出さず、console へ残す。
 */
import { ErrorCodes, classifyError, isUserFacingMessage } from "./errors.js";

export const UserFacingErrorContext = {
  RESULT_SAVE: "result-save",
  RESULT_LOAD: "result-load",
  PLAYER_SUBMIT: "player-submit",
  GENERIC: "generic",
};

const CONTEXT_COPY = {
  [UserFacingErrorContext.RESULT_SAVE]: {
    title: "結果を保存できませんでした",
    message: "入力内容を確認してください。",
  },
  [UserFacingErrorContext.RESULT_LOAD]: {
    title: "試合データを読み込めませんでした",
    message: "再読み込みしてください。",
  },
  [UserFacingErrorContext.PLAYER_SUBMIT]: {
    title: "結果を送信できませんでした",
    message: "入力内容を確認して、もう一度送信してください。",
  },
  [UserFacingErrorContext.GENERIC]: {
    title: "処理を完了できませんでした",
    message: "もう一度お試しください。",
  },
};

const VALIDATION_CODES = new Set([
  ErrorCodes.QUALIFYING_MATCH_RESULT_INVALID_INPUT,
  ErrorCodes.FINALS_MATCH_RESULT_INVALID_INPUT,
  ErrorCodes.MOLKKY_OUT_INVALID,
  ErrorCodes.FINALS_ADVANCEMENT_SETTINGS_INVALID,
  "invalid-argument",
  "firestore/invalid-argument",
  "functions/invalid-argument",
  "loss-band/invalid-result",
]);

const PERMISSION_CODES = new Set([
  ErrorCodes.PERMISSION_DENIED,
  ErrorCodes.TOURNAMENT_MANAGE_DENIED,
  "permission-denied",
  "firestore/permission-denied",
  "functions/permission-denied",
]);

const NETWORK_CODES = new Set([
  ErrorCodes.NETWORK,
  "unavailable",
  "firestore/unavailable",
  "functions/unavailable",
  "aborted",
  "deadline-exceeded",
  "auth/network-request-failed",
]);

const NOT_FOUND_CODES = new Set([
  "not-found",
  "firestore/not-found",
  "functions/not-found",
  ErrorCodes.INVALID_MATCH_ID,
  ErrorCodes.QUALIFYING_MATCH_RESULT_INVALID_MATCH,
  ErrorCodes.FINALS_MATCH_RESULT_INVALID_MATCH,
  ErrorCodes.FINALS_MATCH_SESSION_INVALID_MATCH,
  ErrorCodes.QUALIFYING_MATCH_SESSION_INVALID_MATCH,
]);

const INTERNAL_CODES = new Set([
  "internal",
  "functions/internal",
  "unknown",
  "data-loss",
]);

function stripCodePrefix(code) {
  return String(code || "")
    .replace(/^functions\//, "")
    .replace(/^firestore\//, "");
}

function contextCopy(context) {
  return CONTEXT_COPY[context] || CONTEXT_COPY[UserFacingErrorContext.GENERIC];
}

function isValidationCode(code) {
  return VALIDATION_CODES.has(code) || String(code || "").endsWith("/invalid-input");
}

/**
 * @param {string} [scope]
 * @param {unknown} error
 * @param {object} [extra]
 */
export function logInternalError(scope, error, extra = {}) {
  const label = scope ? `[${scope}]` : "[error]";
  console.error(label, {
    code: error?.code,
    message: error?.message,
    name: error?.name,
    error,
    ...extra,
  });
}

function facingResult({ title = "", message, severity = "error", code = "generic" }) {
  return {
    title,
    message,
    severity,
    code,
  };
}

/**
 * @param {unknown} error
 * @param {string} [context]
 * @param {{ logScope?: string, log?: boolean }} [options]
 */
export function getUserFacingError(
  error,
  context = UserFacingErrorContext.GENERIC,
  options = {}
) {
  if (options.log !== false) {
    logInternalError(options.logScope || context, error);
  }

  const classified = classifyError(error);
  const rawCode = String(error?.code || classified.code || "");
  const bareCode = stripCodePrefix(rawCode);
  const ctx = contextCopy(context);

  if (PERMISSION_CODES.has(rawCode) || PERMISSION_CODES.has(classified.code) || bareCode === "permission-denied") {
    return facingResult({
      message: "この操作を行う権限がありません。",
      code: "permission",
    });
  }

  if (NETWORK_CODES.has(rawCode) || NETWORK_CODES.has(classified.code) || bareCode === "unavailable") {
    return facingResult({
      title: "通信に失敗しました。",
      message: "通信状態を確認して、もう一度お試しください。",
      code: "network",
    });
  }

  if (INTERNAL_CODES.has(rawCode) || INTERNAL_CODES.has(bareCode)) {
    return facingResult({
      title: ctx.title,
      message: ctx.message,
      code: "internal",
    });
  }

  if (NOT_FOUND_CODES.has(rawCode) || NOT_FOUND_CODES.has(classified.code) || bareCode === "not-found") {
    if (classified.code === ErrorCodes.INVALID_MATCH_ID && isUserFacingMessage(classified.message)) {
      return facingResult({
        message: classified.message,
        code: "not-found",
      });
    }
    if (context === UserFacingErrorContext.RESULT_LOAD) {
      return facingResult({
        title: "試合データが見つかりません。",
        message: "再読み込みしてください。",
        code: "not-found",
      });
    }
    return facingResult({
      message: "データが見つかりません。",
      code: "not-found",
    });
  }

  if (isValidationCode(classified.code) || isValidationCode(rawCode)) {
    const message = isUserFacingMessage(classified.message)
      ? classified.message
      : isUserFacingMessage(error?.message)
        ? String(error.message).trim()
        : "入力内容を確認してください。";
    return facingResult({
      message,
      severity: "validation",
      code: "validation",
    });
  }

  if (
    isUserFacingMessage(classified.message) &&
    classified.code !== "unknown" &&
    classified.message !== "予期しないエラーが発生しました。"
  ) {
    return facingResult({
      message: classified.message,
      code: classified.code,
    });
  }

  if (isUserFacingMessage(error?.message)) {
    return facingResult({
      message: String(error.message).trim(),
      severity: "validation",
      code: "validation",
    });
  }

  return facingResult({
    title: ctx.title,
    message: ctx.message,
    code: classified.code || "generic",
  });
}

export function formatUserFacingAlertText(facing) {
  const title = facing?.title?.trim() || "";
  const message = facing?.message?.trim() || "";
  if (title && message && title !== message) {
    return `${title}\n${message}`;
  }
  return message || title || "処理を完了できませんでした。";
}

export function formatUserFacingToast(facing) {
  const title = facing?.title?.trim() || "";
  const message = facing?.message?.trim() || "";
  if (facing?.severity === "validation" || !title) {
    return message || title;
  }
  if (title && message && title !== message) {
    return `${title} ${message}`;
  }
  return message || title;
}
