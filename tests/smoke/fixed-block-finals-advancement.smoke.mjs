/**
 * 新形式決勝進出 smoke テスト
 */
import assert from "node:assert/strict";
import {
  selectFixedBlockQualifiers,
} from "../../js/domain/fixed-block-finals-advancement.js";
import {
  buildPersistedFinalsAdvancement,
  selectFinalists,
} from "../../js/domain/finals-advancement.js";
import {
  buildFixedBlockFinalsBracket,
  buildFinalsBracketFromAdvancement,
} from "../../js/domain/finals-bracket.js";
import { FinalsAdvancementMode } from "../../js/domain/constants.js";
import { usesLegacyFinalsAdvancement, TournamentFormat } from "../../js/domain/tournament-format.js";

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

import {
  assignStandingsRanks,
  compareStandingsEntries,
} from "../../js/domain/qualifying-standings.js";

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

const legacyTournament = { preferredBlockSize: 4 };
assert.equal(usesLegacyFinalsAdvancement(newTournament), false);
assert.equal(usesLegacyFinalsAdvancement(legacyTournament), true);

const selection = selectFixedBlockQualifiers({
  qualifyingStandings: makeStandings(4),
  blockCount: 4,
  qualifiersPerBlock: 2,
});
assert.equal(selection.valid, true);
assert.equal(selection.qualifiers.length, 8);
assert.equal(selection.qualifiers.every((q) => !q.source), true);

const legacySelection = selectFinalists(makeStandings(8), 8);
assert.equal(legacySelection.valid, true);
assert.equal(legacySelection.wildcardCount >= 0, true);

const persisted = buildPersistedFinalsAdvancement(
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
assert.equal(persisted.mode, FinalsAdvancementMode.FIXED_BLOCK_QUALIFIERS);
assert.equal(persisted.qualifierCount, 8);

const bracketPreview = buildFinalsBracketFromAdvancement({
  finalized: true,
  mode: FinalsAdvancementMode.FIXED_BLOCK_QUALIFIERS,
  qualifierCount: 8,
  qualifiers: persisted.qualifiers,
});
assert.equal(bracketPreview.canFinalize, true);
assert.equal(bracketPreview.bracket.bracketSize, 8);

for (const slot of bracketPreview.bracket.slots) {
  assert.ok(slot.entryId, "slot entryId required");
  assert.ok(slot.teamName, "slot teamName required");
}

for (const match of bracketPreview.bracket.matches.filter((m) => m.roundNumber === 1)) {
  for (const team of [match.team1, match.team2]) {
    if (!team?.isBye) {
      assert.ok(team?.entryId);
      assert.ok(team?.teamName);
    }
  }
}

const bracket64 = buildFixedBlockFinalsBracket(
  selectFixedBlockQualifiers({
    qualifyingStandings: makeStandings(32),
    blockCount: 32,
    qualifiersPerBlock: 2,
  }).qualifiers,
  { expectedCount: 64, random: () => 0.25 }
);
assert.equal(bracket64.valid, true);
assert.equal(bracket64.bracket.bracketSize, 64);

console.log("fixed-block-finals-advancement.smoke.mjs: all passed");
