/**
 * multiTeamTotal 最終ラウンド判定・順位確定・復旧
 */
import assert from "node:assert/strict";
import { MatchFormat } from "../../js/domain/aggregate-match-format.js";
import {
  buildMultiTeamBracket,
  getMultiTeamRoundLabel,
  isMultiTeamFinalMatch,
  isMultiTeamFinalRound,
} from "../../js/domain/multi-team-bracket.js";
import {
  buildMultiTeamMatchResultPayload,
  validateMultiTeamMatchResultInput,
} from "../../js/domain/multi-team-match-result.js";
import { applyMultiTeamMatchAdvancement } from "../../js/domain/multi-team-progress.js";
import { buildMultiTeamPlacements } from "../../js/domain/multi-team-placements.js";
import { groupBracketMatchesByRound } from "../../js/domain/finals-bracket-display.js";
import {
  buildBracketPlacements,
  canFinalizeTournament,
} from "../../js/domain/tournament-results.js";
import { getFinalsChampionAndRunnerUp } from "../../js/domain/finals-match-progress.js";
import { MatchResultStatus } from "../../js/domain/constants.js";

function entries(n) {
  return Array.from({ length: n }, (_, i) => ({
    entryId: `e${i + 1}`,
    teamName: `T${i + 1}`,
  }));
}

function scoresFor(ids, totals) {
  return Object.fromEntries(
    ids.map((id, i) => {
      const total = totals[i];
      const s1 = Math.min(50, total);
      const s2 = total - s1;
      return [id, [s1, s2]];
    })
  );
}

// 8人・4チーム・上位2 → 準決勝2組 + 決勝1組
{
  const built = buildMultiTeamBracket({
    entries: entries(8),
    aggregateMatchRules: { teamCount: 4, qualifiersCount: 2 },
    random: () => 0.3,
  });
  assert.equal(built.canFinalize, true);
  const r1 = built.bracket.matches.filter((m) => m.roundNumber === 1);
  const r2 = built.bracket.matches.filter((m) => m.roundNumber === 2);
  assert.equal(r1.length, 2);
  assert.equal(r2.length, 1);
  assert.equal(r2[0].isFinal, true);
  assert.equal(r2[0].nextMatchId, null);
  assert.equal(r2[0].roundLabel, "決勝");
  assert.ok(r1.every((m) => m.roundLabel === "準決勝"));
  assert.ok(r1.every((m) => m.nextMatchId === r2[0].matchId));
  assert.equal(isMultiTeamFinalMatch(r2[0]), true);
  assert.equal(isMultiTeamFinalMatch(r1[0]), false);
  assert.equal(isMultiTeamFinalRound({ bracket: built.bracket, roundNumber: 2 }), true);
  assert.equal(isMultiTeamFinalRound({ bracket: built.bracket, roundNumber: 1 }), false);

  const grouped = groupBracketMatchesByRound(built.bracket);
  assert.equal(grouped[0].roundLabel, "準決勝");
  assert.equal(grouped[1].roundLabel, "決勝");
  assert.equal(getMultiTeamRoundLabel(built.bracket, 1), "準決勝");
  assert.equal(getMultiTeamRoundLabel(built.bracket, 2), "決勝");
}

