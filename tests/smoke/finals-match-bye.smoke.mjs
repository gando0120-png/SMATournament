/**
 * 決勝 BYE 判定スモークテスト
 */
import assert from "node:assert/strict";
import {
  buildFinalsBracket,
  buildFinalsBracketFromAdvancement,
  buildPersistedFinalsBracket,
} from "../../js/domain/finals-bracket.js";
import {
  isByeTeam,
  isPendingTeam,
  isSingleByeMatch,
  isDoubleByeMatch,
} from "../../js/domain/finals-match-bye.js";
import {
  listByeMatchesNeedingResults,
  listDoubleByeMatches,
  resolveFinalsMatchTeams,
} from "../../js/domain/finals-match-progress.js";

function makeQualifiers(count) {
  return Array.from({ length: count }, (_, index) => ({
    entryId: `entry-${index + 1}`,
    teamName: `Team ${index + 1}`,
    seed: index + 1,
    blockId: "A",
    blockName: "A",
    source: "block_winner",
  }));
}

function buildSavedBracket(qualifierCount) {
  const advancement = {
    finalized: true,
    finalTeamCount: qualifierCount,
    qualifiers: makeQualifiers(qualifierCount),
  };
  const preview = buildFinalsBracketFromAdvancement(advancement);
  return buildPersistedFinalsBracket(preview);
}

function testPendingTeamIsNotBye() {
  assert.equal(isPendingTeam(null), true);
  assert.equal(isByeTeam(null), false);
  assert.equal(isDoubleByeMatch(null, null), false);
  assert.equal(isSingleByeMatch(null, null), false);
}

function testExplicitByeSlot() {
  const byeSlot = { entryId: null, teamName: null, seed: 8, isBye: true };
  const realTeam = { entryId: "e1", teamName: "T1", seed: 1, isBye: false };
  assert.equal(isByeTeam(byeSlot), true);
  assert.equal(isSingleByeMatch(realTeam, byeSlot), true);
  assert.equal(isDoubleByeMatch(byeSlot, byeSlot), true);
}

function testEightTeamNoBye() {
  const bracket = buildSavedBracket(8);
  assert.equal(listDoubleByeMatches(bracket).length, 0);
  assert.equal(listByeMatchesNeedingResults(bracket).length, 0);

  const round2 = bracket.matches.find((match) => match.roundNumber === 2);
  assert.ok(round2);
  assert.equal(round2.team1, null);
  assert.equal(round2.team2, null);

  const teams = resolveFinalsMatchTeams({
    match: round2,
    bracket,
    resultsMap: new Map(),
  });
  assert.equal(teams.reason, "feeders_pending");
  assert.equal(teams.resolved, false);
}

function testSixTeamEightBracketWithByes() {
  const result = buildFinalsBracket(makeQualifiers(6));
  assert.equal(result.valid, true);
  const bracket = buildPersistedFinalsBracket(result);

  assert.equal(bracket.bracketSize, 8);
  assert.equal(bracket.qualifierCount, 6);
  assert.equal(listDoubleByeMatches(bracket).length, 0);
  assert.equal(listByeMatchesNeedingResults(bracket).length, 2);

  const round1 = bracket.matches.filter((match) => match.roundNumber === 1);
  const singleByeCount = round1.filter((match) =>
    isSingleByeMatch(match.team1, match.team2)
  ).length;
  assert.equal(singleByeCount, 2);
}

function testLaterRoundOneSideNullIsNotBye() {
  const bracket = buildSavedBracket(8);
  const round2 = { ...bracket.matches.find((match) => match.roundNumber === 2) };
  round2.team1 = { entryId: "e1", teamName: "T1", seed: 1, isBye: false };
  round2.team2 = null;

  assert.equal(isSingleByeMatch(round2.team1, round2.team2), false);
  assert.equal(isDoubleByeMatch(round2.team1, round2.team2), false);

  const teams = resolveFinalsMatchTeams({
    match: round2,
    bracket,
    resultsMap: new Map(),
  });
  assert.equal(teams.reason, "feeders_pending");
}

function run() {
  testPendingTeamIsNotBye();
  testExplicitByeSlot();
  testEightTeamNoBye();
  testSixTeamEightBracketWithByes();
  testLaterRoundOneSideNullIsNotBye();
  console.log("finals-match-bye.smoke: all tests passed");
}

run();
