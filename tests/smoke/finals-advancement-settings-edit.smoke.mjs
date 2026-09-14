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

const dedicatedPathStart = rules.indexOf(
  "function validFinalsAdvancementSettingsBeforeQualifyingStartUpdate"
);
assert.notEqual(dedicatedPathStart, -1);
const dedicatedPath = rules.slice(
  dedicatedPathStart,
  rules.indexOf("function validTournamentSoftDeleteUpdate", dedicatedPathStart)
);
assert.match(dedicatedPath, /newData\.blockCount == old\.blockCount/);
assert.match(dedicatedPath, /newData\.qualifiersPerBlock in \[1, 2\]/);
assert.match(dedicatedPath, /newData\.finalTeamCount in \[4, 8, 16, 32\]/);
assert.match(dedicatedPath, /optionalWildcardComparisonMode\(newData\)/);
assert.match(dedicatedPath, /newData\.updatedAt == request\.time/);
// 式評価上限回避のため、この専用パスでは diff()/hasOnly を使わない
assert.doesNotMatch(dedicatedPath, /diff\(/);
assert.doesNotMatch(dedicatedPath, /hasOnly\(/);

console.log("finals-advancement-settings-edit.smoke.mjs: all passed");
