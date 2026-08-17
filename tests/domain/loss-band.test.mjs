/**
 * 敗戦帯 Phase 1 domain テスト（64 チーム固定シミュレーション）
 */
import assert from "node:assert/strict";
import {
  LOSS_BAND_TEAM_COUNT,
  LOSS_BAND_RANKING_ROUND_COUNT,
  EXPECTED_BAND_COUNTS_AT_ROUND_START,
  LossBandPhase,
  createInitialLossBandState,
  getActiveBandCounts,
  listActiveEntryIds,
  listUnplacedEntryIds,
  buildRankingRoundPairings,
  applyRankingRoundResults,
  applyFinalRankingRoundResults,
  buildFinalPairing,
  applyFinalResult,
  buildDeterministicTeam1WinsResults,
  validateLossBandStateInvariants,
  validateBandCountsAtRoundStart,
  validatePairingsCoverage,
  validateCompletePlacements,
  groupByFinalPlacement,
  pairEntryIdsDeterministic,
} from "../../js/domain/loss-band/index.js";

function makeEntryIds(count = LOSS_BAND_TEAM_COUNT) {
  return Array.from({ length: count }, (_, i) => `e${String(i + 1).padStart(3, "0")}`);
}

function simulateToComplete(entryIds, { preferTeam1 = true } = {}) {
  let state = createInitialLossBandState(entryIds);
  const roundSnapshots = [];

  for (let round = 1; round <= LOSS_BAND_RANKING_ROUND_COUNT; round += 1) {
    const bandCheck = validateBandCountsAtRoundStart(state, round);
    assert.equal(bandCheck.valid, true, bandCheck.errors.join("; "));

    const pairings = buildRankingRoundPairings(state, round);
    const coverage = validatePairingsCoverage(pairings, state);
    assert.equal(coverage.valid, true, coverage.errors.join("; "));

    const results = preferTeam1
      ? buildDeterministicTeam1WinsResults(pairings)
      : Object.fromEntries(
          pairings.matches.map((m) => [m.matchId, m.team2EntryId])
        );

    roundSnapshots.push({
      round,
      bandCounts: getActiveBandCounts(state),
      matchCount: pairings.matches.length,
    });

    if (round < LOSS_BAND_RANKING_ROUND_COUNT) {
      state = applyRankingRoundResults(state, pairings, results);
      const inv = validateLossBandStateInvariants(state);
      assert.equal(inv.valid, true, inv.errors.join("; "));
      // R1–R4 中は誰にも finalPlacement を付けない
      assert.equal(listUnplacedEntryIds(state).length, LOSS_BAND_TEAM_COUNT);
    } else {
      state = applyFinalRankingRoundResults(state, pairings, results);
      const inv = validateLossBandStateInvariants(state);
      assert.equal(inv.valid, true, inv.errors.join("; "));
      assert.equal(state.phase, LossBandPhase.FINAL);
      assert.equal(state.finalists.length, 2);
    }
  }

  const finalPairing = buildFinalPairing(state);
  const finalWinner = preferTeam1
    ? finalPairing.team1EntryId
    : finalPairing.team2EntryId;
  state = applyFinalResult(state, finalWinner);

  return { state, roundSnapshots, finalWinner };
}

// ── 初期化 ──
{
  const ids = makeEntryIds();
  const state = createInitialLossBandState(ids);
  assert.equal(state.teamCount, 64);
  assert.equal(state.bracketSize, 64);
  assert.equal(state.phase, LossBandPhase.RANKING);
  assert.equal(state.completedRankingRound, 0);
  assert.deepEqual(getActiveBandCounts(state), { 0: 64 });
  assert.equal(listActiveEntryIds(state).length, 64);
  assert.equal(listUnplacedEntryIds(state).length, 64);
  assert.equal(state.guaranteedMatchCount, 5);

  assert.throws(() => createInitialLossBandState(makeEntryIds(16)), /17|outside/);
  assert.throws(() => createInitialLossBandState(makeEntryIds(129)), /128|outside/);
  const ok32 = createInitialLossBandState(makeEntryIds(32));
  assert.equal(ok32.bracketSize, 32);
  assert.equal(ok32.guaranteedMatchCount, 4);
  const ok63 = createInitialLossBandState(makeEntryIds(63));
  assert.equal(ok63.teamCount, 63);
  assert.equal(ok63.bracketSize, 64);
  const ok128 = createInitialLossBandState(makeEntryIds(128));
  assert.equal(ok128.bracketSize, 128);
  assert.equal(ok128.guaranteedMatchCount, 6);
  const dup = makeEntryIds();
  dup[63] = dup[0];
  assert.throws(() => createInitialLossBandState(dup), /duplicate/);
}

// ── 決定論ペアリング ──
{
  const pairs = pairEntryIdsDeterministic(["b", "a", "d", "c"]);
  assert.deepEqual(pairs, [
    ["a", "b"],
    ["c", "d"],
  ]);
  const again = pairEntryIdsDeterministic(["d", "c", "b", "a"]);
  assert.deepEqual(again, pairs);
}

