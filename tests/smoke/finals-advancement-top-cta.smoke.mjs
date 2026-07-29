/**
 * 決勝進出ページ上部CTA・ドキュメントスクロール smoke
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const html = readFileSync(join(root, "tournament-finals-advancement.html"), "utf8");
const page = readFileSync(join(root, "js/ui/pages/tournament-finals-advancement-page.js"), "utf8");
const baseCss = readFileSync(join(root, "css/base.css"), "utf8");
const componentsCss = readFileSync(join(root, "css/components.css"), "utf8");

assert.match(html, /id="finalizePanelTop"/);
assert.match(html, /id="finalizeAdvancementTopBtn"/);
assert.match(html, /id="bracketLinkPanelTop"/);
assert.match(html, /id="openFinalsBracketTopBtn"/);
assert.match(html, /id="finalizePanel"/);
assert.match(html, /id="finalizeAdvancementBtn"/);

assert.match(page, /finalizeAdvancementTopBtn/);
assert.match(page, /finalizePanelTopEl/);
assert.match(page, /setFinalizeButtonsDisabled/);
assert.match(page, /finalizeAdvancementTopBtn\?\.addEventListener\("click", handleFinalizeAdvancement\)/);

// 下部余白は維持
assert.match(baseCss, /100dvh/);
assert.match(baseCss, /safe-area-inset-bottom/);

// Android スクロール破壊の原因だった html/body overflow は禁止
assert.doesNotMatch(baseCss, /html\s*\{[^}]*overflow-x\s*:\s*clip/s);
assert.doesNotMatch(baseCss, /body\s*\{[^}]*overflow-x\s*:\s*clip/s);
assert.doesNotMatch(baseCss, /body\s*\{[^}]*overflow-y\s*:\s*auto/s);
assert.doesNotMatch(baseCss, /body\s*\{[^}]*-webkit-overflow-scrolling\s*:\s*touch/s);

// 個別コンテナに新しい縦スクロールを作らない
assert.doesNotMatch(baseCss, /\.app-shell\s*\{[^}]*overflow\s*:/s);
assert.doesNotMatch(baseCss, /\.app-main\s*\{[^}]*overflow\s*:/s);

// 表の横スクロールは維持
assert.match(componentsCss, /\.standings-table-wrap\s*\{[^}]*overflow-x\s*:\s*auto/s);
assert.match(componentsCss, /\.standings-table-wrap\s*\{[^}]*-webkit-overflow-scrolling\s*:\s*touch/s);

console.log("finals-advancement-top-cta.smoke.mjs: all passed");
