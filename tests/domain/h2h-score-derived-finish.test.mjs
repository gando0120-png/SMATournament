/**
 * 得点から終了理由を自動導出する入力仕様
 */
import assert from "node:assert/strict";
import {
  BOTH_TEAMS_FIFTY_MESSAGE,
  SCORE_INVALID_MESSAGE,
  SCORE_REQUIRED_MESSAGE,
  deriveSetFinishReasonFromScores,
  inferSetFinishReasonForEdit,
} from "../../js/domain/h2h-set-finish.js";
import { validateMatchResultInput } from "../../js/domain/qualifying-match-result.js";
import { validateFinalsMatchResultInput } from "../../js/domain/finals-match-result.js";
import {
  reconcileSubmissions,
  validateOwnSideScores,
} from "../../js/domain/player-qualifying-submission.js";

function q(input) {
  return validateMatchResultInput(input);
}

function f(input, options = {}) {
  return validateFinalsMatchResultInput(input, { winsRequired: 2, ...options });
}

const scheduleMatch = {
  matchId: "m1",
  team1: { entryId: "a", teamName: "A" },
  team2: { entryId: "b", teamName: "B" },
  blockId: "b1",
  roundNumber: 1,
  courtNumber: 1,
};

// valid scores
{
  const fiftyForty = deriveSetFinishReasonFromScores(50, 40);
  assert.equal(fiftyForty.valid, true);
  assert.equal(fiftyForty.finishReason, "normal");

  const fortyFifty = deriveSetFinishReasonFromScores(40, 50);
  assert.equal(fortyFifty.valid, true);
  assert.equal(fortyFifty.finishReason, "normal");

  const underFifty = deriveSetFinishReasonFromScores(42, 37);
  assert.equal(underFifty.valid, true);
  assert.equal(underFifty.finishReason, "time_limit");

  const zeroZero = deriveSetFinishReasonFromScores(0, 0);
  assert.equal(zeroZero.valid, true);
  assert.equal(zeroZero.finishReason, "time_limit");

  const draw = deriveSetFinishReasonFromScores(38, 38);
  assert.equal(draw.valid, true);
  assert.equal(draw.finishReason, "time_limit");
}

// invalid scores
{
  const bothFifty = deriveSetFinishReasonFromScores(50, 50);
  assert.equal(bothFifty.valid, false);
  assert.equal(bothFifty.message, BOTH_TEAMS_FIFTY_MESSAGE);

  const qBothFifty = q({
    set1Team1Score: 50,
    set1Team2Score: 50,
    set2Team1Score: 50,
    set2Team2Score: 20,
  });
  assert.equal(qBothFifty.valid, false);
  assert.equal(qBothFifty.message, BOTH_TEAMS_FIFTY_MESSAGE);

  const fBothFifty = f({
    set1Team1Score: 50,
    set1Team2Score: 50,
    set2Team1Score: 50,
    set2Team2Score: 20,
  });
  assert.equal(fBothFifty.valid, false);
  assert.equal(fBothFifty.message, BOTH_TEAMS_FIFTY_MESSAGE);

  const negative = q({
    set1Team1Score: -1,
    set1Team2Score: 10,
    set2Team1Score: 50,
    set2Team2Score: 20,
  });
  assert.equal(negative.valid, false);
  assert.equal(negative.message, SCORE_INVALID_MESSAGE);

  const notNumber = q({
    set1Team1Score: "ab",
    set1Team2Score: 10,
    set2Team1Score: 50,
    set2Team2Score: 20,
  });
  assert.equal(notNumber.valid, false);
  assert.equal(notNumber.message, SCORE_INVALID_MESSAGE);

  const over = q({
    set1Team1Score: 51,
    set1Team2Score: 10,
    set2Team1Score: 50,
    set2Team2Score: 20,
  });
  assert.equal(over.valid, false);
  assert.equal(over.message, SCORE_INVALID_MESSAGE);

  const empty = q({
    set1Team1Score: "",
    set1Team2Score: 10,
    set2Team1Score: 50,
    set2Team2Score: 20,
  });
  assert.equal(empty.valid, false);
  assert.equal(empty.message, SCORE_REQUIRED_MESSAGE);
}

