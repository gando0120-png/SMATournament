/**
 * 大会スケジュール HTML スモーク
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

const newHtml = readFileSync(join(root, "tournament-new.html"), "utf8");
const editHtml = readFileSync(join(root, "tournament-edit-v2.html"), "utf8");

for (const html of [newHtml, editHtml]) {
  assert.ok(html.includes('id="timeScheduleSection"'));
  assert.ok(html.includes('id="dayStartTime"'));
  assert.ok(html.includes('id="matchDurationMinutes"'));
  assert.ok(html.includes('id="matchIntervalMinutes"'));
  assert.ok(html.includes('id="qualifyingToFinalsIntervalMinutes"'));
  assert.ok(html.includes("大会スケジュール"));
}

const dashboard = readFileSync(join(root, "js/ui/pages/tournament-dashboard-page.js"), "utf8");
assert.ok(dashboard.includes("resolveTournamentTimeScheduleSummary"));
assert.ok(dashboard.includes("getTimeSchedule"));
assert.doesNotMatch(dashboard, /qualifyingSchedules.*scheduledStart/);
assert.doesNotMatch(dashboard, /finalsBracket.*scheduledStart/);

const schedulePage = readFileSync(join(root, "js/ui/pages/tournament-schedule-page.js"), "utf8");
assert.ok(schedulePage.includes("buildQualifyingPublicTimeSchedule"));
assert.ok(schedulePage.includes("formatQualifyingRoundTitle"));
assert.ok(schedulePage.includes("formatQualifyingMatchScheduledLabel"));
assert.ok(schedulePage.includes("getTimeSchedule"));
assert.ok(schedulePage.includes("saveTimeScheduleOverrides"));
assert.ok(schedulePage.includes("scheduledTimeDialog"));
assert.ok(schedulePage.includes("時刻変更"));
assert.ok(schedulePage.includes("currentTimeSchedule?.configured"));
assert.doesNotMatch(schedulePage, /saveQualifyingSchedule\([^)]*startTime/);
assert.doesNotMatch(schedulePage, /dayStartTime \+ .*roundNumber/);

const publicPage = readFileSync(join(root, "js/ui/pages/tournament-public-page.js"), "utf8");
assert.ok(publicPage.includes("予選スケジュール"));
assert.ok(publicPage.includes("scheduledStartLabel"));
assert.ok(publicPage.includes("roundHeading"));
assert.doesNotMatch(publicPage, /from \"..\/..\/services\/time-schedule-service.js\"/);
assert.doesNotMatch(publicPage, /from \"..\/..\/domain\/time-schedule.js\"/);
assert.doesNotMatch(publicPage, /getTimeSchedule/);
assert.doesNotMatch(publicPage, /matchDurationMinutes \*/);
assert.doesNotMatch(publicPage, /時刻変更/);
assert.doesNotMatch(publicPage, /（手動）/);
assert.doesNotMatch(publicPage, /scheduledTimeDialog/);

const snapshotService = readFileSync(
  join(root, "js/services/public-tournament-snapshot-service.js"),
  "utf8"
);
assert.ok(snapshotService.includes("getTimeSchedule"));
assert.ok(snapshotService.includes("timeSchedule"));

const timeScheduleService = readFileSync(
  join(root, "js/services/time-schedule-service.js"),
  "utf8"
);
assert.ok(timeScheduleService.includes("saveTimeScheduleOverrides"));
assert.ok(timeScheduleService.includes("withPublicSnapshotRebuild"));

const scheduledTimeDialog = readFileSync(
  join(root, "js/ui/components/scheduled-time-dialog.js"),
  "utf8"
);
assert.ok(scheduledTimeDialog.includes("自動に戻す"));
assert.ok(scheduledTimeDialog.includes("normalizeDayStartTime"));
assert.ok(scheduledTimeDialog.includes('type="time"'));

const finalsAdminPage = readFileSync(
  join(root, "js/ui/pages/tournament-finals-bracket-page.js"),
  "utf8"
);
assert.ok(finalsAdminPage.includes("buildFinalsPublicTimeSchedule"));
assert.ok(finalsAdminPage.includes("applyFinalsScheduledTimesToRounds"));
assert.ok(finalsAdminPage.includes("getTimeSchedule"));
assert.ok(finalsAdminPage.includes("getQualifyingSchedule"));
assert.ok(finalsAdminPage.includes("saveTimeScheduleOverrides"));
assert.ok(finalsAdminPage.includes("scheduledTimeDialog"));
assert.ok(finalsAdminPage.includes("includeManual: true"));
assert.doesNotMatch(finalsAdminPage, /saveFinalsBracket\([^)]*scheduledStart/);
assert.doesNotMatch(finalsAdminPage, /matchDurationMinutes \+ matchIntervalMinutes/);

const finalsView = readFileSync(join(root, "js/ui/components/finals-bracket-view.js"), "utf8");
assert.ok(finalsView.includes("roundHeading"));
assert.ok(finalsView.includes("scheduledStartLabel"));
assert.ok(finalsView.includes("finals-bracket__scheduled"));
assert.ok(finalsView.includes("時刻変更"));
assert.ok(finalsView.includes('options.surface === "admin"'));
assert.ok(finalsView.includes("canEditScheduledTimes"));
assert.doesNotMatch(finalsView, /from \"..\/..\/domain\/time-schedule.js\"/);

const firestoreRules = readFileSync(join(root, "firestore.rules"), "utf8");
assert.ok(firestoreRules.includes("validTimeScheduleOverrides"));
assert.ok(firestoreRules.includes("qualifyingRounds"));
assert.ok(firestoreRules.includes("qualifyingMatches"));
assert.ok(firestoreRules.includes("finalsRounds"));
assert.ok(firestoreRules.includes("finalsMatches"));

console.log("time-schedule.smoke.mjs: ok");
