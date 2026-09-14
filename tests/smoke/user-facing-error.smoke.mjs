/**
 * 利用者向けエラー表示の配線 / レイアウト制約 smoke
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

function read(rel) {
  return readFileSync(join(root, rel), "utf8");
}

const qualifyingDialog = read("js/ui/components/match-result-dialog.js");
const finalsDialog = read("js/ui/components/finals-match-result-dialog.js");
const multiDialog = read("js/ui/components/multi-team-match-result-dialog.js");
const playerPage = read("js/ui/pages/player-results-page.js");
const componentsCss = read("css/components.css");
const helper = read("js/lib/user-facing-error.js");

assert.match(helper, /export function getUserFacingError/);
assert.match(helper, /console\.error/);
assert.match(helper, /functions\/internal/);

for (const source of [qualifyingDialog, finalsDialog, multiDialog]) {
  assert.match(source, /showDialogUserFacingError/);
  assert.match(source, /UserFacingErrorContext/);
  assert.doesNotMatch(source, /error\.message \|\|/);
  assert.doesNotMatch(source, /error\?\.message \|\|/);
}

assert.match(playerPage, /getUserFacingError/);
assert.match(playerPage, /UserFacingErrorContext\.RESULT_LOAD/);
assert.doesNotMatch(playerPage, /classifyError/);

assert.match(componentsCss, /\.match-result-dialog__error[\s\S]*overflow-wrap\s*:\s*anywhere/);
assert.match(componentsCss, /\.match-result-dialog__error[\s\S]*word-break\s*:\s*break-word/);
assert.match(componentsCss, /\.match-result-dialog__error[\s\S]*max-height\s*:\s*4\.5em/);
assert.match(componentsCss, /\.user-facing-error[\s\S]*overflow-wrap\s*:\s*anywhere/);
assert.match(componentsCss, /\.alert[\s\S]*overflow-wrap\s*:\s*anywhere/);
assert.match(componentsCss, /\.toast[\s\S]*overflow-wrap\s*:\s*anywhere/);
assert.match(componentsCss, /\.match-result-dialog \.confirm-dialog__actions[\s\S]*position\s*:\s*sticky/);
assert.match(componentsCss, /\.match-result-dialog__summary:not\(\[hidden\]\)[\s\S]*position\s*:\s*sticky/);

const preview = read("tools/user-facing-error-preview.html");
assert.match(preview, /validation|permission|network|internal/);
assert.match(preview, /決勝同点|同点のセットは入力できません/);
assert.match(preview, /Hosting には載せない/);

console.log("user-facing-error.smoke.mjs: all passed");
