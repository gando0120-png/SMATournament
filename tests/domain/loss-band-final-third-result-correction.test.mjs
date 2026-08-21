/**
 * Phase 3: loss-band final / third_place 結果修正
 */
import assert from "node:assert/strict";
import {
  LOSS_BAND_RESULT_EDIT_LOCKED_MESSAGE,
  assessLossBandFinalResultCorrection,
  assessLossBandRankingResultCorrection,
  assessLossBandThirdPlaceResultCorrection,
  buildPlacementRecords,
  buildValidatedLossBandMatchResult,
  isLossBandExchangeStartedForEditLock,
  pairingsFromRoundDoc,
  planAfterLossBandMatchSaved,
  planCorrectLossBandFinalResult,
  planCorrectLossBandRankingResult,
  planCorrectLossBandThirdPlaceResult,
  planLossBandInitialize,
  rebuildDomainStateFromCompletedRounds,
} from "../../js/domain/loss-band/index.js";
import { buildPublicTournamentSnapshot } from "../../js/domain/public-tournament-snapshot.js";
import { RankingMode } from "../../js/domain/loss-band/constants.js";

function entryIds(n) {
  return Array.from({ length: n }, (_, i) => `e${String(i + 1).padStart(3, "0")}`);
}

function scoreTeam1() {
  return {
    set1Team1Score: 50,
    set1Team2Score: 20,
    set2Team1Score: 50,
    set2Team2Score: 10,
  };
}

function scoreTeam2() {
  return {
    set1Team1Score: 20,
    set1Team2Score: 50,
    set2Team1Score: 10,
    set2Team2Score: 50,
  };
}

function resultFor(match, matchNumber, scoreInput) {
  const built = buildValidatedLossBandMatchResult({
    match,
    matchNumber,
    team1: { entryId: match.team1EntryId, teamName: match.team1EntryId, seed: 1 },
    team2: { entryId: match.team2EntryId, teamName: match.team2EntryId, seed: 2 },
    scoreInput,
    winsRequired: 2,
  });
  assert.equal(built.valid, true, built.message);
  return built.data;
}

function completeCurrentRound(stateDoc, roundDoc, rematchAvoidance, priorCompletedRounds, flipFirst = false) {
  const pairings = pairingsFromRoundDoc(roundDoc);
  let prior = [];
  let currentRoundDoc = roundDoc;
  let currentState = stateDoc;
  let lastPlan = null;
  for (let i = 0; i < pairings.matches.length; i += 1) {
    const match = pairings.matches[i];
    const score = flipFirst && i === 0 ? scoreTeam2() : scoreTeam1();
    const result = resultFor(match, i + 1, score);
    lastPlan = planAfterLossBandMatchSaved({
      stateDoc: currentState,
      roundDoc: currentRoundDoc,
      priorCompletedResults: prior,
      priorCompletedRounds,
      newResult: result,
      rematchAvoidance,
    });
    prior = [...prior, result];
    currentRoundDoc = lastPlan.nextRoundDoc;
    currentState = lastPlan.nextStateDoc;
  }
  assert.equal(lastPlan.roundComplete, true);
  return { lastPlan, results: prior, stateDoc: currentState, roundDoc: currentRoundDoc };
}

