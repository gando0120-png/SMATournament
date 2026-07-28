/**
 * 決勝トーナメント表表示 smoke テスト
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BracketViewMode,
  formatFinalsMatchCourtLabel,
  getFinalsMatchCardStateClass,
  resolveDefaultBracketViewMode,
} from "../../js/domain/finals-bracket-display.js";
import { FinalsMatchDisplayStatus } from "../../js/domain/finals-match-progress.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

const adminPage = readFileSync(join(root, "js/ui/pages/tournament-finals-bracket-page.js"), "utf8");
const publicPage = readFileSync(join(root, "js/ui/pages/tournament-public-page.js"), "utf8");
const matchPage = readFileSync(join(root, "js/ui/pages/tournament-finals-match-page.js"), "utf8");
const viewComponent = readFileSync(join(root, "js/ui/components/finals-bracket-view.js"), "utf8");
const bracketHtml = readFileSync(join(root, "tournament-finals-bracket.html"), "utf8");
const componentsCss = readFileSync(join(root, "css/components.css"), "utf8");

assert.equal(formatFinalsMatchCourtLabel(1), "コート1");
assert.equal(formatFinalsMatchCourtLabel(2), "コート2");

for (const source of [adminPage, publicPage, matchPage, viewComponent]) {
  assert.doesNotMatch(source, /第\$\{match\.matchNumber\}試合/);
  assert.doesNotMatch(source, /第\d+試合/);
}

assert.match(adminPage, /formatFinalsMatchCourtLabel|mountFinalsBracketView/);
assert.match(publicPage, /mountFinalsBracketView/);
assert.match(matchPage, /formatFinalsMatchCourtLabel/);
assert.match(viewComponent, /isLoser:/);
assert.doesNotMatch(
  adminPage,
  /renderAdminTeamLine:[\s\S]{0,400}teams\.winnerEntryId/
);

assert.match(viewComponent, /ラウンド表示/);
assert.match(viewComponent, /全体表/);
assert.match(viewComponent, /resolveDefaultBracketViewMode/);
assert.match(viewComponent, /前のラウンドへ/);
assert.match(viewComponent, /次のラウンドへ/);
assert.match(viewComponent, /finals-bracket-view__round-tab--active/);

assert.equal(resolveDefaultBracketViewMode(480), BracketViewMode.ROUND);
assert.equal(resolveDefaultBracketViewMode(1024), BracketViewMode.BOARD);

assert.equal(
  getFinalsMatchCardStateClass(FinalsMatchDisplayStatus.FINISHED),
  "finals-bracket__match--finished"
);
assert.equal(
  getFinalsMatchCardStateClass(FinalsMatchDisplayStatus.PLAYING),
  "finals-bracket__match--playing"
);
assert.equal(getFinalsMatchCardStateClass(FinalsMatchDisplayStatus.BYE), "finals-bracket__match--bye");

assert.match(componentsCss, /\.finals-bracket__match--finished/);
assert.match(componentsCss, /\.finals-bracket__match--playing/);
assert.match(componentsCss, /\.finals-bracket__match--bye/);
assert.match(componentsCss, /\.finals-bracket-view__toolbar--sticky/);

assert.match(bracketHtml, /finals-bracket-view-host/);
assert.match(publicPage, /data-public-finals-bracket-host/);

console.log("finals-bracket-display.smoke.mjs: all passed");
