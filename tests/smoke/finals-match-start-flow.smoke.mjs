/**
 * 決勝試合開始フロー smoke テスト
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

const bracketPage = readFileSync(join(root, "js/ui/pages/tournament-finals-bracket-page.js"), "utf8");
const matchPage = readFileSync(join(root, "js/ui/pages/tournament-finals-match-page.js"), "utf8");
const progressDomain = readFileSync(join(root, "js/domain/finals-match-progress.js"), "utf8");

assert.match(bracketPage, /getFinalsBracketMatchAction/);
assert.match(bracketPage, /data-finals-start-match/);
assert.match(bracketPage, /startFinalsMatchSession/);
assert.match(bracketPage, /pendingStartMatchIds/);
assert.match(bracketPage, /enterResult:\s*true/);
assert.match(progressDomain, /label:\s*"試合開始"/);
assert.match(progressDomain, /label:\s*"結果を見る"/);
assert.doesNotMatch(bracketPage, /試合を続ける/);

assert.match(matchPage, /shouldOpenFinalsMatchScoreEntryOnLoad/);
assert.match(matchPage, /enterResult/);
assert.match(matchPage, /openResultDialog\(false\)/);
assert.match(matchPage, /clearEnterResultQueryParam/);
assert.match(matchPage, /resolveMatchPageBracketKind/);
assert.match(matchPage, /getBracketServiceOptions/);
assert.match(matchPage, /startFinalsMatchSession\(tournamentId, matchId, getBracketServiceOptions\(\)\)/);
assert.match(matchPage, /buildBracketPageHref\(id, bracketKind, bracketDisplayState\)/);

assert.match(progressDomain, /getFinalsBracketMatchAction/);
assert.match(progressDomain, /shouldOpenFinalsMatchScoreEntryOnLoad/);

console.log("finals-match-start-flow.smoke.mjs: all passed");
