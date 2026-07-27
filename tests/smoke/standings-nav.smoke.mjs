/**
 * 予選順位表 上部ナビ smoke test
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const standingsHtml = readFileSync(resolve(__dirname, "../../tournament-standings.html"), "utf8");
const standingsCss = readFileSync(
  resolve(__dirname, "../../css/pages/tournament-standings.css"),
  "utf8"
);

assert.match(standingsHtml, /preliminary-ranking-actions/);
assert.match(standingsHtml, /tournament-standings\.css\?v=2/);
assert.doesNotMatch(standingsHtml, /standings-header-actions/);
assert.match(standingsCss, /\.preliminary-ranking-actions/);
assert.match(standingsCss, /flex-direction:\s*column/);
assert.match(standingsCss, /white-space:\s*nowrap/);
assert.match(standingsCss, /word-break:\s*keep-all/);
assert.doesNotMatch(standingsCss, /grid-template-columns:\s*repeat\(3/);

console.log("standings-nav.smoke: all tests passed");
