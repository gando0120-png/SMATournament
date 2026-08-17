/**
 * Phase 9-1: bracketSize 一般化（32 / 64 / 128）+ Olympic 一本化
 */
import assert from "node:assert/strict";
import {
  EXPECTED_BAND_COUNTS_AT_ROUND_START,
  R5_PLACEMENT_SPEC,
  LOSS_BAND_TEAM_COUNT,
  createInitialLossBandState,
  getActiveBandCounts,
  listActiveEntryIds,
  buildRankingRoundPairings,
  applyRankingRoundResults,
  applyFinalRankingRoundResults,
  buildFinalPairing,
  applyFinalResult,
  applyThirdPlaceResult,
  buildThirdPlacePairing,
  buildDeterministicTeam1WinsResults,
  validateCompletePlacements,
  validateBandCountsAtRoundStart,
  validatePairingsCoverage,
  expectedBandCountsAtRoundStart,
  buildExpectedBandCountsTable,
  resolveLossBandBracketSize,
  rankingRoundCount,
  finalRoundNumber,
  defaultGuaranteedMatchCount,
  expectedFinalPlacementCounts,
  expectedFixed64R5PlacementCounts,
  usesFixed64PlacementSpec,
  buildOlympicR5PlacementPlan,
  pairEntryIdsWithRematchAvoidance,
  buildOpponentHistoryFromMatchLog,
} from "../../js/domain/loss-band/index.js";

function makeIds(n, prefix = "e") {
  return Array.from(
    { length: n },
    (_, i) => `${prefix}${String(i + 1).padStart(3, "0")}`
  );
}

function simulateComplete(n, options = {}) {
  const {
    thirdPlaceMatch = false,
    rematchAvoidance = false,
    shuffleIds = false,
  } = options;
  let ids = makeIds(n);
  if (shuffleIds) {
    // 決定論チェック用: 逆順入力でも同一結果になること
    ids = [...ids].reverse();
  }
  let state = createInitialLossBandState(ids, {
    thirdPlaceMatch,
    rematchAvoidance,
  });
  const rankingRounds = rankingRoundCount(state.bracketSize);
  const bandStarts = [];

  for (let round = 1; round <= rankingRounds; round += 1) {
    if (state.teamCount === state.bracketSize) {
      const check = validateBandCountsAtRoundStart(state, round);
      assert.equal(check.valid, true, check.errors.join("; "));
    }
    bandStarts.push({ round, bands: getActiveBandCounts(state) });
    const pairings = buildRankingRoundPairings(state, round, {
      rematchAvoidance,
    });
    const coverage = validatePairingsCoverage(pairings, state);
    assert.equal(coverage.valid, true, coverage.errors.join("; "));
    const results = buildDeterministicTeam1WinsResults(pairings);
    if (round < rankingRounds) {
      state = applyRankingRoundResults(state, pairings, results);
    } else {
      state = applyFinalRankingRoundResults(state, pairings, results, {
        thirdPlaceMatch,
      });
    }
  }

  assert.equal(state.finalists.length, 2, `N=${n} finalists`);
  const final = buildFinalPairing(state);
  state = applyFinalResult(state, final.team1EntryId);
  if (state.phase === "third_place") {
    const third = buildThirdPlacePairing(state);
    state = applyThirdPlaceResult(state, third.team1EntryId);
  }

  const v = validateCompletePlacements(state, {
    thirdPlaceMatch: state.thirdPlaceMatch,
  });
  assert.equal(v.valid, true, `N=${n}: ${v.errors.join("; ")}`);
  return { state, bandStarts, rankingRounds };
}

// ── 一般式 ──
{
  assert.equal(resolveLossBandBracketSize(17), 32);
  assert.equal(resolveLossBandBracketSize(32), 32);
  assert.equal(resolveLossBandBracketSize(33), 64);
  assert.equal(resolveLossBandBracketSize(64), 64);
  assert.equal(resolveLossBandBracketSize(65), 128);
  assert.equal(resolveLossBandBracketSize(128), 128);
  assert.equal(resolveLossBandBracketSize(16), null);
  assert.equal(resolveLossBandBracketSize(129), null);

  assert.equal(rankingRoundCount(32), 4);
  assert.equal(rankingRoundCount(64), 5);
  assert.equal(rankingRoundCount(128), 6);
  assert.equal(finalRoundNumber(32), 5);
  assert.equal(finalRoundNumber(64), 6);
  assert.equal(finalRoundNumber(128), 7);
  assert.equal(defaultGuaranteedMatchCount(32), 4);
  assert.equal(defaultGuaranteedMatchCount(64), 5);
  assert.equal(defaultGuaranteedMatchCount(128), 6);
  assert.equal(usesFixed64PlacementSpec(64), false);
}

// ── 帯人数一般式 ≡ 64 固定テーブル ──
{
  const table = buildExpectedBandCountsTable(64);
  for (let r = 1; r <= 5; r += 1) {
    assert.deepEqual(
      table[r],
      { ...EXPECTED_BAND_COUNTS_AT_ROUND_START[r] },
      `64 R${r}`
    );
    assert.deepEqual(
      expectedBandCountsAtRoundStart(64, r),
      { ...EXPECTED_BAND_COUNTS_AT_ROUND_START[r] }
    );
  }
}

