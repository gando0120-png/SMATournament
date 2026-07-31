/**
 * 下位トーナメント到達順位テスト
 */
import assert from "node:assert/strict";
import {
  FinalsMatchResolution,
  MatchResultStatus,
} from "../../js/domain/constants.js";
import { BracketKind } from "../../js/domain/bracket-collections.js";
import {
  buildConsolationBracket,
  buildPersistedConsolationBracket,
} from "../../js/domain/consolation-bracket.js";
import {
  BracketPlacementMode,
  buildBracketPlacements,
  buildConsolationPlacements,
  buildPersistedTournamentResults,
  formatBracketPlacementLabel,
  groupPlacementsByLabel,
  validateTournamentCompletion,
  PlacementType,
} from "../../js/domain/tournament-results.js";
import { buildFinalsBracket } from "../../js/domain/finals-bracket.js";

function makeParticipants(count) {
  return Array.from({ length: count }, (_, index) => ({
    entryId: `c-${index + 1}`,
    teamName: `Consolation ${index + 1}`,
  }));
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

assert.equal(
  formatBracketPlacementLabel("優勝", { bracketKind: BracketKind.CONSOLATION }),
  "下位トーナメント優勝"
);
assert.equal(formatBracketPlacementLabel("ベスト4", { bracketKind: BracketKind.MAIN }), "ベスト4");

const preview8 = buildConsolationBracket(makeParticipants(8), { random: () => 0.42 });
assert.equal(preview8.valid, true);
const consolation8 = {
  ...buildPersistedConsolationBracket(preview8),
  finalized: true,
};
const results8 = buildResultsMapTeam1Wins(consolation8);
const placements8 = buildConsolationPlacements({
  bracket: consolation8,
  resultsMap: results8,
  mode: BracketPlacementMode.STRICT,
});

assert.equal(placements8.valid, true, placements8.message);
assert.equal(placements8.complete, true);
assert.equal(placements8.placements.length, 8);
assert.equal(
  placements8.placements.filter((p) => p.placementLabel === "下位トーナメント優勝").length,
  1
);
assert.equal(
  placements8.placements.filter((p) => p.placementLabel === "下位トーナメント準優勝").length,
  1
);
assert.equal(
  placements8.placements.filter((p) => p.placementLabel === "下位トーナメントベスト4").length,
  2
);
assert.equal(
  placements8.placements.filter((p) => p.placementLabel === "下位トーナメントベスト8").length,
  4
);
assert.equal(
  placements8.placements.every((p) => p.entryId && p.isBye !== true),
  true
);
assert.equal(
  new Set(placements8.placements.map((p) => p.entryId)).size,
  placements8.placements.length
);

const groups8 = groupPlacementsByLabel(placements8.placements, {
  bracketKind: BracketKind.CONSOLATION,
});
assert.deepEqual(
  groups8.map((g) => g.label),
  [
    "下位トーナメント優勝",
    "下位トーナメント準優勝",
    "下位トーナメントベスト4",
    "下位トーナメントベスト8",
  ]
);

// 4枠: ベスト8グループは出ない
const preview4 = buildConsolationBracket(makeParticipants(4), { random: () => 0.42 });
const consolation4 = {
  ...buildPersistedConsolationBracket(preview4),
  finalized: true,
};
const placements4 = buildBracketPlacements({
  bracket: consolation4,
  resultsMap: buildResultsMapTeam1Wins(consolation4),
  bracketKind: BracketKind.CONSOLATION,
  mode: BracketPlacementMode.STRICT,
  requireRunnerUp: false,
});
assert.equal(placements4.valid, true);
assert.equal(
  placements4.placements.some((p) => p.placementLabel === "下位トーナメントベスト8"),
  false
);
assert.equal(
  placements4.placements.filter((p) => p.placementLabel === "下位トーナメントベスト4").length,
  2
);

// 未完了: 勝手に全チームを確定しない
const partialMap = new Map(results8);
const firstPlayed = [...partialMap.keys()][0];
partialMap.delete(firstPlayed);
const partial = buildConsolationPlacements({
  bracket: consolation8,
  resultsMap: partialMap,
  mode: BracketPlacementMode.PARTIAL,
});
assert.equal(partial.status, "in_progress");
assert.ok(partial.placements.length < 8);
assert.equal(
  partial.placements.every((p) => p.entryId && p.placementLabel.startsWith("下位トーナメント")),
  true
);

// BYE 混入なし（5チーム → BYE あり）
const preview5 = buildConsolationBracket(makeParticipants(5), { random: () => 0.42 });
const consolation5 = {
  ...buildPersistedConsolationBracket(preview5),
  finalized: true,
};
const placements5 = buildConsolationPlacements({
  bracket: consolation5,
  resultsMap: buildResultsMapTeam1Wins(consolation5),
  mode: BracketPlacementMode.STRICT,
});
assert.equal(placements5.valid, true, placements5.message);
assert.equal(placements5.placements.length, 5);
assert.equal(
  placements5.placements.every((p) => p.entryId && !String(p.teamName).includes("BYE")),
  true
);

// 上位 + 下位の finalize / persist
const mainQualifiers = Array.from({ length: 8 }, (_, index) => ({
  entryId: `m-${index + 1}`,
  teamName: `Main ${index + 1}`,
  seed: index + 1,
}));
const mainBracket = {
  ...buildFinalsBracket(mainQualifiers, { expectedCount: 8 }).bracket,
  finalized: true,
};
const mainResults = buildResultsMapTeam1Wins(mainBracket);
const completion = validateTournamentCompletion({
  bracket: mainBracket,
  resultsMap: mainResults,
  qualifiers: mainQualifiers,
  advancement: { finalized: true, qualifiers: mainQualifiers },
  existingResults: null,
  consolationBracket: consolation8,
  consolationResultsMap: results8,
});
assert.equal(completion.canFinalize, true, completion.message);
assert.equal(completion.hasConsolation, true);
assert.equal(completion.consolationPlacements.length, 8);

const persisted = buildPersistedTournamentResults(
  completion,
  { id: "t1", name: "Test" },
  { finalized: true, qualifiers: mainQualifiers },
  mainBracket
);
assert.equal(persisted.hasConsolation, true);
assert.equal(persisted.consolationPlacements.length, 8);
assert.equal(persisted.consolationPlacements[0].placementLabel.startsWith("下位トーナメント"), true);
assert.equal(persisted.placements.every((p) => !p.placementLabel.startsWith("下位")), true);

// 下位なしは従来どおり
const mainOnly = validateTournamentCompletion({
  bracket: mainBracket,
  resultsMap: mainResults,
  qualifiers: mainQualifiers,
  advancement: { finalized: true, qualifiers: mainQualifiers },
  existingResults: null,
});
assert.equal(mainOnly.canFinalize, true);
assert.equal(mainOnly.hasConsolation, false);
const persistedMainOnly = buildPersistedTournamentResults(
  mainOnly,
  { id: "t2", name: "Main only" },
  { finalized: true, qualifiers: mainQualifiers },
  mainBracket
);
assert.equal(Object.hasOwn(persistedMainOnly, "consolationPlacements"), false);

console.log("consolation-placements.test.mjs: all passed");
