/**
 * H2H セット終了理由（normal / time_limit）ドメインテスト
 */
import assert from "node:assert/strict";
import {
  SetFinishReason,
  deriveH2HSetOutcome,
  deriveLegacyH2HSetResult,
  inferSetFinishReasonForEdit,
} from "../../js/domain/h2h-set-finish.js";
import {
  validateMatchResultInput,
  buildMatchResultInitialValues,
  computeTeamStatsFromSets,
} from "../../js/domain/qualifying-match-result.js";
import {
  validateFinalsMatchResultInput,
  deriveFinalsSetWinner,
  buildFinalsMatchResultInitialValues,
} from "../../js/domain/finals-match-result.js";
import { buildValidatedLossBandMatchResult } from "../../js/domain/loss-band/persistence.js";
import {
  reconcileSubmissions,
  validateOwnSideScores,
  MatchReconciliationState,
} from "../../js/domain/player-qualifying-submission.js";

function q(input, options) {
  return validateMatchResultInput(input, options);
}

function f(input, options = {}) {
  return validateFinalsMatchResultInput(input, { winsRequired: 2, ...options });
}

// --- shared derive ---
{
  const ok = deriveH2HSetOutcome({
    team1Score: 50,
    team2Score: 32,
    finishReason: SetFinishReason.NORMAL,
  });
  assert.equal(ok.valid, true);
  assert.equal(ok.winner, "team1");

  const ng = deriveH2HSetOutcome({
    team1Score: 46,
    team2Score: 40,
    finishReason: SetFinishReason.NORMAL,
  });
  assert.equal(ng.valid, false);
  assert.match(ng.message, /通常終了では勝者が50点/);

  const tl1 = deriveH2HSetOutcome({
    team1Score: 46,
    team2Score: 40,
    finishReason: SetFinishReason.TIME_LIMIT,
  });
  assert.equal(tl1.valid, true);
  assert.equal(tl1.winner, "team1");

  const tl2 = deriveH2HSetOutcome({
    team1Score: 40,
    team2Score: 46,
    finishReason: SetFinishReason.TIME_LIMIT,
  });
  assert.equal(tl2.valid, true);
  assert.equal(tl2.winner, "team2");

  const drawOk = deriveH2HSetOutcome({
    team1Score: 40,
    team2Score: 40,
    finishReason: SetFinishReason.TIME_LIMIT,
    allowDraw: true,
  });
  assert.equal(drawOk.valid, true);
  assert.equal(drawOk.result, "draw");

  const drawNg = deriveH2HSetOutcome({
    team1Score: 40,
    team2Score: 40,
    finishReason: SetFinishReason.TIME_LIMIT,
    allowDraw: false,
  });
  assert.equal(drawNg.valid, false);
  assert.match(drawNg.message, /時間切れ時に同点/);

  const fiftyAsTimeLimit = deriveH2HSetOutcome({
    team1Score: 50,
    team2Score: 32,
    finishReason: SetFinishReason.TIME_LIMIT,
  });
  assert.equal(fiftyAsTimeLimit.valid, false);
  assert.match(fiftyAsTimeLimit.message, /通常終了/);
}

