/**
 * ワイルドカード順位帯選出・モルックアウト解消の domain テスト
 */
import assert from "node:assert/strict";
import {
  applyMolkkyOutResolutions,
  areStandingsEntriesTied,
  assignStandingsRanks,
  compareStandingsEntries,
  hasUnresolvedBlockMolkkyOuts,
} from "../../js/domain/qualifying-standings.js";
import { selectFinalists } from "../../js/domain/finals-advancement.js";
import { FinalsQualifierSource } from "../../js/domain/constants.js";

function entry(id, stats, extras = {}) {
  return {
    entryId: id,
    teamName: extras.teamName ?? `Team ${id}`,
    symbol: "",
    playedMatches: 3,
    setWins: stats.setWins,
    setDraws: stats.setDraws ?? 0,
    setLosses: stats.setLosses ?? 0,
    totalScore: stats.totalScore,
    remainingMatches: 0,
    ...extras,
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
  const a = entry("a", { setWins: 2, setDraws: 1, totalScore: 100 }, { teamName: "Zebra" });
  const b = entry("b", { setWins: 2, setDraws: 1, totalScore: 100 }, { teamName: "Alpha" });
  assert.equal(compareStandingsEntries(a, b), 0);
  assert.equal(areStandingsEntriesTied(a, b), true);
}

{
  const standings = {
    blocks: [
      block("A", [
        entry("a1", { setWins: 4, totalScore: 200 }),
        entry("a2", { setWins: 2, setDraws: 1, totalScore: 120 }),
        entry("a3", { setWins: 2, setDraws: 1, totalScore: 120 }),
      ]),
    ],
  };

  assert.equal(hasUnresolvedBlockMolkkyOuts(standings), true);
  assert.equal(standings.blocks[0].standings[1].rank, standings.blocks[0].standings[2].rank);

  const resolved = applyMolkkyOutResolutions(standings, {
    blockGroups: [
      {
        blockId: "A",
        entryIds: ["a2", "a3"],
        orderedEntryIds: ["a3", "a2"],
      },
    ],
  });

  assert.equal(hasUnresolvedBlockMolkkyOuts(resolved), false);
  assert.equal(resolved.blocks[0].standings[1].entryId, "a3");
  assert.equal(resolved.blocks[0].standings[1].rank, 2);
  assert.equal(resolved.blocks[0].standings[2].entryId, "a2");
  assert.equal(resolved.blocks[0].standings[2].rank, 3);
}

{
  // 順位帯: 1位自動 + 2位帯のみ比較（3位は混ざらない）
  const standings = {
    blocks: [
      block("A", [
        entry("a1", { setWins: 5, totalScore: 200 }),
        entry("a2", { setWins: 1, totalScore: 50 }),
        entry("a3", { setWins: 4, totalScore: 180 }), // 強い3位だが2位帯より上の成績
      ]),
      block("B", [
        entry("b1", { setWins: 5, totalScore: 190 }),
        entry("b2", { setWins: 2, totalScore: 80 }),
        entry("b3", { setWins: 0, totalScore: 10 }),
      ]),
      block("C", [
        entry("c1", { setWins: 5, totalScore: 185 }),
        entry("c2", { setWins: 3, totalScore: 90 }),
        entry("c3", { setWins: 0, totalScore: 5 }),
      ]),
    ],
  };

  // Fix ranks properly - a3 has better stats than a2 so rank order within block matters
  // After assignStandingsRanks: a1=1, a3=2, a2=3 for block A
  // Wait - I passed unsorted then assignStandingsRanks sorts... block() sorts first.
  // Block A order: a1 (5), a3 (4), a2 (1) → ranks 1,2,3
  // So rank band 2 candidates: a3, b2, c2 — NOT a2

  const result = selectFinalists(standings, 4);
  assert.equal(result.valid, true);
  assert.equal(result.blockWinnerCount, 3);
  assert.equal(result.wildcardCount, 1);
  assert.equal(result.qualifiers[3].source, FinalsQualifierSource.WILDCARD);
  // 2位帯: a3(setWins4) > c2(3) > b2(2)。強い3位 a2 は帯に入らない
  assert.equal(result.qualifiers[3].entryId, "a3");
  assert.equal(result.qualifiers[3].blockRank, 2);
  assert.ok(!result.qualifiers.some((q) => q.entryId === "a2"));
  assert.ok(!result.qualifiers.some((q) => q.entryId === "b2"));
}

{
  // カットオフ同値 → 未解消は needsMolkkyOut
  const standings = {
    blocks: [
      block("A", [
        entry("a1", { setWins: 4, totalScore: 160 }),
        entry("a2", { setWins: 2, setDraws: 0, totalScore: 100 }),
      ]),
      block("B", [
        entry("b1", { setWins: 4, totalScore: 150 }),
        entry("b2", { setWins: 2, setDraws: 0, totalScore: 100 }),
      ]),
      block("C", [
        entry("c1", { setWins: 4, totalScore: 140 }),
        entry("c2", { setWins: 2, setDraws: 0, totalScore: 100 }),
      ]),
    ],
  };

  const unresolved = selectFinalists(standings, 4);
  assert.equal(unresolved.valid, false);
  assert.equal(unresolved.needsMolkkyOut?.scope, "wildcard");
  assert.equal(unresolved.needsMolkkyOut?.rankBand, 2);
  assert.equal(unresolved.needsMolkkyOut?.slotsNeeded, 1);
  assert.equal(unresolved.needsMolkkyOut?.candidates.length, 3);

  const resolved = selectFinalists(standings, 4, {
    wildcardGroups: [
      {
        rankBand: 2,
        entryIds: ["a2", "b2", "c2"],
        orderedEntryIds: ["b2", "a2", "c2"],
      },
    ],
  });
  assert.equal(resolved.valid, true);
  assert.equal(resolved.qualifiers[3].entryId, "b2");
  assert.equal(resolved.qualifiers[3].source, FinalsQualifierSource.WILDCARD);
}

{
  // チーム名だけでは自動選出しない（同値のまま）
  const standings = {
    blocks: [
      block("A", [
        entry("a1", { setWins: 3, totalScore: 100 }),
        entry("zzz", { setWins: 1, totalScore: 50 }, { teamName: "ZZZ" }),
      ]),
      block("B", [
        entry("b1", { setWins: 3, totalScore: 100 }),
        entry("aaa", { setWins: 1, totalScore: 50 }, { teamName: "AAA" }),
      ]),
    ],
  };
  const result = selectFinalists(standings, 3);
  assert.equal(result.valid, false);
  assert.equal(result.needsMolkkyOut?.scope, "wildcard");
}

console.log("finals-advancement-wildcard.test.mjs: all passed");
