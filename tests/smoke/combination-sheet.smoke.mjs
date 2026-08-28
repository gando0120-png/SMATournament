/**
 * 組み合わせ帳票 Sprint 1 の配線スモーク
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildQualifyingBlocksCombinationSheet,
  buildSingleEliminationCombinationSheet,
} from "../../js/domain/combination-sheet.js";
import { renderCombinationSheetHtml } from "../../js/ui/combination-sheet-render.js";
import {
  buildPersistedSingleEliminationBracket,
  buildSingleEliminationBracket,
} from "../../js/domain/single-elimination-bracket.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

function read(rel) {
  return readFileSync(join(root, rel), "utf8");
}

const html = read("combination-sheet.html");
const pageJs = read("js/ui/pages/combination-sheet-page.js");
const domainJs = read("js/domain/combination-sheet.js");
const renderJs = read("js/ui/combination-sheet-render.js");
const css = read("css/combination-sheet.css");
const dashboardHtml = read("tournament-dashboard.html");
const dashboardJs = read("js/ui/pages/tournament-dashboard-page.js");

assert.match(html, /combination-sheet\.html|組み合わせ表/);
assert.match(html, /id="printBtn"/);
assert.match(html, /印刷・PDF保存/);
assert.match(html, /id="printHint"/);
assert.match(html, /ブラウザのメニューから「共有」または「印刷」/);
assert.doesNotMatch(html, /userAgent|navigator\.userAgent/);
assert.match(html, /id="backBtn"/);
assert.match(html, /css\/combination-sheet\.css/);
assert.match(html, /js\/ui\/pages\/combination-sheet-page\.js/);
assert.match(html, /Noto\+Sans\+JP/);
assert.doesNotMatch(html, /finals-bracket-view/);

assert.match(pageJs, /window\.print\(\)/);
assert.match(pageJs, /printHint/);
assert.doesNotMatch(pageJs, /userAgent|navigator\.userAgent/);
assert.doesNotMatch(pageJs, /html2canvas/);
assert.match(pageJs, /@page/);
assert.match(pageJs, /A4 landscape/);
assert.match(pageJs, /buildQualifyingBlocksCombinationSheet/);
assert.match(pageJs, /buildSingleEliminationCombinationSheet/);
assert.match(pageJs, /initTournamentManageGuard/);
assert.doesNotMatch(pageJs, /html2canvas/);
assert.doesNotMatch(pageJs, /jsPDF|jspdf|pdf-lib/);
assert.doesNotMatch(pageJs, /getStorage|firebase\/storage/);
assert.doesNotMatch(pageJs, /from ["'].*finals-bracket-view\.js["']/);

assert.doesNotMatch(domainJs, /firebase/);
assert.doesNotMatch(domainJs, /document\./);
assert.doesNotMatch(domainJs, /window\./);
assert.match(domainJs, /sortBlocksByBlockId/);
assert.match(domainJs, /isBlockDrawFinalized/);
assert.match(domainJs, /hasCreatedSingleEliminationBracket/);
assert.match(domainJs, /isByeTeam/);

assert.doesNotMatch(renderJs, /from ["'].*finals-bracket-view\.js["']/);
assert.match(renderJs, /renderCombinationSheetHtml/);

assert.match(css, /@media print/);
assert.match(css, /@page/);
assert.match(css, /size:\s*A4/);
assert.match(css, /\.no-print/);
assert.match(css, /Noto Sans JP/);
assert.match(css, /\.combination-sheet-print-hint/);
assert.match(css, /max-width:\s*768px/);
assert.doesNotMatch(css, /userAgent/);

assert.match(dashboardHtml, /id="openQualifyingCombinationSheetBtn"/);
assert.match(dashboardHtml, /id="openSingleElimCombinationSheetBtn"/);
assert.match(dashboardHtml, /id="closedCombinationSheetBtn"/);
assert.match(dashboardHtml, /組み合わせ表を出力/);
assert.match(dashboardJs, /combination-sheet\.html\?id=/);
assert.match(dashboardJs, /syncCombinationSheetLinks/);
assert.match(dashboardJs, /isBlockDrawFinalized/);
assert.match(dashboardJs, /hasCreatedSingleEliminationBracket/);

const qualifying = buildQualifyingBlocksCombinationSheet({
  tournament: {
    id: "t1",
    name: "第1回テスト大会",
    eventDate: "2026-08-30",
    venue: "○○グラウンド",
    tournamentFormat: "qualifying_and_finals",
  },
  blockDraw: {
    status: "finalized",
    blocks: [{ id: "A", name: "Aブロック", entryIds: ["e-1", "e-2"] }],
  },
  entries: [
    { id: "e-1", teamName: "チームA" },
    { id: "e-2", teamName: "チームB" },
  ],
});
assert.equal(qualifying.ok, true);
const qualifyingHtml = renderCombinationSheetHtml(qualifying.sheet);
assert.match(qualifyingHtml, /第1回テスト大会/);
assert.match(qualifyingHtml, /予選組み合わせ/);
assert.match(qualifyingHtml, /チームA/);
assert.match(qualifyingHtml, /Aブロック/);
assert.doesNotMatch(qualifyingHtml, /e-1@/);
assert.doesNotMatch(qualifyingHtml, /スマートフォンでは/);

const preview = buildSingleEliminationBracket({
  entries: Array.from({ length: 4 }, (_, index) => ({
    entryId: `se-${index + 1}`,
    teamName: `Team ${index + 1}`,
  })),
  random: () => 0.42,
});
const se = buildSingleEliminationCombinationSheet({
  tournament: {
    id: "t2",
    name: "一発大会",
    eventDate: "2026-08-30",
    venue: "会場",
    tournamentFormat: "single_elimination",
  },
  bracket: buildPersistedSingleEliminationBracket(preview),
  entries: Array.from({ length: 4 }, (_, index) => ({
    id: `se-${index + 1}`,
    teamName: `Team ${index + 1}`,
  })),
});
assert.equal(se.ok, true);
const seHtml = renderCombinationSheetHtml(se.sheet);
assert.match(seHtml, /トーナメント組み合わせ/);
assert.match(seHtml, /決勝/);
assert.doesNotMatch(seHtml, /優勝/);
assert.doesNotMatch(seHtml, /html2canvas/);

console.log("combination-sheet.smoke.mjs: all passed");
