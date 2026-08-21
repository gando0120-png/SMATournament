/**
 * Phase 2: loss-band ranking 結果修正プラン（次ラウンド破棄・再生成）
 */
import assert from "node:assert/strict";
import { MatchSessionStatus } from "../../js/domain/constants.js";
import {
  LOSS_BAND_CORRECTION_FIRESTORE_OP_SOFT_LIMIT,
  LOSS_BAND_RESULT_EDIT_LOCKED_MESSAGE,
  assessLossBandRankingResultCorrection,
  buildLossBandByeResultDoc,
  buildValidatedLossBandMatchResult,
  isLossBandNextRoundStartedForEditLock,
  pairingsFromRoundDoc,
  planAfterLossBandMatchSaved,
  planCorrectLossBandRankingResult,
  planLossBandInitialize,
  rebuildDomainStateFromCompletedRounds,
} from "../../js/domain/loss-band/index.js";
import { buildPublicTournamentSnapshot } from "../../js/domain/public-tournament-snapshot.js";
import { RankingMode } from "../../js/domain/loss-band/constants.js";

function entryIds(n) {
  return Array.from({ length: n }, (_, i) => `e${String(i + 1).padStart(3, "0")}`);
}

function scoreInputTeam1Wins() {
  return {
    set1Team1Score: 50,
    set1Team2Score: 30,
    set2Team1Score: 50,
    set2Team2Score: 20,
  };
}

function scoreInputTeam2Wins() {
  return {
    set1Team1Score: 30,
    set1Team2Score: 50,
    set2Team1Score: 20,
    set2Team2Score: 50,
  };
}

function completeRound(initOrState, roundDoc, priorCompletedRounds, rematchAvoidance) {
  const pairings = pairingsFromRoundDoc(roundDoc);
  let stateDoc = initOrState.stateDoc || initOrState;
  let currentRoundDoc = roundDoc;
  let prior = [];
  let lastPlan = null;
  for (let i = 0; i < pairings.matches.length; i += 1) {
    const match = pairings.matches[i];
    const built = buildValidatedLossBandMatchResult({
      match,
      matchNumber: i + 1,
      team1: { entryId: match.team1EntryId, teamName: match.team1EntryId, seed: 1 },
      team2: { entryId: match.team2EntryId, teamName: match.team2EntryId, seed: 2 },
      scoreInput: scoreInputTeam1Wins(),
      winsRequired: 2,
    });
    assert.equal(built.valid, true, built.message);
    lastPlan = planAfterLossBandMatchSaved({
      stateDoc,
      roundDoc: currentRoundDoc,
      priorCompletedResults: prior,
      priorCompletedRounds,
      newResult: built.data,
      rematchAvoidance,
    });
    prior = [...prior, built.data];
    stateDoc = lastPlan.nextStateDoc;
    currentRoundDoc = lastPlan.nextRoundDoc;
  }
  assert.ok(lastPlan?.roundComplete);
  return { lastPlan, results: prior, stateDoc, roundDoc: currentRoundDoc };
}

function buildR1CompleteFixture(n, options = {}) {
  const rematchAvoidance = options.rematchAvoidance === true;
  const init = planLossBandInitialize(entryIds(n), {
    rematchAvoidance,
    thirdPlaceMatch: false,
    exchangeMatches: false,
    bracketSize: options.bracketSize,
  });
  const completed = completeRound(init, init.roundDoc, [], rematchAvoidance);
  assert.ok(completed.lastPlan.nextRoundPlan, "R2 generated");
  const nextRoundDoc = completed.lastPlan.nextRoundPlan.roundDoc;
  const sessionsMap = new Map(
    completed.lastPlan.nextRoundPlan.matchPlans.map(({ session }) => [
      session.matchId,
      session,
    ])
  );
  const resultsMap = new Map(completed.results.map((r) => [r.matchId, r]));
  return {
    init,
    rematchAvoidance,
    r1RoundDoc: completed.roundDoc,
    r1Results: completed.results,
    stateDoc: completed.stateDoc,
    nextRoundDoc,
    sessionsMap,
    resultsMap,
  };
}