function runToFinal(n, options = {}) {
  const rematchAvoidance = options.rematchAvoidance !== false;
  const thirdPlaceMatch = options.thirdPlaceMatch === true;
  const exchangeMatches = options.exchangeMatches === true;
  const init = planLossBandInitialize(entryIds(n), {
    rematchAvoidance,
    thirdPlaceMatch,
    exchangeMatches,
    bracketSize: options.bracketSize,
  });

  /** @type {Array<{ roundDoc: object, results: object[] }>} */
  const completedRankingRounds = [];
  let stateDoc = init.stateDoc;
  let roundDoc = init.roundDoc;
  let lastPlan = null;

  // complete all ranking rounds
  while (true) {
    const done = completeCurrentRound(
      stateDoc,
      roundDoc,
      rematchAvoidance,
      completedRankingRounds
    );
    completedRankingRounds.push({
      roundDoc: done.roundDoc,
      results: done.results,
    });
    lastPlan = done.lastPlan;
    stateDoc = done.stateDoc;
    if (!lastPlan.nextRoundPlan) break;
    const nextPurpose =
      lastPlan.nextRoundPlan.roundDoc.matchPurpose || "ranking";
    if (nextPurpose !== "ranking") break;
    roundDoc = lastPlan.nextRoundPlan.roundDoc;
  }

  assert.ok(lastPlan.nextRoundPlan);
  assert.equal(lastPlan.nextRoundPlan.roundDoc.roundId, "final");
  const finalRoundDoc = {
    ...lastPlan.nextRoundPlan.roundDoc,
    status: "open",
  };
  const finalMatch = pairingsFromRoundDoc(finalRoundDoc).matches[0];
  const finalResult = resultFor(finalMatch, 1, scoreTeam1());

  // auto-3rd 等で domain 側 thirdPlaceMatch が無効化されている場合がある
  let afterFinal;
  try {
    afterFinal = planAfterLossBandMatchSaved({
      stateDoc,
      roundDoc: finalRoundDoc,
      priorCompletedResults: [],
      priorCompletedRounds: completedRankingRounds,
      newResult: finalResult,
      rematchAvoidance,
    });
  } catch (error) {
    if (
      thirdPlaceMatch &&
      (error.code === "loss-band/invalid-phase" ||
        error.code === "loss-band/third-place-count")
    ) {
      // domain が auto-3rd で COMPLETE になったケース: thirdPlaceMatch を外して再実行
      afterFinal = planAfterLossBandMatchSaved({
        stateDoc: { ...stateDoc, thirdPlaceMatch: false },
        roundDoc: finalRoundDoc,
        priorCompletedResults: [],
        priorCompletedRounds: completedRankingRounds,
        newResult: finalResult,
        rematchAvoidance,
      });
      return {
        rematchAvoidance,
        thirdPlaceMatch: false,
        autoThird: true,
        exchangeMatches,
        completedRankingRounds,
        stateAfterFinal: afterFinal.nextStateDoc,
        finalRoundDoc: afterFinal.nextRoundDoc,
        finalResult,
        afterFinal,
        init,
      };
    }
    throw error;
  }

  return {
    rematchAvoidance,
    thirdPlaceMatch,
    autoThird: false,
    exchangeMatches,
    completedRankingRounds,
    stateAfterFinal: afterFinal.nextStateDoc,
    finalRoundDoc: afterFinal.nextRoundDoc,
    finalResult,
    afterFinal,
    init,
  };
}

function flipFinalWinner(fixture) {
  const match = pairingsFromRoundDoc(fixture.finalRoundDoc).matches[0];
  return resultFor(match, 1, scoreTeam2());
}

function sameWinnerScoreChange(fixture) {
  const match = pairingsFromRoundDoc(fixture.finalRoundDoc).matches[0];
  return resultFor(match, 1, {
    set1Team1Score: 50,
    set1Team2Score: 5,
    set2Team1Score: 50,
    set2Team2Score: 1,
  });
}

// --- final correction: winner swap 1/2, 3+ unchanged ---
{
  const fixture = runToFinal(32, {
    bracketSize: 32,
    thirdPlaceMatch: false,
    exchangeMatches: false,
  });
  assert.equal(fixture.stateAfterFinal.status, "completed");
  assert.ok(fixture.afterFinal.placementsDoc);

  const before = buildPlacementRecords(
    rebuildDomainStateFromCompletedRounds(
      fixture.stateAfterFinal.entryIds,
      [
        ...fixture.completedRankingRounds,
        {
          roundDoc: fixture.finalRoundDoc,
          results: [fixture.finalResult],
        },
      ],
      { thirdPlaceMatch: false, rematchAvoidance: true, bracketSize: 32 }
    )
  );
  const corrected = flipFinalWinner(fixture);
  assert.notEqual(corrected.winner.entryId, fixture.finalResult.winner.entryId);

  const plan = planCorrectLossBandFinalResult({
    tournamentStatus: "open",
    hasTournamentResults: false,
    stateDoc: fixture.stateAfterFinal,
    targetRoundDoc: fixture.finalRoundDoc,
    matchId: corrected.matchId,
    existingResult: fixture.finalResult,
    correctedResult: corrected,
    expectedRevision: fixture.stateAfterFinal.revision ?? 0,
    exchangeRounds: [],
    exchangeResultsMap: new Map(),
    completedRankingRounds: fixture.completedRankingRounds,
    finalRoundDoc: fixture.finalRoundDoc,
    rematchAvoidance: true,
  });

  assert.ok(plan.placementsDoc);
  const after = plan.placementsDoc.placements;
  const p1Before = before.find((r) => r.placement === 1).entryId;
  const p2Before = before.find((r) => r.placement === 2).entryId;
  const p1After = after.find((r) => r.placement === 1).entryId;
  const p2After = after.find((r) => r.placement === 2).entryId;
  assert.equal(p1After, p2Before);
  assert.equal(p2After, p1Before);

  const below3Before = before
    .filter((r) => r.placement >= 3)
    .map((r) => `${r.entryId}:${r.placement}`)
    .sort();
  const below3After = after
    .filter((r) => r.placement >= 3)
    .map((r) => `${r.entryId}:${r.placement}`)
    .sort();
  assert.deepEqual(below3After, below3Before);

  // same winner score change
  const scoreOnly = sameWinnerScoreChange(fixture);
  const plan2 = planCorrectLossBandFinalResult({
    tournamentStatus: "open",
    hasTournamentResults: false,
    stateDoc: fixture.stateAfterFinal,
    targetRoundDoc: fixture.finalRoundDoc,
    matchId: scoreOnly.matchId,
    existingResult: fixture.finalResult,
    correctedResult: scoreOnly,
    expectedRevision: 0,
    exchangeRounds: [],
    exchangeResultsMap: new Map(),
    completedRankingRounds: fixture.completedRankingRounds,
    finalRoundDoc: fixture.finalRoundDoc,
    rematchAvoidance: true,
  });
  assert.equal(plan2.placementsDoc.championEntryId, fixture.finalResult.winner.entryId);
}