// --- qualifying 1-7 ---
{
  // 1
  const t1 = q({
    set1Team1Score: 50,
    set1Team2Score: 32,
    set1FinishReason: "normal",
    set2Team1Score: 50,
    set2Team2Score: 20,
    set2FinishReason: "normal",
  });
  assert.equal(t1.valid, true);
  assert.equal(t1.data.sets[0].result, "team1");

  // 2
  const t2 = q(
    {
      set1Team1Score: 46,
      set1Team2Score: 40,
      set1FinishReason: "normal",
      set2Team1Score: 50,
      set2Team2Score: 20,
      set2FinishReason: "normal",
    },
    { requireFinishReason: true }
  );
  assert.equal(t2.valid, false);
  assert.match(t2.message, /通常終了では勝者が50点/);

  // 3
  const t3 = q({
    set1Team1Score: 46,
    set1Team2Score: 40,
    set1FinishReason: "time_limit",
    set2Team1Score: 50,
    set2Team2Score: 20,
    set2FinishReason: "normal",
  });
  assert.equal(t3.valid, true);
  assert.equal(t3.data.sets[0].result, "team1");
  assert.equal(t3.data.sets[0].finishReason, "time_limit");

  // 4
  const t4 = q({
    set1Team1Score: 40,
    set1Team2Score: 46,
    set1FinishReason: "time_limit",
    set2Team1Score: 50,
    set2Team2Score: 20,
    set2FinishReason: "normal",
  });
  assert.equal(t4.valid, true);
  assert.equal(t4.data.sets[0].result, "team2");

  // 5
  const t5 = q({
    set1Team1Score: 40,
    set1Team2Score: 40,
    set1FinishReason: "time_limit",
    set2Team1Score: 50,
    set2Team2Score: 20,
    set2FinishReason: "normal",
  });
  assert.equal(t5.valid, true);
  assert.equal(t5.data.sets[0].result, "draw");

  // 6 + 7 aggregation
  const t6 = q({
    set1Team1Score: 50,
    set1Team2Score: 32,
    set1FinishReason: "normal",
    set2Team1Score: 46,
    set2Team2Score: 40,
    set2FinishReason: "time_limit",
  });
  assert.equal(t6.valid, true);
  assert.equal(t6.data.team1Stats.setWins, 2);
  assert.equal(t6.data.team1Stats.totalScore, 96);
  assert.equal(t6.data.team2Stats.totalScore, 72);
  const stats = computeTeamStatsFromSets(t6.data.sets);
  assert.equal(stats.team1Stats.setWins, 2);
}

// --- finals 8-15 ---
{
  // 8
  const t8 = f({
    set1Team1Score: 50,
    set1Team2Score: 32,
    set1FinishReason: "normal",
    set2Team1Score: 50,
    set2Team2Score: 10,
    set2FinishReason: "normal",
  });
  assert.equal(t8.valid, true);
  assert.equal(t8.data.winnerSide, "team1");

  // 9
  const t9 = f({
    set1Team1Score: 46,
    set1Team2Score: 40,
    set1FinishReason: "normal",
    set2Team1Score: 50,
    set2Team2Score: 10,
    set2FinishReason: "normal",
  });
  assert.equal(t9.valid, false);
  assert.match(t9.message, /通常終了では勝者が50点/);

  // 10
  const t10 = f({
    set1Team1Score: 46,
    set1Team2Score: 40,
    set1FinishReason: "time_limit",
    set2Team1Score: 50,
    set2Team2Score: 10,
    set2FinishReason: "normal",
  });
  assert.equal(t10.valid, true);
  assert.equal(t10.data.sets[0].winner, "team1");

  // 11
  const t11 = f({
    set1Team1Score: 40,
    set1Team2Score: 46,
    set1FinishReason: "time_limit",
    set2Team1Score: 10,
    set2Team2Score: 50,
    set2FinishReason: "normal",
  });
  assert.equal(t11.valid, true);
  assert.equal(t11.data.sets[0].winner, "team2");
  assert.equal(t11.data.winnerSide, "team2");

  // 12
  const t12 = f({
    set1Team1Score: 40,
    set1Team2Score: 40,
    set1FinishReason: "time_limit",
    set2Team1Score: 50,
    set2Team2Score: 10,
    set2FinishReason: "normal",
  });
  assert.equal(t12.valid, false);
  assert.match(t12.message, /時間切れ時に同点/);

  // 13 mixed + 14 best of 3 (2 wins)
  const t13 = f({
    set1Team1Score: 50,
    set1Team2Score: 40,
    set1FinishReason: "normal",
    set2Team1Score: 42,
    set2Team2Score: 47,
    set2FinishReason: "time_limit",
    set3Team1Score: 50,
    set3Team2Score: 30,
    set3FinishReason: "normal",
  });
  assert.equal(t13.valid, true);
  assert.equal(t13.data.team1SetWins, 2);
  assert.equal(t13.data.team2SetWins, 1);
  assert.equal(t13.data.winnerSide, "team1");
  assert.equal(t13.data.sets[1].finishReason, "time_limit");

  // 15 best of 5 (3 wins)
  const t15 = f(
    {
      set1Team1Score: 50,
      set1Team2Score: 20,
      set1FinishReason: "normal",
      set2Team1Score: 44,
      set2Team2Score: 41,
      set2FinishReason: "time_limit",
      set3Team1Score: 50,
      set3Team2Score: 30,
      set3FinishReason: "normal",
    },
    { winsRequired: 3 }
  );
  assert.equal(t15.valid, true);
  assert.equal(t15.data.winnerSide, "team1");
  assert.equal(t15.data.team1SetWins, 3);
}

