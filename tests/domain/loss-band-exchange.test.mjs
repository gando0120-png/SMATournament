/**
 * Phase 5: 最低保証実試合数＋交流戦
 * guaranteedMatchCount は thirdPlaceMatch と独立（標準5）。
 */
import assert from "node:assert/strict";
import {
  LOSS_BAND_TEAM_COUNT,
  LOSS_BAND_RANKING_ROUND_COUNT,
  LOSS_BAND_DEFAULT_GUARANTEED_MATCH_COUNT,
  LossBandPhase,
  LossBandMatchPurpose,
  createInitialLossBandState,
  buildRankingRoundPairings,
  applyRankingRoundResults,
  applyFinalRankingRoundResults,
  buildFinalPairing,
  applyFinalResult,
  buildThirdPlacePairing,
  applyThirdPlaceResult,
  buildDeterministicTeam1WinsResults,
  buildPlacementRecords,
  planExchangeRound,
  appendExchangeResultsToMatchLog,
  resolveGuaranteedMatchCount,
  buildPlayedMatchCounts,
  listExchangeEligibleEntryIds,
  pickExchangeSitOutEntryId,
  pairExchangeEntryIds,
  validateGuaranteedMatchCounts,
  canCompleteLossBandTournament,
  evaluateLossBandTournamentCompletion,
  LossBandCompletionReasonCode,
  buildLossBandPlacementsDoc,
  planAfterRankingFullyPlaced,
  buildLossBandStateDoc,
  havePlayedBefore,
  expectedFinalPlacementCounts,
  validateCompletePlacements,
} from "../../js/domain/loss-band/index.js";

function makeEntryIds(count = LOSS_BAND_TEAM_COUNT) {
  return Array.from({ length: count }, (_, i) =>
    `e${String(i + 1).padStart(3, "0")}`
  );
}

function simulateRankingComplete(
  entryIds,
  { thirdPlaceMatch = false, guaranteedMatchCount } = {}
) {
  let state = createInitialLossBandState(entryIds, {
    thirdPlaceMatch,
    guaranteedMatchCount,
  });
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
  const final = buildFinalPairing(state);
  state = applyFinalResult(state, final.team1EntryId);
  if (thirdPlaceMatch) {
    const third = buildThirdPlacePairing(state);
    state = applyThirdPlaceResult(state, third.team1EntryId);
  }
  assert.equal(state.phase, LossBandPhase.COMPLETE);
  return state;
}

function runExchangeUntilDone(state, { guaranteedMatchCount }) {
  let current = state;
  const placementsBefore = buildPlacementRecords(current);
  const priorRounds = [];
  let roundNumber = 1;
  let totalExchangeMatches = 0;

  for (let guard = 0; guard < 20; guard += 1) {
    const plan = planExchangeRound({
      state: current,
      matchLog: current.matchLog,
      exchangeRoundNumber: roundNumber,
      priorExchangeRounds: priorRounds,
      guaranteedMatchCount,
    });
    if (!plan.needed) {
      break;
    }
    assert.equal(
      new Set(plan.matches.flatMap((m) => [m.team1EntryId, m.team2EntryId]))
        .size,
      plan.matches.length * 2
    );
    const results = Object.fromEntries(
      plan.matches.map((m) => [m.matchId, m.team1EntryId])
    );
    current = appendExchangeResultsToMatchLog(current, plan, results);
    totalExchangeMatches += plan.matches.length;
    priorRounds.push({
      sitOutEntryId: plan.sitOutEntryId,
      exchangeRoundNumber: roundNumber,
    });
    roundNumber += 1;
  }

  const placementsAfter = buildPlacementRecords(current);
  assert.deepEqual(placementsAfter, placementsBefore);

  const guarantee = validateGuaranteedMatchCounts(current, current.matchLog, {
    guaranteedMatchCount,
  });
  assert.equal(guarantee.valid, true, guarantee.errors.join("; "));

  return { state: current, totalExchangeMatches, placementsBefore };
}

