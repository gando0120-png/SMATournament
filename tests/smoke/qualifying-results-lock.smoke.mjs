/**
 * 決勝進出確定後の予選結果ロック スモークテスト
 */
import assert from "node:assert/strict";
import {
  assertQualifyingResultsEditable,
  isQualifyingResultsLocked,
  QUALIFYING_RESULTS_LOCKED_MESSAGE,
} from "../../js/lib/qualifying-results-lock.js";

function testUnlockedWhenNoAdvancement() {
  assert.equal(isQualifyingResultsLocked(null), false);
  assert.equal(isQualifyingResultsLocked(undefined), false);
  assert.doesNotThrow(() => assertQualifyingResultsEditable(null));
}

function testLockedWhenAdvancementExists() {
  const advancement = { finalized: true, qualifiers: [] };
  assert.equal(isQualifyingResultsLocked(advancement), true);
  assert.throws(
    () => assertQualifyingResultsEditable(advancement),
    (error) => {
      assert.equal(error.code, "qualifying-match-result/advancement-finalized");
      assert.equal(error.message, QUALIFYING_RESULTS_LOCKED_MESSAGE);
      return true;
    }
  );
}

function run() {
  testUnlockedWhenNoAdvancement();
  testLockedWhenAdvancementExists();
  console.log("qualifying-results-lock.smoke: all tests passed");
}

run();
