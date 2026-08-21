/**
 * 決勝 / consolation / multi — 次ラウンド全体ロックのドメインテスト
 */
import assert from "node:assert/strict";
import {
  FinalsMatchResolution,
  MatchResultStatus,
  MatchSessionStatus,
} from "../../js/domain/constants.js";
import { MatchFormat } from "../../js/domain/aggregate-match-format.js";
import {
  FinalsMatchDisplayStatus,
  FINALS_MATCH_RESULT_EDIT_LOCKED_MESSAGE,
  canEditFinalsMatchResult,
  canModifyFinalsMatchResult,
  getFinalsBracketMatchAction,
  getMultiTeamBracketMatchAction,
  isNextRoundStartedForMatch,
  listNextRoundMatchIds,
} from "../../js/domain/finals-match-progress.js";

function team(entryId, name = entryId) {
  return { entryId, teamName: name, seed: 1, isBye: false };
}

function playedResult(winnerEntryId) {
  return {
    status: MatchResultStatus.FINISHED,
    resolution: FinalsMatchResolution.PLAYED,
    winner: team(winnerEntryId),
  };
}

function byeResult(winnerEntryId) {
  return {
    status: MatchResultStatus.FINISHED,
    resolution: FinalsMatchResolution.BYE,
    winner: team(winnerEntryId),
  };
}

/** 簡易 4 チーム SE ブラケット（R1 x2 → R2 final） */
function buildSeBracket() {
  return {
    finalized: true,
    matches: [
      {
        matchId: "r1m1",
        roundNumber: 1,
        nextMatchId: "r2m1",
        nextTeamSlot: "team1",
        team1: team("a"),
        team2: team("b"),
      },
      {
        matchId: "r1m2",
        roundNumber: 1,
        nextMatchId: "r2m1",
        nextTeamSlot: "team2",
        team1: team("c"),
        team2: team("d"),
      },
      {
        matchId: "r2m1",
        roundNumber: 2,
        nextMatchId: null,
        isFinal: true,
        team1: null,
        team2: null,
      },
    ],
  };
}

/** consolation も同じ roundNumber 構造で判定する */
function buildConsolationBracket() {
  const bracket = buildSeBracket();
  bracket.matches = bracket.matches.map((m) => ({
    ...m,
    matchId: `c-${m.matchId}`,
    nextMatchId: m.nextMatchId ? `c-${m.nextMatchId}` : null,
  }));
  return bracket;
}

/** multi: R1 2試合 → R2 */
function buildMultiBracket() {
  return {
    finalized: true,
    matches: [
      {
        matchId: "mt-r1m1",
        roundNumber: 1,
        nextMatchId: "mt-r2m1",
        matchFormat: MatchFormat.MULTI_TEAM_TOTAL,
        qualifiersCount: 1,
        participants: [team("a"), team("b"), team("c")],
      },
      {
        matchId: "mt-r1m2",
        roundNumber: 1,
        nextMatchId: "mt-r2m1",
        matchFormat: MatchFormat.MULTI_TEAM_TOTAL,
        qualifiersCount: 1,
        participants: [team("d"), team("e"), team("f")],
      },
      {
        matchId: "mt-r2m1",
        roundNumber: 2,
        nextMatchId: null,
        isFinal: true,
        matchFormat: MatchFormat.MULTI_TEAM_TOTAL,
        qualifiersCount: 1,
        participants: [],
      },
    ],
  };
}

