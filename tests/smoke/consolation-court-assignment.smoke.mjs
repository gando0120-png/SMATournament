/**
 * 下位トーナメントコート番号 smoke
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assignConsolationCourtsToBracket,
  resolveConsolationCourtRange,
} from "../../js/domain/finals-court-assignment.js";
import { buildConsolationBracket } from "../../js/domain/consolation-bracket.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");

const consolationService = readFileSync(
  resolve(root, "js/services/consolation-bracket-service.js"),
  "utf8"
);
const publicView = readFileSync(resolve(root, "js/domain/public-tournament-view.js"), "utf8");
const bracketPage = readFileSync(
  resolve(root, "js/ui/pages/tournament-finals-bracket-page.js"),
  "utf8"
);
const matchPage = readFileSync(resolve(root, "js/ui/pages/tournament-finals-match-page.js"), "utf8");
const bracketView = readFileSync(resolve(root, "js/ui/components/finals-bracket-view.js"), "utf8");

assert.match(consolationService, /assignConsolationCourtsToBracket/);
assert.match(publicView, /ensureConsolationCourtNumbers/);
assert.match(bracketPage, /ensureConsolationCourtNumbers/);
assert.match(matchPage, /ensureConsolationCourtNumbers/);
assert.match(bracketView, /resolveMatchCourtNumber/);
assert.doesNotMatch(consolationService, /startCourt:\s*9/);

const mainBracket = {
  matches: Array.from({ length: 8 }, (_, i) => ({
    matchId: `final-r1-m${i + 1}`,
    roundNumber: 1,
    matchNumber: i + 1,
  })),
};
const range = resolveConsolationCourtRange({
  mainBracket,
  tournamentCourtCount: 16,
});
assert.equal(range.startCourt, 9);

const preview = buildConsolationBracket(
  Array.from({ length: 8 }, (_, i) => ({ entryId: `e${i}`, teamName: `T${i}` })),
  { random: () => 0.1 }
);
const assigned = assignConsolationCourtsToBracket(preview.bracket, {
  mainBracket,
  tournamentCourtCount: 16,
});
assert.ok(assigned.matches.every((m) => m.courtNumber >= 9));
assert.ok(assigned.matches.every((m) => m.courtNumber <= 16));

console.log("consolation-court-assignment.smoke.mjs: ok");