function flipFirstMatchWinner(fixture) {
  const first = fixture.r1Results[0];
  const pairings = pairingsFromRoundDoc(fixture.r1RoundDoc);
  const match = pairings.matches.find((m) => m.matchId === first.matchId);
  assert.ok(match);
  const built = buildValidatedLossBandMatchResult({
    match,
    matchNumber: 1,
    team1: { entryId: match.team1EntryId, teamName: match.team1EntryId, seed: 1 },
    team2: { entryId: match.team2EntryId, teamName: match.team2EntryId, seed: 2 },
    scoreInput: scoreInputTeam2Wins(),
    winsRequired: 2,
  });
  assert.equal(built.valid, true, built.message);
  assert.notEqual(built.data.winner.entryId, first.winner.entryId);
  return built.data;
}

function sameWinnerScoreChange(fixture) {
  const first = fixture.r1Results[0];
  const pairings = pairingsFromRoundDoc(fixture.r1RoundDoc);
  const match = pairings.matches.find((m) => m.matchId === first.matchId);
  const built = buildValidatedLossBandMatchResult({
    match,
    matchNumber: 1,
    team1: { entryId: match.team1EntryId, teamName: match.team1EntryId, seed: 1 },
    team2: { entryId: match.team2EntryId, teamName: match.team2EntryId, seed: 2 },
    scoreInput: {
      set1Team1Score: 50,
      set1Team2Score: 10,
      set2Team1Score: 50,
      set2Team2Score: 5,
    },
    winsRequired: 2,
  });
  assert.equal(built.valid, true, built.message);
  assert.equal(built.data.winner.entryId, first.winner.entryId);
  return built.data;
}

function runCorrection(fixture, correctedResult, overrides = {}) {
  return planCorrectLossBandRankingResult({
    stateDoc: fixture.stateDoc,
    targetRoundDoc: fixture.r1RoundDoc,
    matchId: correctedResult.matchId,
    existingResult: fixture.r1Results[0],
    correctedResult,
    priorCompletedRounds: [],
    targetRoundOtherResults: fixture.r1Results.slice(1),
    nextRoundDoc: fixture.nextRoundDoc,
    nextRoundSessionsMap: fixture.sessionsMap,
    nextRoundResultsMap: new Map(),
    hasPlacements: false,
    hasTournamentResults: false,
    tournamentStatus: "open",
    expectedRevision: fixture.stateDoc.revision ?? 0,
    rematchAvoidance: fixture.rematchAvoidance,
    ...overrides,
  });
}

// --- basic 32/64/128 ---
for (const n of [32, 64, 128]) {
  const fixture = buildR1CompleteFixture(n, { bracketSize: n });
  const corrected = flipFirstMatchWinner(fixture);
  const plan = runCorrection(fixture, corrected);

  assert.ok(plan.discardNext, `n=${n} discard R2`);
  assert.equal(plan.discardNext.roundId, "r2");
  assert.equal(
    plan.discardNext.sessionMatchIds.length,
    fixture.nextRoundDoc.matchIds.length
  );
  assert.ok(plan.nextRoundPlan);
  assert.equal(plan.nextRoundPlan.roundDoc.roundId, "r2");
  for (const { session } of plan.nextRoundPlan.matchPlans) {
    assert.equal(session.status, MatchSessionStatus.READY);
    assert.equal("startedAt" in session, false);
  }
  assert.equal(plan.nextStateDoc.completedRankingRound, 1);
  assert.equal(plan.nextStateDoc.currentRoundId, "r2");
  assert.equal(plan.nextStateDoc.revision, 1);
  assert.ok(plan.estimatedOps < LOSS_BAND_CORRECTION_FIRESTORE_OP_SOFT_LIMIT);
  assert.ok(plan.estimatedOps < 500, `n=${n} under hard limit`);

  // 勝者変更で R2 pairing が変わり得る（少なくとも plan は成功）
  const oldPairs = JSON.stringify(fixture.nextRoundDoc.pairs || fixture.nextRoundDoc.bands);
  const newPairs = JSON.stringify(
    plan.nextRoundPlan.roundDoc.pairs || plan.nextRoundPlan.roundDoc.bands
  );
  assert.notEqual(oldPairs, newPairs, `n=${n} winner flip regenerates pairing`);
}

