/**
 * 大会編集 v2 URL チェーン（HTML → entry → form）と旧モジュール混在防止
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

const editV2Html = readFileSync(join(root, "tournament-edit-v2.html"), "utf8");
const editLegacyHtml = readFileSync(join(root, "tournament-edit.html"), "utf8");
const editPageV2 = readFileSync(join(root, "js/ui/pages/tournament-edit-page-v2.js"), "utf8");
const dashboardJs = readFileSync(join(root, "js/ui/pages/tournament-dashboard-page.js"), "utf8");
const newPage = readFileSync(join(root, "js/ui/pages/tournament-new-page.js"), "utf8");

// HTML → entry
assert.match(editV2Html, /name=["']app-build["']\s+content=["']20260731d["']/);
assert.match(editV2Html, /src=["']js\/ui\/pages\/tournament-edit-page-v2\.js["']/);
assert.doesNotMatch(editV2Html, /tournament-edit-page\.js/);

// entry → form-v2（クエリなしでも可。旧 tournament-form.js は不可）
assert.match(editPageV2, /from\s*["']\.\.\/tournament-form-v2\.js(?:\?[^"']*)?["']/);
assert.doesNotMatch(editPageV2, /from\s*["']\.\.\/tournament-form\.js/);
assert.match(editPageV2, /\[tournament-edit\] build 20260731d/);

// dashboard リンク
assert.match(dashboardJs, /tournament-edit-v2\.html\?id=/);
assert.doesNotMatch(dashboardJs, /return `tournament-edit\.html\?id=/);

// 旧 HTML は新 URL へリダイレクト
assert.match(editLegacyHtml, /tournament-edit-v2\.html/);
assert.match(editLegacyHtml, /location\.replace/);
assert.doesNotMatch(editLegacyHtml, /tournament-edit-page\.js/);

// create も form-v2 を使う
assert.match(newPage, /from\s*["']\.\.\/tournament-form-v2\.js/);

// ページ JS が旧 tournament-form.js を直接 import していないこと（shim 自体は除外）
function walkJs(dir, acc = []) {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, name.name);
    if (name.isDirectory()) walkJs(full, acc);
    else if (extname(name.name) === ".js") acc.push(full);
  }
  return acc;
}

const pageFiles = walkJs(join(root, "js/ui/pages"));
for (const file of pageFiles) {
  const source = readFileSync(file, "utf8");
  const rel = file.slice(root.length + 1).replace(/\\/g, "/");
  // 旧 edit-page は残置するが、本番導線では使わない。import が旧 formなら警告対象
  if (rel.endsWith("tournament-edit-page-v2.js") || rel.endsWith("tournament-new-page.js")) {
    assert.doesNotMatch(
      source,
      /from\s*["'][^"']*\/tournament-form\.js["']/,
      `${rel} must not import legacy tournament-form.js`
    );
  }
}

console.log("tournament-edit-v2-urls.smoke.mjs: all passed");
