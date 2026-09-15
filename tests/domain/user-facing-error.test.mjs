/**
 * 利用者向けエラー変換
 */
import assert from "node:assert/strict";
import { classifyError, ErrorCodes } from "../../js/lib/errors.js";
import {
  BOTH_TEAMS_FIFTY_MESSAGE,
  FINALS_SET_DRAW_MESSAGE,
} from "../../js/domain/h2h-set-finish.js";
import {
  formatUserFacingAlertText,
  formatUserFacingToast,
  getUserFacingError,
  UserFacingErrorContext,
} from "../../js/lib/user-facing-error.js";

const originalError = console.error;
const logs = [];
console.error = (...args) => {
  logs.push(args);
};

function lastLog() {
  return logs[logs.length - 1];
}

{
  const error = new Error(BOTH_TEAMS_FIFTY_MESSAGE);
  error.code = ErrorCodes.QUALIFYING_MATCH_RESULT_INVALID_INPUT;
  const facing = getUserFacingError(error, UserFacingErrorContext.RESULT_SAVE, {
    logScope: "test-fifty",
  });
  assert.equal(facing.severity, "validation");
  assert.equal(facing.message, BOTH_TEAMS_FIFTY_MESSAGE);
  assert.equal(facing.title, "");
  assert.equal(formatUserFacingToast(facing), BOTH_TEAMS_FIFTY_MESSAGE);
}

{
  const error = new Error(FINALS_SET_DRAW_MESSAGE);
  error.code = ErrorCodes.FINALS_MATCH_RESULT_INVALID_INPUT;
  const facing = getUserFacingError(error, UserFacingErrorContext.RESULT_SAVE, {
    logScope: "test-draw",
  });
  assert.equal(facing.severity, "validation");
  assert.equal(facing.message, FINALS_SET_DRAW_MESSAGE);
}

{
  const error = { code: "permission-denied", message: "Missing or insufficient permissions." };
  const facing = getUserFacingError(error, UserFacingErrorContext.RESULT_SAVE, {
    logScope: "test-permission",
  });
  assert.equal(facing.code, "permission");
  assert.equal(facing.message, "この操作を行う権限がありません。");
  assert.doesNotMatch(facing.message, /permission-denied|Missing or insufficient/i);
}

{
  const error = { code: "unavailable", message: "The service is currently unavailable." };
  const facing = getUserFacingError(error, UserFacingErrorContext.RESULT_SAVE, {
    logScope: "test-unavailable",
  });
  assert.equal(facing.code, "network");
  assert.match(facing.title, /通信に失敗しました/);
  assert.match(facing.message, /通信状態を確認/);
}

{
  const error = {
    code: "functions/internal",
    message: "INTERNAL: could not handle request at Callable\n    at /workspace/index.js:12:3",
  };
  const facing = getUserFacingError(error, UserFacingErrorContext.RESULT_SAVE, {
    logScope: "test-functions-internal",
  });
  assert.equal(facing.code, "internal");
  assert.equal(facing.title, "結果を保存できませんでした");
  assert.equal(facing.message, "入力内容を確認してください。");
  assert.doesNotMatch(formatUserFacingAlertText(facing), /INTERNAL|Callable|index\.js/);
}

{
  const error = { code: "functions/not-found", message: "NOT_FOUND: document missing" };
  const facing = getUserFacingError(error, UserFacingErrorContext.GENERIC, {
    logScope: "test-functions-not-found",
  });
  assert.equal(facing.message, "データが見つかりません。");
  assert.doesNotMatch(facing.message, /NOT_FOUND|document missing/);
}

{
  const longMessage =
    "very long internal stack Error: FirebaseError: functions/internal failed-precondition " +
    "at Handler.save (file:///app/js/services/foo.js:128:11) " +
    JSON.stringify({ details: "secret-token-xyz", nested: { code: "permission-denied" } });
  const error = new Error(longMessage);
  const facing = getUserFacingError(error, UserFacingErrorContext.RESULT_SAVE, {
    logScope: "test-generic-long",
  });
  assert.equal(facing.title, "結果を保存できませんでした");
  assert.equal(facing.message, "入力内容を確認してください。");
  assert.ok(facing.message.length < 40);
  const logPayload = lastLog()?.[1];
  assert.equal(logPayload?.message, longMessage);
  assert.equal(logPayload?.error, error);
}

{
  const error = {
    code: "functions/failed-precondition",
    message: "この試合はすでに結果が確定しています。",
  };
  const facing = getUserFacingError(error, UserFacingErrorContext.PLAYER_SUBMIT, {
    logScope: "test-finals-already",
    log: false,
  });
  assert.equal(facing.message, "この試合はすでに結果が確定しています。");
  assert.doesNotMatch(facing.message, /failed-precondition|FirebaseError|functions\//);
}

{
  const error = {
    code: ErrorCodes.FINALS_ADVANCEMENT_SETTINGS_NOT_EDITABLE,
    message: "予選開始後は進出条件を変更できません。",
  };
  const facing = getUserFacingError(error, UserFacingErrorContext.GENERIC, {
    logScope: "test-domain",
    log: false,
  });
  assert.equal(facing.message, "予選開始後は進出条件を変更できません。");
}

{
  const classified = classifyError({
    code: "permission-denied",
    message: "Missing or insufficient permissions.",
  });
  assert.equal(classified.message, "この操作を行う権限がありません。");
}

{
  const classified = classifyError(new Error("FirebaseError: boom at foo.js:1"));
  assert.equal(classified.message, "予期しないエラーが発生しました。");
}

{
  const loadFacing = getUserFacingError(
    { code: "functions/not-found", message: "NOT_FOUND" },
    UserFacingErrorContext.RESULT_LOAD,
    { log: false }
  );
  assert.equal(loadFacing.title, "試合データが見つかりません。");
  assert.equal(loadFacing.message, "再読み込みしてください。");
}

console.error = originalError;
console.log("user-facing-error.test: all tests passed");
