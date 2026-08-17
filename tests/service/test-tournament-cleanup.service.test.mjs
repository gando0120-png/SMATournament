/**
 * テスト大会一括削除サービス層テスト（Firestore 非依存）
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  filterCleanupCandidates,
  validateCleanupSelection,
} from "../../js/domain/test-tournament-cleanup.js";
import { TOURNAMENT_SUBCOLLECTIONS } from "../../js/domain/tournament-subcollections.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const serviceSource = readFileSync(
  join(root, "js/services/test-tournament-cleanup-service.js"),
  "utf8"
);
const functionsSource = readFileSync(
  join(root, "functions/src/test-tournament-cleanup.js"),
  "utf8"
);

assert.match(serviceSource, /dryRunTestTournamentCleanupCallable/);
assert.match(serviceSource, /deleteTestTournamentCallable/);
assert.match(serviceSource, /validateCleanupSelection/);
assert.match(serviceSource, /executeTestTournamentCleanup/);
assert.doesNotMatch(serviceSource, /dev=1/);

assert.match(functionsSource, /recursiveDelete/);
assert.match(functionsSource, /assertDeletableTestTournamentName/);
assert.match(functionsSource, /assertOperatorEnabled/);
assert.match(functionsSource, /listCollections/);

const expectedSubcollections = [
  "entries",
  "blockDraw",
  "qualifyingSchedules",
  "qualifyingMatchResults",
  "qualifyingMatchSessions",
  "qualifyingResultSubmissions",
  "qualifyingMatchReconciliations",
  "entryAccessTokens",
  "finalsAdvancement",
  "finalsBracket",
  "finalsMatchSessions",
  "finalsMatchResults",
  "consolationBracket",
  "consolationMatchSessions",
  "consolationMatchResults",
  "lossBandState",
  "lossBandRounds",
  "lossBandMatchSessions",
  "lossBandMatchResults",
  "lossBandPlacements",
  "tournamentResults",
  "publicSnapshot",
  "testSimulation",
  "molkkyOutResolutions",
];
assert.deepEqual([...TOURNAMENT_SUBCOLLECTIONS], expectedSubcollections);

const candidates = filterCleanupCandidates([
  { id: "a", name: "E2E" },
  { id: "b", name: "通常大会" },
]);
const dryRunSelection = validateCleanupSelection(candidates, ["a"]);
assert.equal(dryRunSelection.valid, true);

const blocked = validateCleanupSelection(candidates, ["a", "b"]);
assert.equal(blocked.hasNonTestTournament, true);

console.log("test-tournament-cleanup.service.test.mjs: all passed");
