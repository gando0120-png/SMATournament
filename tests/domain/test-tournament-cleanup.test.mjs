/**
 * テスト大会名・一括削除ドメインテスト
 */
import assert from "node:assert/strict";
import {
  isTestTournamentName,
  isLooseTestTournamentName,
  isDeletableTestTournamentName,
} from "../../js/domain/test-tournament-access.js";
import {
  filterCleanupCandidates,
  validateCleanupSelection,
  summarizeDryRunOutcome,
  summarizeCleanupExecution,
} from "../../js/domain/test-tournament-cleanup.js";

assert.equal(isTestTournamentName("[E2E] 13人テスト"), true);
assert.equal(isTestTournamentName("[TEST] 一発トーナメント"), true);
assert.equal(isTestTournamentName("E2E"), true);
assert.equal(isTestTournamentName("TEST"), true);
assert.equal(isTestTournamentName("  e2e  "), true);
assert.equal(isTestTournamentName("test sample"), true);
assert.equal(isTestTournamentName("E2E demo"), true);

assert.equal(isTestTournamentName("通常大会"), false);
assert.equal(isTestTournamentName("SMA E2E CUP"), false);
assert.equal(isTestTournamentName("大会TEST版"), false);
assert.equal(isTestTournamentName("prefix [E2E]"), false);
assert.equal(isTestTournamentName(""), false);
assert.equal(isTestTournamentName(null), false);
assert.equal(isTestTournamentName(undefined), false);

assert.equal(isLooseTestTournamentName("E2E大会"), true);
assert.equal(isLooseTestTournamentName("TEST大会"), true);
assert.equal(isLooseTestTournamentName("E2E"), false);
assert.equal(isLooseTestTournamentName("[E2E] x"), false);
assert.equal(isLooseTestTournamentName("SMA E2E CUP"), false);

assert.equal(isDeletableTestTournamentName("E2E"), true);
assert.equal(isDeletableTestTournamentName("E2E大会"), true);
assert.equal(isDeletableTestTournamentName("通常大会"), false);

const candidates = filterCleanupCandidates([
  { id: "t1", name: "E2E", isDeleted: false },
  { id: "t2", name: "[E2E] 13人テスト", isDeleted: false },
  { id: "t3", name: "通常大会", isDeleted: false },
  { id: "t4", name: "SMA E2E CUP", isDeleted: false },
  { id: "t5", name: "TEST", isDeleted: false },
  { id: "t6", name: "[TEST] 一発トーナメント", isDeleted: false },
  { id: "t7", name: "大会TEST版", isDeleted: false },
  { id: "t8", name: "E2E大会", isDeleted: false },
  { id: "t9", name: "[E2E] deleted", isDeleted: true },
]);
assert.deepEqual(
  candidates.map((item) => item.id).sort(),
  ["t1", "t2", "t5", "t6", "t8"]
);

const validSelection = validateCleanupSelection(candidates, ["t1", "t2", "t5", "t6"]);
assert.equal(validSelection.valid, true);
assert.equal(validSelection.hasNonTestTournament, false);

const invalidSelection = validateCleanupSelection(candidates, ["t1", "t3"]);
assert.equal(invalidSelection.valid, false);
assert.equal(invalidSelection.hasNonTestTournament, true);

const dryRun = summarizeDryRunOutcome({
  tournaments: [
    { tournamentId: "t1", name: "E2E", documentCount: 3, subcollections: { entries: 2 } },
    { tournamentId: "t2", name: "[E2E] 13人テスト", documentCount: 10 },
  ],
});
assert.equal(dryRun.tournamentCount, 2);
assert.equal(dryRun.totalDocuments, 13);
assert.deepEqual(dryRun.tournamentNames, ["E2E", "[E2E] 13人テスト"]);

const execution = summarizeCleanupExecution({
  completedCount: 2,
  selectedCount: 2,
  deletedDocumentCount: 13,
  succeeded: [{ tournamentId: "t1", name: "E2E", deletedDocumentCount: 3 }],
  failed: [{ tournamentId: "t2", name: "[E2E] x", reason: "failed" }],
});
assert.equal(execution.partialFailure, true);
assert.equal(execution.allSucceeded, false);

console.log("test-tournament-cleanup.test.mjs: all passed");