// qualifying match: draws allowed, 50未満は time_limit
{
  const qValid = q({
    set1Team1Score: 50,
    set1Team2Score: 40,
    set2Team1Score: 42,
    set2Team2Score: 37,
  });
  assert.equal(qValid.valid, true);
  assert.equal(qValid.data.sets[0].finishReason, "normal");
  assert.equal(qValid.data.sets[1].finishReason, "time_limit");

  const qDraw = q({
    set1Team1Score: 38,
    set1Team2Score: 38,
    set2Team1Score: 0,
    set2Team2Score: 0,
  });
  assert.equal(qDraw.valid, true);
  assert.equal(qDraw.data.sets[0].result, "draw");
  assert.equal(qDraw.data.sets[0].finishReason, "time_limit");
  assert.equal(qDraw.data.sets[1].result, "draw");
  assert.equal(qDraw.data.team1Stats.setDraws, 2);
}

// finals: no draw, mixed normal + time_limit, 2先 / 3先
{
  const mixed = f({
    set1Team1Score: 50,
    set1Team2Score: 40,
    set2Team1Score: 42,
    set2Team2Score: 37,
  });
  assert.equal(mixed.valid, true);
  assert.equal(mixed.data.sets[0].finishReason, "normal");
  assert.equal(mixed.data.sets[1].finishReason, "time_limit");
  assert.equal(mixed.data.winnerSide, "team1");

  const finalsDraw = f({
    set1Team1Score: 38,
    set1Team2Score: 38,
    set2Team1Score: 50,
    set2Team2Score: 20,
  });
  assert.equal(finalsDraw.valid, false);

  const threeWins = f(
    {
      set1Team1Score: 50,
      set1Team2Score: 20,
      set2Team1Score: 44,
      set2Team2Score: 41,
      set3Team1Score: 50,
      set3Team2Score: 30,
    },
    { winsRequired: 3 }
  );
  assert.equal(threeWins.valid, true);
  assert.equal(threeWins.data.sets[1].finishReason, "time_limit");
  assert.equal(threeWins.data.winnerSide, "team1");
}

// past time_limit data still readable
{
  assert.equal(
    inferSetFinishReasonForEdit({
      team1Score: 42,
      team2Score: 37,
      finishReason: "time_limit",
    }),
    "time_limit"
  );
  const old = q({
    set1Team1Score: 42,
    set1Team2Score: 37,
    set1FinishReason: "time_limit",
    set2Team1Score: 50,
    set2Team2Score: 20,
    set2FinishReason: "normal",
  });
  assert.equal(old.valid, true);
  assert.equal(old.data.sets[0].finishReason, "time_limit");
}

// player submissions: scores only, reasons auto
{
  const own = validateOwnSideScores({ set1OwnScore: 42, set2OwnScore: 37 });
  assert.equal(own.valid, true);
  assert.equal(own.data.set1FinishReason, undefined);

  const matched = reconcileSubmissions({
    submissionA: { set1OwnScore: 42, set2OwnScore: 37, entryId: "a", side: "team1" },
    submissionB: { set1OwnScore: 37, set2OwnScore: 42, entryId: "b", side: "team2" },
    scheduleMatch,
    officialExists: false,
  });
  assert.equal(matched.ok, true);
  assert.equal(matched.officialPayload.sets[0].finishReason, "time_limit");
  assert.equal(matched.officialPayload.sets[1].finishReason, "time_limit");

  const mixedLegacy = reconcileSubmissions({
    submissionA: {
      set1OwnScore: 42,
      set2OwnScore: 50,
      set1FinishReason: "time_limit",
      entryId: "a",
      side: "team1",
    },
    submissionB: { set1OwnScore: 37, set2OwnScore: 20, entryId: "b", side: "team2" },
    scheduleMatch,
    officialExists: false,
  });
  assert.equal(mixedLegacy.ok, true);
  assert.equal(mixedLegacy.officialPayload.sets[0].finishReason, "time_limit");
  assert.equal(mixedLegacy.officialPayload.sets[1].finishReason, "normal");
}

console.log("h2h-score-derived-finish.test.mjs: all passed");
