/**
 * テストツール画面 smoke テスト（ソース検査 + ドメイン）
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { calculateDummyFillPlan } from "../../js/domain/dummy-entries.js";
import { isTestTournamentName } from "../../js/domain/test-tournament-access.js";
import { findForbiddenSnapshotFields } from "../../js/domain/public-tournament-snapshot.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const pageSource = readFileSync(
  join(root, "js/ui/pages/tournament-test-tools-page.js"),
  "utf8"
);
const htmlSource = readFileSync(join(root, "tournament-test-tools.html"), "utf8");
const serviceSource = readFileSync(
  join(root, "js/services/dummy-entry-service.js"),
  "utf8"
);
const qualifyingServiceSource = readFileSync(
  join(root, "js/services/qualifying-auto-progress-service.js"),
  "utf8"
);
const finalsServiceSource = readFileSync(
  join(root, "js/services/finals-auto-progress-service.js"),
  "utf8"
);
const dashboardSource = readFileSync(
  join(root, "js/ui/pages/tournament-dashboard-page.js"),
  "utf8"
);

assert.match(pageSource, /canUseTournamentTestTools/);
assert.match(pageSource, /fillDummyEntriesToTarget/);
assert.match(pageSource, /deleteDummyEntries/);
assert.match(pageSource, /runQualifyingAutoProgress/);
assert.match(pageSource, /validateQualifyingAutoProgress/);
assert.match(pageSource, /simulationSeedInput/);
assert.match(pageSource, /runFinalsAutoProgress/);
assert.match(pageSource, /validateFinalsAutoProgress/);
assert.match(pageSource, /finalsSimulationSeedInput/);
assert.match(pageSource, /confirmDialog/);
assert.match(pageSource, /console\.error\("\[test-tools\] loadPage failed"/);
assert.doesNotMatch(pageSource, /dev=1/);

assert.match(htmlSource, /予選自動進行/);
assert.match(htmlSource, /全予選試合を自動入力/);
assert.match(htmlSource, /決勝トーナメント自動進行/);
assert.match(htmlSource, /決勝トーナメントを自動進行/);
assert.match(htmlSource, /finalsSimulationSeedInput/);

assert.match(finalsServiceSource, /writeBatch/);
assert.match(finalsServiceSource, /buildFinalsAutoProgressPlan/);
assert.match(finalsServiceSource, /validateFinalsAutoProgress/);
assert.doesNotMatch(finalsServiceSource, /testSimulation/);

assert.match(serviceSource, /writeBatch/);
assert.match(serviceSource, /entry\.isDummy !== true/);
assert.doesNotMatch(serviceSource, /finalsAdvancement[\s\S]*setDoc/);

assert.match(qualifyingServiceSource, /writeBatch/);
assert.match(qualifyingServiceSource, /buildQualifyingMatchResultPayload/);
assert.match(qualifyingServiceSource, /validateQualifyingAutoProgress/);
assert.doesNotMatch(qualifyingServiceSource, /testSimulation/);

assert.match(dashboardSource, /isTestTournamentName/);
assert.match(dashboardSource, /openTestToolsBtn/);

assert.equal(isTestTournamentName("[E2E] x"), true);
assert.equal(isTestTournamentName("本番大会"), false);

const plan = calculateDummyFillPlan({
  targetCount: 16,
  confirmedCount: 3,
  maxTeams: 64,
  existingEntries: [],
});
assert.equal(plan.toAdd, 13);

const realEntries = [
  { id: "real", isDummy: false, teamName: "実チーム", status: "confirmed" },
  { id: "d1", isDummy: true, teamName: "ダミーチーム01", status: "confirmed" },
];
const deleteTargets = realEntries.filter((entry) => entry.isDummy === true);
assert.equal(deleteTargets.length, 1);
assert.equal(deleteTargets[0].id, "d1");

const forbidden = findForbiddenSnapshotFields({
  isDummy: true,
  dummyBatchId: "x",
  simulationSeed: 1,
  testSimulation: { qualifying: { simulationSeed: 1 } },
});
assert.ok(forbidden.includes("isDummy"));
assert.ok(forbidden.includes("dummyBatchId"));
assert.ok(forbidden.includes("testSimulation"));

console.log("tournament-test-tools.smoke.mjs: all passed");
