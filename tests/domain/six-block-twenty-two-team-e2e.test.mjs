/**
 * 22チーム・6ブロック → WC2 → 8チーム決勝 の domain E2E
 */
import assert from "node:assert/strict";
import {
  computeQualifyingAdvancementCounts,
  validateBlockConfiguration,
} from "../../js/domain/block-configuration.js";
import {
  distributeEntriesToFixedBlocks,
  validateGeneratedBlockDraw,
} from "../../js/domain/fixed-block-draw.js";
import { buildQualifyingScheduleFromBlockDraw } from "../../js/domain/qualifying-schedule.js";
import {
  assignStandingsRanks,
  compareStandingsEntries,
} from "../../js/domain/qualifying-standings.js";
import {
  listWildcardBandCandidates,
  selectFinalists,
} from "../../js/domain/finals-advancement.js";
import { WildcardComparisonMode } from "../../js/domain/wildcard-comparison.js";
import { FinalsQualifierSource } from "../../js/domain/constants.js";
import { buildFinalsBracket } from "../../js/domain/finals-bracket.js";

function makeEntries(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `e${index + 1}`,
    teamName: `Team ${index + 1}`,
  }));
}

function countScheduleMatches(schedule) {
  let total = 0;
  for (const block of schedule.blocks || []) {
    for (const round of block.rounds || []) {
      total += (round.matches || []).length;
    }
  }
  return total;
}

function entry(id, stats) {
  return {
    entryId: id,
    teamName: `Team ${id}`,
    symbol: "",
    playedMatches: stats.playedMatches,
    setWins: stats.setWins,
    setDraws: stats.setDraws ?? 0,
    setLosses: stats.setLosses ?? 0,
    totalScore: stats.totalScore,
    remainingMatches: 0,
  };
}

function rankedBlock(blockId, blockName, standings) {
  return {
    blockId,
    blockName,
    standings: assignStandingsRanks(
      [...standings].sort((a, b) => {
        const metric = compareStandingsEntries(a, b);
        if (metric !== 0) {
          return metric;
        }
        return String(a.teamName).localeCompare(String(b.teamName), "ja");
      })
    ),
  };
}

