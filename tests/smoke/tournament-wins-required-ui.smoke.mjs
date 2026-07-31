/**
 * トーナメント勝利条件 UI が作成・編集画面に常時あること
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const newHtml = readFileSync(join(root, "tournament-new.html"), "utf8");
const editHtml = readFileSync(join(root, "tournament-edit.html"), "utf8");
const newPage = readFileSync(join(root, "js/ui/pages/tournament-new-page.js"), "utf8");

for (const html of [newHtml, editHtml]) {
  assert.match(html, /トーナメント勝利条件/);
  assert.match(html, /name="winsRequired"/);
  assert.match(html, /value="2"/);
  assert.match(html, /value="3"/);
  assert.match(html, /2セット先取/);
  assert.match(html, /3セット先取/);
  assert.match(html, /useRoundOverrides/);
  assert.match(html, /ラウンドごとに変更する/);
  assert.match(html, /決勝のみ3セット先取/);
  assert.match(html, /finalsMatchRulesSection/);
}

const dashboardHtml = readFileSync(join(root, "tournament-dashboard.html"), "utf8");
assert.match(dashboardHtml, /editTournamentBtn/);
assert.match(dashboardHtml, /大会設定を編集/);
assert.doesNotMatch(dashboardHtml, /id="editTournamentBtn"[^>]*href="#"/);

// 作成画面: 勝利条件は予選設定セクションの外（一発TNでも常に表示）
const winsIdx = newHtml.indexOf('name="winsRequired"');
const qualifyingIdx = newHtml.indexOf('id="qualifyingSettingsSection"');
assert.ok(winsIdx > 0, "winsRequired radios missing on create form");
assert.ok(qualifyingIdx > 0, "qualifyingSettingsSection missing");
assert.ok(
  winsIdx < qualifyingIdx,
  "winsRequired must stay outside qualifyingSettingsSection so single_elimination keeps it visible"
);

// 形式切替で隠すのは予選設定のみ
assert.match(newPage, /qualifyingSettingsSection\?\.classList\.toggle\("hidden"/);
assert.doesNotMatch(newPage, /winsRequired.*classList\.toggle\("hidden"/);

assert.match(editHtml, /winsRequiredLockNote/);

console.log("tournament-wins-required-ui.smoke.mjs: all passed");