// --- third_place pending: final correct without discarding third ---
{
  const fixture = runToFinal(32, {
    bracketSize: 32,
    thirdPlaceMatch: true,
    exchangeMatches: false,
  });
  assert.equal(fixture.stateAfterFinal.status, "third_place_pending");
  assert.equal(fixture.afterFinal.placementsDoc, null);
  assert.ok(fixture.afterFinal.nextRoundPlan);
  assert.equal(fixture.afterFinal.nextRoundPlan.roundDoc.roundId, "third_place");

  const thirdRound = fixture.afterFinal.nextRoundPlan.roundDoc;
  const corrected = flipFinalWinner(fixture);
  const plan = planCorrectLossBandFinalResult({
    tournamentStatus: "open",
    hasTournamentResults: false,
    stateDoc: fixture.stateAfterFinal,
    targetRoundDoc: fixture.finalRoundDoc,
    matchId: corrected.matchId,
    existingResult: fixture.finalResult,
    correctedResult: corrected,
    expectedRevision: 0,
    exchangeRounds: [],
    exchangeResultsMap: new Map(),
    completedRankingRounds: fixture.completedRankingRounds,
    finalRoundDoc: fixture.finalRoundDoc,
    thirdPlaceRoundDoc: thirdRound,
    thirdPlaceResult: null,
    rematchAvoidance: true,
  });
  assert.equal(plan.placementsDoc, null);
  assert.equal(plan.discardExchange, null);
  assert.equal(plan.nextStateDoc.status, "third_place_pending");
  // third pairing participants unchanged
  assert.deepEqual(
    (thirdRound.pairs || []).map((p) => [p.team1EntryId, p.team2EntryId]),
    (fixture.afterFinal.nextRoundPlan.roundDoc.pairs || []).map((p) => [
      p.team1EntryId,
      p.team2EntryId,
    ])
  );
}

