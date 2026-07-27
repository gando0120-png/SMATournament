/**
 * 大会結果画面 seed 非表示 smoke テスト
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const pageSource = readFileSync(
  join(root, "js/ui/pages/tournament-results-page.js"),
  "utf8"
);

assert.match(pageSource, /shouldHideSeed/);
assert.match(pageSource, /usesLegacyFinalsAdvancement\(tournament\)/);
assert.match(pageSource, /hideSeed/);
assert.match(pageSource, /console\.error\("\[tournament-results\] loadPage failed", error\)/);
assert.doesNotMatch(
  pageSource,
  /champion\?\.seed != null \? ` \(seed \$\{champion\.seed\}\)` : ""/
);

console.log("tournament-results-seed-display.smoke.mjs: all passed");
