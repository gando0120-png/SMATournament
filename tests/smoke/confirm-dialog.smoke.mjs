/**
 * 確認ダイアログ — 長文耐性・背景スクロールロック smoke
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const dialogJs = readFileSync(join(root, "js/ui/components/confirm-dialog.js"), "utf8");
const componentsCss = readFileSync(join(root, "css/components.css"), "utf8");
const advancementPage = readFileSync(
  join(root, "js/ui/pages/tournament-finals-advancement-page.js"),
  "utf8"
);

assert.match(dialogJs, /lockBodyScroll/);
assert.match(dialogJs, /unlockBodyScroll/);
assert.match(dialogJs, /document\.body\.style\.position\s*=\s*"fixed"/);
assert.match(dialogJs, /document\.body\.style\.top\s*=\s*`-\$\{lockedScrollY\}px`/);
assert.match(dialogJs, /window\.scrollTo\(0,\s*lockedScrollY\)/);

assert.match(componentsCss, /\.confirm-overlay\s*\{[^}]*overflow-y\s*:\s*auto/s);
assert.match(componentsCss, /\.confirm-overlay\s*\{[^}]*safe-area-inset-top/s);
assert.match(componentsCss, /\.confirm-overlay\s*\{[^}]*safe-area-inset-bottom/s);
assert.match(componentsCss, /\.confirm-dialog\s*\{[^}]*max-height\s*:\s*calc\(/s);
assert.match(componentsCss, /\.confirm-dialog\s*\{[^}]*flex-direction\s*:\s*column/s);
assert.match(componentsCss, /\.confirm-dialog__message\s*\{[^}]*overflow-y\s*:\s*auto/s);
assert.match(componentsCss, /\.confirm-dialog__actions\s*\{[^}]*flex-shrink\s*:\s*0/s);

assert.match(advancementPage, /チームを決勝進出として確定します/);
assert.match(advancementPage, /確定後は決勝トーナメントを作成できます/);
assert.doesNotMatch(advancementPage, /formatFixedBlockAdvancementPreviewMessage/);
assert.doesNotMatch(
  advancementPage,
  /confirmMessage\s*=\s*`\$\{formatFixedBlockAdvancementPreviewMessage/
);

console.log("confirm-dialog.smoke.mjs: all passed");
