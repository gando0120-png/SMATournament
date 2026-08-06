/**
 * 決勝枠・自動通過・ワイルドカード計算と順位帯選出
 */
import assert from "node:assert/strict";
import {
  computeQualifyingAdvancementCounts,
  resolveStoredOrDerivedFinalTeamCount,
} from "../../js/domain/block-configuration.js";
import {
  assignStandingsRanks,
  compareStandingsEntries,
} from "../../js/domain/qualifying-standings.js";
import { selectFinalists } from "../../js/domain/finals-advancement.js";
import { FinalsQualifierSource } from "../../js/domain/constants.js";
import { usesRankBandWildcards } from "../../js/domain/tournament-format.js";

{
  const ok = computeQualifyingAdvancementCounts({
    blockCount: 16,
    qualifiersPerBlock: 1,
    finalTeamCount: 16,
  });
  assert.equal(ok.valid, true);
  assert.equal(ok.autoPassCount, 16);
  assert.equal(ok.wildcardCount, 0);
}

{
  const wc = computeQualifyingAdvancementCounts({
    blockCount: 16,
    qualifiersPerBlock: 1,
    finalTeamCount: 32,
    teamCount: 48,
  });
  assert.equal(wc.valid, true);
  assert.equal(wc.autoPassCount, 16);
  assert.equal(wc.wildcardCount, 16);
}

{
  const overflow = computeQualifyingAdvancementCounts({
    blockCount: 8,
    qualifiersPerBlock: 2,
    finalTeamCount: 8,
  });
  assert.equal(overflow.valid, false);
  assert.ok(overflow.errors[0].includes("超えて"));
}

{
  const overTeams = computeQualifyingAdvancementCounts({
    blockCount: 8,
    qualifiersPerBlock: 1,
    finalTeamCount: 32,
    teamCount: 16,
  });
  assert.equal(overTeams.valid, false);
  assert.ok(overTeams.errors[0].includes("参加チーム数"));
}

assert.equal(
  resolveStoredOrDerivedFinalTeamCount({ blockCount: 8, qualifiersPerBlock: 1 }),
  8
);
assert.equal(
  resolveStoredOrDerivedFinalTeamCount({
    blockCount: 8,
    qualifiersPerBlock: 1,
    finalTeamCount: 16,
  }),
  16
);
assert.equal(
  resolveStoredOrDerivedFinalTeamCount({ blockCount: 32, qualifiersPerBlock: 2 }),
  64
);

assert.equal(
  usesRankBandWildcards({ blockCount: 16, qualifiersPerBlock: 1, finalTeamCount: 32 }),
  true
);
assert.equal(
  usesRankBandWildcards({ blockCount: 16, qualifiersPerBlock: 1, finalTeamCount: 16 }),
  false
);

function entry(id, stats) {
  return {
    entryId: id,
    teamName: `Team ${id}`,
    symbol: "",
    playedMatches: 3,
    setWins: stats.setWins,
    setDraws: stats.setDraws ?? 0,
    setLosses: stats.setLosses ?? 0,
    totalScore: stats.totalScore,
    remainingMatches: 0,
  };
}

function block(blockId, standings) {
  return {
    blockId,
    blockName: `Block ${blockId}`,
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
  // WC0 相当: autoPassRanks=2 で枠ちょうど → ワイルドカードなし
  const standings = {
    blocks: [
      block("A", [
        entry("a1", { setWins: 4, totalScore: 100 }),
        entry("a2", { setWins: 3, totalScore: 90 }),
        entry("a3", { setWins: 1, totalScore: 40 }),
      ]),
      block("B", [
        entry("b1", { setWins: 4, totalScore: 95 }),
        entry("b2", { setWins: 3, totalScore: 85 }),
        entry("b3", { setWins: 1, totalScore: 30 }),
      ]),
    ],
  };
  const result = selectFinalists(standings, 4, { autoPassRanks: 2 });
  assert.equal(result.valid, true);
  assert.equal(result.wildcardCount, 0);
  assert.equal(result.qualifiers.length, 4);
}

{
  // WCあり: 1位自動通過 + 2位帯で補充
  const standings = {
    blocks: [
      block("A", [
        entry("a1", { setWins: 5, totalScore: 120 }),
        entry("a2", { setWins: 2, totalScore: 70 }),
      ]),
      block("B", [
        entry("b1", { setWins: 5, totalScore: 110 }),
        entry("b2", { setWins: 3, totalScore: 80 }),
      ]),
      block("C", [
        entry("c1", { setWins: 5, totalScore: 100 }),
        entry("c2", { setWins: 1, totalScore: 50 }),
      ]),
      block("D", [
        entry("d1", { setWins: 5, totalScore: 105 }),
        entry("d2", { setWins: 4, totalScore: 90 }),
      ]),
    ],
  };
  const result = selectFinalists(standings, 6, { autoPassRanks: 1 });
  assert.equal(result.valid, true);
  assert.equal(result.blockWinnerCount, 4);
  assert.equal(result.wildcardCount, 2);
  assert.equal(result.qualifiers[4].entryId, "d2");
  assert.equal(result.qualifiers[4].source, FinalsQualifierSource.WILDCARD);
  assert.equal(result.qualifiers[5].entryId, "b2");
}

console.log("finals-slots-advancement.test.mjs: all passed");
