/**
 * 決勝ブラケット画面: seed 表示の smoke テスト（ソース検査）
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const pageSource = readFileSync(
  join(root, "js/ui/pages/tournament-finals-bracket-page.js"),
  "utf8"
);
const htmlSource = readFileSync(join(root, "tournament-finals-bracket.html"), "utf8");

assert.match(pageSource, /usesLegacyFinalsAdvancement\(tournament\)/);
assert.match(pageSource, /hideSeed = isSingleElim \|\| !usesLegacyFinalsAdvancement\(tournament\)/);
assert.match(pageSource, /決勝進出チーム/);
assert.match(htmlSource, /決勝進出チーム/);
assert.doesNotMatch(htmlSource, /進出チーム（seed 順）/);

console.log("tournament-finals-bracket-seed-display.smoke.mjs: all passed");
