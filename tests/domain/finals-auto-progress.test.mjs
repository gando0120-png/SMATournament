/**
 * 決勝自動進行ドメインテスト
 */
import assert from "node:assert/strict";
import { EntryStatus, TournamentStatus } from "../../js/domain/constants.js";
import {
  buildSingleEliminationBracket,
  buildPersistedSingleEliminationBracket,
} from "../../js/domain/single-elimination-bracket.js";
import { TournamentFormat } from "../../js/domain/tournament-format.js";
import {
  buildFinalsAutoProgressPlan,
  countExpectedFinalsPlayedMatches,
  simulateFinalsTournament,
  validateFinalsAutoProgress,
} from "../../js/domain/finals-auto-progress.js";
import { FinalsSimulationMode } from "../../js/domain/finals-match-result-generator.js";
import { buildTournamentPlacements } from "../../js/domain/tournament-results.js";
import { getSingleEliminationParticipants } from "../../js/domain/single-elimination-bracket.js";

function makeDummyEntries(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `entry-${index + 1}`,
    teamName: `Team ${index + 1}`,
    status: EntryStatus.CONFIRMED,
    isDummy: true,
  }));
}

function buildBracketFixture(teamCount, random = () => 0) {
  const entries = makeDummyEntries(teamCount).map((entry) => ({
    entryId: entry.id,
    teamName: entry.teamName,
  }));
  const preview = buildSingleEliminationBracket({ entries, random });
  assert.equal(preview.valid, true, `teamCount=${teamCount}`);
  return buildPersistedSingleEliminationBracket(preview);
}

const singleElimTournament = {
  id: "finals-test-1",
  name: "[E2E] Finals Auto",
  status: TournamentStatus.OPEN,
  tournamentFormat: TournamentFormat.SINGLE_ELIMINATION,
};

for (const teamCount of [2, 3, 5, 8, 16, 40]) {
  const bracket = buildBracketFixture(teamCount);
  assert.equal(
    countExpectedFinalsPlayedMatches(bracket),
    teamCount - 1,
    `teamCount=${teamCount}`
  );

  const simulation = simulateFinalsTournament({
    bracket,
    simulationSeed: 4242,
    mode: FinalsSimulationMode.STANDARD,
  });

  assert.equal(simulation.errors.length, 0, `teamCount=${teamCount}`);
  assert.equal(simulation.playedPlans.length, teamCount - 1, `teamCount=${teamCount}`);
  assert.equal(simulation.progress.complete, true, `teamCount=${teamCount}`);
  assert.equal(simulation.outcome.complete, true, `teamCount=${teamCount}`);
  assert.ok(simulation.outcome.champion?.teamName, `teamCount=${teamCount}`);
  assert.ok(simulation.outcome.runnerUp?.teamName, `teamCount=${teamCount}`);

  for (const plan of simulation.playedPlans) {
    assert.ok(plan.resultPayload.winner?.entryId);
    assert.ok(plan.resultPayload.winner?.teamName);
    assert.ok(plan.resultPayload.loser?.entryId);
    assert.ok(plan.resultPayload.loser?.teamName);
  }
}

{
  const bracket = buildBracketFixture(16);
  const simA = simulateFinalsTournament({
    bracket,
    simulationSeed: 111,
    mode: FinalsSimulationMode.STANDARD,
  });
  const simB = simulateFinalsTournament({
    bracket,
    simulationSeed: 111,
    mode: FinalsSimulationMode.STANDARD,
  });
  assert.equal(simA.outcome.champion?.entryId, simB.outcome.champion?.entryId);
  assert.deepEqual(
    simA.playedPlans.map((plan) => plan.resultPayload.winner.entryId),
    simB.playedPlans.map((plan) => plan.resultPayload.winner.entryId)
  );
}

{
  const bracket = buildBracketFixture(16);
  const simA = simulateFinalsTournament({
    bracket,
    simulationSeed: 111,
    mode: FinalsSimulationMode.STANDARD,
  });
  const simB = simulateFinalsTournament({
    bracket,
    simulationSeed: 222,
    mode: FinalsSimulationMode.STANDARD,
  });
  assert.notEqual(simA.outcome.champion?.entryId, simB.outcome.champion?.entryId);
}

{
  const bracket = buildBracketFixture(5);
  const simulation = simulateFinalsTournament({
    bracket,
    simulationSeed: 99,
    mode: FinalsSimulationMode.STANDARD,
  });
  assert.equal(simulation.byeResults.length, 3);
  assert.equal(simulation.playedPlans.length, 4);
}

{
  const entries = makeDummyEntries(8);
  const realMixed = [...entries.slice(0, 7), {
    id: "real-1",
    teamName: "Real Team",
    status: EntryStatus.CONFIRMED,
    isDummy: false,
  }];
  const bracket = buildBracketFixture(8);
  const validation = validateFinalsAutoProgress({
    tournament: singleElimTournament,
    canManage: true,
    entries: realMixed,
    bracket,
    finalsAdvancement: null,
    existingResults: new Map(),
    structureState: { hasTournamentResults: false },
  });
  assert.equal(validation.allowed, false);
  assert.match(validation.reason, /実参加者/);
}

{
  const bracket = buildBracketFixture(8);
  const validation = validateFinalsAutoProgress({
    tournament: singleElimTournament,
    canManage: true,
    entries: makeDummyEntries(8),
    bracket,
    finalsAdvancement: null,
    existingResults: new Map([["final-r1-m1", { resolution: "played" }]]),
    structureState: { hasTournamentResults: false },
  });
  assert.equal(validation.allowed, false);
  assert.match(validation.reason, /すでに入力/);
}

{
  const bracket = buildBracketFixture(8);
  const plan = buildFinalsAutoProgressPlan({
    tournament: singleElimTournament,
    canManage: true,
    entries: makeDummyEntries(8),
    bracket,
    finalsAdvancement: null,
    existingResults: new Map(),
    structureState: { hasTournamentResults: false },
    simulationSeed: 777,
    mode: FinalsSimulationMode.STANDARD,
    tournamentId: singleElimTournament.id,
  });
  assert.equal(plan.valid, true);
  const placements = buildTournamentPlacements({
    bracket,
    resultsMap: plan.simulation.resultsMap,
    qualifiers: getSingleEliminationParticipants(bracket),
  });
  assert.equal(placements.valid, true);
  assert.ok(placements.placements.every((row) => row.teamName));
}

{
  const legacyTournament = {
    ...singleElimTournament,
    tournamentFormat: undefined,
  };
  const bracket = buildBracketFixture(4);
  const validation = validateFinalsAutoProgress({
    tournament: legacyTournament,
    canManage: true,
    entries: makeDummyEntries(4),
    bracket,
    finalsAdvancement: null,
    existingResults: new Map(),
    structureState: { hasTournamentResults: false },
  });
  assert.equal(validation.allowed, false);
  assert.match(validation.reason, /Legacy|従来形式/);
}

console.log("finals-auto-progress.test.mjs: all passed");
