/**
 * fixed_block_qualifiers → 決勝ブラケット生成・永続化テスト
 */
import assert from "node:assert/strict";
import {
  selectFixedBlockQualifiers,
  normalizeFixedBlockQualifiersForBracket,
  validateFixedBlockQualifiersForBracket,
  enrichFixedBlockQualifiersForBracket,
  needsFixedBlockQualifierEnrichment,
} from "../../js/domain/fixed-block-finals-advancement.js";
import {
  assignStandingsRanks,
  compareStandingsEntries,
} from "../../js/domain/qualifying-standings.js";
import {
  buildPersistedFinalsAdvancement,
  selectFinalists,
} from "../../js/domain/finals-advancement.js";
import {
  buildFinalsBracket,
  buildFinalsBracketFromAdvancement,
  buildPersistedFinalsBracket,
  needsFinalsBracketTeamDataRepair,
} from "../../js/domain/finals-bracket.js";
import { FinalsAdvancementMode } from "../../js/domain/constants.js";
import { TournamentFormat } from "../../js/domain/tournament-format.js";

function makeStanding(entryId, stats) {
  return {
    entryId,
    teamName: `Team ${entryId}`,
    symbol: "",
    playedMatches: 3,
    setWins: stats.setWins,
    setDraws: 0,
    setLosses: stats.setLosses ?? 0,
    totalScore: stats.totalScore ?? 100,
    remainingMatches: 0,
  };
}

function makeStandings(blockCount, teamsPerBlock = 4) {
  const blocks = [];
  for (let i = 0; i < blockCount; i += 1) {
    const blockId = String.fromCharCode(65 + i);
    const standings = assignStandingsRanks(
      Array.from({ length: teamsPerBlock }, (_, rank) =>
        makeStanding(`e-${blockId}-${rank + 1}`, {
          setWins: teamsPerBlock - rank,
          setLosses: rank,
          totalScore: 100 - rank * 10,
        })
      ).sort(compareStandingsEntries)
    );
    blocks.push({ blockId, blockName: `${blockId}ブロック`, standings });
  }
  return { finalized: true, blocks };
}

const newTournament = {
  tournamentFormat: TournamentFormat.QUALIFYING_AND_FINALS,
  blockCount: 4,
  qualifiersPerBlock: 2,
};

const selection = selectFixedBlockQualifiers({
  qualifyingStandings: makeStandings(4),
  blockCount: 4,
  qualifiersPerBlock: 2,
});
assert.equal(selection.valid, true);
assert.equal(selection.qualifiers.length, 8);

const persistedAdvancement = buildPersistedFinalsAdvancement(
  {
    canFinalize: true,
    mode: FinalsAdvancementMode.FIXED_BLOCK_QUALIFIERS,
    completion: { totalMatches: 10, finishedMatches: 10 },
    qualifyingStandings: makeStandings(4),
    selection: {
      valid: true,
      qualifierCount: 8,
      qualifiersPerBlock: 2,
      blockCount: 4,
      qualifiers: selection.qualifiers,
    },
  },
  { tournament: newTournament }
);

assert.equal(persistedAdvancement.qualifiers.length, 8);
for (const qualifier of persistedAdvancement.qualifiers) {
  assert.ok(qualifier.entryId, "persisted qualifier must have entryId");
  assert.ok(qualifier.teamName, "persisted qualifier must have teamName");
  assert.ok(qualifier.blockId, "persisted qualifier must have blockId");
  assert.ok(qualifier.blockRank, "persisted qualifier must have blockRank");
}

const bracketPreview = buildFinalsBracketFromAdvancement({
  finalized: true,
  mode: FinalsAdvancementMode.FIXED_BLOCK_QUALIFIERS,
  qualifierCount: 8,
  qualifiers: persistedAdvancement.qualifiers,
});
assert.equal(bracketPreview.valid, true);
assert.equal(bracketPreview.canFinalize, true);

const { bracket } = bracketPreview;
assert.equal(bracket.slots.length, 8);
assert.equal(bracket.matches.filter((m) => m.roundNumber === 1).length, 4);

