/**
 * Cloud Functions テスト大会名判定
 */
import assert from "node:assert/strict";
import {
  isTestTournamentName,
  isDeletableTestTournamentName,
  assertDeletableTestTournamentName,
  normalizeTournamentIds,
} from "../src/test-tournament-name.js";

assert.equal(isTestTournamentName("  test "), true);
assert.equal(isDeletableTestTournamentName("E2E大会"), true);
assert.throws(() => assertDeletableTestTournamentName("通常大会"), /テスト大会名条件/);

assert.deepEqual(normalizeTournamentIds([" a ", "a", "", null, "b"]), ["a", "b"]);

console.log("test-tournament-cleanup.functions.test.mjs: all passed");