// 中間ラウンドは進出、最終は進出なし・1〜4位確定
{
  const built = buildMultiTeamBracket({
    entries: entries(8),
    aggregateMatchRules: { teamCount: 4, qualifiersCount: 2 },
    random: () => 0.15,
  });
  const sfMatches = built.bracket.matches
    .filter((m) => m.roundNumber === 1)
    .sort((a, b) => a.matchNumber - b.matchNumber);
  const finalMatch = built.bracket.matches.find((m) => m.isFinal);

  /** @type {Map<string, object>} */
  const resultsMap = new Map();
  let bracket = built.bracket;

  for (const sf of sfMatches) {
    const ids = sf.participantEntryIds;
    const validated = validateMultiTeamMatchResultInput({
      participantEntryIds: ids,
      scores: scoresFor(ids, [100, 90, 80, 70]),
      qualifiersCount: 2,
      isFinalRound: false,
    });
    assert.equal(validated.valid, true);
    assert.equal(validated.values.qualifierEntryIds.length, 2);
    const payload = buildMultiTeamMatchResultPayload({
      match: sf,
      validated: validated.values,
    });
    assert.ok(Array.isArray(payload.qualifierEntryIds));
    resultsMap.set(sf.matchId, {
      ...payload,
      status: MatchResultStatus.FINISHED,
    });
    const advanced = applyMultiTeamMatchAdvancement({
      bracket,
      match: sf,
      result: payload,
    });
    bracket = { ...bracket, matches: advanced.matches };
  }

  const resolvedFinal = bracket.matches.find((m) => m.matchId === finalMatch.matchId);
  const finalIds = resolvedFinal.participants.map((p) => p.entryId).filter(Boolean);
  assert.equal(finalIds.length, 4);

  const finalValidated = validateMultiTeamMatchResultInput({
    participantEntryIds: finalIds,
    scores: scoresFor(finalIds, [100, 96, 88, 72]),
    qualifiersCount: 2,
    isFinalRound: true,
  });
  assert.equal(finalValidated.valid, true);
  assert.equal(finalValidated.values.qualifierEntryIds, undefined);

  const finalPayload = buildMultiTeamMatchResultPayload({
    match: resolvedFinal,
    validated: finalValidated.values,
  });
  assert.equal("qualifierEntryIds" in finalPayload, false);
  assert.deepEqual(finalPayload.rankingEntryIds, finalIds);

  // 最終ラウンド結果があっても進出処理は動かない
  const noAdvance = applyMultiTeamMatchAdvancement({
    bracket,
    match: resolvedFinal,
    result: {
      ...finalPayload,
      qualifierEntryIds: finalIds.slice(0, 2),
    },
  });
  assert.deepEqual(noAdvance.changedMatchIds, []);

  resultsMap.set(finalMatch.matchId, {
    ...finalPayload,
    status: MatchResultStatus.FINISHED,
  });

  const { champion, runnerUp, placements } = buildMultiTeamPlacements({
    bracket,
    resultsByMatchId: resultsMap,
  });
  assert.equal(champion.entryId, finalIds[0]);
  assert.equal(runnerUp.entryId, finalIds[1]);
  assert.equal(placements.find((p) => p.rank === 1)?.placementLabel, "優勝");
  assert.equal(placements.find((p) => p.rank === 2)?.placementLabel, "準優勝");
  assert.equal(placements.find((p) => p.rank === 3)?.placementLabel, "3位");
  assert.equal(placements.find((p) => p.rank === 4)?.placementLabel, "4位");

  const outcome = getFinalsChampionAndRunnerUp(bracket, resultsMap);
  assert.equal(outcome.complete, true);
  assert.equal(outcome.champion.entryId, finalIds[0]);
  assert.equal(outcome.runnerUp.entryId, finalIds[1]);
  assert.notEqual(outcome.champion.teamName, "—");

  const bracketPlacements = buildBracketPlacements({
    bracket,
    resultsMap,
  });
  assert.equal(bracketPlacements.valid, true);
  assert.equal(bracketPlacements.complete, true);
  assert.equal(bracketPlacements.champion.entryId, finalIds[0]);

  const finalize = canFinalizeTournament({
    tournament: { status: "open" },
    bracket: { ...bracket, finalized: true, mode: "single_elimination" },
    resultsMap,
    qualifiers: entries(8),
    advancement: null,
  });
  assert.equal(finalize.canFinalize, true, finalize.message);
}