// --- third_place correction: 3/4 swap, 1/2 and 5+ unchanged ---
{
  const fixture = runToFinal(32, {
    bracketSize: 32,
    thirdPlaceMatch: true,
    exchangeMatches: false,
  });
  const thirdRoundDoc = fixture.afterFinal.nextRoundPlan.roundDoc;
  const thirdMatch = pairingsFromRoundDoc(thirdRoundDoc).matches[0];
  const thirdResult = resultFor(thirdMatch, 1, scoreTeam1());
  const afterThird = planAfterLossBandMatchSaved({
    stateDoc: fixture.stateAfterFinal,
    roundDoc: thirdRoundDoc,
    priorCompletedResults: [],
    priorCompletedRounds: [
      ...fixture.completedRankingRounds,
      { roundDoc: fixture.finalRoundDoc, results: [fixture.finalResult] },
    ],
    newResult: thirdResult,
    rematchAvoidance: true,
  });
  assert.ok(afterThird.placementsDoc);

  const before = afterThird.placementsDoc.placements;
  const flippedThird = resultFor(thirdMatch, 1, scoreTeam2());
  const plan = planCorrectLossBandThirdPlaceResult({
    tournamentStatus: "open",
    hasTournamentResults: false,
    stateDoc: afterThird.nextStateDoc,
    targetRoundDoc: afterThird.nextRoundDoc,
    matchId: flippedThird.matchId,
    existingResult: thirdResult,
    correctedResult: flippedThird,
    expectedRevision: afterThird.nextStateDoc.revision ?? 0,
    exchangeRounds: [],
    exchangeResultsMap: new Map(),
    completedRankingRounds: fixture.completedRankingRounds,
    finalRoundDoc: fixture.finalRoundDoc,
    finalResult: fixture.finalResult,
    thirdPlaceRoundDoc: afterThird.nextRoundDoc,
    rematchAvoidance: true,
  });

  const after = plan.placementsDoc.placements;
  assert.equal(
    after.find((r) => r.placement === 1).entryId,
    before.find((r) => r.placement === 1).entryId
  );
  assert.equal(
    after.find((r) => r.placement === 2).entryId,
    before.find((r) => r.placement === 2).entryId
  );
  assert.equal(
    after.find((r) => r.placement === 3).entryId,
    before.find((r) => r.placement === 4).entryId
  );
  assert.equal(
    after.find((r) => r.placement === 4).entryId,
    before.find((r) => r.placement === 3).entryId
  );
  const below5Before = before
    .filter((r) => r.placement >= 5)
    .map((r) => `${r.entryId}:${r.placement}`)
    .sort();
  const below5After = after
    .filter((r) => r.placement >= 5)
    .map((r) => `${r.entryId}:${r.placement}`)
    .sort();
  assert.deepEqual(below5After, below5Before);
}

// --- locks ---
{
  const fixture = runToFinal(32, {
    bracketSize: 32,
    thirdPlaceMatch: false,
    exchangeMatches: false,
  });
  const mid = fixture.finalResult.matchId;

  assert.equal(
    assessLossBandFinalResultCorrection({
      tournamentStatus: "open",
      hasTournamentResults: true,
      stateDoc: fixture.stateAfterFinal,
      targetRoundDoc: fixture.finalRoundDoc,
      matchId: mid,
      existingResult: fixture.finalResult,
    }).ok,
    false
  );
  assert.equal(
    assessLossBandFinalResultCorrection({
      tournamentStatus: "closed",
      hasTournamentResults: false,
      stateDoc: fixture.stateAfterFinal,
      targetRoundDoc: fixture.finalRoundDoc,
      matchId: mid,
      existingResult: fixture.finalResult,
    }).ok,
    false
  );

  const exchangeRounds = [{ roundId: "ex1", matchIds: ["lb-ex1-m1"] }];
  assert.equal(
    isLossBandExchangeStartedForEditLock({
      exchangeRounds,
      exchangeResultsMap: new Map([["lb-ex1-m1", { matchId: "lb-ex1-m1" }]]),
    }),
    true
  );
  assert.equal(
    assessLossBandFinalResultCorrection({
      tournamentStatus: "open",
      hasTournamentResults: false,
      stateDoc: { ...fixture.stateAfterFinal, status: "exchange_pending" },
      targetRoundDoc: fixture.finalRoundDoc,
      matchId: mid,
      existingResult: fixture.finalResult,
      exchangeRounds,
      exchangeResultsMap: new Map([["lb-ex1-m1", { matchId: "lb-ex1-m1" }]]),
    }).ok,
    false
  );

  // resultless exchange → allow
  assert.equal(
    assessLossBandFinalResultCorrection({
      tournamentStatus: "open",
      hasTournamentResults: false,
      stateDoc: { ...fixture.stateAfterFinal, status: "exchange_pending" },
      targetRoundDoc: fixture.finalRoundDoc,
      matchId: mid,
      existingResult: fixture.finalResult,
      exchangeRounds,
      exchangeResultsMap: new Map(),
    }).ok,
    true
  );
}