// ── 32 BYEなし ──
{
  const { state, bandStarts } = simulateComplete(32);
  assert.equal(state.bracketSize, 32);
  assert.equal(state.guaranteedMatchCount, 4);
  assert.deepEqual(bandStarts[0].bands, { 0: 32 });
  assert.deepEqual(bandStarts[1].bands, { 0: 16, 1: 16 });
  assert.deepEqual(bandStarts[2].bands, { 0: 8, 1: 16, 2: 8 });
  assert.deepEqual(bandStarts[3].bands, { 0: 4, 1: 12, 2: 12, 3: 4 });
  assert.equal(listActiveEntryIds(state).length, 32);
  assert.equal(state.finalists?.length ?? 2, 2);
}

// ── 64 回帰（Olympic ≡ SPEC） ──
{
  const { state, bandStarts } = simulateComplete(64);
  assert.equal(state.bracketSize, 64);
  for (let r = 1; r <= 5; r += 1) {
    assert.deepEqual(
      bandStarts[r - 1].bands,
      { ...EXPECTED_BAND_COUNTS_AT_ROUND_START[r] },
      `64 band R${r}`
    );
  }
  const expected = expectedFinalPlacementCounts({ thirdPlaceMatch: false });
  const actual = new Map();
  for (const id of listActiveEntryIds(state)) {
    const p = state.teams[id].finalPlacement;
    actual.set(p, (actual.get(p) ?? 0) + 1);
  }
  for (const [p, c] of expected) {
    assert.equal(actual.get(p), c, `64 placement ${p}`);
  }
  const fixed = expectedFixed64R5PlacementCounts({ thirdPlaceMatch: false });
  for (const [p, c] of fixed) {
    // finalists are 1/2 — fixed map excludes null placement
    if (p === 1 || p === 2) continue;
    assert.equal(actual.get(p), c, `64 olympic≡spec ${p}`);
  }
  // SPEC count rows sum to 62 + 2 finalists
  let specPlaced = 0;
  for (const spec of R5_PLACEMENT_SPEC) {
    if (spec.placement != null) specPlaced += spec.count;
  }
  assert.equal(specPlaced, 62);
  assert.equal(listActiveEntryIds(state).length, LOSS_BAND_TEAM_COUNT);
}

// ── 128 BYEなし ──
{
  const { state, bandStarts } = simulateComplete(128);
  assert.equal(state.bracketSize, 128);
  assert.equal(state.guaranteedMatchCount, 6);
  assert.deepEqual(bandStarts[5].bands, {
    0: 4,
    1: 20,
    2: 40,
    3: 40,
    4: 20,
    5: 4,
  });
  assert.equal(listActiveEntryIds(state).length, 128);
}

// ── BYE 代表 ──
{
  for (const n of [31, 48, 63, 96, 127]) {
    const { state } = simulateComplete(n, { rematchAvoidance: true });
    assert.equal(state.teamCount, n);
    assert.equal(listActiveEntryIds(state).filter((id) => state.teams[id].finalPlacement != null).length, n);
    assert.equal(state.guaranteedMatchCount, rankingRoundCount(state.bracketSize));
  }
}

// ── 決定論（入力順変更） ──
{
  const a = simulateComplete(48, { rematchAvoidance: true });
  const b = simulateComplete(48, { rematchAvoidance: true, shuffleIds: true });
  const placementsA = Object.fromEntries(
    listActiveEntryIds(a.state).map((id) => [id, a.state.teams[id].finalPlacement])
  );
  const placementsB = Object.fromEntries(
    listActiveEntryIds(b.state).map((id) => [id, b.state.teams[id].finalPlacement])
  );
  assert.deepEqual(placementsA, placementsB);
  assert.deepEqual([...a.state.finalists].sort(), [...b.state.finalists].sort());
}

// ── Olympic: winner+BYE 同帯（ユニット） ──
{
  const stayersByLoss = new Map([
    [0, ["a", "bye0"]],
    [1, ["w1", "bye1"]],
  ]);
  const losersByLoss = new Map([
    [0, ["l0"]],
    [1, ["l1"]],
  ]);
  const plan = buildOlympicR5PlacementPlan({
    stayersByLoss,
    losersByLoss,
    thirdPlaceMatch: true,
  });
  assert.deepEqual(plan.finalists, ["a", "bye0"]);
  assert.deepEqual(plan.autoThirdPlaceEntryIds, ["l0"]);
  const stay1 = plan.groups.find((g) => g.lossCount === 1 && g.kind === "stay");
  assert.equal(stay1.entryIds.includes("bye1"), true);
  assert.equal(stay1.entryIds.includes("w1"), true);
  assert.equal(stay1.placement, 4);
}

// ── 128 最大帯で再戦回避が決定論的に動く ──
{
  const ids = makeIds(40);
  const history = new Map();
  const a = pairEntryIdsWithRematchAvoidance(ids, history);
  const b = pairEntryIdsWithRematchAvoidance(ids, history);
  assert.deepEqual(a.pairs, b.pairs);
  assert.equal(a.pairs.length, 20);
  // full 128 sim already exercised rematchAvoidance=false; spot-check with history
  const { state } = simulateComplete(32, { rematchAvoidance: true });
  const log = state.matchLog.filter((m) => !m.isBye);
  const hist = buildOpponentHistoryFromMatchLog(log);
  assert.ok(hist.size > 0);
}

console.log("loss-band-bracket.test.mjs: ok");