// 保存済み決勝結果からの復旧（qualifierEntryIds あり／決勝参加者スロット空）
{
  const bracket = {
    matchFormat: MatchFormat.MULTI_TEAM_TOTAL,
    finalized: true,
    mode: "single_elimination",
    roundCount: 2,
    bracketSize: 8,
    matches: [
      {
        matchId: "sf1",
        roundNumber: 1,
        matchNumber: 1,
        matchFormat: MatchFormat.MULTI_TEAM_TOTAL,
        nextMatchId: "final",
        nextSlotStart: 0,
        nextQualifierSpan: 2,
        qualifiersCount: 2,
        isFinal: false,
        participants: [
          { entryId: "a", teamName: "A" },
          { entryId: "b", teamName: "B" },
          { entryId: "c", teamName: "C" },
          { entryId: "d", teamName: "D" },
        ],
        participantEntryIds: ["a", "b", "c", "d"],
      },
      {
        matchId: "sf2",
        roundNumber: 1,
        matchNumber: 2,
        matchFormat: MatchFormat.MULTI_TEAM_TOTAL,
        nextMatchId: "final",
        nextSlotStart: 2,
        nextQualifierSpan: 2,
        qualifiersCount: 2,
        isFinal: false,
        participants: [
          { entryId: "e", teamName: "E" },
          { entryId: "f", teamName: "F" },
          { entryId: "g", teamName: "G" },
          { entryId: "h", teamName: "H" },
        ],
        participantEntryIds: ["e", "f", "g", "h"],
      },
      {
        matchId: "final",
        roundNumber: 2,
        matchNumber: 1,
        matchFormat: MatchFormat.MULTI_TEAM_TOTAL,
        nextMatchId: null,
        qualifiersCount: 2,
        isFinal: true,
        roundLabel: "決勝",
        // 本番で起きうる: ブラケット上の決勝スロットが空
        participants: [
          { entryId: null },
          { entryId: null },
          { entryId: null },
          { entryId: null },
        ],
        participantEntryIds: [],
      },
    ],
  };

  const resultsMap = new Map([
    [
      "sf1",
      {
        matchFormat: MatchFormat.MULTI_TEAM_TOTAL,
        status: MatchResultStatus.FINISHED,
        resolution: "played",
        rankingEntryIds: ["a", "b", "c", "d"],
        qualifierEntryIds: ["a", "b"],
      },
    ],
    [
      "sf2",
      {
        matchFormat: MatchFormat.MULTI_TEAM_TOTAL,
        status: MatchResultStatus.FINISHED,
        resolution: "played",
        rankingEntryIds: ["e", "f", "g", "h"],
        qualifierEntryIds: ["e", "f"],
      },
    ],
    [
      "final",
      {
        matchFormat: MatchFormat.MULTI_TEAM_TOTAL,
        status: MatchResultStatus.FINISHED,
        resolution: "played",
        rankingEntryIds: ["b", "e", "a", "f"],
        // 旧データ互換: qualifierEntryIds が残っていても進出に使わない
        qualifierEntryIds: ["b", "e"],
        totals: { b: 100, e: 96, a: 88, f: 72 },
      },
    ],
  ]);

  const outcome = getFinalsChampionAndRunnerUp(bracket, resultsMap);
  assert.equal(outcome.complete, true);
  assert.equal(outcome.champion.entryId, "b");
  assert.equal(outcome.champion.teamName, "B");
  assert.equal(outcome.runnerUp.entryId, "e");
  assert.equal(outcome.runnerUp.teamName, "E");

  const placements = buildBracketPlacements({ bracket, resultsMap });
  assert.equal(placements.valid, true);
  assert.equal(placements.complete, true);

  const finalize = canFinalizeTournament({
    tournament: { status: "open" },
    bracket,
    resultsMap,
    qualifiers: entries(8).map((e, i) => ({
      entryId: String.fromCharCode(97 + i),
      teamName: e.teamName,
    })),
    advancement: null,
  });
  assert.equal(finalize.canFinalize, true, finalize.message);

  // H2H 用の getFinalsRoundLabel(bracketSize=8) だと round2=準決勝になるが、multi は決勝
  const grouped = groupBracketMatchesByRound(bracket);
  assert.equal(grouped.find((r) => r.roundNumber === 2)?.roundLabel, "決勝");
  assert.equal(grouped.find((r) => r.roundNumber === 1)?.roundLabel, "準決勝");
}

console.log("multi-team-final-round.test.mjs: all passed");