// ── resolve: 標準5、明示上書き、thirdPlaceと独立 ──
{
  assert.equal(LOSS_BAND_DEFAULT_GUARANTEED_MATCH_COUNT, 5);
  assert.equal(resolveGuaranteedMatchCount(), 5);
  assert.equal(resolveGuaranteedMatchCount({}), 5);
  assert.equal(resolveGuaranteedMatchCount({ thirdPlaceMatch: true }), 5);
  assert.equal(resolveGuaranteedMatchCount({ guaranteedMatchCount: 6 }), 6);
  assert.equal(resolveGuaranteedMatchCount(6), 6);
}

// ── 1. thirdPlaceMatch=false → 保証5、交流戦0 ──
{
  const entryIds = makeEntryIds();
  const ranked = simulateRankingComplete(entryIds, { thirdPlaceMatch: false });
  assert.equal(ranked.guaranteedMatchCount, 5);
  const played = buildPlayedMatchCounts(ranked.matchLog);
  for (const id of entryIds) {
    assert.ok((played[id] ?? 0) >= 5, id);
  }
  assert.equal(
    listExchangeEligibleEntryIds(ranked, ranked.matchLog, {
      guaranteedMatchCount: 5,
    }).length,
    0
  );

  const after = planAfterRankingFullyPlaced({
    stateDoc: buildLossBandStateDoc(entryIds, {
      thirdPlaceMatch: false,
      exchangeMatches: true,
      guaranteedMatchCount: 5,
    }),
    domainState: ranked,
    rematchAvoidance: false,
  });
  assert.equal(after.tournamentComplete, true);
  assert.equal(after.exchangeRoundPlan, null);
  assert.equal(after.nextStateDoc.status, "completed");
}

// ── 2. thirdPlaceMatch=true → 保証5のまま、交流戦0、3位戦2チームのみ6試合 ──
{
  const entryIds = makeEntryIds();
  const ranked = simulateRankingComplete(entryIds, { thirdPlaceMatch: true });
  assert.equal(ranked.guaranteedMatchCount, 5);

  const played = buildPlayedMatchCounts(ranked.matchLog);
  const sixGameTeams = entryIds.filter((id) => (played[id] ?? 0) === 6);
  const fiveGameTeams = entryIds.filter((id) => (played[id] ?? 0) === 5);
  // 決勝2 + 3位決定戦2 = 4人が6試合、残り60人が5試合
  assert.equal(sixGameTeams.length, 4);
  assert.equal(fiveGameTeams.length, 60);
  for (const id of [...ranked.finalists, ...ranked.thirdPlaceFinalists]) {
    assert.equal(played[id], 6, id);
  }

  assert.equal(
    listExchangeEligibleEntryIds(ranked, ranked.matchLog, {
      guaranteedMatchCount: 5,
    }).length,
    0
  );

  const after = planAfterRankingFullyPlaced({
    stateDoc: buildLossBandStateDoc(entryIds, {
      thirdPlaceMatch: true,
      exchangeMatches: true,
      guaranteedMatchCount: 5,
    }),
    domainState: ranked,
    rematchAvoidance: false,
  });
  assert.equal(after.tournamentComplete, true);
  assert.equal(after.exchangeRoundPlan, null);

  const validation = validateCompletePlacements(ranked, {
    thirdPlaceMatch: true,
  });
  assert.equal(validation.valid, true, validation.errors.join("; "));
  assert.equal(expectedFinalPlacementCounts({ thirdPlaceMatch: true }).get(3), 1);
  assert.equal(expectedFinalPlacementCounts({ thirdPlaceMatch: true }).get(4), 1);
}

