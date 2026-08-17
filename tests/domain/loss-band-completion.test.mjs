/**
 * Phase 4: 順位確定・3位決定戦・完了判定
 */
import assert from "node:assert/strict";
import {
  LOSS_BAND_TEAM_COUNT,
  LOSS_BAND_RANKING_ROUND_COUNT,
  LossBandPhase,
  LossBandCompletionReasonCode,
  createInitialLossBandState,
  buildRankingRoundPairings,
  applyRankingRoundResults,
  applyFinalRankingRoundResults,
  buildFinalPairing,
  applyFinalResult,
  buildThirdPlacePairing,
  applyThirdPlaceResult,
  buildDeterministicTeam1WinsResults,
  validateCompletePlacements,
  expectedFinalPlacementCounts,
  buildPlacementRecords,
  formatLossBandPlacementLabel,
  evaluateLossBandRankingCompletion,
  canCompleteLossBandRanking,
  validateLossBandStateInvariants,
  buildLossBandPlacementsDoc,
} from "../../js/domain/loss-band/index.js";

function makeEntryIds(count = LOSS_BAND_TEAM_COUNT) {
  return Array.from({ length: count }, (_, i) =>
    `e${String(i + 1).padStart(3, "0")}`
  );
}

function simulateToAfterR5(entryIds, { thirdPlaceMatch = false } = {}) {
  let state = createInitialLossBandState(entryIds, { thirdPlaceMatch });
  for (let round = 1; round <= LOSS_BAND_RANKING_ROUND_COUNT; round += 1) {
    const pairings = buildRankingRoundPairings(state, round);
    const results = buildDeterministicTeam1WinsResults(pairings);
    if (round < LOSS_BAND_RANKING_ROUND_COUNT) {
      state = applyRankingRoundResults(state, pairings, results);
    } else {
      state = applyFinalRankingRoundResults(state, pairings, results, {
        thirdPlaceMatch,
      });
    }
  }
  return state;
}

function simulateComplete(entryIds, { thirdPlaceMatch = false, preferTeam1 = true } = {}) {
  let state = simulateToAfterR5(entryIds, { thirdPlaceMatch });
  assert.equal(state.phase, LossBandPhase.FINAL);

  const final = buildFinalPairing(state);
  const finalWinner = preferTeam1 ? final.team1EntryId : final.team2EntryId;
  state = applyFinalResult(state, finalWinner);

  if (thirdPlaceMatch) {
    assert.equal(state.phase, LossBandPhase.THIRD_PLACE);
    const third = buildThirdPlacePairing(state);
    const thirdWinner = preferTeam1 ? third.team1EntryId : third.team2EntryId;
    state = applyThirdPlaceResult(state, thirdWinner);
  }

  assert.equal(state.phase, LossBandPhase.COMPLETE);
  return state;
}

function countsFromState(state) {
  const map = new Map();
  for (const row of buildPlacementRecords(state)) {
    map.set(row.placement, (map.get(row.placement) ?? 0) + 1);
  }
  return map;
}

// ── 64チーム標準（3位タイ） ──
{
  const entryIds = makeEntryIds();
  const state = simulateComplete(entryIds, { thirdPlaceMatch: false });
  const validation = validateCompletePlacements(state, { thirdPlaceMatch: false });
  assert.equal(validation.valid, true, validation.errors.join("; "));

  const expected = expectedFinalPlacementCounts({ thirdPlaceMatch: false });
  const actual = countsFromState(state);
  for (const [placement, count] of expected) {
    assert.equal(actual.get(placement), count, `placement ${placement}`);
  }

  assert.equal(actual.get(1), 1);
  assert.equal(actual.get(2), 1);
  assert.equal(actual.get(3), 2);
  assert.equal(actual.get(5), 8);
  assert.equal(actual.get(13), 8);
  assert.equal(actual.get(21), 12);
  assert.equal(actual.get(33), 12);
  assert.equal(actual.get(45), 8);
  assert.equal(actual.get(53), 8);
  assert.equal(actual.get(61), 2);
  assert.equal(actual.get(63), 2);

  const records = buildPlacementRecords(state);
  assert.equal(records.length, 64);
  assert.equal(new Set(records.map((r) => r.entryId)).size, 64);
  const tied3 = records.filter((r) => r.placement === 3);
  assert.equal(tied3.length, 2);
  assert.equal(tied3.every((r) => r.isTied === true), true);
  assert.equal(formatLossBandPlacementLabel(3, true), "3位タイ");
  assert.equal(formatLossBandPlacementLabel(1, false), "1位");

  const completion = evaluateLossBandRankingCompletion(state);
  assert.equal(completion.complete, true);
  assert.equal(canCompleteLossBandRanking(state), true);

  const placementsDoc = buildLossBandPlacementsDoc(state);
  assert.equal(placementsDoc.placements.length, 64);
  assert.equal(placementsDoc.status, "completed");
}

