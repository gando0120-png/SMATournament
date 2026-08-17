/**
 * Phase 8: loss-band BYE + 動的 Olympic 順位
 */
import assert from "node:assert/strict";
import {
  LOSS_BAND_TEAM_COUNT,
  LOSS_BAND_RANKING_ROUND_COUNT,
  createInitialLossBandState,
  buildRankingRoundPairings,
  applyRankingRoundResults,
  applyFinalRankingRoundResults,
  applyFinalResult,
  buildDeterministicTeam1WinsResults,
  buildOpponentHistoryFromMatchLog,
  countPlayedMatchesForEntry,
  buildPlayedMatchCounts,
  validateCompletePlacements,
  validatePairingsCoverage,
  pickByeEntryId,
  selectByeAndPlayingEntryIds,
  buildOlympicR5PlacementPlan,
  listActiveEntryIds,
  getActiveBandCounts,
  buildFinalPairing,
  evaluateLossBandTournamentCompletion,
  planExchangeRound,
  appendExchangeResultsToMatchLog,
  buildPlacementRecords,
} from "../../js/domain/loss-band/index.js";

function makeIds(n) {
  return Array.from({ length: n }, (_, i) => `e${String(i + 1).padStart(3, "0")}`);
}

function simulateToComplete(n, { thirdPlaceMatch = false, rematchAvoidance = true } = {}) {
  let state = createInitialLossBandState(makeIds(n), {
    thirdPlaceMatch,
    rematchAvoidance,
    guaranteedMatchCount: 5,
  });
  const byeEvents = [];

  for (let round = 1; round <= LOSS_BAND_RANKING_ROUND_COUNT; round += 1) {
    const pairings = buildRankingRoundPairings(state, round, { rematchAvoidance });
    const coverage = validatePairingsCoverage(pairings, state);
    assert.equal(coverage.valid, true, coverage.errors.join("; "));
    for (const bye of pairings.byes ?? []) {
      byeEvents.push({ round, entryId: bye.entryId, lossCount: bye.lossCount });
    }
    const results = buildDeterministicTeam1WinsResults(pairings);
    if (round < LOSS_BAND_RANKING_ROUND_COUNT) {
      state = applyRankingRoundResults(state, pairings, results);
    } else {
      state = applyFinalRankingRoundResults(state, pairings, results, {
        thirdPlaceMatch,
      });
    }
  }

  const final = buildFinalPairing(state);
  state = applyFinalResult(state, final.team1EntryId);
  return { state, byeEvents };
}

// ── BYE 公平性・決定論 ──
{
  const ids = ["e003", "e001", "e002"];
  assert.equal(pickByeEntryId(ids, new Map()), "e001");
  assert.equal(pickByeEntryId(ids, { e001: 1, e002: 0, e003: 0 }), "e002");
  const a = selectByeAndPlayingEntryIds(ids, {});
  const b = selectByeAndPlayingEntryIds(ids, {});
  assert.deepEqual(a, b);
  assert.equal(a.byeEntryId, "e001");
  assert.equal(a.playingEntryIds.length, 2);
}

// ── BYE は lossCount / played / history に入らない ──
{
  let state = createInitialLossBandState(makeIds(63), { rematchAvoidance: true });
  const pairings = buildRankingRoundPairings(state, 1, { rematchAvoidance: true });
  assert.equal(pairings.byes.length, 1);
  const byeId = pairings.byes[0].entryId;
  const results = buildDeterministicTeam1WinsResults(pairings);
  state = applyRankingRoundResults(state, pairings, results);

  assert.equal(state.teams[byeId].lossCount, 0);
  assert.equal(state.teams[byeId].byeCount, 1);
  assert.equal(countPlayedMatchesForEntry(state.matchLog, byeId), 0);
  const history = buildOpponentHistoryFromMatchLog(state.matchLog);
  assert.equal(history.has(byeId) && history.get(byeId).size > 0, false);
  const played = buildPlayedMatchCounts(state.matchLog);
  assert.equal(played[byeId] ?? 0, 0);
}

