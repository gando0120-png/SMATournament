/**
 * 一発トーナメント bracket ドメインテスト
 */
import assert from "node:assert/strict";
import {
  assignTeamsToFirstRoundSlots,
  buildSingleEliminationBracket,
  countFirstRoundDoubleByeMatches,
  resolveSingleEliminationBracketSize,
} from "../../js/domain/single-elimination-bracket.js";
import { listByeMatchesNeedingResults } from "../../js/domain/finals-match-progress.js";
import { getByeWinnerTeam } from "../../js/domain/finals-match-bye.js";

function makeEntries(count, prefix = "e") {
  return Array.from({ length: count }, (_, index) => ({
    entryId: `${prefix}-${index + 1}`,
    teamName: `Team ${index + 1}`,
  }));
}

const sizeCases = [
  [2, 2, 0],
  [3, 4, 1],
  [4, 4, 0],
  [5, 8, 3],
  [8, 8, 0],
  [9, 16, 7],
  [32, 32, 0],
  [33, 64, 31],
  [64, 64, 0],
];

for (const [teamCount, expectedSize, expectedBye] of sizeCases) {
  const result = resolveSingleEliminationBracketSize(teamCount);
  assert.equal(result.valid, true, `teamCount=${teamCount}`);
  assert.equal(result.bracketSize, expectedSize, `teamCount=${teamCount}`);
  assert.equal(result.byeCount, expectedBye, `teamCount=${teamCount}`);
}

const invalid1 = resolveSingleEliminationBracketSize(1);
assert.equal(invalid1.valid, false);
assert.match(invalid1.errors[0], /2チーム以上/);

const invalid65 = resolveSingleEliminationBracketSize(65);
assert.equal(invalid65.valid, false);
assert.match(invalid65.errors[0], /64チームまで/);

function collectEntryIds(bracket) {
  return (bracket.slots ?? [])
    .filter((slot) => !slot.isBye)
    .map((slot) => slot.entryId);
}

const entries5 = makeEntries(5);
const bracket5 = buildSingleEliminationBracket({ entries: entries5, random: () => 0.42 });
assert.equal(bracket5.valid, true);
assert.equal(bracket5.bracket.bracketSize, 8);
assert.equal(bracket5.bracket.byeCount, 3);
assert.equal(collectEntryIds(bracket5.bracket).length, 5);
assert.equal(new Set(collectEntryIds(bracket5.bracket)).size, 5);
assert.deepEqual(
  [...collectEntryIds(bracket5.bracket)].sort(),
  entries5.map((entry) => entry.entryId).sort()
);
assert.equal(countFirstRoundDoubleByeMatches(bracket5.bracket), 0);

const byeMatches = listByeMatchesNeedingResults(bracket5.bracket);
assert.equal(byeMatches.length, 3);
for (const match of byeMatches) {
  const winner = getByeWinnerTeam(match.team1, match.team2);
  assert.ok(winner?.entryId);
}

const bracketA = buildSingleEliminationBracket({ entries: makeEntries(8), random: () => 0.1 });
const bracketB = buildSingleEliminationBracket({ entries: makeEntries(8), random: () => 0.9 });
assert.notDeepEqual(
  collectEntryIds(bracketA.bracket),
  collectEntryIds(bracketB.bracket)
);

const assigned = assignTeamsToFirstRoundSlots(makeEntries(5), 8, () => 0.5);
const teamSlots = assigned.filter(Boolean);
assert.equal(teamSlots.length, 5);
const pairDoubleBye = [];
for (let i = 0; i < assigned.length; i += 2) {
  if (!assigned[i] && !assigned[i + 1]) {
    pairDoubleBye.push(i / 2);
  }
}
assert.equal(pairDoubleBye.length, 0);

console.log("single-elimination-bracket.test.mjs: all passed");
