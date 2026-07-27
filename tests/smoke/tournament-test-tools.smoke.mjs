/**
 * テストツール画面 smoke テスト（ソース検査 + ドメイン）
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { calculateDummyFillPlan } from "../../js/domain/dummy-entries.js";
import { isTestTournamentName } from "../../js/domain/test-tournament-access.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const pageSource = readFileSync(
  join(root, "js/ui/pages/tournament-test-tools-page.js"),
  "utf8"
);
const serviceSource = readFileSync(
  join(root, "js/services/dummy-entry-service.js"),
  "utf8"
);
const dashboardSource = readFileSync(
  join(root, "js/ui/pages/tournament-dashboard-page.js"),
  "utf8"
);

assert.match(pageSource, /canUseTournamentTestTools/);
assert.match(pageSource, /fillDummyEntriesToTarget/);
assert.match(pageSource, /deleteDummyEntries/);
assert.match(pageSource, /confirmDialog/);
assert.match(pageSource, /console\.error\("\[test-tools\] loadPage failed"/);
assert.doesNotMatch(pageSource, /dev=1/);

assert.match(serviceSource, /writeBatch/);
assert.match(serviceSource, /entry\.isDummy !== true/);
assert.doesNotMatch(serviceSource, /finalsAdvancement[\s\S]*setDoc/);

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

console.log("tournament-test-tools.smoke.mjs: all passed");