// ── 二重配置なし・同一入力同一BYE ──
{
  const p1 = buildRankingRoundPairings(
    createInitialLossBandState(makeIds(33), { rematchAvoidance: true }),
    1,
    { rematchAvoidance: true }
  );
  const p2 = buildRankingRoundPairings(
    createInitialLossBandState(makeIds(33), { rematchAvoidance: true }),
    1,
    { rematchAvoidance: true }
  );
  assert.deepEqual(
    p1.byes.map((b) => b.entryId),
    p2.byes.map((b) => b.entryId)
  );
  const covered = [
    ...p1.matches.flatMap((m) => [m.team1EntryId, m.team2EntryId]),
    ...p1.byes.map((b) => b.entryId),
  ];
  assert.equal(new Set(covered).size, 33);
  assert.equal(covered.length, 33);
}

// ── Olympic: winner+BYE 同帯、BYE単独順位なし、N=placements ──
{
  const sizes = [63, 60, 48, 33, 64];
  for (const n of sizes) {
    let state = createInitialLossBandState(makeIds(n), {
      rematchAvoidance: true,
      thirdPlaceMatch: false,
      guaranteedMatchCount: 5,
    });
    for (let round = 1; round <= 5; round += 1) {
      const pairings = buildRankingRoundPairings(state, round, {
        rematchAvoidance: true,
      });
      const results = buildDeterministicTeam1WinsResults(pairings);
      if (round < 5) {
        state = applyRankingRoundResults(state, pairings, results);
      } else {
        // R5 BYE が単独順位にならないこと: stayers に含まれる
        const zeroByes = (pairings.byes ?? []).filter((b) => b.lossCount === 0);
        state = applyFinalRankingRoundResults(state, pairings, results);
        assert.equal(state.finalists.length, 2, `N=${n} finalists`);
        for (const bye of zeroByes) {
          assert.ok(
            state.finalists.includes(bye.entryId),
            `N=${n} 0-loss BYE must be finalist`
          );
        }
      }
    }
    const final = buildFinalPairing(state);
    state = applyFinalResult(state, final.team1EntryId);
    assert.equal(state.phase, "complete");
    const records = buildPlacementRecords(state);
    assert.equal(records.length, n, `N=${n} placements`);
    const validation = validateCompletePlacements(state, { thirdPlaceMatch: false });
    assert.equal(validation.valid, true, `${n}: ${validation.errors.join("; ")}`);

    // Olympic skip: ranks must be competition-style
    const counts = new Map();
    for (const row of records) {
      counts.set(row.placement, (counts.get(row.placement) ?? 0) + 1);
    }
    const ranks = [...counts.keys()].sort((a, b) => a - b);
    let cursor = 1;
    for (const rank of ranks) {
      assert.equal(rank, cursor, `N=${n} olympic gap at ${rank}`);
      cursor += counts.get(rank);
    }
  }
}

// ── 3位候補1人 → 自動3位、4位なし ──
{
  let state = createInitialLossBandState(makeIds(48), {
    rematchAvoidance: true,
    thirdPlaceMatch: true,
    guaranteedMatchCount: 5,
  });
  for (let round = 1; round <= 5; round += 1) {
    const pairings = buildRankingRoundPairings(state, round, {
      rematchAvoidance: true,
    });
    const results = buildDeterministicTeam1WinsResults(pairings);
    state =
      round < 5
        ? applyRankingRoundResults(state, pairings, results)
        : applyFinalRankingRoundResults(state, pairings, results, {
            thirdPlaceMatch: true,
          });
  }
  // 48: 0敗敗者1人 → auto 3rd, no third place match
  assert.equal(state.thirdPlaceMatch, false);
  assert.equal(state.thirdPlaceFinalists, null);
  const autoThird = listActiveEntryIds(state).filter(
    (id) => state.teams[id].finalPlacement === 3
  );
  assert.equal(autoThird.length, 1);
  // 3位自動確定後の次帯は Olympic で4位帯になる（3位決定戦の「4位」ではない）
  const at4 = listActiveEntryIds(state).filter(
    (id) => state.teams[id].finalPlacement === 4
  );
  assert.ok(at4.length >= 1, "olympic next band starts at 4");
  assert.ok(
    !state.finalists.includes(at4[0]),
    "placement 4 is not a fabricated runner from third-place"
  );
  const final = buildFinalPairing(state);
  state = applyFinalResult(state, final.team1EntryId);
  assert.equal(state.phase, "complete");
  const v = validateCompletePlacements(state, { thirdPlaceMatch: false });
  assert.equal(v.valid, true, v.errors.join("; "));
}

