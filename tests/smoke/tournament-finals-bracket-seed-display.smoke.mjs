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

// 進出チーム一覧は対戦表と重複するため通常非表示（描画処理を呼ばない）
assert.doesNotMatch(htmlSource, /id="qualifiersPanel"/);
assert.doesNotMatch(htmlSource, /id="qualifiersTable"/);
assert.doesNotMatch(htmlSource, /id="qualifiersBody"/);
assert.match(pageSource, /function buildQualifiersTableHtml\s*\(/);
const qualifierHelperRefs = [...pageSource.matchAll(/buildQualifiersTableHtml\s*\(/g)];
assert.equal(
  qualifierHelperRefs.length,
  1,
  "buildQualifiersTableHtml should remain unused except for its definition (future collapse)"
);

// 概要（チーム数 / 枠数）とブラケットは維持
assert.match(htmlSource, /id="bracketMeta"/);
assert.match(htmlSource, /id="bracketRounds"/);

console.log("tournament-finals-bracket-seed-display.smoke.mjs: all passed");
