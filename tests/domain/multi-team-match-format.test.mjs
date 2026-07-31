/**
 * 複数チーム・2セット合計ドメイン
 */
import assert from "node:assert/strict";
import {
  MatchFormat,
  normalizeAggregateMatchRules,
  validateAggregateMatchRulesInput,
} from "../../js/domain/aggregate-match-format.js";
import {
  hasBoundaryTie,
  rankByTotalScoreDesc,
  validateMultiTeamMatchResultInput,
} from "../../js/domain/multi-team-match-result.js";
import {
  buildMultiTeamBracket,
  nextRoundParticipantCount,
  planMatchSizes,
} from "../../js/domain/multi-team-bracket.js";
import { applyMultiTeamMatchAdvancement } from "../../js/domain/multi-team-progress.js";
import { buildMultiTeamPlacements } from "../../js/domain/multi-team-placements.js";

// settings
{
  const ok = validateAggregateMatchRulesInput({ teamCount: 4, qualifiersCount: 2 });
  assert.equal(ok.valid, true);
  assert.equal(ok.values.aggregateMatchRules.setCount, 2);
  const bad = validateAggregateMatchRulesInput({ teamCount: 2, qualifiersCount: 2 });
  assert.equal(bad.valid, false);
}

// sizes / progression math
assert.deepEqual(planMatchSizes(16, 4), [4, 4, 4, 4]);
assert.deepEqual(planMatchSizes(5, 4), [4]); // 1 auto-pass
assert.equal(nextRoundParticipantCount(16, 4, 2), 8);
assert.equal(nextRoundParticipantCount(5, 4, 2), 3); // 2 from match + 1 auto

function entries(n) {
  return Array.from({ length: n }, (_, i) => ({
    entryId: `e${i + 1}`,
    teamName: `T${i + 1}`,
  }));
}

// 4チーム1試合
{
  const built = buildMultiTeamBracket({
    entries: entries(4),
    aggregateMatchRules: { teamCount: 4, qualifiersCount: 2 },
    random: () => 0.5,
  });
  assert.equal(built.canFinalize, true);
  assert.equal(built.bracket.matchFormat, MatchFormat.MULTI_TEAM_TOTAL);
  assert.equal(built.bracket.matches.length, 1);
  assert.equal(built.bracket.matches[0].isFinal, true);
  assert.equal(built.bracket.matches[0].participants.length, 4);
}

// 16チーム → 準決勝4試合 + 決勝
{
  const built = buildMultiTeamBracket({
    entries: entries(16),
    aggregateMatchRules: { teamCount: 4, qualifiersCount: 2 },
    random: () => 0.1,
  });
  assert.equal(built.canFinalize, true);
  const r1 = built.bracket.matches.filter((m) => m.roundNumber === 1);
  assert.equal(r1.length, 4);
  const final = built.bracket.matches.filter((m) => m.isFinal);
  assert.equal(final.length, 1);
}