// ── 交流戦で保証到達・placements 不変 ──
{
  let state = createInitialLossBandState(makeIds(63), {
    rematchAvoidance: true,
    thirdPlaceMatch: false,
    guaranteedMatchCount: 5,
  });
  for (let round = 1; round <= 5; round += 1) {
    const pairings = buildRankingRoundPairings(state, round, {
      rematchAvoidance: true,
    });
    const results = buildDeterministicTeam1WinsResults(pairings);
    state =
      round < 5
        ? applyRankingRoundResults(state, pairings, results)
        : applyFinalRankingRoundResults(state, pairings, results);
  }
  const final = buildFinalPairing(state);
  state = applyFinalResult(state, final.team1EntryId);
  const before = buildPlacementRecords(state).map((r) => ({
    entryId: r.entryId,
    placement: r.placement,
  }));

  let exchangeRound = 0;
  let priorExchange = [];
  while (true) {
    const plan = planExchangeRound({
      state,
      matchLog: state.matchLog,
      exchangeRoundNumber: exchangeRound + 1,
      priorExchangeRounds: priorExchange,
      guaranteedMatchCount: 5,
    });
    if (!plan.needed) break;
    exchangeRound += 1;
    const winners = Object.fromEntries(
      plan.matches.map((m) => [m.matchId, m.team1EntryId])
    );
    state = appendExchangeResultsToMatchLog(state, plan, winners);
    priorExchange.push({
      exchangeRoundNumber: exchangeRound,
      sitOutEntryId: plan.sitOutEntryId,
    });
    if (exchangeRound > 20) {
      assert.fail("exchange loop");
    }
  }

  const completion = evaluateLossBandTournamentCompletion(state, {
    exchangeMatches: true,
    guaranteedMatchCount: 5,
  });
  assert.equal(completion.tournamentComplete, true, completion.message);

  const after = buildPlacementRecords(state).map((r) => ({
    entryId: r.entryId,
    placement: r.placement,
  }));
  assert.deepEqual(after, before);

  for (const id of listActiveEntryIds(state)) {
    assert.ok(countPlayedMatchesForEntry(state.matchLog, id) >= 5, id);
  }
}

// ── Olympic plan unit: winner+BYE 同帯 ──
{
  const stayersByLoss = new Map([
    [1, ["a", "b", "bye1"]],
  ]);
  const losersByLoss = new Map([[1, ["c", "d", "e", "f", "g", "h", "i"]]]);
  // need also loss 0 for finalists
  stayersByLoss.set(0, ["f1", "f2"]);
  losersByLoss.set(0, ["l1", "l2"]);
  const plan = buildOlympicR5PlacementPlan({
    stayersByLoss,
    losersByLoss,
    thirdPlaceMatch: false,
  });
  assert.deepEqual(plan.finalists, ["f1", "f2"]);
  const stay1 = plan.groups.find((g) => g.lossCount === 1 && g.kind === "stay");
  assert.equal(stay1.entryIds.length, 3);
  assert.ok(stay1.entryIds.includes("bye1"));
  assert.equal(stay1.placement, 5);
  const drop1 = plan.groups.find((g) => g.lossCount === 1 && g.kind === "drop");
  assert.equal(drop1.placement, 8); // 5 + 3
}

console.log("loss-band-bye.test.mjs: ok");