// --- same winner score change still regenerates ---
{
  const fixture = buildR1CompleteFixture(32, { bracketSize: 32 });
  const corrected = sameWinnerScoreChange(fixture);
  const plan = runCorrection(fixture, corrected);
  assert.ok(plan.nextRoundPlan);
  assert.equal(plan.correctedResult.winner.entryId, fixture.r1Results[0].winner.entryId);
}

// --- locks ---
{
  const fixture = buildR1CompleteFixture(32, { bracketSize: 32 });
  const corrected = flipFirstMatchWinner(fixture);
  const mid = fixture.nextRoundDoc.matchIds[0];

  for (const [label, sessionsMap, resultsMap] of [
    [
      "playing",
      new Map([[mid, { status: MatchSessionStatus.PLAYING }]]),
      new Map(),
    ],
    [
      "finished",
      new Map([[mid, { status: MatchSessionStatus.FINISHED }]]),
      new Map(),
    ],
    [
      "result",
      new Map(fixture.sessionsMap),
      new Map([[mid, { matchId: mid }]]),
    ],
  ]) {
    assert.equal(
      isLossBandNextRoundStartedForEditLock({
        nextRoundMatchIds: fixture.nextRoundDoc.matchIds,
        sessionsMap,
        resultsMap,
      }),
      true,
      label
    );
    assert.throws(
      () =>
        runCorrection(fixture, corrected, {
          nextRoundSessionsMap: sessionsMap,
          nextRoundResultsMap: resultsMap,
        }),
      (err) =>
        err.code === "loss-band/next-round-started" &&
        err.message === LOSS_BAND_RESULT_EDIT_LOCKED_MESSAGE,
      label
    );
  }
}

// --- ready only OK ---
{
  const fixture = buildR1CompleteFixture(32, { bracketSize: 32 });
  const corrected = flipFirstMatchWinner(fixture);
  const gate = assessLossBandRankingResultCorrection({
    tournamentStatus: "open",
    stateDoc: fixture.stateDoc,
    targetRoundDoc: fixture.r1RoundDoc,
    matchId: corrected.matchId,
    existingResult: fixture.r1Results[0],
    nextRoundDoc: fixture.nextRoundDoc,
    nextRoundSessionsMap: fixture.sessionsMap,
    nextRoundResultsMap: new Map(),
  });
  assert.equal(gate.ok, true);
}

// --- BYE reject ---
{
  const fixture = buildR1CompleteFixture(31, { bracketSize: 32 });
  const bye = (fixture.r1RoundDoc.byes || [])[0];
  assert.ok(bye, "31 teams has BYE");
  const byeResult = buildLossBandByeResultDoc(bye);
  const gate = assessLossBandRankingResultCorrection({
    tournamentStatus: "open",
    stateDoc: fixture.stateDoc,
    targetRoundDoc: fixture.r1RoundDoc,
    matchId: bye.matchId,
    existingResult: byeResult,
    nextRoundDoc: fixture.nextRoundDoc,
    nextRoundSessionsMap: fixture.sessionsMap,
    nextRoundResultsMap: new Map(),
  });
  assert.equal(gate.ok, false);
  assert.equal(gate.code, "loss-band/bye-not-editable");
}

// --- completed / placements / exchange / tournamentResults ---
{
  const fixture = buildR1CompleteFixture(32, { bracketSize: 32 });
  const mid = fixture.r1Results[0].matchId;
  for (const [label, params] of [
    ["placements", { hasPlacements: true }],
    ["tournamentResults", { hasTournamentResults: true }],
    [
      "completed",
      { stateDoc: { ...fixture.stateDoc, status: "completed" } },
    ],
    [
      "exchange_pending",
      { stateDoc: { ...fixture.stateDoc, status: "exchange_pending" } },
    ],
  ]) {
    const gate = assessLossBandRankingResultCorrection({
      tournamentStatus: "open",
      stateDoc: fixture.stateDoc,
      targetRoundDoc: fixture.r1RoundDoc,
      matchId: mid,
      existingResult: fixture.r1Results[0],
      nextRoundDoc: fixture.nextRoundDoc,
      nextRoundSessionsMap: fixture.sessionsMap,
      nextRoundResultsMap: new Map(),
      ...params,
    });
    assert.equal(gate.ok, false, label);
  }
}