// deriveFinalsSetWinner
assert.equal(deriveFinalsSetWinner(46, 40, { finishReason: "time_limit" }), "team1");
assert.equal(deriveFinalsSetWinner(46, 40, { finishReason: "normal" }), null);
assert.equal(deriveFinalsSetWinner(50, 32), "team1");

// --- 16 consolation uses same finals validator ---
{
  const consolation = f({
    set1Team1Score: 46,
    set1Team2Score: 40,
    set1FinishReason: "time_limit",
    set2Team1Score: 50,
    set2Team2Score: 12,
    set2FinishReason: "normal",
  });
  assert.equal(consolation.valid, true);
}

// --- 17-20 loss-band ---
{
  const match = {
    matchId: "lb1",
    roundNumber: 1,
    lossCount: 0,
    team1EntryId: "a",
    team2EntryId: "b",
    purpose: "ranking",
  };
  const built = buildValidatedLossBandMatchResult({
    match,
    matchNumber: 1,
    team1: { entryId: "a", teamName: "A", seed: 1 },
    team2: { entryId: "b", teamName: "B", seed: 2 },
    scoreInput: {
      set1Team1Score: 46,
      set1Team2Score: 40,
      set1FinishReason: "time_limit",
      set2Team1Score: 50,
      set2Team2Score: 10,
      set2FinishReason: "normal",
    },
    winsRequired: 2,
  });
  assert.equal(built.valid, true, built.message);
  assert.equal(built.data.winnerSide, "team1");
  assert.equal(built.data.sets[0].finishReason, "time_limit");

  for (const purpose of ["final", "third_place", "exchange"]) {
    const lb = buildValidatedLossBandMatchResult({
      match: { ...match, purpose, matchId: `lb-${purpose}` },
      matchNumber: 1,
      team1: { entryId: "a", teamName: "A", seed: 1 },
      team2: { entryId: "b", teamName: "B", seed: 2 },
      scoreInput: {
        set1Team1Score: 42,
        set1Team2Score: 37,
        set1FinishReason: "time_limit",
        set2Team1Score: 50,
        set2Team2Score: 20,
        set2FinishReason: "normal",
      },
      winsRequired: 2,
    });
    assert.equal(lb.valid, true, `${purpose}: ${lb.message}`);
  }

  const drawNg = buildValidatedLossBandMatchResult({
    match,
    matchNumber: 1,
    team1: { entryId: "a", teamName: "A", seed: 1 },
    team2: { entryId: "b", teamName: "B", seed: 2 },
    scoreInput: {
      set1Team1Score: 40,
      set1Team2Score: 40,
      set1FinishReason: "time_limit",
      set2Team1Score: 50,
      set2Team2Score: 20,
      set2FinishReason: "normal",
    },
    winsRequired: 2,
  });
  assert.equal(drawNg.valid, false);
}

