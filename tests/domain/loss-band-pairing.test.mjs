/**
 * 敗戦帯 Phase 2 — 再戦回避ペアリング domain テスト
 */
import assert from "node:assert/strict";
import {
  LOSS_BAND_TEAM_COUNT,
  LOSS_BAND_RANKING_ROUND_COUNT,
  EXPECTED_BAND_COUNTS_AT_ROUND_START,
  LossBandPhase,
  createInitialLossBandState,
  getActiveBandCounts,
  buildRankingRoundPairings,
  applyRankingRoundResults,
  applyFinalRankingRoundResults,
  buildFinalPairing,
  applyFinalResult,
  buildDeterministicTeam1WinsResults,
  validateCompletePlacements,
  groupByFinalPlacement,
  pairEntryIdsDeterministic,
  pairEntryIdsWithRematchAvoidance,
  countRematchesInPairs,
  buildOpponentHistoryFromMatchLog,
} from "../../js/domain/loss-band/index.js";

function makeEntryIds(count = LOSS_BAND_TEAM_COUNT) {
  return Array.from({ length: count }, (_, i) => `e${String(i + 1).padStart(3, "0")}`);
}

function simulateWithBandSnapshots(entryIds, rematchAvoidance) {
  let state = createInitialLossBandState(entryIds);
  const snapshots = [];
  let totalRematches = 0;

  for (let round = 1; round <= LOSS_BAND_RANKING_ROUND_COUNT; round += 1) {
    snapshots.push({ round, bandCounts: { ...getActiveBandCounts(state) } });
    const pairings = buildRankingRoundPairings(state, round, { rematchAvoidance });
    totalRematches += pairings.rematchCount;

    const paired = pairings.matches.flatMap((m) => [m.team1EntryId, m.team2EntryId]);
    assert.equal(new Set(paired).size, paired.length);
    assert.equal(paired.length, 64);

    for (const match of pairings.matches) {
      assert.equal(
        state.teams[match.team1EntryId].lossCount,
        state.teams[match.team2EntryId].lossCount
      );
      assert.equal(state.teams[match.team1EntryId].lossCount, match.lossCount);
    }

    const results = buildDeterministicTeam1WinsResults(pairings);
    state =
      round < LOSS_BAND_RANKING_ROUND_COUNT
        ? applyRankingRoundResults(state, pairings, results)
        : applyFinalRankingRoundResults(state, pairings, results);
  }

  const finalPairing = buildFinalPairing(state);
  state = applyFinalResult(state, finalPairing.team1EntryId);
  return { state, snapshots, totalRematches };
}

// ── 1. 対戦履歴なし: 再戦回避でも 64 完走・帯内のみ ──
{
  const { state, snapshots, totalRematches } = simulateWithBandSnapshots(
    makeEntryIds(),
    true
  );
  assert.equal(state.phase, LossBandPhase.COMPLETE);
  assert.equal(totalRematches, 0, "no history => no rematches");
  for (let round = 1; round <= 5; round += 1) {
    assert.deepEqual(
      snapshots[round - 1].bandCounts,
      Object.fromEntries(
        Object.entries(EXPECTED_BAND_COUNTS_AT_ROUND_START[round]).map(([k, v]) => [
          Number(k),
          v,
        ])
      )
    );
  }
  assert.equal(validateCompletePlacements(state).valid, true);
}

// ── 2. 再戦回避: 過去対戦があれば未対戦を優先 ──
{
  const ids = ["a01", "a02", "a03", "a04"];
  const history = {
    a01: ["a02"],
    a02: ["a01"],
  };
  const adjacent = pairEntryIdsDeterministic(ids);
  assert.equal(countRematchesInPairs(adjacent, history), 1);

  const avoided = pairEntryIdsWithRematchAvoidance(ids, history);
  assert.equal(avoided.rematchCount, 0);
  assert.equal(avoided.pairs.length, 2);
  const flat = avoided.pairs.flat();
  assert.equal(new Set(flat).size, 4);
  assert.equal(
    avoided.pairs.some(
      ([a, b]) => (a === "a01" && b === "a02") || (a === "a02" && b === "a01")
    ),
    false
  );
}

// ── 3. greedy（隣接）は再戦するが、探索は再戦0を見つける ──
{
  // ソート順 a,b,c,d。隣接 greedy は (a,b)(c,d)。
  // a-b 対戦済みなら greedy は再戦1。探索は (a,c)(b,d) 等で再戦0。
  const ids = ["a", "b", "c", "d"];
  const history = { a: ["b"], b: ["a"] };
  assert.equal(countRematchesInPairs(pairEntryIdsDeterministic(ids), history), 1);
  const avoided = pairEntryIdsWithRematchAvoidance(ids, history);
  assert.equal(avoided.rematchCount, 0);
  assert.deepEqual(avoided.pairs, [
    ["a", "c"],
    ["b", "d"],
  ]);
}

