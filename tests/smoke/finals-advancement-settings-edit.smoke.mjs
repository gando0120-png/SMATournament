/**
 * 進出条件再編集 UI / service 配線 smoke
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const dashboardHtml = readFileSync(join(root, "tournament-dashboard.html"), "utf8");
const dashboardJs = readFileSync(join(root, "js/ui/pages/tournament-dashboard-page.js"), "utf8");
const serviceJs = readFileSync(
  join(root, "js/services/finals-advancement-settings-service.js"),
  "utf8"
);
const rules = readFileSync(join(root, "firestore.rules"), "utf8");

assert.match(dashboardHtml, /id="editFinalsAdvancementSettingsBtn"/);
assert.match(dashboardHtml, /進出条件を変更/);
assert.match(dashboardJs, /updateFinalsAdvancementSettingsBeforeQualifyingStart/);
assert.match(dashboardJs, /formatFinalsAdvancementSettingsChangeConfirmMessage/);
assert.match(dashboardJs, /handleUnlockFinalsAdvancementSettings/);
assert.match(dashboardJs, /confirmDialog/);
assert.match(dashboardJs, /自動通過 \$\{nextAuto\} \/ WC \$\{nextWc\}|formatFinalsAdvancementSettingsChangeConfirmMessage/);

assert.match(serviceJs, /withPublicSnapshotRebuild/);
assert.doesNotMatch(serviceJs, /saveQualifyingSchedule/);
assert.doesNotMatch(serviceJs, /finalizeBlockDraw/);

assert.match(rules, /validFinalsAdvancementSettingsBeforeQualifyingStartUpdate/);
assert.match(
  rules,
  /hasOnly\(\['qualifiersPerBlock', 'finalTeamCount', 'wildcardComparisonMode', 'updatedAt'\]\)/
);
assert.match(rules, /newData\.blockCount == old\.blockCount/);

console.log("finals-advancement-settings-edit.smoke.mjs: all passed");
