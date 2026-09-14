/**
 * スマホ結果入力 chrome / sticky summary
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyVisualViewportHeight,
  buildH2HScoreSummary,
  buildOwnSideScoreSummary,
  formatScoreDisplay,
  parseScoreInputField,
  scrollScoreInputIntoView,
} from "../../js/ui/components/score-input-dialog-chrome.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const qualifyingDialog = readFileSync(
  join(root, "js/ui/components/match-result-dialog.js"),
  "utf8"
);
const finalsDialog = readFileSync(
  join(root, "js/ui/components/finals-match-result-dialog.js"),
  "utf8"
);
const chromeSrc = readFileSync(
  join(root, "js/ui/components/score-input-dialog-chrome.js"),
  "utf8"
);
const componentsCss = readFileSync(join(root, "css/components.css"), "utf8");
const preview = readFileSync(join(root, "tools/score-input-mobile-preview.html"), "utf8");

assert.equal(formatScoreDisplay(""), "—");
assert.equal(formatScoreDisplay("42"), "42");
assert.deepEqual(parseScoreInputField("set2Team1Score"), {
  kind: "h2h",
  setNumber: 2,
  side: "team1",
});
assert.deepEqual(parseScoreInputField("set5Team2Score"), {
  kind: "h2h",
  setNumber: 5,
  side: "team2",
});
assert.deepEqual(parseScoreInputField("set1OwnScore"), {
  kind: "own",
  setNumber: 1,
  side: "own",
});
assert.equal(parseScoreInputField("venue"), null);

const q1 = buildH2HScoreSummary({
  setNumber: 1,
  team1Name: "SMA",
  team2Name: "チームB",
  team1Score: "42",
  team2Score: "",
});
assert.equal(q1.setLabel, "第1セット");
assert.equal(q1.line, "SMA 42 - — チームB");

const q2 = buildH2HScoreSummary({
  setNumber: 2,
  team1Name: "SMA",
  team2Name: "チームB",
  team1Score: "42",
  team2Score: "37",
});
assert.equal(q2.setLabel, "第2セット");
assert.equal(q2.line, "SMA 42 - 37 チームB");

const finals3 = buildH2HScoreSummary({
  setNumber: 3,
  team1Name: "A",
  team2Name: "B",
  team1Score: "50",
  team2Score: "40",
});
assert.equal(finals3.setLabel, "第3セット");

const finals5 = buildH2HScoreSummary({
  setNumber: 5,
  team1Name: "A",
  team2Name: "B",
  team1Score: "11",
  team2Score: "22",
});
assert.equal(finals5.setLabel, "第5セット");
assert.equal(finals5.line, "A 11 - 22 B");

const own = buildOwnSideScoreSummary({
  setNumber: 2,
  teamName: "SMA",
  opponentName: "チームB",
  ownScore: "42",
});
assert.equal(own.setLabel, "第2セット（自チーム）");
assert.match(own.line, /SMA 42/);
assert.match(own.line, /対戦: チームB/);

assert.equal(typeof applyVisualViewportHeight(null), "function");
assert.doesNotThrow(() => applyVisualViewportHeight(null)());
assert.doesNotThrow(() => scrollScoreInputIntoView(null, null));

for (const source of [qualifyingDialog, finalsDialog]) {
  assert.match(source, /attachScoreInputDialogChrome/);
  assert.match(source, /match-result-dialog__body/);
  assert.match(source, /data-action="submit"/);
  assert.doesNotMatch(source, /通常終了/);
  assert.doesNotMatch(source, /時間切れ/);
}

assert.match(qualifyingDialog, /aria-label="第1セット チーム1"/);
assert.match(qualifyingDialog, /aria-label="第2セット チーム2"/);
assert.match(qualifyingDialog, /第1セット（自チーム）/);
assert.match(qualifyingDialog, /buildOwnSideScoreSummary/);
assert.match(finalsDialog, /data-set-row/);
assert.match(finalsDialog, /resolveFinalsMaxSets/);
assert.match(finalsDialog, /buildH2HScoreSummary/);

assert.match(chromeSrc, /visualViewport/);
assert.match(chromeSrc, /score-input-summary/);
assert.match(chromeSrc, /aria-live/);
assert.match(chromeSrc, /scrollIntoView/);

assert.match(componentsCss, /--visual-viewport-height/);
assert.match(componentsCss, /\.match-result-dialog__summary/);
assert.match(componentsCss, /@media \(max-width: 639px\)/);
assert.match(
  componentsCss,
  /@media \(min-width: 640px\)\s*\{[^}]*\.match-result-dialog__summary\s*\{[^}]*display\s*:\s*none/s
);
assert.match(qualifyingDialog, /inputmode="numeric"/);
assert.match(finalsDialog, /inputmode="numeric"/);

assert.match(preview, /予選運営/);
assert.match(preview, /参加者/);
assert.match(preview, /決勝2先/);
assert.match(preview, /決勝3先/);
assert.match(preview, /width="390"/);
assert.doesNotMatch(preview, /firebase-config/);

console.log("score-input-dialog-chrome.smoke.mjs: all passed");
