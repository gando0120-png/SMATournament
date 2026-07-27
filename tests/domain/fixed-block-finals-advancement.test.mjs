/**
 * 新形式決勝進出ドメインテスト
 */
import assert from "node:assert/strict";
import {
  selectFixedBlockQualifiers,
  validateFixedBlockAdvancementPrerequisites,
  groupFixedBlockQualifiersByBlock,
} from "../../js/domain/fixed-block-finals-advancement.js";
import {
  assignStandingsRanks,
  compareStandingsEntries,
} from "../../js/domain/qualifying-standings.js";
import { buildFinalsAdvancementPreview, buildPersistedFinalsAdvancement } from "../../js/domain/finals-advancement.js";
import { buildFixedBlockFinalsBracket } from "../../js/domain/finals-bracket.js";
import { FinalsAdvancementMode } from "../../js/domain/constants.js";

function makeStanding(entryId, stats) {
  return {
    entryId,
    teamName: `Team ${entryId}`,
    symbol: "",
    playedMatches: 3,
    setWins: stats.setWins,
    setDraws: stats.setDraws ?? 0,
    setLosses: stats.setLosses ?? 0,
    totalScore: stats.totalScore ?? 100,
    remainingMatches: 0,
  };
}

function makeBlock(blockId, teamStats) {
  const sorted = assignStandingsRanks(
    teamStats.map((stats, index) => makeStanding(`e-${blockId}-${index + 1}`, stats)).sort(compareStandingsEntries)
  );
  return {
    blockId,
    blockName: `${blockId}ブロック`,
    standings: sorted,
  };
}

function makeStandings(blockCount, teamsPerBlock = 4) {
  const blocks = [];
  for (let i = 0; i < blockCount; i += 1) {
    const blockId = String.fromCharCode(65 + i);
    blocks.push(
      makeBlock(
        blockId,
        Array.from({ length: teamsPerBlock }, (_, rank) => ({
          setWins: teamsPerBlock - rank,
          setDraws: 0,
          setLosses: rank,
          totalScore: 100 - rank * 10,
        }))
      )
    );
  }
  return { finalized: true, blocks };
}

const blockDrawFinalized = {
  status: "finalized",
  blockCount: 4,
  blocks: [{ id: "A" }, { id: "B" }, { id: "C" }, { id: "D" }],
};

assert.equal(
  selectFixedBlockQualifiers({
    qualifyingStandings: makeStandings(4),
    blockCount: 4,
    qualifiersPerBlock: 1,
  }).qualifiers.length,
  4
);

assert.equal(
  selectFixedBlockQualifiers({
    qualifyingStandings: makeStandings(4),
    blockCount: 4,
    qualifiersPerBlock: 2,
  }).qualifiers.length,
  8
);

assert.equal(
  selectFixedBlockQualifiers({
    qualifyingStandings: makeStandings(16),
    blockCount: 16,
    qualifiersPerBlock: 1,
  }).qualifiers.length,
  16
);

assert.equal(
  selectFixedBlockQualifiers({
    qualifyingStandings: makeStandings(16),
    blockCount: 16,
    qualifiersPerBlock: 2,
  }).qualifiers.length,
  32
);

assert.equal(
  selectFixedBlockQualifiers({
    qualifyingStandings: makeStandings(32),
    blockCount: 32,
    qualifiersPerBlock: 2,
  }).qualifiers.length,
  64
);

assert.equal(
  selectFixedBlockQualifiers({
    qualifyingStandings: makeStandings(3),
    blockCount: 4,
    qualifiersPerBlock: 1,
  }).valid,
  false
);

const insufficientRankBlock = makeStandings(4);
insufficientRankBlock.blocks[0].standings = insufficientRankBlock.blocks[0].standings.slice(0, 1);
assert.equal(
  selectFixedBlockQualifiers({
    qualifyingStandings: insufficientRankBlock,
    blockCount: 4,
    qualifiersPerBlock: 2,
  }).valid,
  false
);

const tiedBlock = makeStandings(4);
tiedBlock.blocks[0].standings[1].setWins = tiedBlock.blocks[0].standings[0].setWins;
tiedBlock.blocks[0].standings[1].setDraws = tiedBlock.blocks[0].standings[0].setDraws;
tiedBlock.blocks[0].standings[1].totalScore = tiedBlock.blocks[0].standings[0].totalScore;
tiedBlock.blocks[0].standings = assignStandingsRanks(
  [...tiedBlock.blocks[0].standings].sort(compareStandingsEntries)
);
assert.equal(
  selectFixedBlockQualifiers({
    qualifyingStandings: tiedBlock,
    blockCount: 4,
    qualifiersPerBlock: 1,
  }).valid,
  false
);

assert.equal(validateFixedBlockAdvancementPrerequisites({ blockDraw: null, blockCount: 4 }).valid, false);
assert.equal(
  validateFixedBlockAdvancementPrerequisites({ blockDraw: blockDrawFinalized, blockCount: 4 }).valid,
  true
);

const legacyBlockDraw = {
  preferredBlockSize: 4,
  blockCount: 4,
  blocks: [{ id: "A" }, { id: "B" }, { id: "C" }, { id: "D" }],
};
assert.equal(
  validateFixedBlockAdvancementPrerequisites({ blockDraw: legacyBlockDraw, blockCount: 4 }).valid,
  true
);

const grouped = groupFixedBlockQualifiersByBlock([
  { entryId: "e-A-1", blockId: "A", blockRank: 1, teamName: "A1" },
  { entryId: "e-B-1", blockId: "B", blockRank: 1, teamName: "B1" },
]);
assert.equal(grouped.length, 2);

const qualifiers64 = selectFixedBlockQualifiers({
  qualifyingStandings: makeStandings(32),
  blockCount: 32,
  qualifiersPerBlock: 2,
}).qualifiers;
const bracket64 = buildFixedBlockFinalsBracket(qualifiers64, { expectedCount: 64, random: () => 0.5 });
assert.equal(bracket64.valid, true);
assert.equal(bracket64.bracket.bracketSize, 64);

console.log("fixed-block-finals-advancement.test.mjs: all passed");
