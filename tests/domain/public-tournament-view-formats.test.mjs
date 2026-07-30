/**
 * 公開 ViewModel 形式別テスト
 */
import assert from "node:assert/strict";
import { TournamentStatus, EntryStatus } from "../../js/domain/constants.js";
import { PublicTournamentFormat } from "../../js/domain/tournament-format.js";
import {
  buildPublicTournamentView,
} from "../../js/domain/public-tournament-view.js";
import {
  buildPublicTournamentSnapshot,
  buildPublicTournamentViewFromSnapshot,
  findForbiddenSnapshotFields,
  PUBLIC_SNAPSHOT_SCHEMA_VERSION,
} from "../../js/domain/public-tournament-snapshot.js";
import {
  buildSingleEliminationBracket,
  buildPersistedSingleEliminationBracket,
} from "../../js/domain/single-elimination-bracket.js";
import { getFixedBlockLabel } from "../../js/domain/fixed-block-draw.js";
import { isBlockDrawDraft } from "../../js/domain/block-draw-state.js";

function makeEntry(id, teamName) {
  return {
    id,
    teamName,
    status: EntryStatus.CONFIRMED,
    representativeName: "代表",
    email: "secret@example.com",
  };
}

function makeLegacyAdvancement() {
  return {
    finalized: true,
    qualifiers: [
      {
        entryId: "e1",
        teamName: "A",
        seed: 1,
        source: "block_winner",
        blockName: "A",
      },
      {
        entryId: "e2",
        teamName: "B",
        seed: 2,
        source: "wildcard",
        blockName: "B",
      },
    ],
    wildcardCount: 1,
  };
}

const legacyView = buildPublicTournamentView({
  tournament: {
    id: "legacy-1",
    name: "旧形式",
    status: TournamentStatus.OPEN,
    preferredBlockSize: 4,
  },
  entries: [makeEntry("e1", "Team A"), makeEntry("e2", "Team B")],
  blockDraw: {
    blocks: [{ id: "A", name: "A", entryIds: ["e1", "e2"] }],
  },
  finalsAdvancement: makeLegacyAdvancement(),
});

assert.equal(legacyView.tournament.tournamentFormat, PublicTournamentFormat.LEGACY);
assert.equal(legacyView.sections.qualifying.visible, true);
assert.equal(legacyView.sections.advancement.visible, true);
assert.equal(legacyView.sections.advancement.usesWildcards, true);
assert.equal(legacyView.sections.bracket.showSeed, true);

const newFormatView = buildPublicTournamentView({
  tournament: {
    id: "new-1",
    name: "新形式",
    status: TournamentStatus.OPEN,
    tournamentFormat: "qualifying_and_finals",
    blockCount: 4,
    qualifiersPerBlock: 2,
  },
  entries: [makeEntry("e1", "Team A")],
  blockDraw: {
    status: "finalized",
    blocks: [
      { id: "B", name: "Bブロック", entryIds: ["e1"] },
      { id: "A", name: "Aブロック", entryIds: [] },
    ],
  },
  finalsAdvancement: {
    finalized: true,
    mode: "fixed_block_qualifiers",
    qualifiers: [
      { entryId: "e1", blockId: "A", blockRank: 1 },
      { entryId: "e2", blockId: "B", blockRank: 2 },
    ],
  },
});

assert.equal(newFormatView.tournament.tournamentFormat, PublicTournamentFormat.QUALIFYING_AND_FINALS);
assert.equal(newFormatView.sections.advancement.usesWildcards, false);
assert.equal(newFormatView.sections.advancement.visible, true);
assert.equal(newFormatView.sections.bracket.showSeed, false);
assert.deepEqual(
  newFormatView.sections.qualifying.blocks.blocks.map((block) => block.blockId),
  ["A", "B"]
);

// ブラケット作成後は進出一覧を非表示（対戦表と重複）
const newFormatWithBracket = buildPublicTournamentView({
  tournament: {
    id: "new-bracket",
    name: "新形式ブラケットあり",
    status: TournamentStatus.OPEN,
    tournamentFormat: "qualifying_and_finals",
    blockCount: 4,
    qualifiersPerBlock: 2,
  },
  entries: [makeEntry("e1", "Team A"), makeEntry("e2", "Team B")],
  finalsAdvancement: {
    finalized: true,
    mode: "fixed_block_qualifiers",
    qualifiers: [
      { entryId: "e1", teamName: "Team A", blockId: "A", blockRank: 1 },
      { entryId: "e2", teamName: "Team B", blockId: "B", blockRank: 1 },
    ],
  },
  finalsBracket: {
    finalized: true,
    bracketSize: 2,
    qualifierCount: 2,
    teamCount: 2,
    matches: [{ matchId: "final-r1-m1", roundNumber: 1, matchNumber: 1 }],
    slots: [
      { slotNumber: 1, entryId: "e1", teamName: "Team A", isBye: false },
      { slotNumber: 2, entryId: "e2", teamName: "Team B", isBye: false },
    ],
  },
});
assert.equal(newFormatWithBracket.sections.advancement.visible, false);
assert.equal(newFormatWithBracket.sections.bracket.ready, true);

const draftDraw = { status: "draft", blocks: [{ id: "A", entryIds: ["e1"] }] };
assert.equal(isBlockDrawDraft(draftDraw), true);
const draftView = buildPublicTournamentView({
  tournament: { id: "draft", status: TournamentStatus.OPEN, tournamentFormat: "qualifying_and_finals" },
  entries: [makeEntry("e1", "Team A")],
  blockDraw: draftDraw,
});
assert.equal(draftView.sections.qualifying.blocks.ready, false);

