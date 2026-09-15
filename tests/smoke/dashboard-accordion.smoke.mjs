/**
 * 大会管理ダッシュボード アコーディオン配線 smoke
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

function read(rel) {
  return readFileSync(join(root, rel), "utf8");
}

const html = read("tournament-dashboard.html");
const pageJs = read("js/ui/pages/tournament-dashboard-page.js");
const sectionsJs = read("js/ui/dashboard-sections.js");
const css = read("css/components.css");
const preview = read("tools/dashboard-accordion-preview.html");
const firebaseJson = read("firebase.json");

const requiredIds = [
  "tournamentName",
  "tournamentMeta",
  "statusBadge",
  "closedSummaryPanel",
  "finalizeResultsPanel",
  "openEntriesManageBtn",
  "editEntryCompletionGuidanceBtn",
  "editTournamentBtn",
  "entryUrl",
  "copyUrlBtn",
  "publicPagePanel",
  "copyPublicUrlBtn",
  "openPublicPageBtn",
  "publicViewSelect",
  "participantResultEntrySelect",
  "copyPlayerCommonUrlBtn",
  "qualifyingFlowPanel",
  "blockDrawBtn",
  "openScheduleOverviewBtn",
  "openScheduleBtn",
  "openStandingsBtn",
  "openFinalsAdvancementBtn",
  "finalsAdvancementPanel",
  "openFinalsAdvancementPrimaryBtn",
  "singleElimPanel",
  "createSingleElimBracketBtn",
  "openSingleElimBracketBtn",
  "finalsBracketPanel",
  "openFinalsBracketPrimaryBtn",
  "openEntryBtn",
  "closedViewLinksPanel",
  "closedScheduleOverviewBtn",
];

for (const id of requiredIds) {
  assert.match(html, new RegExp(`id="${id}"`));
}

assert.match(html, /id="tournamentName"/);
assert.ok(html.indexOf('id="closedSummaryPanel"') < html.indexOf("<details"));
assert.ok(html.indexOf('id="finalizeResultsPanel"') < html.indexOf("<details"));
assert.ok(html.indexOf('id="tournamentName"') < html.indexOf("<details"));
assert.doesNotMatch(
  html.slice(html.indexOf('id="closedSummaryPanel"'), html.indexOf('id="closedSummaryPanel"') + 400),
  /<details/
);

const qualifyingBlock = html.match(
  /<details class="dashboard-section" data-section="qualifying"[\s\S]*?<\/details>/
);
assert.ok(qualifyingBlock, "抽選・予選 details が必要");
assert.match(qualifyingBlock[0], /id="qualifyingFlowPanel"/);
assert.match(qualifyingBlock[0], /id="blockDrawBtn"/);
assert.match(qualifyingBlock[0], /id="openScheduleBtn"/);
assert.match(qualifyingBlock[0], /id="openScheduleOverviewBtn"/);
assert.match(qualifyingBlock[0], /<summary class="dashboard-section__toggle">/);
assert.equal((html.match(/id="qualifyingFlowPanel"/g) || []).length, 1);
assert.doesNotMatch(html.replace(qualifyingBlock[0], ""), /id="blockDrawBtn"/);

const seBlock = html.match(
  /<details class="dashboard-section" data-section="se"[\s\S]*?<\/details>/
);
assert.ok(seBlock);
assert.match(seBlock[0], /id="singleElimPanel"/);
assert.match(seBlock[0], /class="panel hidden"/);

assert.match(html, /data-section="entries"/);
assert.match(html, /data-section="info"/);
assert.match(html, /data-section="public-entry"/);
assert.match(html, /data-section="public"/);
assert.match(html, /data-section="player-results"/);
assert.match(html, /data-section="advancement"/);
assert.match(html, /data-section="finals"/);
assert.match(html, /data-section="entry-open"/);
assert.match(html, /data-section="browse"/);

assert.equal((html.match(/<details class="dashboard-section"/g) || []).length, 11);
assert.equal((html.match(/<details class="dashboard-section"[^>]* open>/g) || []).length, 11);

assert.match(html, /id="dashboardOperations"/);
assert.match(html, /data-hide-when-closed/);

assert.match(pageJs, /from "\.\.\/dashboard-sections\.js"/);
assert.match(pageJs, /applyDashboardSectionsAfterLoad\(\)/);
assert.match(pageJs, /refreshDashboardSectionLabels\(\)/);
assert.match(pageJs, /bindDashboardSectionPersistence/);
assert.doesNotMatch(pageJs, /dashboard-section[\s\S]{0,80}classList\.(add|toggle)\(["']hidden["']/);

assert.match(sectionsJs, /sma\.dashboard\.sections\./);
assert.match(sectionsJs, /sessionStorage/);
assert.doesNotMatch(sectionsJs, /firebase/);
assert.doesNotMatch(sectionsJs, /getDoc|onSnapshot|collection\(/);
assert.doesNotMatch(sectionsJs, /\.hidden/);
assert.doesNotMatch(sectionsJs, /予選終了/);

assert.match(css, /min-height:\s*var\(--touch-min\)/);
assert.match(css, /dashboard-section:has\(>\s*\.dashboard-section__content\s*>\s*\.hidden\)/);
assert.match(css, /content:\s*"▶"/);
assert.match(css, /content:\s*"▼"/);
assert.match(css, /overflow-x:\s*clip/);

assert.match(preview, /360/);
assert.match(preview, /390/);
assert.match(preview, /430/);
assert.match(preview, /dashboard-sections\.js/);
assert.match(preview, /scene-closed|closed/);
assert.match(preview, /single_elimination|SE/);

assert.match(firebaseJson, /"tools\/\*\*"/);

console.log("dashboard-accordion.smoke.mjs: all passed");