// --- 21 result edit initial values ---
{
  const qInit = buildMatchResultInitialValues({
    sets: [
      { setNumber: 1, team1Score: 46, team2Score: 40, result: "team1", finishReason: "normal" },
      { setNumber: 2, team1Score: 50, team2Score: 20, result: "team1", finishReason: "normal" },
    ],
  });
  assert.equal(qInit.set1FinishReason, "normal");
  const qInitLegacy = buildMatchResultInitialValues({
    sets: [
      { setNumber: 1, team1Score: 46, team2Score: 40, result: "team1" },
      { setNumber: 2, team1Score: 50, team2Score: 20, result: "team1" },
    ],
  });
  assert.equal(qInitLegacy.set1FinishReason, "time_limit");
  assert.equal(qInitLegacy.set2FinishReason, "normal");

  const fInit = buildFinalsMatchResultInitialValues({
    sets: [
      { setNumber: 1, team1Score: 46, team2Score: 40, winner: "team1", finishReason: "time_limit" },
      { setNumber: 2, team1Score: 50, team2Score: 10, winner: "team1" },
    ],
  });
  assert.equal(fInit.set1FinishReason, "time_limit");
  assert.equal(fInit.set2FinishReason, "normal");
  assert.equal(inferSetFinishReasonForEdit({ team1Score: 50, team2Score: 10 }), "normal");
}

// --- 22 legacy read without finishReason ---
{
  const legacy = q({
    set1Team1Score: 46,
    set1Team2Score: 40,
    set2Team1Score: 50,
    set2Team2Score: 20,
  });
  assert.equal(legacy.valid, true);
  assert.equal(legacy.data.sets[0].result, "team1");
  assert.equal(legacy.data.sets[0].finishReason, undefined);
  assert.equal(deriveLegacyH2HSetResult(46, 40, { allowDraw: true }), "team1");
}

// --- 23 player qualifying ---
{
  const scheduleMatch = {
    matchId: "m1",
    team1: { entryId: "a", teamName: "A" },
    team2: { entryId: "b", teamName: "B" },
    blockId: "b1",
    roundNumber: 1,
    courtNumber: 1,
  };
  const ownOk = validateOwnSideScores({
    set1OwnScore: 46,
    set2OwnScore: 50,
    set1FinishReason: "time_limit",
    set2FinishReason: "normal",
  });
  assert.equal(ownOk.valid, true);

  const matched = reconcileSubmissions({
    submissionA: {
      set1OwnScore: 46,
      set2OwnScore: 50,
      set1FinishReason: "time_limit",
      set2FinishReason: "normal",
      entryId: "a",
      side: "team1",
    },
    submissionB: {
      set1OwnScore: 40,
      set2OwnScore: 20,
      set1FinishReason: "time_limit",
      set2FinishReason: "normal",
      entryId: "b",
      side: "team2",
    },
    scheduleMatch,
    officialExists: false,
  });
  assert.equal(matched.ok, true);
  assert.equal(matched.officialPayload.sets[0].finishReason, "time_limit");

  const conflictReason = reconcileSubmissions({
    submissionA: {
      set1OwnScore: 50,
      set2OwnScore: 50,
      set1FinishReason: "normal",
      set2FinishReason: "normal",
      entryId: "a",
      side: "team1",
    },
    submissionB: {
      set1OwnScore: 20,
      set2OwnScore: 20,
      set1FinishReason: "time_limit",
      set2FinishReason: "normal",
      entryId: "b",
      side: "team2",
    },
    scheduleMatch,
    officialExists: false,
  });
  assert.equal(conflictReason.ok, false);
  assert.equal(conflictReason.state, MatchReconciliationState.CONFLICT);

  const legacyPlayer = reconcileSubmissions({
    submissionA: { set1OwnScore: 50, set2OwnScore: 30, entryId: "a", side: "team1" },
    submissionB: { set1OwnScore: 20, set2OwnScore: 50, entryId: "b", side: "team2" },
    scheduleMatch,
    officialExists: false,
  });
  assert.equal(legacyPlayer.ok, true);
}

console.log("h2h-set-finish-reason.test.mjs: all passed");
