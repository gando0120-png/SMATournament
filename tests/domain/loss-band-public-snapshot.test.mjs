/**
 * Phase 7: loss_band publicSnapshot / public view
 */
import assert from "node:assert/strict";
import { TournamentStatus, EntryStatus } from "../../js/domain/constants.js";
import { TournamentFormat } from "../../js/domain/tournament-format.js";
import {
  buildPublicTournamentSnapshot,
  buildPublicTournamentViewFromSnapshot,
  findForbiddenSnapshotFields,
} from "../../js/domain/public-tournament-snapshot.js";
import {
  RankingMode,
  LOSS_BAND_TEAM_COUNT,
  planLossBandInitialize,
  planAfterLossBandMatchSaved,
  pairingsFromRoundDoc,
  buildValidatedLossBandMatchResult,
  buildLossBandPublicSection,
  formatLossBandBandLabel,
} from "../../js/domain/loss-band/index.js";

function entryIds64() {
  return Array.from({ length: LOSS_BAND_TEAM_COUNT }, (_, i) =>
    `e${String(i + 1).padStart(2, "0")}`
  );
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

function completeRound(stateDoc, roundDoc, rematchAvoidance, priorCompletedRounds) {
  const pairings = pairingsFromRoundDoc(roundDoc);
  let prior = [];
  let currentRoundDoc = roundDoc;
  let currentState = stateDoc;
  let lastPlan = null;
  for (let i = 0; i < pairings.matches.length; i += 1) {
    const match = pairings.matches[i];
    const result = buildResultForMatch(match, i + 1);
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
  return { lastPlan, prior, stateDoc: currentState, roundDoc: currentRoundDoc };
}

assert.equal(formatLossBandBandLabel(0), "0敗帯");
assert.equal(formatLossBandBandLabel(2), "2敗帯");

{
  const ids = entryIds64();
  const init = planLossBandInitialize(ids, {
    rematchAvoidance: true,
    thirdPlaceMatch: false,
  });
  let stateDoc = init.stateDoc;
  let roundDoc = init.roundDoc;
  const completedRounds = [];
  const allResults = new Map();

  // R1〜R3 まで進めて公開ビューを確認
  for (let r = 1; r <= 3; r += 1) {
    const done = completeRound(stateDoc, roundDoc, true, completedRounds);
    for (const result of done.prior) {
      allResults.set(result.matchId, result);
    }
    completedRounds.push({ roundDoc: done.roundDoc, results: done.prior });
    stateDoc = done.stateDoc;
    roundDoc = done.lastPlan.nextRoundPlan.roundDoc;
  }

  const teamNames = Object.fromEntries(ids.map((id) => [id, `Team ${id}`]));
  const section = buildLossBandPublicSection({
    tournament: {
      id: "t-lb",
      bracketMatchConfig: { main: { rankingMode: RankingMode.LOSS_BAND } },
    },
    lossBandState: stateDoc,
    lossBandRounds: completedRounds.map((c) => c.roundDoc).concat([roundDoc]),
    lossBandResultsMap: allResults,
    teamNameByEntryId: teamNames,
  });

  assert.equal(section.visible, true);
  assert.equal(section.ready, true);
  assert.equal(section.rankingMode, RankingMode.LOSS_BAND);
  assert.ok(section.rounds.length >= 3);
  const r3 = section.rounds.find((r) => r.roundNumber === 3);
  assert.ok(r3);
  assert.ok(r3.bands.some((b) => b.label === "0敗帯"));
  assert.ok(section.hint);

  const entries = ids.map((id) => ({
    id,
    teamName: `Team ${id}`,
    status: EntryStatus.CONFIRMED,
    email: "secret@example.com",
  }));

  const snapshot = buildPublicTournamentSnapshot({
    tournament: {
      id: "t-lb",
      name: "Loss Band Public",
      status: TournamentStatus.OPEN,
      tournamentFormat: TournamentFormat.SINGLE_ELIMINATION,
      publicViewEnabled: true,
      maxTeams: 64,
      createdBy: "op-secret",
      bracketMatchConfig: { main: { rankingMode: RankingMode.LOSS_BAND } },
    },
    entries,
    lossBandState: stateDoc,
    lossBandRounds: completedRounds.map((c) => c.roundDoc).concat([roundDoc]),
    lossBandResultsMap: allResults,
  });

  assert.equal(snapshot.lossBand.visible, true);
  assert.equal(snapshot.bracket.visible, false);
  assert.equal(snapshot.tournament.progressStatusLabel, "順位決定戦進行中");
  const forbidden = findForbiddenSnapshotFields(snapshot);
  assert.equal(
    forbidden.filter((p) => p.includes("createdBy") || p.includes("email")).length,
    0,
    forbidden.join(", ")
  );

  const view = buildPublicTournamentViewFromSnapshot(snapshot, "e01");
  assert.equal(view.sections.lossBand.visible, true);
  assert.ok(view.sections.lossBand.rounds.length >= 3);
}

console.log("loss-band-public-snapshot.test.mjs: ok");
