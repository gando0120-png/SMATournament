/**
 * block-count-lock ドメインテスト
 */
import assert from "node:assert/strict";
import {
  blockCountChangeRequiresDraftDiscard,
  isBlockCountEditable,
} from "../../js/domain/block-count-lock.js";

assert.equal(isBlockCountEditable(null), true, "blockDraw なし：変更可能");
assert.equal(isBlockCountEditable(undefined), true, "blockDraw なし：変更可能");

assert.equal(
  isBlockCountEditable({ status: "draft" }),
  true,
  "draft：変更可能"
);
assert.equal(
  blockCountChangeRequiresDraftDiscard({ status: "draft" }),
  true,
  "draft：破棄が必要"
);

assert.equal(
  isBlockCountEditable({ status: "finalized" }),
  false,
  "finalized：変更不可"
);
assert.equal(
  blockCountChangeRequiresDraftDiscard({ status: "finalized" }),
  false,
  "finalized：破棄不要"
);

assert.equal(
  isBlockCountEditable({ blockCount: 16 }),
  false,
  "status 未設定の既存 blockDraw は変更不可扱い"
);

console.log("block-count-lock.test.mjs: all passed");
