/**
 * Sprint 3-4: tournament-results ドメインロジックのスモークテスト
 */
import assert from "node:assert/strict";
import { buildFinalsBracket } from "../../js/domain/finals-bracket.js";
import {
  FinalsMatchResolution,
  MatchResultStatus,
} from "../../js/domain/constants.js";
import {
  buildTournamentPlacements,
  getEliminationPlacementLabel,
  validateTournamentCompletion,
  PlacementType,
} from "../../js/domain/tournament-results.js";

function makeQualifiers(count) {
  return Array.from({ length: count }, (_, index) => ({
    entryId: `entry-${index + 1}`,
    teamName: `Team ${index + 1}`,
    seed: index + 1,
    blockId: `block-${(index % 2) + 1}`,
    blockName: `Block ${(index % 2) + 1}`,
  }));
}

function teamFromQualifier(qualifier) {
  return {
    entryId: qualifier.entryId,
    teamName: qualifier.teamName,
    seed: qualifier.seed,
  };
}

/**
 * 各試合で team1 を勝者とする単純な結果マップを生成
 */
function buildResultsMapWhereTeam1Wins(bracket) {
  const resultsMap = new Map();
  const qualifierById = new Map(
    makeQualifiers(bracket.qualifierCount).map((q) => [q.entryId, q])
  );

  for (const match of bracket.matches) {
    let team1 = match.team1;
    let team2 = match.team2;

    if (match.roundNumber > 1) {
      const feeder1 = bracket.matches.find(
        (m) => m.nextMatchId === match.matchId && m.nextTeamSlot === "team1"
      );
      const feeder2 = bracket.matches.find(
        (m) => m.nextMatchId === match.matchId && m.nextTeamSlot === "team2"
      );
      const result1 = resultsMap.get(feeder1.matchId);
      const result2 = resultsMap.get(feeder2.matchId);
      team1 = result1?.winner ?? team1;
      team2 = result2?.winner ?? team2;
    }

    if (team1?.isBye && !team2?.isBye) {
      resultsMap.set(match.matchId, {
        status: MatchResultStatus.FINISHED,
        resolution: FinalsMatchResolution.BYE,
        winner: team2,
        team1,
        team2,
      });
      continue;
    }

    if (team2?.isBye && !team1?.isBye) {
      resultsMap.set(match.matchId, {
        status: MatchResultStatus.FINISHED,
        resolution: FinalsMatchResolution.BYE,
        winner: team1,
        team1,
        team2,
      });
      continue;
    }

    if (!team1?.entryId || !team2?.entryId) {
      continue;
    }

    resultsMap.set(match.matchId, {
      status: MatchResultStatus.FINISHED,
      resolution: FinalsMatchResolution.PLAYED,
      winner: team1,
      loser: team2,
      team1,
      team2,
    });
  }

  return { resultsMap, qualifierById };
}

function testEliminationLabels() {
  assert.deepEqual(getEliminationPlacementLabel(3, 3), {
    placementType: PlacementType.RUNNER_UP,
    placementLabel: "準優勝",
  });
  assert.deepEqual(getEliminationPlacementLabel(2, 3), {
    placementType: PlacementType.ELIMINATED,
    placementLabel: "ベスト4",
  });
  assert.deepEqual(getEliminationPlacementLabel(1, 3), {
    placementType: PlacementType.ELIMINATED,
    placementLabel: "ベスト8",
  });
  assert.deepEqual(getEliminationPlacementLabel(4, 4), {
    placementType: PlacementType.RUNNER_UP,
    placementLabel: "準優勝",
  });
  assert.deepEqual(getEliminationPlacementLabel(1, 4), {
    placementType: PlacementType.ELIMINATED,
    placementLabel: "ベスト16",
  });
}

function testEightTeamPlacements() {
  const qualifiers = makeQualifiers(8);
  const { bracket } = buildFinalsBracket(qualifiers, { expectedCount: 8 });
  assert.ok(bracket);

  const finalizedBracket = { ...bracket, finalized: true };
  const { resultsMap } = buildResultsMapWhereTeam1Wins(finalizedBracket);

  const completion = validateTournamentCompletion({
    bracket: finalizedBracket,
    resultsMap,
    qualifiers,
    existingResults: null,
  });

  assert.equal(completion.canFinalize, true, completion.message ?? "should finalize");
  assert.ok(completion.champion);
  assert.ok(completion.runnerUp);

  const { valid, placements } = buildTournamentPlacements({
    bracket: finalizedBracket,
    resultsMap,
    qualifiers,
  });

  assert.equal(valid, true);
  assert.equal(placements.length, 8);

  const entryIds = placements.map((p) => p.entryId);
  assert.equal(new Set(entryIds).size, 8, "entryId must be unique");

  const champion = placements.find((p) => p.placementType === PlacementType.CHAMPION);
  const runnerUp = placements.find((p) => p.placementType === PlacementType.RUNNER_UP);
  const best4 = placements.filter((p) => p.placementLabel === "ベスト4");
  const best8 = placements.filter((p) => p.placementLabel === "ベスト8");

  assert.ok(champion);
  assert.ok(runnerUp);
  assert.equal(best4.length, 2);
  assert.equal(best8.length, 4);
  assert.equal(champion.eliminatedRoundNumber, null);
  assert.equal(runnerUp.eliminatedRoundNumber, finalizedBracket.roundCount);
}

function testSixteenTeamPlacements() {
  const qualifiers = makeQualifiers(16);
  const { bracket } = buildFinalsBracket(qualifiers, { expectedCount: 16 });
  assert.ok(bracket);

  const finalizedBracket = { ...bracket, finalized: true };
  const { resultsMap } = buildResultsMapWhereTeam1Wins(finalizedBracket);

  const { valid, placements } = buildTournamentPlacements({
    bracket: finalizedBracket,
    resultsMap,
    qualifiers,
  });

  assert.equal(valid, true);
  assert.equal(placements.length, 16);
  assert.equal(
    placements.filter((p) => p.placementLabel === "ベスト16").length,
    8
  );
}

function testIncompleteFinalBlocksFinalize() {
  const qualifiers = makeQualifiers(8);
  const { bracket } = buildFinalsBracket(qualifiers, { expectedCount: 8 });
  const finalizedBracket = { ...bracket, finalized: true };
  const resultsMap = new Map();

  const completion = validateTournamentCompletion({
    bracket: finalizedBracket,
    resultsMap,
    qualifiers,
    existingResults: null,
  });

  assert.equal(completion.canFinalize, false);
}

function testAlreadyFinalizedBlocksFinalize() {
  const qualifiers = makeQualifiers(8);
  const { bracket } = buildFinalsBracket(qualifiers, { expectedCount: 8 });
  const finalizedBracket = { ...bracket, finalized: true };
  const { resultsMap } = buildResultsMapWhereTeam1Wins(finalizedBracket);

  const completion = validateTournamentCompletion({
    bracket: finalizedBracket,
    resultsMap,
    qualifiers,
    existingResults: { finalized: true },
  });

  assert.equal(completion.canFinalize, false);
}

function run() {
  testEliminationLabels();
  testEightTeamPlacements();
  testSixteenTeamPlacements();
  testIncompleteFinalBlocksFinalize();
  testAlreadyFinalizedBlocksFinalize();
  console.log("tournament-results.smoke: all tests passed");
}

run();