// --- exchange resultless discard + regen ---
{
  const fixture = runToFinal(32, {
    bracketSize: 32,
    thirdPlaceMatch: false,
    exchangeMatches: true,
    rematchAvoidance: true,
  });
  // may or may not need exchange depending on guaranteed counts
  const exchangeRounds =
    fixture.afterFinal.exchangeRoundPlan
      ? [fixture.afterFinal.exchangeRoundPlan.roundDoc]
      : [];
  const corrected = flipFinalWinner(fixture);
  const plan = planCorrectLossBandFinalResult({
    tournamentStatus: "open",
    hasTournamentResults: false,
    stateDoc: fixture.stateAfterFinal,
    targetRoundDoc: fixture.finalRoundDoc,
    matchId: corrected.matchId,
    existingResult: fixture.finalResult,
    correctedResult: corrected,
    expectedRevision: 0,
    exchangeRounds,
    exchangeResultsMap: new Map(),
    completedRankingRounds: fixture.completedRankingRounds,
    finalRoundDoc: fixture.finalRoundDoc,
    rematchAvoidance: true,
  });
  assert.ok(plan.placementsDoc);
  if (exchangeRounds.length > 0) {
    assert.ok(plan.discardExchange);
    assert.ok(plan.discardExchange.roundIds.includes("ex1"));
  }
}

// --- sizes 32/64/128 + BYE 31/48 ---
for (const [n, bracketSize, third] of [
  [32, 32, false],
  [64, 64, true],
  [128, 128, false],
  [31, 32, false],
  [48, 64, true],
]) {
  const fixture = runToFinal(n, {
    bracketSize,
    thirdPlaceMatch: third,
    exchangeMatches: false,
  });
  const corrected = flipFinalWinner(fixture);
  if (third && !fixture.autoThird) {
    // finish third quickly if pending
    if (fixture.stateAfterFinal.status === "third_place_pending") {
      const thirdRoundDoc = fixture.afterFinal.nextRoundPlan.roundDoc;
      const thirdMatch = pairingsFromRoundDoc(thirdRoundDoc).matches[0];
      const thirdResult = resultFor(thirdMatch, 1, scoreTeam1());
      const afterThird = planAfterLossBandMatchSaved({
        stateDoc: fixture.stateAfterFinal,
        roundDoc: thirdRoundDoc,
        priorCompletedResults: [],
        priorCompletedRounds: [
          ...fixture.completedRankingRounds,
          { roundDoc: fixture.finalRoundDoc, results: [fixture.finalResult] },
        ],
        newResult: thirdResult,
        rematchAvoidance: true,
      });
      const plan = planCorrectLossBandFinalResult({
        tournamentStatus: "open",
        hasTournamentResults: false,
        stateDoc: afterThird.nextStateDoc,
        targetRoundDoc: fixture.finalRoundDoc,
        matchId: corrected.matchId,
        existingResult: fixture.finalResult,
        correctedResult: corrected,
        expectedRevision: 0,
        exchangeRounds: [],
        exchangeResultsMap: new Map(),
        completedRankingRounds: fixture.completedRankingRounds,
        finalRoundDoc: fixture.finalRoundDoc,
        thirdPlaceRoundDoc: afterThird.nextRoundDoc,
        thirdPlaceResult: thirdResult,
        rematchAvoidance: true,
      });
      assert.ok(plan.placementsDoc, `n=${n} placements`);
      assert.equal(plan.placementsDoc.placements.length, n);
    }
  } else {
    const plan = planCorrectLossBandFinalResult({
      tournamentStatus: "open",
      hasTournamentResults: false,
      stateDoc: fixture.stateAfterFinal,
      targetRoundDoc: fixture.finalRoundDoc,
      matchId: corrected.matchId,
      existingResult: fixture.finalResult,
      correctedResult: corrected,
      expectedRevision: 0,
      exchangeRounds: [],
      exchangeResultsMap: new Map(),
      completedRankingRounds: fixture.completedRankingRounds,
      finalRoundDoc: fixture.finalRoundDoc,
      rematchAvoidance: true,
    });
    assert.ok(plan.placementsDoc, `n=${n}`);
    assert.equal(plan.placementsDoc.placements.length, n);
    const ids = plan.placementsDoc.placements.map((r) => r.entryId);
    assert.equal(new Set(ids).size, n);
    if (fixture.autoThird) {
      const thirds = plan.placementsDoc.placements.filter((r) => r.placement === 3);
      assert.equal(thirds.length, 1, `n=${n} auto-3rd single`);
    }
  }
}

