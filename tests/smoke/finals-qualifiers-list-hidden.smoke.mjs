/**
 * 決勝進出チーム一覧をブラケット画面から外した smoke
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TournamentStatus, EntryStatus } from "../../js/domain/constants.js";
import { buildPublicTournamentView } from "../../js/domain/public-tournament-view.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const bracketPage = readFileSync(
  join(root, "js/ui/pages/tournament-finals-bracket-page.js"),
  "utf8"
);
const bracketHtml = readFileSync(join(root, "tournament-finals-bracket.html"), "utf8");
const publicPage = readFileSync(join(root, "js/ui/pages/tournament-public-page.js"), "utf8");
const publicView = readFileSync(join(root, "js/domain/public-tournament-view.js"), "utf8");

assert.doesNotMatch(bracketHtml, /qualifiersPanel/);
assert.match(bracketPage, /function buildQualifiersTableHtml/);
assert.match(bracketPage, /bracketMetaEl\.textContent/);
assert.match(publicView, /visible:\s*showAdvancement\s*&&\s*!finalsBracket\?\.finalized/);
assert.match(publicPage, /showAdvancementList/);
assert.match(publicPage, /mainBracketReady/);
assert.match(publicPage, /!mainBracketReady/);

const viewWithoutBracket = buildPublicTournamentView({
  tournament: {
    id: "t1",
    status: TournamentStatus.OPEN,
    tournamentFormat: "qualifying_and_finals",
    blockCount: 2,
    qualifiersPerBlock: 1,
  },
  entries: [{ id: "e1", teamName: "A", status: EntryStatus.CONFIRMED }],
  finalsAdvancement: {
    finalized: true,
    mode: "fixed_block_qualifiers",
    qualifiers: [{ entryId: "e1", teamName: "A", blockId: "A", blockRank: 1 }],
  },
});
assert.equal(viewWithoutBracket.sections.advancement.visible, true);

const viewWithBracket = buildPublicTournamentView({
  tournament: {
    id: "t2",
    status: TournamentStatus.OPEN,
    tournamentFormat: "qualifying_and_finals",
    blockCount: 2,
    qualifiersPerBlock: 1,
  },
  entries: [{ id: "e1", teamName: "A", status: EntryStatus.CONFIRMED }],
  finalsAdvancement: {
    finalized: true,
    mode: "fixed_block_qualifiers",
    qualifiers: [{ entryId: "e1", teamName: "A", blockId: "A", blockRank: 1 }],
  },
  finalsBracket: {
    finalized: true,
    bracketSize: 2,
    matches: [{ matchId: "final-r1-m1", roundNumber: 1, matchNumber: 1 }],
    slots: [],
  },
});
assert.equal(viewWithBracket.sections.advancement.visible, false);
assert.equal(viewWithBracket.sections.bracket.ready, true);

console.log("finals-qualifiers-list-hidden.smoke.mjs: all passed");
