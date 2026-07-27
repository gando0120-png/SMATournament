/**
 * 公開エントリー向けエラーメッセージ smoke test
 */
import assert from "node:assert/strict";
import { classifyEntryError, classifyError } from "../../js/lib/errors.js";

const permissionDenied = { code: "permission-denied" };
const entryClassified = classifyEntryError(permissionDenied);
const operatorClassified = classifyError(permissionDenied);

assert.match(entryClassified.message, /受付状態または通信環境/);
assert.match(operatorClassified.message, /operators/);
assert.notEqual(entryClassified.message, operatorClassified.message);

const notOpen = { code: "entry/not-open", message: "エントリー締切を過ぎています。" };
assert.equal(classifyEntryError(notOpen).message, notOpen.message);

console.log("entry-error-message.smoke: all tests passed");