const slotEntryIds = new Set();
for (const slot of bracket.slots) {
  assert.ok(slot.entryId, "slot must have entryId");
  assert.ok(slot.teamName, "slot must have teamName");
  assert.ok(slot.blockId, "slot must preserve blockId");
  assert.ok(slot.blockRank, "slot must preserve blockRank");
  assert.equal(slotEntryIds.has(slot.entryId), false, "duplicate entryId in slots");
  slotEntryIds.add(slot.entryId);
}

for (const match of bracket.matches.filter((m) => m.roundNumber === 1)) {
  for (const team of [match.team1, match.team2]) {
    if (!team?.isBye) {
      assert.ok(team?.entryId, "round1 team must have entryId");
      assert.ok(team?.teamName, "round1 team must have teamName");
    }
  }
}

const persistedBracket = buildPersistedFinalsBracket(bracketPreview);
assert.equal(needsFinalsBracketTeamDataRepair(persistedBracket), false);

const corruptBracket = {
  ...persistedBracket,
  matches: persistedBracket.matches.map((match) =>
    match.roundNumber === 1
      ? {
          ...match,
          team1: match.team1 ? { ...match.team1, teamName: null } : match.team1,
        }
      : match
  ),
};
assert.equal(needsFinalsBracketTeamDataRepair(corruptBracket), true);

const legacySelection = selectFinalists(makeStandings(8), 8);
assert.equal(legacySelection.valid, true);

const legacyAdvancement = buildPersistedFinalsAdvancement(
  {
    canFinalize: true,
    mode: FinalsAdvancementMode.LEGACY,
    completion: { totalMatches: 20, finishedMatches: 20 },
    qualifyingStandings: makeStandings(8),
    selection: legacySelection,
  },
  { tournament: { preferredBlockSize: 4 } }
);

const legacyBracket = buildFinalsBracketFromAdvancement(legacyAdvancement);
assert.equal(legacyBracket.valid, true);
for (const slot of legacyBracket.bracket.slots.filter((s) => !s.isBye)) {
  assert.ok(slot.entryId);
  assert.ok(slot.teamName);
  assert.ok(slot.seed);
}

const strippedQualifiers = persistedAdvancement.qualifiers.map(({ entryId, blockId, blockRank }) => ({
  entryId,
  blockId,
  blockRank,
}));
assert.equal(needsFixedBlockQualifierEnrichment(strippedQualifiers), true);

const enriched = enrichFixedBlockQualifiersForBracket(strippedQualifiers, {
  entries: selection.qualifiers.map((q) => ({ id: q.entryId, teamName: q.teamName })),
  blockDraw: {
    blocks: [
      { id: "A", name: "Aブロック" },
      { id: "B", name: "Bブロック" },
      { id: "C", name: "Cブロック" },
      { id: "D", name: "Dブロック" },
    ],
  },
});
assert.equal(enriched.every((q) => q.teamName), true);
assert.equal(
  validateFixedBlockQualifiersForBracket(enriched).valid,
  true,
  "enriched qualifiers must pass bracket validation"
);

const normalized = normalizeFixedBlockQualifiersForBracket(strippedQualifiers);
assert.equal(
  validateFixedBlockQualifiersForBracket(normalized).valid,
  false,
  "teamName missing must fail validation"
);

const legacyQualifiers = legacySelection.qualifiers.map((q) => ({
  seed: q.seed,
  entryId: q.entryId,
  teamName: q.teamName,
  blockId: q.blockId,
  blockName: q.blockName,
}));
const legacyDirect = buildFinalsBracket(legacyQualifiers, { expectedCount: 8 });
assert.equal(legacyDirect.valid, true);

const reloaded = buildPersistedFinalsBracket(
  buildFinalsBracketFromAdvancement({
    finalized: true,
    mode: FinalsAdvancementMode.FIXED_BLOCK_QUALIFIERS,
    qualifierCount: 8,
    qualifiers: persistedAdvancement.qualifiers,
  })
);
for (const slot of reloaded.slots) {
  const source = persistedAdvancement.qualifiers.find((q) => q.entryId === slot.entryId);
  assert.equal(slot.teamName, source?.teamName, "reloaded slot teamName must match advancement");
}

console.log("fixed-block-finals-bracket.test.mjs: all passed");
