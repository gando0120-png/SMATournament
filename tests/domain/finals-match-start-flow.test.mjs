/**
 * 決勝試合開始フロー ドメインテスト
 */
import assert from "node:assert/strict";
import {
  FinalsMatchDisplayStatus,
  getFinalsBracketMatchAction,
  shouldOpenFinalsMatchScoreEntryOnLoad,
  shouldStartFinalsMatchFromBracket,
} from "../../js/domain/finals-match-progress.js";

assert.deepEqual(getFinalsBracketMatchAction(FinalsMatchDisplayStatus.READY), {
  kind: "start",
  label: "試合開始",
});
assert.deepEqual(getFinalsBracketMatchAction(FinalsMatchDisplayStatus.PLAYING), {
  kind: "open",
  label: "試合を開く",
});
assert.deepEqual(getFinalsBracketMatchAction(FinalsMatchDisplayStatus.FINISHED), {
  kind: "view",
  label: "結果を見る",
});
assert.deepEqual(
  getFinalsBracketMatchAction(FinalsMatchDisplayStatus.FINISHED, { canEditResult: true }),
  { kind: "edit_result", label: "結果を修正" }
);
assert.equal(
  getFinalsBracketMatchAction(FinalsMatchDisplayStatus.FINISHED, { canEditResult: false })
    .kind,
  "edit_locked"
);
assert.deepEqual(getFinalsBracketMatchAction(FinalsMatchDisplayStatus.WAITING_OPPONENT), {
  kind: "none",
  label: null,
});
assert.deepEqual(getFinalsBracketMatchAction(FinalsMatchDisplayStatus.BYE), {
  kind: "none",
  label: null,
});

assert.equal(shouldStartFinalsMatchFromBracket(FinalsMatchDisplayStatus.READY), true);
assert.equal(shouldStartFinalsMatchFromBracket(FinalsMatchDisplayStatus.PLAYING), false);

assert.equal(
  shouldOpenFinalsMatchScoreEntryOnLoad(FinalsMatchDisplayStatus.PLAYING, true),
  true
);
assert.equal(
  shouldOpenFinalsMatchScoreEntryOnLoad(FinalsMatchDisplayStatus.READY, true),
  false
);
assert.equal(
  shouldOpenFinalsMatchScoreEntryOnLoad(FinalsMatchDisplayStatus.PLAYING, false),
  false
);

console.log("finals-match-start-flow.test.mjs: all passed");
