/**
 * 決勝自動進行サービス層テスト（Firestore 非依存）
 */
import assert from "node:assert/strict";
import {
  buildSingleEliminationBracket,
  buildPersistedSingleEliminationBracket,
} from "../../js/domain/single-elimination-bracket.js";
import {
  buildFinalsAutoProgressPlan,
  summarizeFinalsAutoProgressOutcome,
} from "../../js/domain/finals-auto-progress.js";
import { FinalsSimulationMode } from "../../js/domain/finals-match-result-generator.js";
import { buildTournamentPlacements } from "../../js/domain/tournament-results.js";
import { getSingleEliminationParticipants } from "../../js/domain/single-elimination-bracket.js";
import { TournamentStatus } from "../../js/domain/constants.js";
import { TournamentFormat } from "../../js/domain/tournament-format.js";

function makeEntries(count) {
  return Array.from({ length: count }, (_, index) => ({
    entryId: `entry-${index + 1}`,
    teamName: `Team ${index + 1}`,
  }));
}

function buildBracketFixture(teamCount) {
  const preview = buildSingleEliminationBracket({
    entries: makeEntries(teamCount),
    random: () => 0,
  });
  return buildPersistedSingleEliminationBracket(preview);
}

const tournament = {
  id: "service-finals-test",
  name: "[E2E] Service Finals",
  status: TournamentStatus.OPEN,
  tournamentFormat: TournamentFormat.SINGLE_ELIMINATION,
};

for (const teamCount of [3, 5, 16, 40]) {
  const bracket = buildBracketFixture(teamCount);
  const plan = buildFinalsAutoProgressPlan({
    tournament,
    canManage: true,
    entries: makeEntries(teamCount).map((entry) => ({
      id: entry.entryId,
      teamName: entry.teamName,
      status: "confirmed",
      isDummy: true,
    })),
    bracket,
    finalsAdvancement: null,
    existingResults: new Map(),
    structureState: { hasTournamentResults: false },
    simulationSeed: 2024,
    mode: FinalsSimulationMode.STANDARD,
    tournamentId: tournament.id,
  });

  assert.equal(plan.valid, true, `teamCount=${teamCount}`);
  const outcome = summarizeFinalsAutoProgressOutcome(bracket, plan.simulation.resultsMap);
  assert.equal(outcome.finishedPlayedMatches, teamCount - 1, `teamCount=${teamCount}`);
  assert.equal(outcome.complete, true, `teamCount=${teamCount}`);
  assert.equal(outcome.canPreviewTournamentResults, true, `teamCount=${teamCount}`);

  const placements = buildTournamentPlacements({
    bracket,
    resultsMap: plan.simulation.resultsMap,
    qualifiers: getSingleEliminationParticipants(bracket),
  });
  assert.equal(placements.valid, true, `teamCount=${teamCount}`);
  assert.equal(placements.placements.length, teamCount, `teamCount=${teamCount}`);
  assert.ok(placements.placements.every((row) => row.teamName), `teamCount=${teamCount}`);
}

console.log("finals-auto-progress.service.test.mjs: all passed");
