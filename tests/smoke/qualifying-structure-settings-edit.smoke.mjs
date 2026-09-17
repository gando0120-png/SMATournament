/**
 * 抽選確定前の予選構成変更 UI / Rules 配線 smoke
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ALLOWED_BLOCK_COUNTS } from "../../js/domain/block-configuration.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const dashboardHtml = readFileSync(join(root, "tournament-dashboard.html"), "utf8");
const createHtml = readFileSync(join(root, "tournament-new.html"), "utf8");
const dashboardJs = readFileSync(join(root, "js/ui/pages/tournament-dashboard-page.js"), "utf8");
const serviceJs = readFileSync(
  join(root, "js/services/qualifying-structure-settings-service.js"),
  "utf8"
);
const rules = readFileSync(join(root, "firestore.rules"), "utf8");

assert.deepEqual(ALLOWED_BLOCK_COUNTS, [4, 6, 7, 8, 16, 32]);
assert.match(createHtml, /option value="7"/);
assert.match(dashboardHtml, /option value="7"/);
assert.match(dashboardHtml, /id="newFormatBlockCountHint"/);
assert.match(dashboardHtml, /id="newFormatAdvancementPreview"/);
assert.match(dashboardJs, /updateQualifyingStructureSettingsBeforeDrawFinalize/);
assert.match(dashboardJs, /buildQualifyingStructureSettingsPreview/);
assert.match(dashboardJs, /formatQualifyingStructureDraftDiscardConfirmMessage/);
assert.match(dashboardJs, /readSavedQualifyingStructureFormValues/);
assert.match(dashboardJs, /restoreNewFormatSettingsFormFromSaved/);
assert.equal(
  [...dashboardJs.matchAll(/restoreNewFormatSettingsFormFromSaved\(/g)].length,
  3
);
assert.match(dashboardJs, /抽選確定後はブロック数を変更できません/);
assert.match(dashboardJs, /updateFinalsAdvancementSettingsBeforeQualifyingStart/);
assert.match(dashboardJs, /editFinalsAdvancementSettingsBtn/);

assert.match(serviceJs, /deleteBlockDrawDraftIfPresent/);
assert.match(serviceJs, /withPublicSnapshotRebuild/);
assert.doesNotMatch(serviceJs, /saveTimeSchedule/);
assert.doesNotMatch(serviceJs, /saveQualifyingSchedule/);

const dedicatedPathStart = rules.indexOf(
  "function validFinalsAdvancementSettingsBeforeQualifyingStartUpdate"
);
assert.notEqual(dedicatedPathStart, -1);
const dedicatedPath = rules.slice(
  dedicatedPathStart,
  rules.indexOf("function validTournamentSoftDeleteUpdate", dedicatedPathStart)
);
assert.match(dedicatedPath, /n == 7|isAllowedBlockCountValue\(newData\.blockCount\)/);
assert.match(dedicatedPath, /!hasBlockDraw\(tournamentId\)/);
assert.match(dedicatedPath, /qualifyingSchedules\/current/);
assert.match(dedicatedPath, /newData\.maxTeams == old\.maxTeams/);
assert.match(dedicatedPath, /newData\.teamSize == old\.teamSize/);
assert.match(dedicatedPath, /newData\.name == old\.name/);
assert.match(dedicatedPath, /newData\.updatedAt == request\.time/);
assert.doesNotMatch(dedicatedPath, /\.diff\(/);
assert.doesNotMatch(dedicatedPath, /hasOnly\(/);

assert.match(rules, /n == 4 \|\| n == 6 \|\| n == 7 \|\| n == 8 \|\| n == 16 \|\| n == 32/);
assert.match(
  rules,
  /validFinalsAdvancementSettingsBeforeQualifyingStartUpdate\(tournamentId\)/
);

assert.match(rules, /function validTournamentSettingsUpdate/);
assert.match(rules, /affectedKeys\(\)\.hasOnly\(allowedKeys\)/);

console.log("qualifying-structure-settings-edit.smoke.mjs: all passed");
