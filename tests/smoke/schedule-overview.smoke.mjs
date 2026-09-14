/**
 * 大会スケジュール一覧の配線スモーク
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildScheduleOverview,
  buildScheduleOverviewFromSnapshot,
} from "../../js/domain/schedule-overview.js";
import {
  renderAllMatchesHtml,
  renderScheduleOverviewPrintHtml,
  renderTeamScheduleHtml,
} from "../../js/ui/schedule-overview-render.js";
import { TournamentFormat } from "../../js/domain/tournament-format.js";
import { buildQualifyingScheduleFromBlockDraw } from "../../js/domain/qualifying-schedule.js";
import { buildPersistedQualifyingSchedule } from "../../js/domain/qualifying-schedule-persist.js";
import { buildTimeScheduleDoc } from "../../js/domain/time-schedule.js";
import { EntryStatus } from "../../js/domain/constants.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

function read(rel) {
  return readFileSync(join(root, rel), "utf8");
}

const html = read("tournament-schedule-overview.html");
const pageJs = read("js/ui/pages/tournament-schedule-overview-page.js");
const domainJs = read("js/domain/schedule-overview.js");
const renderJs = read("js/ui/schedule-overview-render.js");
const css = read("css/schedule-overview.css");
const dashboardHtml = read("tournament-dashboard.html");
const dashboardJs = read("js/ui/pages/tournament-dashboard-page.js");
const publicHtml = read("tournament-public.html");
const publicJs = read("js/ui/pages/tournament-public-page.js");
const snapshotJs = read("js/domain/public-tournament-snapshot.js");

assert.match(html, /id="modeAllBtn"/);
assert.match(html, /id="modeTeamBtn"/);
assert.match(html, /id="printBtn"/);
assert.match(html, /印刷・PDF保存/);
assert.match(html, /id="printHint"/);
assert.match(html, /id="printRoot"/);
assert.match(html, /css\/schedule-overview\.css/);
assert.match(html, /js\/ui\/pages\/tournament-schedule-overview-page\.js/);
assert.doesNotMatch(html, /jsPDF|jspdf|pdf-lib|html2canvas/);

assert.match(pageJs, /window\.print\(\)/);
assert.match(pageJs, /loadPublicSnapshot/);
assert.match(pageJs, /buildScheduleOverviewFromSnapshot/);
assert.match(pageJs, /get\("public"\) === "1"/);
assert.doesNotMatch(pageJs, /timeSchedule\/current/);
assert.doesNotMatch(pageJs, /getTimeSchedule/);
assert.doesNotMatch(pageJs, /html2canvas|jsPDF|jspdf|pdf-lib/);

assert.doesNotMatch(domainJs, /firebase/);
assert.doesNotMatch(domainJs, /document\./);
assert.doesNotMatch(domainJs, /window\./);
assert.match(domainJs, /buildQualifyingPublicTimeSchedule/);
assert.match(domainJs, /applyQualifyingScheduledTimesToScheduleSection/);
assert.match(domainJs, /resolveLiveTeamName/);

assert.match(renderJs, /renderScheduleOverviewPrintHtml/);
assert.doesNotMatch(renderJs, /firebase/);

assert.match(css, /@media print/);
assert.match(css, /@page/);
assert.match(css, /size:\s*A4 portrait/);
assert.match(css, /\.no-print/);
assert.match(css, /overflow-wrap:\s*anywhere/);

assert.match(dashboardHtml, /id="openScheduleOverviewBtn"/);
assert.match(dashboardHtml, /大会スケジュール/);
assert.match(dashboardHtml, /id="closedScheduleOverviewBtn"/);
assert.match(dashboardJs, /tournament-schedule-overview\.html/);

assert.match(publicHtml, /id="openPublicScheduleOverviewBtn"/);
assert.match(publicHtml, /試合スケジュール/);
assert.match(publicJs, /tournament-schedule-overview\.html/);
assert.match(publicJs, /public=1/);

assert.match(snapshotJs, /scheduleOverview/);
assert.match(snapshotJs, /buildScheduleOverview/);

const entries = Array.from({ length: 4 }, (_, index) => ({
  id: `e${index + 1}`,
  teamName: `チーム${index + 1}`,
  status: EntryStatus.CONFIRMED,
}));
const blockDraw = {
  status: "finalized",
  blocks: [{ id: "A", name: "Aブロック", entryIds: entries.map((entry) => entry.id) }],
};
const schedule = buildPersistedQualifyingSchedule(
  buildQualifyingScheduleFromBlockDraw(blockDraw, entries),
  blockDraw
);
const overview = buildScheduleOverview({
  tournament: {
    id: "t1",
    name: "スモーク大会",
    tournamentFormat: TournamentFormat.QUALIFYING_AND_FINALS,
  },
  entries,
  schedule,
  blockDraw,
  timeSchedule: buildTimeScheduleDoc({
    dayStartTime: "09:00",
    matchDurationMinutes: 20,
    matchIntervalMinutes: 5,
    qualifyingToFinalsIntervalMinutes: 60,
  }),
});
const allHtml = renderAllMatchesHtml(overview);
assert.match(allHtml, /第1節/);
assert.match(allHtml, /1コート|2コート/);
const teamHtml = renderTeamScheduleHtml(overview, "");
assert.match(teamHtml, /チームを選択/);
const printHtml = renderScheduleOverviewPrintHtml(overview, { mode: "all" });
assert.match(printHtml, /sheet-page/);
assert.match(printHtml, /第1節/);
const teamPrint = renderScheduleOverviewPrintHtml(overview, {
  mode: "team",
  teamId: "e1",
});
assert.match(teamPrint, /のスケジュール/);

const snapshotLike = { scheduleOverview: overview };
assert.equal(buildScheduleOverviewFromSnapshot(snapshotLike).slots.length, overview.slots.length);

console.log("schedule-overview.smoke.mjs: all passed");
