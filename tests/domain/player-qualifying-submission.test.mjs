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
  normalizeTeamNumber,
  formatTeamNumber,
  planTeamNumberAssignments,
  resolveEntryIdByTeamNumber,
  combineOneSidedSubmissions,
  validateOwnSideScores,
  extractOwnSideScores,
  buildTournamentPlayerResultsUrl,
  buildPlayerTeamChoices,
  filterPlayerTeamChoices,
  formatPlayerTeamChoiceLabel,
  PlayerMatchUiStatus,
  MatchReconciliationState,
} from "../../js/domain/player-qualifying-submission.js";

assert.equal(buildSubmissionDocId("m1", "e1"), "m1_e1");

assert.deepEqual(normalizeTeamNumber("01"), { valid: true, value: 1 });
assert.deepEqual(normalizeTeamNumber("1"), { valid: true, value: 1 });
assert.deepEqual(normalizeTeamNumber(7), { valid: true, value: 7 });
assert.deepEqual(normalizeTeamNumber("07"), { valid: true, value: 7 });
assert.equal(normalizeTeamNumber("0").valid, false);
assert.equal(normalizeTeamNumber("abc").valid, false);
assert.equal(formatTeamNumber(7, 2), "07");
assert.equal(formatTeamNumber(64, 2), "64");

{
  const plan = planTeamNumberAssignments([
    { id: "a", dummyIndex: 1 },
    { id: "b", dummyIndex: 2 },
    { id: "c" },
  ]);
  assert.equal(plan.byEntryId.get("a"), 1);
  assert.equal(plan.byEntryId.get("b"), 2);
  assert.equal(plan.byEntryId.get("c"), 3);
}

{
  const entries = [
    { id: "e1", status: "confirmed", teamName: "T1", teamNumber: 1 },
    { id: "e7", status: "confirmed", teamName: "T7", teamNumber: 7 },
    { id: "e64", status: "confirmed", teamName: "T64", teamNumber: 64 },
  ];
  assert.equal(resolveEntryIdByTeamNumber(entries, "01").entryId, "e1");
  assert.equal(resolveEntryIdByTeamNumber(entries, "1").entryId, "e1");
  assert.equal(resolveEntryIdByTeamNumber(entries, "07").entryId, "e7");
  assert.equal(resolveEntryIdByTeamNumber(entries, 64).entryId, "e64");
  assert.equal(resolveEntryIdByTeamNumber(entries, "99").ok, false);
}

assert.deepEqual(
  combineOneSidedSubmissions(
    { set1OwnScore: 50, set2OwnScore: 30 },
    { set1OwnScore: 20, set2OwnScore: 50 }
  ),
  {
    set1Team1Score: 50,
    set1Team2Score: 20,
    set2Team1Score: 30,
    set2Team2Score: 50,
  }
);

assert.equal(validateOwnSideScores({ set1OwnScore: 50, set2OwnScore: 12 }).valid, true);
assert.equal(validateOwnSideScores({ set1OwnScore: "", set2OwnScore: 12 }).valid, false);

assert.deepEqual(
  extractOwnSideScores(
    { set1Team1Score: 50, set1Team2Score: 10, set2Team1Score: 20, set2Team2Score: 50 },
    "team1"
  ),
  { set1OwnScore: 50, set2OwnScore: 20 }
);

assert.equal(
  submissionScoresEqual(
    { set1Team1Score: 1, set1Team2Score: 2, set2Team1Score: 3, set2Team2Score: 4 },
    { set1Team1Score: "1", set1Team2Score: "2", set2Team1Score: "3", set2Team2Score: "4" }
  ),
  true
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

{
  const result = reconcileSubmissions({
    submissionA: { set1OwnScore: 50, set2OwnScore: 30, entryId: "a", side: "team1" },
    submissionB: { set1OwnScore: 20, set2OwnScore: 50, entryId: "b", side: "team2" },
    scheduleMatch: match,
    officialExists: false,
  });
  assert.equal(result.ok, true);
  assert.equal(result.state, MatchReconciliationState.MATCHED);
  assert.equal(result.officialPayload.status, "finished");
}

{
  // 両チーム50点はバリデーション失敗 → conflict（推測補完なし）
  const result = reconcileSubmissions({
    submissionA: { set1OwnScore: 50, set2OwnScore: 30, entryId: "a", side: "team1" },
    submissionB: { set1OwnScore: 50, set2OwnScore: 50, entryId: "b", side: "team2" },
    scheduleMatch: match,
    officialExists: false,
  });
  assert.equal(result.ok, false);
  assert.equal(result.state, MatchReconciliationState.CONFLICT);
}

assert.equal(
  resolvePlayerMatchUiStatus({ mySubmission: { set1OwnScore: 1 }, opponentSubmission: null }),
  PlayerMatchUiStatus.AWAITING_OPPONENT
);
assert.equal(
  resolveReconciliationState({
    team1Submitted: true,
    team2Submitted: false,
    officialExists: false,
    scoresMatch: null,
  }),
  MatchReconciliationState.AWAITING_OPPONENT
);
assert.match(getOperatorReconciliationLabel(MatchReconciliationState.CONFLICT), /不一致/);

assert.match(buildTournamentPlayerResultsUrl("tid123"), /tournamentId=tid123/);
assert.doesNotMatch(buildTournamentPlayerResultsUrl("tid123"), /teamToken/);

{
  const { choices } = buildPlayerTeamChoices(
    [
      { id: "e1", status: "confirmed", teamName: "庄内アルファ", teamNumber: 7 },
      { id: "e2", status: "confirmed", teamName: "庄内ベータ", teamNumber: 21 },
      { id: "e3", status: "confirmed", teamName: "普通チーム", teamNumber: 3 },
      { id: "e4", status: "pending", teamName: "未確定", teamNumber: 4 },
      { id: "e5", status: "cancelled", teamName: "辞退", teamNumber: 5 },
    ],
    { maxTeams: 64 }
  );
  assert.equal(choices.length, 3);
  assert.deepEqual(
    choices.map((c) => c.teamNumberLabel),
    ["03", "07", "21"]
  );
  assert.ok(!JSON.stringify(choices).includes("entryId"));
  assert.ok(!JSON.stringify(choices).includes('"e1"'));

  const byNum = filterPlayerTeamChoices(choices, "07");
  assert.equal(byNum.length, 1);
  assert.equal(byNum[0].teamNumber, 7);

  const byName = filterPlayerTeamChoices(choices, "庄内");
  assert.equal(byName.length, 2);
  assert.equal(filterPlayerTeamChoices(choices, "存在しない").length, 0);
  assert.equal(formatPlayerTeamChoiceLabel(choices[1]), "07　庄内アルファ");
}

console.log("player-qualifying-submission.test.mjs: all passed");
