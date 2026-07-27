/**
 * 大会結果 placements 生成テスト（fixed_block / legacy / 2チーム）
 */
import assert from "node:assert/strict";
import { buildFixedBlockFinalsBracket } from "../../js/domain/finals-bracket.js";
import { buildFinalsBracket } from "../../js/domain/finals-bracket.js";
import {
  FinalsMatchResolution,
  MatchResultStatus,
} from "../../js/domain/constants.js";
import {
  buildPersistedTournamentResults,
  buildTournamentPlacements,
  getFinalsBracketParticipants,
  getTournamentResultParticipants,
  PlacementType,
  validateTournamentCompletion,
} from "../../js/domain/tournament-results.js";

function makeFixedBlockQualifiers() {
  const blocks = ["A", "B", "C", "D"];
  const qualifiers = [];
  for (const blockId of blocks) {
    for (let rank = 1; rank <= 2; rank += 1) {
      qualifiers.push({
        entryId: `e-${blockId}-${rank}`,
        teamName: `Team ${blockId}${rank}`,
        blockId,
        blockName: `${blockId}ブロック`,
        blockRank: rank,
      });
    }
  }
  return qualifiers;
}

function buildResultsMapTeam1Wins(bracket) {
  const resultsMap = new Map();
  const sortedMatches = [...(bracket.matches ?? [])].sort(
    (a, b) => a.roundNumber - b.roundNumber || a.matchNumber - b.matchNumber
  );

  for (const match of sortedMatches) {
    let team1 = match.team1;
    let team2 = match.team2;

    if (match.roundNumber > 1) {
      const feeder1 = bracket.matches.find(
        (m) => m.nextMatchId === match.matchId && m.nextTeamSlot === "team1"
      );
      const feeder2 = bracket.matches.find(
        (m) => m.nextMatchId === match.matchId && m.nextTeamSlot === "team2"
      );
      team1 = (feeder1 && resultsMap.get(feeder1.matchId)?.winner) ?? team1;
      team2 = (feeder2 && resultsMap.get(feeder2.matchId)?.winner) ?? team2;
    }

    if (team1?.isBye && team2?.entryId) {
      resultsMap.set(match.matchId, {
        status: MatchResultStatus.FINISHED,
        resolution: FinalsMatchResolution.BYE,
        winner: team2,
        team1,
        team2,
      });
      continue;
    }

    if (team2?.isBye && team1?.entryId) {
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

  return resultsMap;
}

function assertPlacementCounts(placements, { champion = 1, runnerUp = 1, best4 = 0, best8 = 0 } = {}) {
  assert.equal(
    placements.filter((p) => p.placementType === PlacementType.CHAMPION).length,
    champion
  );
  assert.equal(
    placements.filter((p) => p.placementType === PlacementType.RUNNER_UP).length,
    runnerUp
  );
  assert.equal(placements.filter((p) => p.placementLabel === "ベスト4").length, best4);
  assert.equal(placements.filter((p) => p.placementLabel === "ベスト8").length, best8);
}

const fullQualifiers = makeFixedBlockQualifiers();
const bracketResult = buildFixedBlockFinalsBracket(fullQualifiers, {
  expectedCount: 8,
  random: () => 0.42,
});
assert.equal(bracketResult.valid, true);

const finalizedBracket = { ...bracketResult.bracket, finalized: true };
const strippedAdvancement = {
  finalized: true,
  mode: "fixed_block_qualifiers",
  qualifierCount: 8,
  qualifiers: fullQualifiers.map(({ entryId, blockId, blockRank }) => ({
    entryId,
    blockId,
    blockRank,
  })),
};

const participants = getTournamentResultParticipants(finalizedBracket, strippedAdvancement);
assert.equal(participants.length, 8);
assert.equal(
  participants.every((participant) => participant.entryId && participant.teamName),
  true,
  "participants must come from bracket slots with teamName"
);

const resultsMap = buildResultsMapTeam1Wins(finalizedBracket);
assert.equal(resultsMap.size, 7, "8-team bracket has 7 finals matches");

const completion = validateTournamentCompletion({
  bracket: finalizedBracket,
  resultsMap,
  qualifiers: participants,
  advancement: strippedAdvancement,
  existingResults: null,
});
assert.equal(completion.canFinalize, true, completion.message ?? "should finalize");

const { valid, placements } = buildTournamentPlacements({
  bracket: finalizedBracket,
  resultsMap,
  qualifiers: strippedAdvancement.qualifiers,
});
assert.equal(valid, true);
assert.equal(placements.length, 8);
assert.equal(
  placements.every((placement) => placement.entryId && placement.teamName),
  true
);
assertPlacementCounts(placements, { best4: 2, best8: 4 });
assert.equal(placements.some((placement) => placement.isBye), false);

const legacyQualifiers = Array.from({ length: 8 }, (_, index) => ({
  entryId: `legacy-${index + 1}`,
  teamName: `Legacy ${index + 1}`,
  seed: index + 1,
  blockId: "A",
  blockName: "A",
}));
const legacyBracket = {
  ...buildFinalsBracket(legacyQualifiers, { expectedCount: 8 }).bracket,
  finalized: true,
};
const legacyResults = buildResultsMapTeam1Wins(legacyBracket);
const legacyPlacements = buildTournamentPlacements({
  bracket: legacyBracket,
  resultsMap: legacyResults,
  qualifiers: legacyQualifiers,
});
assert.equal(legacyPlacements.valid, true);
assert.equal(legacyPlacements.placements.every((p) => p.seed != null), true);

const twoTeamQualifiers = [
  { entryId: "t-1", teamName: "Team 1", seed: 1, blockId: "A", blockName: "A" },
  { entryId: "t-2", teamName: "Team 2", seed: 2, blockId: "B", blockName: "B" },
];
const twoTeamBracket = {
  ...buildFinalsBracket(twoTeamQualifiers, { expectedCount: 2 }).bracket,
  finalized: true,
};
const twoTeamResults = buildResultsMapTeam1Wins(twoTeamBracket);
const twoTeamPlacements = buildTournamentPlacements({
  bracket: twoTeamBracket,
  resultsMap: twoTeamResults,
  qualifiers: twoTeamQualifiers,
});
assert.equal(twoTeamPlacements.valid, true);
assert.equal(twoTeamPlacements.placements.length, 2);
assertPlacementCounts(twoTeamPlacements.placements, { best4: 0, best8: 0 });

const persisted = buildPersistedTournamentResults(
  completion,
  { id: "t1", name: "Test" },
  strippedAdvancement,
  finalizedBracket
);
assert.equal(persisted.placements.length, 8);
assert.equal(
  persisted.placements.every((placement) => placement.entryId && placement.teamName),
  true
);

assert.deepEqual(getFinalsBracketParticipants({ finalized: false, slots: [] }), []);

console.log("tournament-results-placements.test.mjs: all passed");
