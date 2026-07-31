/**
 * 大会詳細 → 大会編集リンクの配線 smoke
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const dashboardHtml = readFileSync(join(root, "tournament-dashboard.html"), "utf8");
const dashboardJs = readFileSync(join(root, "js/ui/pages/tournament-dashboard-page.js"), "utf8");
const probeJs = readFileSync(join(root, "js/lib/dashboard-load-probe.js"), "utf8");
const componentsCss = readFileSync(join(root, "css/components.css"), "utf8");

assert.match(dashboardHtml, /id="editTournamentBtn"/);
assert.match(dashboardHtml, /大会設定を編集/);
assert.match(dashboardHtml, /id="winsRequiredEditHint"/);
// 初期状態で href="#" の偽リンクにしない
assert.doesNotMatch(
  dashboardHtml,
  /id="editTournamentBtn"[^>]*href="#"/
);

assert.match(dashboardJs, /function buildTournamentEditHref/);
assert.match(dashboardJs, /function syncEditTournamentLink/);
assert.match(dashboardJs, /tournament-edit\.html\?id=/);
assert.match(dashboardJs, /syncEditTournamentLink\(\{\s*locked:\s*false/);
assert.match(dashboardJs, /isFinalsMatchRulesLocked/);
// URL の tournamentId を使う（tournament.id のみに依存しない）
assert.match(dashboardJs, /buildTournamentEditHref\(tournamentId\)/);

// probe はドキュメントの id フィールドで上書きしない
assert.match(probeJs, /\.\.\.snap\.data\(\),\s*id:\s*snap\.id/);

assert.match(componentsCss, /aria-disabled="true"/);
assert.match(componentsCss, /pointer-events:\s*none/);

console.log("tournament-edit-link.smoke.mjs: all passed");