// ── 4. 再戦不可避でも停止せず決定論ペアリング ──
{
  // 4人で全ペア対戦済み → どの完全マッチングも再戦2
  const ids = ["a", "b", "c", "d"];
  const history = {
    a: ["b", "c", "d"],
    b: ["a", "c", "d"],
    c: ["a", "b", "d"],
    d: ["a", "b", "c"],
  };
  const r1 = pairEntryIdsWithRematchAvoidance(ids, history);
  const r2 = pairEntryIdsWithRematchAvoidance([...ids].reverse(), history);
  assert.equal(r1.rematchCount, 2);
  assert.deepEqual(r1.pairs, r2.pairs);
  assert.deepEqual(r1.pairs, [
    ["a", "b"],
    ["c", "d"],
  ]);
}

// ── 5. 決定論: 入力順を変えても同じ / 複数回同じ ──
{
  const ids = ["m3", "m1", "m4", "m2", "m5", "m6"];
  const history = {
    m1: ["m2"],
    m2: ["m1"],
    m3: ["m4"],
    m4: ["m3"],
  };
  const a = pairEntryIdsWithRematchAvoidance(ids, history);
  const b = pairEntryIdsWithRematchAvoidance([...ids].reverse(), history);
  const c = pairEntryIdsWithRematchAvoidance(ids, history);
  assert.deepEqual(a.pairs, b.pairs);
  assert.deepEqual(a.pairs, c.pairs);
  assert.equal(a.rematchCount, b.rematchCount);
}

// ── 6. 敗戦帯分離（異なる lossCount を組ませない） ──
{
  let state = createInitialLossBandState(makeEntryIds());
  // R1 実施
  {
    const p = buildRankingRoundPairings(state, 1, { rematchAvoidance: true });
    state = applyRankingRoundResults(state, p, buildDeterministicTeam1WinsResults(p));
  }
  // R2: 0敗帯と1敗帯が混在
  const pairings = buildRankingRoundPairings(state, 2, { rematchAvoidance: true });
  for (const match of pairings.matches) {
    assert.equal(
      state.teams[match.team1EntryId].lossCount,
      state.teams[match.team2EntryId].lossCount
    );
  }
  const zeroBand = pairings.byLossCount[0] ?? [];
  const oneBand = pairings.byLossCount[1] ?? [];
  assert.equal(zeroBand.length, 16);
  assert.equal(oneBand.length, 16);
  for (const m of zeroBand) {
    assert.equal(m.lossCount, 0);
  }
  for (const m of oneBand) {
    assert.equal(m.lossCount, 1);
  }
}

// ── 7. 64フルシミュレーション: 回避ONでも順位は Phase 1 と一致 + 再戦件数比較 ──
{
  const entryIds = makeEntryIds();
  const off = simulateWithBandSnapshots(entryIds, false);
  const on = simulateWithBandSnapshots(entryIds, true);

  assert.equal(off.state.phase, LossBandPhase.COMPLETE);
  assert.equal(on.state.phase, LossBandPhase.COMPLETE);
  assert.equal(validateCompletePlacements(off.state).valid, true);
  assert.equal(validateCompletePlacements(on.state).valid, true);

  for (let round = 1; round <= 5; round += 1) {
    assert.deepEqual(off.snapshots[round - 1].bandCounts, on.snapshots[round - 1].bandCounts);
    assert.deepEqual(
      on.snapshots[round - 1].bandCounts,
      Object.fromEntries(
        Object.entries(EXPECTED_BAND_COUNTS_AT_ROUND_START[round]).map(([k, v]) => [
          Number(k),
          v,
        ])
      )
    );
  }

  const offGroups = groupByFinalPlacement(off.state);
  const onGroups = groupByFinalPlacement(on.state);
  for (const placement of [1, 2, 3, 5, 13, 21, 33, 45, 53, 61, 63]) {
    assert.equal(
      (offGroups.get(placement) ?? []).length,
      (onGroups.get(placement) ?? []).length,
      `placement ${placement} size mismatch`
    );
  }

  // 全64一意
  assert.equal(
    new Set([...onGroups.values()].flat()).size,
    64
  );

  // 再戦回避ONの再戦件数は標準以下
  assert.ok(
    on.totalRematches <= off.totalRematches,
    `avoidance rematches ${on.totalRematches} > standard ${off.totalRematches}`
  );

  console.log(
    JSON.stringify({
      standardRematches: off.totalRematches,
      avoidanceRematches: on.totalRematches,
      reduction: off.totalRematches - on.totalRematches,
    })
  );
}

// ── matchLog から履歴導出 ──
{
  const history = buildOpponentHistoryFromMatchLog([
    { team1EntryId: "a", team2EntryId: "b" },
    { team1EntryId: "c", team2EntryId: "d" },
  ]);
  assert.equal(history.get("a").has("b"), true);
  assert.equal(history.get("b").has("a"), true);
  assert.equal(history.get("a").has("c") ?? false, false);
}

console.log("loss-band Phase 2 rematch-avoidance tests: ok");
