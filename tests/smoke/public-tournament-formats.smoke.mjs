/**
 * 公開 snapshot 形式別 smoke テスト
 */
import assert from "node:assert/strict";
import {
  buildPublicTournamentSnapshot,
  buildPublicTournamentViewFromSnapshot,
  findForbiddenSnapshotFields,
} from "../../js/domain/public-tournament-snapshot.js";
import { TournamentStatus, EntryStatus } from "../../js/domain/constants.js";
import {
  buildSingleEliminationBracket,
  buildPersistedSingleEliminationBracket,
} from "../../js/domain/single-elimination-bracket.js";
import { buildFinalsBracket, buildPersistedFinalsBracket } from "../../js/domain/finals-bracket.js";

function makeEntry(id, teamName) {
  return {
    id,
    teamName,
    status: EntryStatus.CONFIRMED,
    representativeName: "代表",
    email: "secret@example.com",
    comment: "内部",
  };
}

function makeTournament(overrides = {}) {
  return {
    id: "t-1",
    name: "テスト大会",
    status: TournamentStatus.OPEN,
    maxTeams: 64,
    teamSize: 3,
    courtCount: 2,
    publicViewEnabled: true,
    createdBy: "operator",
    ...overrides,
  };
}

const legacySnapshot = buildPublicTournamentSnapshot({
  tournament: makeTournament({ preferredBlockSize: 4 }),
  entries: [makeEntry("e1", "A"), makeEntry("e2", "B")],
  blockDraw: { blocks: [{ id: "A", entryIds: ["e1", "e2"] }] },
  finalsAdvancement: {
    finalized: true,
    qualifiers: [
      { entryId: "e1", teamName: "A", seed: 1, source: "block_winner" },
    ],
    wildcardCount: 0,
  },
});
assert.equal(legacySnapshot.tournament.tournamentFormat, "legacy");
assert.equal(legacySnapshot.qualifying.visible, true);
assert.equal(findForbiddenSnapshotFields(legacySnapshot).length, 0);

const newFormatSnapshot = buildPublicTournamentSnapshot({
  tournament: makeTournament({
    tournamentFormat: "qualifying_and_finals",
    blockCount: 4,
    qualifiersPerBlock: 2,
  }),
  entries: [makeEntry("e1", "A")],
  blockDraw: {
    status: "finalized",
    blocks: [{ id: "A", entryIds: ["e1"] }],
  },
  finalsAdvancement: {
    finalized: true,
    mode: "fixed_block_qualifiers",
    qualifiers: [{ entryId: "e1", blockId: "A", blockRank: 1 }],
  },
});
assert.equal(newFormatSnapshot.advancement.usesWildcards, false);
assert.equal(newFormatSnapshot.bracket.showSeed, false);

const entries3 = [makeEntry("e1", "T1"), makeEntry("e2", "T2"), makeEntry("e3", "T3")];
const bracket3 = buildPersistedSingleEliminationBracket(
  buildSingleEliminationBracket({
    entries: entries3.map((entry) => ({ entryId: entry.id, teamName: entry.teamName })),
    random: () => 0.3,
  })
);

const singleElimSnapshot = buildPublicTournamentSnapshot({
  tournament: makeTournament({ tournamentFormat: "single_elimination" }),
  entries: entries3,
  finalsBracket: bracket3,
});
assert.equal(singleElimSnapshot.qualifying.visible, false);
assert.equal(singleElimSnapshot.advancement.visible, false);
assert.equal(singleElimSnapshot.bracket.title, "一発トーナメント");
assert.equal(singleElimSnapshot.tournament.byeCount, 1);

const view3 = buildPublicTournamentViewFromSnapshot(singleElimSnapshot);
const byeMatch = view3.sections.bracket.rounds[0]?.matches.find(
  (match) => match.team1?.type === "bye" || match.team2?.type === "bye"
);
assert.ok(byeMatch);

const entries2 = [makeEntry("e1", "T1"), makeEntry("e2", "T2")];
const bracket2 = buildPersistedSingleEliminationBracket(
  buildSingleEliminationBracket({
    entries: entries2.map((entry) => ({ entryId: entry.id, teamName: entry.teamName })),
    random: () => 0.5,
  })
);
const closedSnapshot = buildPublicTournamentSnapshot({
  tournament: makeTournament({
    tournamentFormat: "single_elimination",
    status: TournamentStatus.CLOSED,
  }),
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
const closedView = buildPublicTournamentViewFromSnapshot(closedSnapshot);
assert.equal(closedView.sections.results.ready, true);
assert.equal(closedView.tournament.progressStatusLabel, "大会終了");

const entries40 = Array.from({ length: 40 }, (_, index) =>
  makeEntry(`e-${index + 1}`, `Team ${index + 1}`)
);
const bracket40 = buildPersistedSingleEliminationBracket(
  buildSingleEliminationBracket({
    entries: entries40.map((entry) => ({ entryId: entry.id, teamName: entry.teamName })),
    random: () => 0.2,
  })
);
const snapshot40 = buildPublicTournamentSnapshot({
  tournament: makeTournament({ tournamentFormat: "single_elimination", maxTeams: 64 }),
  entries: entries40,
  finalsBracket: bracket40,
});
assert.equal(snapshot40.bracket.rounds.length, 6);
assert.doesNotThrow(() => buildPublicTournamentViewFromSnapshot(snapshot40));

const qualifiers8 = Array.from({ length: 8 }, (_, index) => ({
  entryId: `e-${index + 1}`,
  teamName: `Team ${index + 1}`,
  seed: index + 1,
  source: "block_winner",
}));
const qualifyingSnapshot = buildPublicTournamentSnapshot({
  tournament: makeTournament(),
  entries: qualifiers8.map((q) => makeEntry(q.entryId, q.teamName)),
  finalsBracket: buildPersistedFinalsBracket(buildFinalsBracket(qualifiers8)),
});
assert.equal(qualifyingSnapshot.bracket.showSeed, true);

console.log("public-tournament-formats.smoke.mjs: all passed");
