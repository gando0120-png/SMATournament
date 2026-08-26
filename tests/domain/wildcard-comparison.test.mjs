/**
 * ワイルドカード比較 raw / normalized の公平性テスト
 */
import assert from "node:assert/strict";
import {
  assignStandingsRanks,
  compareStandingsEntries,
} from "../../js/domain/qualifying-standings.js";
import { selectFinalists } from "../../js/domain/finals-advancement.js";
import {
  compareWildcardCandidates,
  computeAverageScorePerMatch,
  computeNormalizedSetWinRate,
  WildcardComparisonMode,
} from "../../js/domain/wildcard-comparison.js";
import { FinalsQualifierSource } from "../../js/domain/constants.js";

function entry(id, stats, extras = {}) {
  return {
    entryId: id,
    teamName: extras.teamName ?? `Team ${id}`,
    symbol: "",
    playedMatches: stats.playedMatches,
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
  // 4チームブロック2位: 4/6 ≈ 66.7%
  const fourTeamSecond = entry("four2", {
    setWins: 4,
    setLosses: 2,
    playedMatches: 3,
    totalScore: 200,
  });
  // 3チームブロック2位: 3/4 = 75%
  const threeTeamSecond = entry("three2", {
    setWins: 3,
    setLosses: 1,
    playedMatches: 2,
    totalScore: 150,
  });

  assert.equal(computeNormalizedSetWinRate(fourTeamSecond), 4 / 6);
  assert.equal(computeNormalizedSetWinRate(threeTeamSecond), 3 / 4);

  assert.ok(
    compareWildcardCandidates(
      fourTeamSecond,
      threeTeamSecond,
      WildcardComparisonMode.RAW
    ) < 0,
    "raw ではセット勝数が多い4勝側が上位"
  );
  assert.ok(
    compareWildcardCandidates(
      fourTeamSecond,
      threeTeamSecond,
      WildcardComparisonMode.NORMALIZED
    ) > 0,
    "normalized では勝率75%側が上位"
  );
}

{
  // セット勝率が同じなら平均得点で比較
  const a = entry("a", {
    setWins: 3,
    setLosses: 1,
    playedMatches: 2,
    totalScore: 160,
  });
  const b = entry("b", {
    setWins: 3,
    setLosses: 1,
    playedMatches: 2,
    totalScore: 140,
  });
  assert.equal(computeNormalizedSetWinRate(a), computeNormalizedSetWinRate(b));
  assert.equal(computeAverageScorePerMatch(a), 80);
  assert.equal(computeAverageScorePerMatch(b), 70);
  assert.ok(
    compareWildcardCandidates(a, b, WildcardComparisonMode.NORMALIZED) < 0,
    "平均得点が高い方が上位"
  );
}

{
  const standings = {
    blocks: [
      block("A", [
        entry("a1", { setWins: 6, setLosses: 0, playedMatches: 3, totalScore: 300 }),
        entry("a2", {
          setWins: 4,
          setLosses: 2,
          playedMatches: 3,
          totalScore: 200,
        }),
        entry("a3", { setWins: 2, setLosses: 4, playedMatches: 3, totalScore: 100 }),
        entry("a4", { setWins: 0, setLosses: 6, playedMatches: 3, totalScore: 50 }),
      ]),
      block("B", [
        entry("b1", { setWins: 4, setLosses: 0, playedMatches: 2, totalScore: 200 }),
        entry("b2", {
          setWins: 3,
          setLosses: 1,
          playedMatches: 2,
          totalScore: 150,
        }),
        entry("b3", { setWins: 0, setLosses: 4, playedMatches: 2, totalScore: 40 }),
      ]),
      block("C", [
        entry("c1", { setWins: 4, setLosses: 0, playedMatches: 2, totalScore: 190 }),
        entry("c2", {
          setWins: 2,
          setLosses: 2,
          playedMatches: 2,
          totalScore: 120,
        }),
        entry("c3", { setWins: 0, setLosses: 4, playedMatches: 2, totalScore: 30 }),
      ]),
    ],
  };

  const raw = selectFinalists(standings, 4, {
    autoPassRanks: 1,
    comparisonMode: WildcardComparisonMode.RAW,
  });
  assert.equal(raw.valid, true);
  assert.equal(raw.wildcardCount, 1);
  assert.equal(raw.qualifiers[3].entryId, "a2", "raw では4勝の a2 が進出");

  const normalized = selectFinalists(standings, 4, {
    autoPassRanks: 1,
    comparisonMode: WildcardComparisonMode.NORMALIZED,
  });
  assert.equal(normalized.valid, true);
  assert.equal(normalized.wildcardCount, 1);
  assert.equal(
    normalized.qualifiers[3].entryId,
    "b2",
    "normalized では勝率75%の b2 が進出"
  );
  assert.equal(normalized.qualifiers[3].source, FinalsQualifierSource.WILDCARD);
  assert.equal(normalized.comparisonMode, WildcardComparisonMode.NORMALIZED);
}

{
  // 未指定は raw（後方互換）
  const standings = {
    blocks: [
      block("A", [
        entry("a1", { setWins: 4, playedMatches: 2, totalScore: 100 }),
        entry("a2", { setWins: 2, playedMatches: 2, totalScore: 80 }),
      ]),
      block("B", [
        entry("b1", { setWins: 4, playedMatches: 2, totalScore: 100 }),
        entry("b2", { setWins: 3, playedMatches: 2, totalScore: 90 }),
      ]),
    ],
  };
  const result = selectFinalists(standings, 3, { autoPassRanks: 1 });
  assert.equal(result.comparisonMode, WildcardComparisonMode.RAW);
  assert.equal(result.qualifiers[2].entryId, "b2");
}

console.log("wildcard-comparison.test.mjs: all passed");
