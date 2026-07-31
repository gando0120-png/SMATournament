/**
 * 予選順位表モルックアウト UI smoke
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const page = readFileSync(join(root, "js/ui/pages/tournament-standings-page.js"), "utf8");
const componentsCss = readFileSync(join(root, "css/components.css"), "utf8");

assert.match(page, /applyMolkkyOutResolutions/);
assert.match(page, /upsertMolkkyOutResolution/);
assert.match(page, /モルックアウト対象/);
assert.match(page, /renderMolkkyOutOrderPanel/);
assert.match(componentsCss, /standings-badge--molkky-out/);
assert.match(componentsCss, /molkky-out-order__list/);

console.log("standings-molkky-out.smoke.mjs: all passed");