// ── 3. guaranteedMatchCount=6 明示 → 交流戦発生、placements不変 ──
{
  const entryIds = makeEntryIds();
  const ranked = simulateRankingComplete(entryIds, {
    thirdPlaceMatch: false,
    guaranteedMatchCount: 6,
  });
  assert.equal(ranked.guaranteedMatchCount, 6);

  const eligible = listExchangeEligibleEntryIds(ranked, ranked.matchLog, {
    guaranteedMatchCount: 6,
  });
  // 決勝2人は既に6、残り62人が5 → 交流戦対象62
  assert.equal(eligible.length, 62);
  assert.ok(!eligible.includes(ranked.finalists[0]));
  assert.ok(!eligible.includes(ranked.finalists[1]));

  const plan1 = planExchangeRound({
    state: ranked,
    matchLog: ranked.matchLog,
    exchangeRoundNumber: 1,
    priorExchangeRounds: [],
    guaranteedMatchCount: 6,
  });
  assert.equal(plan1.needed, true);
  assert.equal(plan1.matches.length, 31);
  assert.equal(plan1.guaranteedMatchCount, 6);

  const { state: done, totalExchangeMatches, placementsBefore } =
    runExchangeUntilDone(ranked, { guaranteedMatchCount: 6 });
  assert.equal(totalExchangeMatches, 31);
  assert.equal(
    canCompleteLossBandTournament(done, {
      exchangeMatches: true,
      guaranteedMatchCount: 6,
    }),
    true
  );

  const doc = buildLossBandPlacementsDoc(ranked, { thirdPlaceMatch: false });
  assert.deepEqual(
    doc.placements.map((p) => ({ entryId: p.entryId, placement: p.placement })),
    placementsBefore.map((p) => ({
      entryId: p.entryId,
      placement: p.placement,
    }))
  );
}

// ── 4. guaranteedMatchCount変更は順位ロジックに影響しない ──
{
  const entryIds = makeEntryIds();
  const a = buildPlacementRecords(
    simulateRankingComplete(entryIds, {
      thirdPlaceMatch: false,
      guaranteedMatchCount: 5,
    })
  );
  const b = buildPlacementRecords(
    simulateRankingComplete(entryIds, {
      thirdPlaceMatch: false,
      guaranteedMatchCount: 6,
    })
  );
  assert.deepEqual(a, b);

  const c = buildPlacementRecords(
    simulateRankingComplete(entryIds, {
      thirdPlaceMatch: true,
      guaranteedMatchCount: 5,
    })
  );
  const d = buildPlacementRecords(
    simulateRankingComplete(entryIds, {
      thirdPlaceMatch: true,
      guaranteedMatchCount: 8,
    })
  );
  assert.deepEqual(c, d);
}

// ── 再戦回避・奇数待機・決定論（既存） ──
{
  const history = new Map([
    ["a", new Set(["b"])],
    ["b", new Set(["a"])],
  ]);
  const paired = pairExchangeEntryIds(["a", "b", "c", "d"], {
    opponentHistory: history,
    placements: { a: 5, b: 5, c: 13, d: 13 },
    playedCounts: { a: 5, b: 5, c: 5, d: 5 },
  });
  assert.equal(paired.rematchCount, 0);
  for (const [x, y] of paired.pairs) {
    assert.equal(havePlayedBefore(x, y, history), false);
  }

  assert.equal(pickExchangeSitOutEntryId(["c", "a", "b"], {}), "a");
  assert.equal(pickExchangeSitOutEntryId(["c", "a", "b"], { a: 1 }), "b");

  const x = pairExchangeEntryIds(["d", "c", "b", "a"], {
    placements: { a: 1, b: 2, c: 3, d: 4 },
    playedCounts: { a: 5, b: 5, c: 5, d: 5 },
  });
  const y = pairExchangeEntryIds(["a", "b", "c", "d"], {
    placements: { a: 1, b: 2, c: 3, d: 4 },
    playedCounts: { a: 5, b: 5, c: 5, d: 5 },
  });
  assert.deepEqual(x.pairs, y.pairs);
}

// ── 不正: 順位未確定では交流戦不可 ──
{
  const entryIds = makeEntryIds();
  const mid = createInitialLossBandState(entryIds);
  assert.throws(
    () =>
      planExchangeRound({
        state: mid,
        matchLog: [],
        exchangeRoundNumber: 1,
        guaranteedMatchCount: 5,
      }),
    /completed rankings/
  );

  const ranked = simulateRankingComplete(entryIds, { thirdPlaceMatch: true });
  assert.equal(
    evaluateLossBandTournamentCompletion(ranked, {
      exchangeMatches: true,
      guaranteedMatchCount: 5,
    }).reasonCode,
    LossBandCompletionReasonCode.COMPLETE
  );
}

console.log("loss-band Phase 5 exchange tests: ok");
