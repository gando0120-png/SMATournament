/**
 * Phase 3: loss-band 永続化オーケストレーション（R1→R2）
 */
import assert from "node:assert/strict";
import {
  EXPECTED_BAND_COUNTS_AT_ROUND_START,
  buildRankingRoundPairings,
  buildValidatedLossBandMatchResult,
  getActiveBandCounts,
  planAfterLossBandMatchSaved,
  planLossBandInitialize,
  pairingsFromRoundDoc,
  validateRoundTeamUniqueness,
  hasLossBandMatchSessionCreateShape,
  validateLossBandMatchSessionStructure,
  resolveLossBandSessionBackfillFromRounds,
  buildLossBandMatchSessionDoc,
} from "../../js/domain/loss-band/index.js";

function entryIds64() {
  return Array.from({ length: 64 }, (_, i) => `e${String(i + 1).padStart(2, "0")}`);
}

function team1WinsScoreInput() {
  return {
    set1Team1Score: 50,
    set1Team2Score: 10,
    set2Team1Score: 50,
    set2Team2Score: 20,
  };
}

function buildResultForMatch(match, matchNumber) {
  const built = buildValidatedLossBandMatchResult({
    match,
    matchNumber,
    team1: { entryId: match.team1EntryId, teamName: match.team1EntryId, seed: 1 },
    team2: { entryId: match.team2EntryId, teamName: match.team2EntryId, seed: 2 },
    scoreInput: team1WinsScoreInput(),
    winsRequired: 2,
  });
  assert.equal(built.valid, true, built.message);
  return built.data;
}

function run() {
  const entryIds = entryIds64();

  // init → R1 32 matches
  const init = planLossBandInitialize(entryIds, { rematchAvoidance: true });
  assert.equal(init.roundDoc.roundNumber, 1);
  assert.equal(init.roundDoc.matchIds.length, 32);
  assert.equal(init.matchPlans.length, 32);
  assert.equal(validateRoundTeamUniqueness(init.roundDoc), true);
  assert.deepEqual(getActiveBandCounts(init.domainState), { 0: 64 });

  // 1試合のみ → R1 継続、次ラウンドなし
  const firstMatch = init.pairings.matches[0];
  const firstResult = buildResultForMatch(firstMatch, 1);
  const afterOne = planAfterLossBandMatchSaved({
    stateDoc: init.stateDoc,
    roundDoc: init.roundDoc,
    priorCompletedResults: [],
    newResult: firstResult,
    rematchAvoidance: true,
  });
  assert.equal(afterOne.roundComplete, false);
  assert.equal(afterOne.nextRoundPlan, null);
  assert.equal(afterOne.nextRoundDoc.status, "open");
  assert.equal(afterOne.nextRoundDoc.completedMatchIds.length, 1);
  assert.equal(afterOne.nextStateDoc.currentRound, 1);

  // 残り31試合 → R2 生成（0敗32 / 1敗32）
  let prior = [firstResult];
  let roundDoc = afterOne.nextRoundDoc;
  let stateDoc = afterOne.nextStateDoc;
  let lastPlan = afterOne;

  for (let i = 1; i < init.pairings.matches.length; i += 1) {
    const match = init.pairings.matches[i];
    const result = buildResultForMatch(match, i + 1);
    lastPlan = planAfterLossBandMatchSaved({
      stateDoc,
      roundDoc,
      priorCompletedResults: prior,
      newResult: result,
      rematchAvoidance: true,
    });
    prior = [...prior, result];
    roundDoc = lastPlan.nextRoundDoc;
    stateDoc = lastPlan.nextStateDoc;
    if (i < init.pairings.matches.length - 1) {
      assert.equal(lastPlan.roundComplete, false);
      assert.equal(lastPlan.nextRoundPlan, null);
    }
  }

  assert.equal(lastPlan.roundComplete, true);
  assert.ok(lastPlan.nextRoundPlan);
  assert.equal(lastPlan.nextRoundPlan.roundDoc.roundNumber, 2);
  assert.equal(lastPlan.nextRoundPlan.roundDoc.matchIds.length, 32);
  assert.equal(lastPlan.nextStateDoc.currentRound, 2);
  assert.equal(lastPlan.nextStateDoc.completedRankingRound, 1);
  assert.deepEqual(
    getActiveBandCounts(lastPlan.domainStateAfterRound),
    EXPECTED_BAND_COUNTS_AT_ROUND_START[2]
  );

  // 再戦回避ONの R2 が domain 直接計算と一致
  const expectedR2 = buildRankingRoundPairings(
    lastPlan.domainStateAfterRound,
    2,
    { rematchAvoidance: true }
  );
  const fromDoc = pairingsFromRoundDoc(lastPlan.nextRoundPlan.roundDoc);
  assert.deepEqual(
    fromDoc.matches.map((m) => [m.matchId, m.team1EntryId, m.team2EntryId]),
    expectedR2.matches.map((m) => [m.matchId, m.team1EntryId, m.team2EntryId])
  );
  assert.equal(validateRoundTeamUniqueness(lastPlan.nextRoundPlan.roundDoc), true);

  // 再読込しても再ペアリングしない（同一 roundDoc）
  const reloaded = pairingsFromRoundDoc(lastPlan.nextRoundPlan.roundDoc);
  assert.deepEqual(reloaded.matches, fromDoc.matches);

  // bootstrap / builder session は Rules create 相当の必須フィールドを持つ
  for (const { match, matchNumber, session } of init.matchPlans) {
    assert.equal(
      hasLossBandMatchSessionCreateShape(session),
      true,
      `init session incomplete: ${session.matchId}`
    );
    const named = buildLossBandMatchSessionDoc(
      match,
      matchNumber,
      { entryId: match.team1EntryId, teamName: "A" },
      { entryId: match.team2EntryId, teamName: "B" }
    );
    assert.equal(hasLossBandMatchSessionCreateShape(named), true);
    assert.equal(validateLossBandMatchSessionStructure(named).valid, true);
  }
  for (const { session } of lastPlan.nextRoundPlan.matchPlans) {
    assert.equal(
      hasLossBandMatchSessionCreateShape(session),
      true,
      `next session incomplete: ${session.matchId}`
    );
  }

  // incomplete session（IAM 旧 bootstrap 形状）は保存前ガードで拒否
  const incomplete = {
    matchId: firstMatch.matchId,
    matchNumber: 1,
    matchPurpose: "ranking",
    status: "playing",
    team1EntryId: firstMatch.team1EntryId,
    team2EntryId: firstMatch.team2EntryId,
  };
  const incompleteCheck = validateLossBandMatchSessionStructure(incomplete);
  assert.equal(incompleteCheck.valid, false);
  assert.ok(incompleteCheck.missing.includes("roundNumber"));
  assert.ok(incompleteCheck.missing.includes("lossBand"));

  // backfill 解決: round pairing から一意に roundNumber/lossBand
  const resolved = resolveLossBandSessionBackfillFromRounds(
    [init.roundDoc],
    firstMatch.matchId
  );
  assert.equal(resolved.ok, true);
  assert.equal(resolved.roundNumber, 1);
  assert.equal(resolved.lossBand, firstMatch.lossCount);
  assert.equal(
    resolveLossBandSessionBackfillFromRounds([init.roundDoc], "missing-id").ok,
    false
  );

  console.log("loss-band Phase 3 persistence orchestration tests: ok");
}

run();