{
  const config = validateBlockConfiguration({
    teamCount: 22,
    blockCount: 6,
    qualifiersPerBlock: 1,
  });
  assert.equal(config.valid, true);
  assert.deepEqual(
    [
      config.distribution.largerBlockCount,
      config.distribution.smallerBlockCount,
      config.distribution.maxBlockSize,
      config.distribution.minBlockSize,
    ],
    [4, 2, 4, 3]
  );

  const advancementCounts = computeQualifyingAdvancementCounts({
    blockCount: 6,
    qualifiersPerBlock: 1,
    finalTeamCount: 8,
    teamCount: 22,
  });
  assert.equal(advancementCounts.valid, true);
  assert.equal(advancementCounts.autoPassCount, 6);
  assert.equal(advancementCounts.wildcardCount, 2);

  const expandedCounts = computeQualifyingAdvancementCounts({
    blockCount: 6,
    qualifiersPerBlock: 2,
    finalTeamCount: 16,
    teamCount: 22,
  });
  assert.equal(expandedCounts.valid, true);
  assert.equal(expandedCounts.autoPassCount, 12);
  assert.equal(expandedCounts.wildcardCount, 4);

  const entries = makeEntries(22);
  const draw = distributeEntriesToFixedBlocks({
    entries,
    blockCount: 6,
    random: () => 0.42,
  });
  assert.equal(draw.blockCount, 6);

  const allEntryIds = draw.blocks.flatMap((block) => block.entryIds);
  assert.equal(allEntryIds.length, 22);
  assert.equal(new Set(allEntryIds).size, 22);

  const sizes = draw.blocks.map((block) => block.entryIds.length).sort((a, b) => a - b);
  assert.deepEqual(sizes, [3, 3, 4, 4, 4, 4]);

  const drawValidation = validateGeneratedBlockDraw({
    entries,
    blocks: draw.blocks,
    blockCount: 6,
    distribution: draw.distribution,
  });
  assert.equal(drawValidation.valid, true);

  const schedule = buildQualifyingScheduleFromBlockDraw(draw, entries);
  assert.equal(countScheduleMatches(schedule), 30, "予選は30試合");

  // 各ブロック総当たり（3チーム=3試合、4チーム=6試合）
  for (const block of schedule.blocks) {
    const teamCount = draw.blocks.find((item) => item.id === block.blockId)?.entryIds.length;
    const expectedMatches = (teamCount * (teamCount - 1)) / 2;
    const actualMatches = block.rounds.reduce(
      (sum, round) => sum + (round.matches || []).length,
      0
    );
    assert.equal(actualMatches, expectedMatches);
  }

  // 公開ブロック名 A〜F
  const blockLabels = draw.blocks.map((block) => block.id);
  assert.deepEqual(blockLabels, ["A", "B", "C", "D", "E", "F"]);

  // 順位表: 4チーム×4 + 3チーム×2。WCは2位帯のみ、normalized で公平比較
  const standings = {
    blocks: [
      rankedBlock("A", "Aブロック", [
        entry("a1", { setWins: 6, setLosses: 0, playedMatches: 3, totalScore: 300 }),
        entry("a2", { setWins: 4, setLosses: 2, playedMatches: 3, totalScore: 210 }),
        entry("a3", { setWins: 2, setLosses: 4, playedMatches: 3, totalScore: 120 }),
        entry("a4", { setWins: 0, setLosses: 6, playedMatches: 3, totalScore: 60 }),
      ]),
      rankedBlock("B", "Bブロック", [
        entry("b1", { setWins: 6, setLosses: 0, playedMatches: 3, totalScore: 290 }),
        entry("b2", { setWins: 3, setLosses: 3, playedMatches: 3, totalScore: 180 }),
        entry("b3", { setWins: 2, setLosses: 4, playedMatches: 3, totalScore: 110 }),
        entry("b4", { setWins: 1, setLosses: 5, playedMatches: 3, totalScore: 70 }),
      ]),
      rankedBlock("C", "Cブロック", [
        entry("c1", { setWins: 5, setLosses: 1, playedMatches: 3, totalScore: 280 }),
        entry("c2", { setWins: 4, setLosses: 2, playedMatches: 3, totalScore: 200 }),
        entry("c3", { setWins: 2, setLosses: 4, playedMatches: 3, totalScore: 100 }),
        entry("c4", { setWins: 1, setLosses: 5, playedMatches: 3, totalScore: 80 }),
      ]),
      rankedBlock("D", "Dブロック", [
        entry("d1", { setWins: 5, setLosses: 1, playedMatches: 3, totalScore: 270 }),
        entry("d2", { setWins: 3, setLosses: 3, playedMatches: 3, totalScore: 170 }),
        entry("d3", { setWins: 3, setLosses: 3, playedMatches: 3, totalScore: 160 }),
        entry("d4", { setWins: 1, setLosses: 5, playedMatches: 3, totalScore: 90 }),
      ]),
      rankedBlock("E", "Eブロック", [
        entry("e1", { setWins: 4, setLosses: 0, playedMatches: 2, totalScore: 200 }),
        entry("e2", { setWins: 3, setLosses: 1, playedMatches: 2, totalScore: 170 }),
        entry("e3", { setWins: 0, setLosses: 4, playedMatches: 2, totalScore: 40 }),
      ]),
      rankedBlock("F", "Fブロック", [
        entry("f1", { setWins: 4, setLosses: 0, playedMatches: 2, totalScore: 190 }),
        entry("f2", { setWins: 2, setLosses: 2, playedMatches: 2, totalScore: 130 }),
        entry("f3", { setWins: 0, setLosses: 4, playedMatches: 2, totalScore: 50 }),
      ]),
    ],
  };

  const wcPreview = listWildcardBandCandidates(standings, {
    autoPassRanks: 1,
    wildcardSlots: 2,
    comparisonMode: WildcardComparisonMode.NORMALIZED,
  });
  assert.equal(wcPreview.rankBand, 2);
  assert.equal(wcPreview.candidates.length, 6, "WC候補は各ブロック2位の6チームのみ");
  assert.ok(wcPreview.candidates.every((candidate) => candidate.blockRank === 2));

  // normalized: e2 (3/4=75%) > a2/c2 (4/6≈66.7%) > ...
  assert.equal(wcPreview.candidates[0].entryId, "e2");
  assert.equal(wcPreview.candidates[0].advances, true);
  assert.equal(wcPreview.candidates[1].advances, true);
  assert.equal(wcPreview.candidates[2].advances, false);

  const selection = selectFinalists(standings, 8, {
    autoPassRanks: 1,
    comparisonMode: WildcardComparisonMode.NORMALIZED,
  });
  assert.equal(selection.valid, true);
  assert.equal(selection.blockWinnerCount, 6);
  assert.equal(selection.wildcardCount, 2);
  assert.equal(selection.qualifiers.length, 8);
  assert.equal(selection.comparisonMode, WildcardComparisonMode.NORMALIZED);

  const autoPassIds = selection.qualifiers
    .filter((qualifier) => qualifier.source === FinalsQualifierSource.BLOCK_WINNER)
    .map((qualifier) => qualifier.entryId)
    .sort();
  assert.deepEqual(autoPassIds, ["a1", "b1", "c1", "d1", "e1", "f1"]);

  const wildcardIds = selection.qualifiers
    .filter((qualifier) => qualifier.source === FinalsQualifierSource.WILDCARD)
    .map((qualifier) => qualifier.entryId);
  assert.equal(wildcardIds.length, 2);
  assert.ok(wildcardIds.includes("e2"));
  assert.ok(selection.qualifiers.every((qualifier) => qualifier.blockId));

  const bracket = buildFinalsBracket(selection.qualifiers, { expectedCount: 8 });
  assert.equal(bracket.valid, true);
  assert.equal(bracket.bracket?.slots?.filter((slot) => !slot.isBye).length, 8);
}

console.log("six-block-twenty-two-team-e2e.test.mjs: all passed");
