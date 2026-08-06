/**
 * プレイヤー予選提出・照合のドメインテスト
 */
import assert from "node:assert/strict";
import {
  buildSubmissionDocId,
  submissionScoresEqual,
  resolveMatchSide,
  assertPlayerSubmissionAllowed,
  reconcileSubmissions,
  resolvePlayerMatchUiStatus,
  resolveReconciliationState,
  getOperatorReconciliationLabel,
  PlayerMatchUiStatus,
  MatchReconciliationState,
} from "../../js/domain/player-qualifying-submission.js";

assert.equal(buildSubmissionDocId("m1", "e1"), "m1_e1");

assert.equal(
  submissionScoresEqual(
    { set1Team1Score: 1, set1Team2Score: 2, set2Team1Score: 3, set2Team2Score: 4 },
    { set1Team1Score: "1", set1Team2Score: "2", set2Team1Score: "3", set2Team2Score: "4" }
  ),
  true
);
assert.equal(
  submissionScoresEqual(
    { set1Team1Score: 1, set1Team2Score: 2, set2Team1Score: 3, set2Team2Score: 4 },
    { set1Team1Score: 1, set1Team2Score: 2, set2Team1Score: 3, set2Team2Score: 5 }
  ),
  false
);

const match = {
  matchId: "m1",
  team1: { entryId: "a", teamName: "A" },
  team2: { entryId: "b", teamName: "B" },
  blockId: "b1",
  roundNumber: 1,
  courtNumber: 1,
};
assert.equal(resolveMatchSide(match, "a"), "team1");
assert.equal(resolveMatchSide(match, "b"), "team2");
assert.equal(resolveMatchSide(match, "x"), null);

assert.equal(
  assertPlayerSubmissionAllowed({ participantResultEntryEnabled: true, status: "open" }).allowed,
  true
);
assert.equal(
  assertPlayerSubmissionAllowed({ participantResultEntryEnabled: false, status: "open" }).allowed,
  false
);
assert.equal(
  assertPlayerSubmissionAllowed(
    { participantResultEntryEnabled: true, status: "open" },
    { hasFinalsAdvancement: true }
  ).allowed,
  false
);

const scoresOk = {
  set1Team1Score: 50,
  set1Team2Score: 30,
  set2Team1Score: 40,
  set2Team2Score: 50,
};
const scoresBad = {
  set1Team1Score: 50,
  set1Team2Score: 30,
  set2Team1Score: 41,
  set2Team2Score: 50,
};

{
  const result = reconcileSubmissions({
    submissionA: { ...scoresOk, entryId: "a", side: "team1" },
    submissionB: { ...scoresOk, entryId: "b", side: "team2" },
    scheduleMatch: match,
    officialExists: false,
  });
  assert.equal(result.ok, true);
  assert.equal(result.state, MatchReconciliationState.MATCHED);
  assert.equal(result.officialPayload.status, "finished");
  assert.equal(result.officialPayload.team1Stats.setWins, 1);
  assert.equal(result.officialPayload.team2Stats.setWins, 1);
}

{
  const result = reconcileSubmissions({
    submissionA: { ...scoresOk, entryId: "a", side: "team1" },
    submissionB: { ...scoresBad, entryId: "b", side: "team2" },
    scheduleMatch: match,
    officialExists: false,
  });
  assert.equal(result.ok, false);
  assert.equal(result.state, MatchReconciliationState.CONFLICT);
}

assert.equal(
  resolvePlayerMatchUiStatus({ mySubmission: scoresOk }),
  PlayerMatchUiStatus.AWAITING_OPPONENT
);
assert.equal(
  resolvePlayerMatchUiStatus({
    mySubmission: scoresOk,
    opponentSubmission: scoresOk,
    officialResult: { status: "finished" },
  }),
  PlayerMatchUiStatus.OFFICIAL
);
assert.equal(
  resolvePlayerMatchUiStatus({
    mySubmission: scoresOk,
    opponentSubmission: scoresBad,
    reconciliation: { state: MatchReconciliationState.CONFLICT },
  }),
  PlayerMatchUiStatus.CONFLICT
);

assert.equal(
  resolveReconciliationState({
    team1EntryId: "a",
    team2EntryId: "b",
    team1Submitted: true,
    team2Submitted: false,
    officialExists: false,
    scoresMatch: null,
  }),
  MatchReconciliationState.AWAITING_OPPONENT
);

assert.match(
  getOperatorReconciliationLabel(MatchReconciliationState.AWAITING_OPPONENT, {
    team1Submitted: true,
    team2Submitted: false,
    team2Name: "Team B",
  }),
  /Team B/
);

console.log("player-qualifying-submission.test.mjs: all passed");