// スコア・順位
{
  const ids = ["A", "B", "C", "D"];
  const scores = {
    A: [50, 21],
    B: [38, 50],
    C: [25, 42],
    D: [17, 30],
  };
  const result = validateMultiTeamMatchResultInput({
    participantEntryIds: ids,
    scores,
    qualifiersCount: 2,
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.values.totals, { A: 71, B: 88, C: 67, D: 47 });
  assert.deepEqual(result.values.rankingEntryIds, ["B", "A", "C", "D"]);
  assert.deepEqual(result.values.qualifierEntryIds, ["B", "A"]);
}

// 不正得点
{
  const bad = validateMultiTeamMatchResultInput({
    participantEntryIds: ["A", "B"],
    scores: { A: [51, 0], B: [0, 0] },
    qualifiersCount: 1,
  });
  assert.equal(bad.valid, false);
}

// 参加外
{
  const bad = validateMultiTeamMatchResultInput({
    participantEntryIds: ["A", "B"],
    scores: { A: [10, 10], B: [10, 10], C: [10, 10] },
    qualifiersCount: 1,
  });
  assert.equal(bad.valid, false);
}

// 境界同点 → 手動必要
{
  const ids = ["A", "B", "C"];
  const scores = { A: [40, 40], B: [50, 30], C: [20, 20] }; // A=80, B=80, C=40
  const ranked = rankByTotalScoreDesc(ids, { A: 80, B: 80, C: 40 });
  assert.equal(hasBoundaryTie(ranked, { A: 80, B: 80, C: 40 }, 1), true);
  const needs = validateMultiTeamMatchResultInput({
    participantEntryIds: ids,
    scores,
    qualifiersCount: 1,
  });
  assert.equal(needs.valid, false);
  assert.equal(needs.needsManualTieBreak, true);

  const fixed = validateMultiTeamMatchResultInput({
    participantEntryIds: ids,
    scores,
    qualifiersCount: 1,
    manualRankingEntryIds: ["B", "A", "C"],
  });
  assert.equal(fixed.valid, true);
  assert.deepEqual(fixed.values.qualifierEntryIds, ["B"]);
  assert.ok(fixed.values.tieResolution);
}

// 非境界同点（3位タイ、2抜け）は自動完了可
{
  const scores = {
    A: [50, 50], // 100
    B: [40, 40], // 80
    C: [30, 30], // 60
    D: [30, 30], // 60
  };
  const ok = validateMultiTeamMatchResultInput({
    participantEntryIds: ["A", "B", "C", "D"],
    scores,
    qualifiersCount: 2,
  });
  assert.equal(ok.valid, true);
  assert.deepEqual(ok.values.qualifierEntryIds, ["A", "B"]);
}

// 進出適用
{
  const built = buildMultiTeamBracket({
    entries: entries(8),
    aggregateMatchRules: { teamCount: 4, qualifiersCount: 2 },
    random: () => 0.2,
  });
  const m1 = built.bracket.matches.find((m) => m.roundNumber === 1 && m.matchNumber === 1);
  const ids = m1.participantEntryIds;
  const validated = validateMultiTeamMatchResultInput({
    participantEntryIds: ids,
    scores: Object.fromEntries(
      ids.map((id, i) => [id, [50 - i, 40 - i]])
    ),
    qualifiersCount: 2,
  });
  assert.equal(validated.valid, true);
  const { matches } = applyMultiTeamMatchAdvancement({
    bracket: built.bracket,
    match: m1,
    result: validated.values,
  });
  const next = matches.find((m) => m.matchId === m1.nextMatchId);
  assert.ok(next);
  const placed = next.participants.filter((p) => p.entryId);
  assert.equal(placed.length >= 2, true);
  assert.equal(new Set(placed.map((p) => p.entryId)).size, placed.length);
}

// 最終順位
{
  const bracket = {
    matches: [
      {
        matchId: "final",
        roundNumber: 2,
        isFinal: true,
        matchFormat: MatchFormat.MULTI_TEAM_TOTAL,
        participants: [
          { entryId: "A", teamName: "A" },
          { entryId: "B", teamName: "B" },
          { entryId: "C", teamName: "C" },
        ],
      },
      {
        matchId: "sf1",
        roundNumber: 1,
        isFinal: false,
        matchFormat: MatchFormat.MULTI_TEAM_TOTAL,
        participants: [
          { entryId: "A", teamName: "A" },
          { entryId: "X", teamName: "X" },
          { entryId: "Y", teamName: "Y" },
        ],
      },
    ],
  };
  const results = {
    final: {
      rankingEntryIds: ["B", "A", "C"],
      qualifierEntryIds: ["B", "A"],
    },
    sf1: {
      rankingEntryIds: ["A", "X", "Y"],
      qualifierEntryIds: ["A"],
    },
  };
  const { champion, runnerUp, placements } = buildMultiTeamPlacements({
    bracket,
    resultsByMatchId: results,
  });
  assert.equal(champion.entryId, "B");
  assert.equal(runnerUp.entryId, "A");
  assert.ok(placements.some((p) => p.entryId === "X" && p.placementLabel));
}

assert.deepEqual(normalizeAggregateMatchRules({ teamCount: 3, qualifiersCount: 1 }).teamCount, 3);

console.log("multi-team-match-format.test.mjs: all passed");