// ── 64 チーム全シミュレーション（team1 勝ち） ──
{
  const entryIds = makeEntryIds();
  const { state, roundSnapshots } = simulateToComplete(entryIds, {
    preferTeam1: true,
  });

  for (let round = 1; round <= 5; round += 1) {
    const snap = roundSnapshots[round - 1];
    assert.ok(
      Object.entries(EXPECTED_BAND_COUNTS_AT_ROUND_START[round]).every(
        ([loss, count]) => snap.bandCounts[Number(loss)] === count
      ),
      `R${round} start bands: ${JSON.stringify(snap.bandCounts)}`
    );
    const expectedMatches =
      Object.values(EXPECTED_BAND_COUNTS_AT_ROUND_START[round]).reduce(
        (sum, n) => sum + n,
        0
      ) / 2;
    assert.equal(snap.matchCount, expectedMatches, `R${round} match count`);
  }

  assert.equal(state.phase, LossBandPhase.COMPLETE);
  const placementCheck = validateCompletePlacements(state);
  assert.equal(
    placementCheck.valid,
    true,
    placementCheck.errors.join("; ")
  );

  const groups = groupByFinalPlacement(state);
  assert.equal(groups.get(1).length, 1);
  assert.equal(groups.get(2).length, 1);
  assert.equal(groups.get(3).length, 2);
  assert.equal(groups.get(5).length, 8);
  assert.equal(groups.get(13).length, 8);
  assert.equal(groups.get(21).length, 12);
  assert.equal(groups.get(33).length, 12);
  assert.equal(groups.get(45).length, 8);
  assert.equal(groups.get(53).length, 8);
  assert.equal(groups.get(61).length, 2);
  assert.equal(groups.get(63).length, 2);

  let total = 0;
  for (const ids of groups.values()) {
    total += ids.length;
  }
  assert.equal(total, 64);

  // 全 entryId が一意に出現
  const allPlaced = [...groups.values()].flat();
  assert.equal(new Set(allPlaced).size, 64);
  assert.deepEqual(
    [...allPlaced].sort((a, b) => a.localeCompare(b, "en")),
    [...entryIds].sort((a, b) => a.localeCompare(b, "en"))
  );
}

// ── 勝者は loss 維持・敗者のみ +1（R1） ──
{
  const state0 = createInitialLossBandState(makeEntryIds());
  const pairings = buildRankingRoundPairings(state0, 1);
  const results = buildDeterministicTeam1WinsResults(pairings);
  const state1 = applyRankingRoundResults(state0, pairings, results);

  for (const match of pairings.matches) {
    const winner = results[match.matchId];
    const loser =
      winner === match.team1EntryId ? match.team2EntryId : match.team1EntryId;
    assert.equal(state1.teams[winner].lossCount, 0);
    assert.equal(state1.teams[loser].lossCount, 1);
    assert.equal(state1.teams[winner].finalPlacement, null);
    assert.equal(state1.teams[loser].finalPlacement, null);
  }
  assert.deepEqual(getActiveBandCounts(state1), { 0: 32, 1: 32 });
}

// ── 同一入力 → 同一結果 ──
{
  const ids = makeEntryIds();
  const a = simulateToComplete(ids, { preferTeam1: true });
  const b = simulateToComplete(ids, { preferTeam1: true });

  assert.deepEqual(
    Object.fromEntries(
      listActiveEntryIds(a.state).map((id) => [
        id,
        {
          lossCount: a.state.teams[id].lossCount,
          finalPlacement: a.state.teams[id].finalPlacement,
        },
      ])
    ),
    Object.fromEntries(
      listActiveEntryIds(b.state).map((id) => [
        id,
        {
          lossCount: b.state.teams[id].lossCount,
          finalPlacement: b.state.teams[id].finalPlacement,
        },
      ])
    )
  );
  assert.deepEqual(a.state.finalists, b.state.finalists);
  assert.equal(a.finalWinner, b.finalWinner);
}

// ── 別の勝者選択でも帯人数推移は同じ（R1–R5 開始時） ──
{
  const ids = makeEntryIds();
  const team1Path = simulateToComplete(ids, { preferTeam1: true });
  const team2Path = simulateToComplete(ids, { preferTeam1: false });

  for (let i = 0; i < 5; i += 1) {
    assert.deepEqual(
      team1Path.roundSnapshots[i].bandCounts,
      team2Path.roundSnapshots[i].bandCounts,
      `band counts diverge at R${i + 1}`
    );
  }
  assert.equal(validateCompletePlacements(team2Path.state).valid, true);
}

// ── ペアリングに重複・取り残しがない ──
{
  let state = createInitialLossBandState(makeEntryIds());
  for (let round = 1; round <= 4; round += 1) {
    const pairings = buildRankingRoundPairings(state, round);
    const paired = pairings.matches.flatMap((m) => [
      m.team1EntryId,
      m.team2EntryId,
    ]);
    assert.equal(new Set(paired).size, paired.length);
    assert.equal(paired.length, 64);
    state = applyRankingRoundResults(
      state,
      pairings,
      buildDeterministicTeam1WinsResults(pairings)
    );
  }
}

// ── R5 前に finalPlacement なし ──
{
  let state = createInitialLossBandState(makeEntryIds());
  for (let round = 1; round <= 4; round += 1) {
    const pairings = buildRankingRoundPairings(state, round);
    state = applyRankingRoundResults(
      state,
      pairings,
      buildDeterministicTeam1WinsResults(pairings)
    );
    assert.equal(
      listActiveEntryIds(state).every(
        (id) => state.teams[id].finalPlacement == null
      ),
      true,
      `placement leaked after R${round}`
    );
  }
}

console.log("loss-band Phase 1 domain tests: ok");
console.log(
  "64-team simulation band counts at round starts:",
  JSON.stringify(EXPECTED_BAND_COUNTS_AT_ROUND_START, null, 2)
);