// --- publicSnapshot after final correction ---
{
  const fixture = runToFinal(32, {
    bracketSize: 32,
    thirdPlaceMatch: false,
    exchangeMatches: false,
  });
  const corrected = flipFinalWinner(fixture);
  const plan = planCorrectLossBandFinalResult({
    tournamentStatus: "open",
    hasTournamentResults: false,
    stateDoc: fixture.stateAfterFinal,
    targetRoundDoc: fixture.finalRoundDoc,
    matchId: corrected.matchId,
    existingResult: fixture.finalResult,
    correctedResult: corrected,
    expectedRevision: 0,
    exchangeRounds: [],
    exchangeResultsMap: new Map(),
    completedRankingRounds: fixture.completedRankingRounds,
    finalRoundDoc: fixture.finalRoundDoc,
    rematchAvoidance: true,
  });
  const resultsMap = new Map([[corrected.matchId, corrected]]);
  for (const { results } of fixture.completedRankingRounds) {
    for (const r of results) resultsMap.set(r.matchId, r);
  }
  const snapshot = buildPublicTournamentSnapshot({
    tournament: {
      name: "LB",
      status: "open",
      bracketMatchConfig: { main: { rankingMode: RankingMode.LOSS_BAND } },
      maxTeams: 32,
    },
    entries: entryIds(32).map((id) => ({
      id,
      teamName: id,
      status: "confirmed",
    })),
    blockDraw: null,
    schedule: null,
    qualifyingResultsMap: new Map(),
    qualifyingSessionsMap: new Map(),
    finalsAdvancement: null,
    finalsBracket: null,
    finalsResultsMap: new Map(),
    finalsSessionsMap: new Map(),
    tournamentResults: null,
    consolationBracket: null,
    consolationResultsMap: new Map(),
    consolationSessionsMap: new Map(),
    lossBandState: plan.nextStateDoc,
    lossBandRounds: [
      ...fixture.completedRankingRounds.map((c) => c.roundDoc),
      fixture.finalRoundDoc,
    ],
    lossBandResultsMap: resultsMap,
    lossBandSessionsMap: new Map(),
    lossBandPlacements: plan.placementsDoc,
    lossBandExchangeRounds: [],
    lossBandExchangeResultsMap: new Map(),
  });
  assert.equal(snapshot.lossBand?.visible, true);
  assert.equal(
    snapshot.lossBand?.placements?.champion?.entryId ||
      snapshot.lossBand?.placements?.championEntryId ||
      plan.placementsDoc.championEntryId,
    corrected.winner.entryId
  );
}

// --- Phase 2 ranking regression still works ---
{
  const init = planLossBandInitialize(entryIds(32), {
    rematchAvoidance: false,
    thirdPlaceMatch: false,
    exchangeMatches: false,
    bracketSize: 32,
  });
  const done = completeCurrentRound(init.stateDoc, init.roundDoc, false, []);
  const nextRoundDoc = done.lastPlan.nextRoundPlan.roundDoc;
  const sessionsMap = new Map(
    done.lastPlan.nextRoundPlan.matchPlans.map(({ session }) => [
      session.matchId,
      session,
    ])
  );
  const first = done.results[0];
  const match = pairingsFromRoundDoc(done.roundDoc).matches.find(
    (m) => m.matchId === first.matchId
  );
  const corrected = resultFor(match, 1, scoreTeam2());
  const plan = planCorrectLossBandRankingResult({
    stateDoc: done.stateDoc,
    targetRoundDoc: done.roundDoc,
    matchId: corrected.matchId,
    existingResult: first,
    correctedResult: corrected,
    priorCompletedRounds: [],
    targetRoundOtherResults: done.results.slice(1),
    nextRoundDoc,
    nextRoundSessionsMap: sessionsMap,
    nextRoundResultsMap: new Map(),
    hasPlacements: false,
    hasTournamentResults: false,
    tournamentStatus: "open",
    expectedRevision: 0,
    rematchAvoidance: false,
  });
  assert.ok(plan.nextRoundPlan);

  // next started → reject
  assert.equal(
    assessLossBandRankingResultCorrection({
      tournamentStatus: "open",
      stateDoc: done.stateDoc,
      targetRoundDoc: done.roundDoc,
      matchId: first.matchId,
      existingResult: first,
      nextRoundDoc,
      nextRoundSessionsMap: new Map([
        [nextRoundDoc.matchIds[0], { status: "playing" }],
      ]),
      nextRoundResultsMap: new Map(),
    }).message,
    LOSS_BAND_RESULT_EDIT_LOCKED_MESSAGE
  );
}

console.log("loss-band-final-third-result-correction.test.mjs: ok");
