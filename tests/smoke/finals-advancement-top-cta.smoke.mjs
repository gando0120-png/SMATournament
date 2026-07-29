/**
 * 決勝進出ページ上部CTA・スクロール余白 smoke
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const html = readFileSync(join(root, "tournament-finals-advancement.html"), "utf8");
const page = readFileSync(join(root, "js/ui/pages/tournament-finals-advancement-page.js"), "utf8");
const baseCss = readFileSync(join(root, "css/base.css"), "utf8");

assert.match(html, /id="finalizePanelTop"/);
assert.match(html, /id="finalizeAdvancementTopBtn"/);
assert.match(html, /id="bracketLinkPanelTop"/);
assert.match(html, /id="openFinalsBracketTopBtn"/);

assert.match(page, /finalizeAdvancementTopBtn/);
assert.match(page, /finalizePanelTopEl/);
assert.match(page, /setFinalizeButtonsDisabled/);
assert.match(page, /finalizeAdvancementTopBtn\?\.addEventListener\("click", handleFinalizeAdvancement\)/);

assert.match(baseCss, /100dvh/);
assert.match(baseCss, /safe-area-inset-bottom/);

console.log("finals-advancement-top-cta.smoke.mjs: all passed");