function assertRoundLockSuite(label, bracket, r1MatchId, r2MatchId, otherR1MatchId) {
  const r1 = bracket.matches.find((m) => m.matchId === r1MatchId);
  const otherR1 = bracket.matches.find((m) => m.matchId === otherR1MatchId);
  assert.ok(r1 && otherR1, `${label}: matches exist`);

  assert.deepEqual(listNextRoundMatchIds(bracket, r1), [r2MatchId]);

  const baseResults = new Map([
    [r1MatchId, playedResult("a")],
    [otherR1MatchId, playedResult("c")],
  ]);
  const emptySessions = new Map();

  // 1. R2未開始 → R1結果修正可能
  {
    const gate = canEditFinalsMatchResult({
      match: r1,
      bracket,
      resultsMap: baseResults,
      sessionsMap: emptySessions,
    });
    assert.equal(gate.allowed, true, `${label}: R2未開始は編集可`);
    assert.equal(
      isNextRoundStartedForMatch({
        match: r1,
        bracket,
        resultsMap: baseResults,
        sessionsMap: emptySessions,
      }),
      false
    );
  }

  // 5. R2未開始 → 勝者変更可能（modify も可）
  {
    const gate = canModifyFinalsMatchResult({
      match: r1,
      bracket,
      resultsMap: baseResults,
      sessionsMap: emptySessions,
    });
    assert.equal(gate.allowed, true, `${label}: R2未開始は modify 可`);
  }

  // 2. R2の1試合 playing → R1全試合修正不可
  {
    const sessions = new Map([
      [r2MatchId, { status: MatchSessionStatus.PLAYING }],
    ]);
    for (const match of [r1, otherR1]) {
      const gate = canEditFinalsMatchResult({
        match,
        bracket,
        resultsMap: baseResults,
        sessionsMap: sessions,
      });
      assert.equal(gate.allowed, false, `${label}: R2 playing で ${match.matchId} 不可`);
      assert.equal(gate.message, FINALS_MATCH_RESULT_EDIT_LOCKED_MESSAGE);
    }
  }

  // 3. R2の1試合 finished → R1全試合修正不可
  {
    const sessions = new Map([
      [r2MatchId, { status: MatchSessionStatus.FINISHED }],
    ]);
    const gate = canModifyFinalsMatchResult({
      match: otherR1,
      bracket,
      resultsMap: baseResults,
      sessionsMap: sessions,
    });
    assert.equal(gate.allowed, false, `${label}: R2 finished で他R1も不可`);
  }

  // 4. R2に result あり → R1全試合修正不可
  {
    const results = new Map(baseResults);
    results.set(r2MatchId, playedResult("a"));
    const gate = canEditFinalsMatchResult({
      match: r1,
      bracket,
      resultsMap: results,
      sessionsMap: emptySessions,
    });
    assert.equal(gate.allowed, false, `${label}: R2 result で不可`);
  }

  // 6. R2開始後 → 同勝者のスコア修正も不可
  {
    const sessions = new Map([
      [r2MatchId, { status: MatchSessionStatus.PLAYING }],
    ]);
    const gate = canModifyFinalsMatchResult({
      match: r1,
      bracket,
      resultsMap: baseResults,
      sessionsMap: sessions,
    });
    assert.equal(gate.allowed, false, `${label}: 同勝者スコア修正も不可`);
  }

  // 7. BYE修正不可
  {
    const results = new Map([[r1MatchId, byeResult("a")]]);
    const gate = canEditFinalsMatchResult({
      match: r1,
      bracket,
      resultsMap: results,
      sessionsMap: emptySessions,
    });
    assert.equal(gate.allowed, false, `${label}: BYE不可`);
    assert.match(gate.message || "", /BYE/);
  }
}

// --- SE ---
assertRoundLockSuite("SE", buildSeBracket(), "r1m1", "r2m1", "r1m2");

// --- consolation ---
assertRoundLockSuite(
  "consolation",
  buildConsolationBracket(),
  "c-r1m1",
  "c-r2m1",
  "c-r1m2"
);

// --- multi ---
assertRoundLockSuite("multi", buildMultiBracket(), "mt-r1m1", "mt-r2m1", "mt-r1m2");

// UI actions
{
  assert.deepEqual(
    getFinalsBracketMatchAction(FinalsMatchDisplayStatus.FINISHED, {
      canEditResult: true,
    }),
    { kind: "edit_result", label: "結果を修正" }
  );
  const locked = getFinalsBracketMatchAction(FinalsMatchDisplayStatus.FINISHED, {
    canEditResult: false,
  });
  assert.equal(locked.kind, "edit_locked");
  assert.equal(locked.message, FINALS_MATCH_RESULT_EDIT_LOCKED_MESSAGE);

  assert.deepEqual(
    getMultiTeamBracketMatchAction(FinalsMatchDisplayStatus.FINISHED, {
      canEditResult: true,
    }),
    { kind: "edit_result", label: "結果を修正" }
  );
  assert.equal(
    getMultiTeamBracketMatchAction(FinalsMatchDisplayStatus.FINISHED, {
      canEditResult: false,
    }).kind,
    "edit_locked"
  );
}

// 最終ラウンド（次Rなし）は修正可
{
  const bracket = buildSeBracket();
  const finalMatch = bracket.matches.find((m) => m.matchId === "r2m1");
  const results = new Map([["r2m1", playedResult("a")]]);
  const gate = canEditFinalsMatchResult({
    match: finalMatch,
    bracket,
    resultsMap: results,
    sessionsMap: new Map(),
  });
  assert.equal(gate.allowed, true, "最終ラウンドは次Rがないので修正可");
}

// 8. closed / tournamentResults 後は UI・service 側で不可（domain ロックとは別レイヤ）
// requireOpenTournament / editsFrozen で担保。ここでは最終R以外のロック独立性を確認済み。

console.log("finals-match-result-edit-lock.test.mjs: ok");
