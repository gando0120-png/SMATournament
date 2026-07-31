/**
 * 下位トーナメント結果表示 smoke
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { BracketKind } from "../../js/domain/bracket-collections.js";
import {
  formatBracketPlacementLabel,
  groupPlacementsByLabel,
} from "../../js/domain/tournament-results.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const resultsHtml = readFileSync(join(root, "tournament-results.html"), "utf8");
const resultsPage = readFileSync(join(root, "js/ui/pages/tournament-results-page.js"), "utf8");
const publicPage = readFileSync(join(root, "js/ui/pages/tournament-public-page.js"), "utf8");
const publicView = readFileSync(join(root, "js/domain/public-tournament-view.js"), "utf8");
const resultsDomain = readFileSync(join(root, "js/domain/tournament-results.js"), "utf8");

assert.match(resultsHtml, /id="consolationResultsPanel"/);
assert.match(resultsHtml, /下位トーナメント/);
assert.match(resultsHtml, /上位トーナメント/);
assert.match(resultsPage, /buildConsolationPlacements/);
assert.match(resultsPage, /renderConsolationResultsSection/);
assert.match(resultsPage, /consolationPlacements/);
assert.match(publicPage, /renderConsolationResultsBlock/);
assert.match(publicPage, /下位トーナメント優勝/);
assert.match(publicView, /buildConsolationResultsSection/);
assert.match(resultsDomain, /buildBracketPlacements/);
assert.match(resultsDomain, /formatBracketPlacementLabel/);

assert.equal(
  formatBracketPlacementLabel("ベスト8", { bracketKind: BracketKind.CONSOLATION }),
  "下位トーナメントベスト8"
);

const groups = groupPlacementsByLabel(
  [
    { entryId: "a", placementLabel: "下位トーナメント優勝" },
    { entryId: "b", placementLabel: "下位トーナメントベスト4" },
    { entryId: "a", placementLabel: "下位トーナメント優勝" },
  ],
  { bracketKind: BracketKind.CONSOLATION }
);
assert.equal(groups[0].items.length, 1);

console.log("consolation-results-display.smoke.mjs: ok");