// ── 3位決定戦 ON ──
{
  const entryIds = makeEntryIds();
  const state = simulateComplete(entryIds, { thirdPlaceMatch: true });
  const validation = validateCompletePlacements(state, { thirdPlaceMatch: true });
  assert.equal(validation.valid, true, validation.errors.join("; "));

  const actual = countsFromState(state);
  assert.equal(actual.get(1), 1);
  assert.equal(actual.get(2), 1);
  assert.equal(actual.get(3), 1);
  assert.equal(actual.get(4), 1);
  assert.equal(actual.get(5), 8);
  assert.equal(actual.get(13), 8);
  assert.equal(actual.get(21), 12);
  assert.equal(actual.get(33), 12);
  assert.equal(actual.get(45), 8);
  assert.equal(actual.get(53), 8);
  assert.equal(actual.get(61), 2);
  assert.equal(actual.get(63), 2);

  let sum = 0;
  for (const c of actual.values()) sum += c;
  assert.equal(sum, 64);

  assert.equal(canCompleteLossBandRanking(state), true);
}

// ── 決定論: 同一結果 → 同一順位 ──
{
  const entryIds = makeEntryIds();
  const a = buildPlacementRecords(
    simulateComplete(entryIds, { thirdPlaceMatch: false, preferTeam1: true })
  );
  const b = buildPlacementRecords(
    simulateComplete(entryIds, { thirdPlaceMatch: false, preferTeam1: true })
  );
  assert.deepEqual(a, b);

  const c = buildPlacementRecords(
    simulateComplete(entryIds, { thirdPlaceMatch: true, preferTeam1: true })
  );
  const d = buildPlacementRecords(
    simulateComplete(entryIds, { thirdPlaceMatch: true, preferTeam1: true })
  );
  assert.deepEqual(c, d);
}

// ── 不正状態 ──
{
  const entryIds = makeEntryIds();
  let state = createInitialLossBandState(entryIds);
  assert.equal(canCompleteLossBandRanking(state), false);
  assert.equal(
    evaluateLossBandRankingCompletion(state).reasonCode,
    LossBandCompletionReasonCode.R5_INCOMPLETE
  );

  // R5 未完了で順位確定不可（finalPlacement なし）
  for (let round = 1; round <= 4; round += 1) {
    const pairings = buildRankingRoundPairings(state, round);
    state = applyRankingRoundResults(
      state,
      pairings,
      buildDeterministicTeam1WinsResults(pairings)
    );
  }
  assert.equal(
    state.teams[entryIds[0]].finalPlacement,
    null
  );
  assert.throws(() => buildFinalPairing(state), /phase/);

  state = simulateToAfterR5(entryIds, { thirdPlaceMatch: false });
  assert.equal(canCompleteLossBandRanking(state), false);
  assert.equal(
    evaluateLossBandRankingCompletion(state).reasonCode,
    LossBandCompletionReasonCode.FINAL_INCOMPLETE
  );

  const afterFinalPendingThird = applyFinalResult(
    simulateToAfterR5(entryIds, { thirdPlaceMatch: true }),
    buildFinalPairing(simulateToAfterR5(entryIds, { thirdPlaceMatch: true }))
      .team1EntryId
  );
  assert.equal(afterFinalPendingThird.phase, LossBandPhase.THIRD_PLACE);
  assert.equal(canCompleteLossBandRanking(afterFinalPendingThird), false);
  assert.equal(
    evaluateLossBandRankingCompletion(afterFinalPendingThird).reasonCode,
    LossBandCompletionReasonCode.THIRD_PLACE_INCOMPLETE
  );

  // 順位確定済みチームを ranking に再投入不可
  const complete = simulateComplete(entryIds, { thirdPlaceMatch: false });
  assert.throws(
    () => buildRankingRoundPairings(complete, 1),
    /phase/
  );

  // completed 後の進行不可
  assert.throws(
    () => applyFinalResult(complete, complete.finalists[0]),
    /phase/
  );
  assert.throws(
    () =>
      applyThirdPlaceResult(
        complete,
        complete.thirdPlaceFinalists?.[0] || entryIds[0]
      ),
    /phase/
  );

  // R5 後に third place 候補が ranking に戻らない
  const afterR5Third = simulateToAfterR5(entryIds, { thirdPlaceMatch: true });
  assert.equal(afterR5Third.thirdPlaceFinalists.length, 2);
  for (const id of afterR5Third.thirdPlaceFinalists) {
    assert.equal(afterR5Third.teams[id].finalPlacement, null);
  }
  const inv = validateLossBandStateInvariants(afterR5Third);
  assert.equal(inv.valid, true, inv.errors.join("; "));
}

console.log("loss-band Phase 4 completion/placement tests: ok");