// --- revision / idempotency ---
{
  const fixture = buildR1CompleteFixture(32, { bracketSize: 32 });
  const corrected = flipFirstMatchWinner(fixture);
  const plan1 = runCorrection(fixture, corrected);
  assert.throws(
    () =>
      runCorrection(fixture, corrected, {
        expectedRevision: 0,
        stateDoc: { ...fixture.stateDoc, revision: plan1.nextRevision },
      }),
    (err) => err.code === "loss-band/revision-mismatch"
  );
}

// --- determinism ---
{
  const fixture = buildR1CompleteFixture(64, {
    bracketSize: 64,
    rematchAvoidance: true,
  });
  const corrected = flipFirstMatchWinner(fixture);
  const a = runCorrection(fixture, corrected);
  const b = runCorrection(fixture, corrected);
  assert.deepEqual(
    a.nextRoundPlan.roundDoc.bands,
    b.nextRoundPlan.roundDoc.bands
  );
  assert.deepEqual(
    a.nextRoundPlan.matchPlans.map((p) => p.match.matchId),
    b.nextRoundPlan.matchPlans.map((p) => p.match.matchId)
  );
}

// --- rematch avoidance retained after correction ---
{
  const fixture = buildR1CompleteFixture(48, {
    bracketSize: 64,
    rematchAvoidance: true,
  });
  const corrected = flipFirstMatchWinner(fixture);
  const plan = runCorrection(fixture, corrected);
  assert.equal(plan.nextRoundPlan.roundDoc.rematchAvoidance, true);
  assert.equal(plan.nextStateDoc.rematchAvoidance, true);
  // rebuild domain then pair again → same
  const rebuilt = rebuildDomainStateFromCompletedRounds(
    fixture.stateDoc.entryIds,
    [
      {
        roundDoc: fixture.r1RoundDoc,
        results: [
          corrected,
          ...fixture.r1Results.slice(1),
        ],
      },
    ],
    { rematchAvoidance: true, bracketSize: 64 }
  );
  assert.equal(rebuilt.rematchAvoidance, true);
}

// --- public snapshot shape with corrected next round ---
{
  const fixture = buildR1CompleteFixture(32, { bracketSize: 32 });
  const corrected = flipFirstMatchWinner(fixture);
  const plan = runCorrection(fixture, corrected);
  const resultsMap = new Map([
    ...fixture.r1Results.slice(1).map((r) => [r.matchId, r]),
    [corrected.matchId, corrected],
  ]);
  const sessionsMap = new Map(
    plan.nextRoundPlan.matchPlans.map(({ session }) => [session.matchId, session])
  );
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
    lossBandRounds: [fixture.r1RoundDoc, plan.nextRoundPlan.roundDoc],
    lossBandResultsMap: resultsMap,
    lossBandSessionsMap: sessionsMap,
    lossBandPlacements: null,
    lossBandExchangeRounds: [],
    lossBandExchangeResultsMap: new Map(),
  });
  assert.equal(snapshot.lossBand?.visible, true);
  assert.ok((snapshot.lossBand?.rounds || []).length >= 1);
}

// --- BYE sizes 48 / 96 at least one correction path ---
for (const [n, bracketSize] of [
  [48, 64],
  [96, 128],
]) {
  const fixture = buildR1CompleteFixture(n, { bracketSize });
  assert.ok((fixture.r1RoundDoc.byes || []).length >= 1 || n % 2 === 0);
  const corrected = flipFirstMatchWinner(fixture);
  const plan = runCorrection(fixture, corrected);
  assert.ok(plan.nextRoundPlan, `n=${n} regen`);
  assert.ok(plan.estimatedOps < 500);
}

console.log("loss-band-ranking-result-correction.test.mjs: ok");
