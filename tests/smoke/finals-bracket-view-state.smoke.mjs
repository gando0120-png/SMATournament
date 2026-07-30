/**
 * 運営トーナメント表示状態維持 smoke
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { BracketViewMode, resolveDefaultBracketViewMode } from "../../js/domain/finals-bracket-display.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const bracketPage = readFileSync(join(root, "js/ui/pages/tournament-finals-bracket-page.js"), "utf8");
const matchPage = readFileSync(join(root, "js/ui/pages/tournament-finals-match-page.js"), "utf8");
const viewComponent = readFileSync(join(root, "js/ui/components/finals-bracket-view.js"), "utf8");
const publicPage = readFileSync(join(root, "js/ui/pages/tournament-public-page.js"), "utf8");

assert.equal(resolveDefaultBracketViewMode(1024, { surface: "admin" }), BracketViewMode.ROUND);
assert.equal(resolveDefaultBracketViewMode(1024), BracketViewMode.BOARD);

assert.match(bracketPage, /resolveAdminBracketViewState/);
assert.match(bracketPage, /persistBracketViewState/);
assert.match(bracketPage, /destroyBracketViewController/);
assert.match(bracketPage, /initialViewMode/);
assert.match(matchPage, /readBracketViewStateFromSearch/);
assert.match(matchPage, /goBackToBracket/);
assert.match(viewComponent, /onViewStateChange/);
assert.match(viewComponent, /surface === "admin"/);
assert.doesNotMatch(publicPage, /resolveAdminBracketViewState/);
assert.doesNotMatch(publicPage, /initialViewMode/);

console.log("finals-bracket-view-state.smoke.mjs: ok");
