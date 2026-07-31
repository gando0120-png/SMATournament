/**
 * 結果入力ダイアログ — 表形式スコアボード smoke
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const finalsDialog = readFileSync(
  join(root, "js/ui/components/finals-match-result-dialog.js"),
  "utf8"
);
const qualifyingDialog = readFileSync(
  join(root, "js/ui/components/match-result-dialog.js"),
  "utf8"
);
const multiDialog = readFileSync(
  join(root, "js/ui/components/multi-team-match-result-dialog.js"),
  "utf8"
);
const componentsCss = readFileSync(join(root, "css/components.css"), "utf8");

for (const source of [finalsDialog, qualifyingDialog]) {
  assert.match(source, /match-result-dialog__scoreboard/);
  assert.match(source, /match-result-dialog--h2h/);
  assert.match(source, /data-team="1"/);
  assert.match(source, /data-team="2"/);
  assert.match(source, /data-side="left"/);
  assert.match(source, /data-side="right"/);
  assert.match(source, /result-team-column--left/);
  assert.match(source, /result-team-column--right/);
  assert.match(source, /result-score-input--left/);
  assert.match(source, /result-score-input--right/);
  assert.doesNotMatch(source, />チーム1</);
  assert.doesNotMatch(source, />チーム2</);
  assert.doesNotMatch(source, /match-result-dialog__scoreboard-col/);
  assert.doesNotMatch(source, /チーム1 得点/);
  assert.doesNotMatch(source, /match-result-dialog__sets/);
}

assert.doesNotMatch(multiDialog, /result-team-column--left/);
assert.doesNotMatch(multiDialog, /result-score-input--left/);
assert.doesNotMatch(multiDialog, /match-result-dialog--h2h/);
assert.match(multiDialog, /multi-team-result-dialog/);

assert.match(qualifyingDialog, /name="set1Team1Score"/);
assert.match(qualifyingDialog, /name="set1Team2Score"/);
assert.match(qualifyingDialog, /name="set2Team1Score"/);
assert.match(qualifyingDialog, /name="set2Team2Score"/);
assert.match(qualifyingDialog, /第1セット/);
assert.match(qualifyingDialog, /第2セット/);

assert.match(finalsDialog, /winsRequired/);
assert.match(finalsDialog, /resolveFinalsMaxSets/);
assert.match(finalsDialog, /resolveVisibleFinalsSetCount/);
assert.match(finalsDialog, /getFinalsSetScoreFieldNames/);
assert.match(finalsDialog, /data-set-row/);
assert.match(finalsDialog, /結果を確定/);
assert.match(finalsDialog, /セット先取/);

const qualifyingInputOrder = [
  ...qualifyingDialog.matchAll(/name="(set[12]Team[12]Score)"/g),
].map((match) => match[1]);
assert.deepEqual(qualifyingInputOrder, [
  "set1Team1Score",
  "set1Team2Score",
  "set2Team1Score",
  "set2Team2Score",
]);

assert.match(componentsCss, /\.match-result-dialog__scoreboard\s*\{[^}]*display\s*:\s*grid/s);
assert.match(componentsCss, /\.match-result-dialog__score-input\s*\{[^}]*width\s*:\s*5\.625rem/s);
assert.match(componentsCss, /\.match-result-dialog__set-row\s*\{[^}]*display\s*:\s*contents/s);
assert.match(componentsCss, /\.match-result-dialog--h2h/);
assert.match(componentsCss, /result-score-input--left/);
assert.match(componentsCss, /result-score-input--right/);
assert.match(componentsCss, /--h2h-side-left-accent/);
assert.match(componentsCss, /--h2h-side-right-accent/);
assert.match(componentsCss, /aria-invalid/);
assert.doesNotMatch(componentsCss, /\.match-result-dialog__sets\s*\{/);
assert.doesNotMatch(componentsCss, /\.match-result-dialog__fields\s*\{/);

console.log("match-result-dialog.smoke.mjs: all passed");