const entries3 = [makeEntry("e1", "T1"), makeEntry("e2", "T2"), makeEntry("e3", "T3")];
const bracket3 = buildPersistedSingleEliminationBracket(
  buildSingleEliminationBracket({
    entries: entries3.map((entry) => ({ entryId: entry.id, teamName: entry.teamName })),
    random: () => 0.2,
  })
);

const singleElimView = buildPublicTournamentView({
  tournament: {
    id: "se-1",
    name: "一発TN",
    status: TournamentStatus.OPEN,
    tournamentFormat: "single_elimination",
  },
  entries: entries3,
  finalsBracket: bracket3,
});

assert.equal(singleElimView.tournament.tournamentFormat, PublicTournamentFormat.SINGLE_ELIMINATION);
assert.equal(singleElimView.sections.qualifying.visible, false);
assert.equal(singleElimView.sections.advancement.visible, false);
assert.equal(singleElimView.sections.bracket.visible, true);
assert.equal(singleElimView.sections.bracket.title, "一発トーナメント");
assert.equal(singleElimView.sections.bracket.showSeed, false);
assert.equal(singleElimView.tournament.byeCount, 1);
assert.equal(
  singleElimView.tournament.progressStatusLabel,
  "トーナメント進行中"
);

const entries2 = [makeEntry("e1", "T1"), makeEntry("e2", "T2")];
const bracket2 = buildPersistedSingleEliminationBracket(
  buildSingleEliminationBracket({
    entries: entries2.map((entry) => ({ entryId: entry.id, teamName: entry.teamName })),
    random: () => 0.5,
  })
);
assert.equal(bracket2.matches.length, 1);

const closedSingleElim = buildPublicTournamentView({
  tournament: {
    id: "se-closed",
    status: TournamentStatus.CLOSED,
    tournamentFormat: "single_elimination",
  },
  entries: entries2,
  finalsBracket: bracket2,
  tournamentResults: {
    finalized: true,
    champion: { entryId: "e1", teamName: "T1" },
    runnerUp: { entryId: "e2", teamName: "T2" },
    placements: [
      { entryId: "e1", teamName: "T1", placementLabel: "優勝" },
      { entryId: "e2", teamName: "T2", placementLabel: "準優勝" },
    ],
  },
});
assert.equal(closedSingleElim.sections.results.ready, true);
assert.equal(closedSingleElim.sections.results.placementGroups.length, 2);
assert.equal(
  closedSingleElim.sections.results.placementGroups.some((group) => group.label === "ベスト4"),
  false
);

const entries40 = Array.from({ length: 40 }, (_, index) =>
  makeEntry(`e-${index + 1}`, `Team ${index + 1}`)
);
const bracket40 = buildPersistedSingleEliminationBracket(
  buildSingleEliminationBracket({
    entries: entries40.map((entry) => ({ entryId: entry.id, teamName: entry.teamName })),
    random: () => 0.1,
  })
);
assert.equal(bracket40.bracketSize, 64);
const view40 = buildPublicTournamentView({
  tournament: {
    id: "se-40",
    status: TournamentStatus.OPEN,
    tournamentFormat: "single_elimination",
  },
  entries: entries40,
  finalsBracket: bracket40,
});
assert.equal(view40.sections.bracket.rounds.length, 6);

const blocks32 = Array.from({ length: 32 }, (_, index) => ({
  id: getFixedBlockLabel(index),
  name: `${getFixedBlockLabel(index)}ブロック`,
  entryIds: [],
}));
blocks32.reverse();
const view32 = buildPublicTournamentView({
  tournament: {
    id: "blocks-32",
    status: TournamentStatus.OPEN,
    tournamentFormat: "qualifying_and_finals",
    blockCount: 32,
    qualifiersPerBlock: 1,
  },
  entries: [],
  blockDraw: { status: "finalized", blocks: blocks32 },
});
assert.deepEqual(
  view32.sections.qualifying.blocks.blocks.slice(0, 3).map((block) => block.blockId),
  ["A", "B", "C"]
);
assert.deepEqual(
  view32.sections.qualifying.blocks.blocks.slice(-2).map((block) => block.blockId),
  ["AE", "AF"]
);

const snapshot = buildPublicTournamentSnapshot({
  tournament: {
    id: "snap-1",
    name: "Snapshot",
    status: TournamentStatus.OPEN,
    tournamentFormat: "single_elimination",
    teamSize: 3,
    publicViewEnabled: true,
    createdBy: "operator",
  },
  entries: entries3,
  finalsBracket: bracket3,
});
assert.equal(snapshot.schemaVersion, PUBLIC_SNAPSHOT_SCHEMA_VERSION);
assert.equal(snapshot.tournament.tournamentFormat, "single_elimination");
assert.equal(snapshot.qualifying.visible, false);
assert.equal(snapshot.advancement.visible, false);
assert.equal(findForbiddenSnapshotFields(snapshot).length, 0);

const roundTrip = buildPublicTournamentViewFromSnapshot(snapshot);
assert.equal(roundTrip.sections.bracket.ready, true);
assert.equal(roundTrip.sections.bracket.showSeed, false);

console.log("public-tournament-view-formats.test.mjs: all passed");
