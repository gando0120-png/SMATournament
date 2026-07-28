/**
 * 下位トーナメント bracket ドメインテスト
 */
import assert from "node:assert/strict";
import { BracketKind } from "../../js/domain/bracket-collections.js";
import {
  buildConsolationBracket,
  buildPersistedConsolationBracket,
  CONSOLATION_MODE,
  hasCreatedConsolationBracket,
  isConsolationBracket,
  resolveConsolationBracketSize,
} from "../../js/domain/consolation-bracket.js";
import {
  assignTeamsToFirstRoundSlots,
  buildSingleEliminationBracket,
  countFirstRoundDoubleByeMatches,
} from "../../js/domain/single-elimination-bracket.js";
import { listByeMatchesNeedingResults } from "../../js/domain/finals-match-progress.js";
import { getByeWinnerTeam } from "../../js/domain/finals-match-bye.js";

function makeParticipants(count, prefix = "p") {
  return Array.from({ length: count }, (_, index) => ({
    entryId: `${prefix}-${index + 1}`,
    teamName: `Team ${index + 1}`,
  }));
}

function collectEntryIds(bracket) {
  return (bracket.slots ?? [])
    .filter((slot) => !slot.isBye)
    .map((slot) => slot.entryId);
}

const sizeCases = [
  [2, 2, 0],
  [3, 4, 1],
  [5, 8, 3],
  [8, 8, 0],
  [13, 16, 3],
];

for (const [teamCount, expectedSize, expectedBye] of sizeCases) {
  const sizeResult = resolveConsolationBracketSize(teamCount);
  assert.equal(sizeResult.valid, true, `teamCount=${teamCount}`);
  assert.equal(sizeResult.bracketSize, expectedSize, `teamCount=${teamCount}`);
  assert.equal(sizeResult.byeCount, expectedBye, `teamCount=${teamCount}`);

  const result = buildConsolationBracket(makeParticipants(teamCount), { random: () => 0.42 });
  assert.equal(result.valid, true, `teamCount=${teamCount}`);
  assert.equal(result.canFinalize, true, `teamCount=${teamCount}`);
  assert.equal(result.bracket.bracketSize, expectedSize, `teamCount=${teamCount}`);
  assert.equal(result.bracket.byeCount, expectedBye, `teamCount=${teamCount}`);
  assert.equal(result.bracket.teamCount, teamCount, `teamCount=${teamCount}`);
  assert.equal(collectEntryIds(result.bracket).length, teamCount, `teamCount=${teamCount}`);
  assert.equal(new Set(collectEntryIds(result.bracket)).size, teamCount, `teamCount=${teamCount}`);
}

// ── 全参加者が1回だけ slot へ配置 ───────────────────────────

const participants5 = makeParticipants(5);
const bracket5 = buildConsolationBracket(participants5, { random: () => 0.42 });
assert.deepEqual(
  [...collectEntryIds(bracket5.bracket)].sort(),
  participants5.map((p) => p.entryId).sort()
);

// ── BYE が正しく分散される（BYE 同士の対戦なし） ─────────────

assert.equal(countFirstRoundDoubleByeMatches(bracket5.bracket), 0);
const byeMatches = listByeMatchesNeedingResults(bracket5.bracket);
assert.equal(byeMatches.length, 3);
for (const match of byeMatches) {
  const winner = getByeWinnerTeam(match.team1, match.team2);
  assert.ok(winner?.entryId);
}

const assigned = assignTeamsToFirstRoundSlots(makeParticipants(5), 8, () => 0.5);
const pairDoubleBye = [];
for (let i = 0; i < assigned.length; i += 2) {
  if (!assigned[i] && !assigned[i + 1]) {
    pairDoubleBye.push(i / 2);
  }
}
assert.equal(pairDoubleBye.length, 0);

// ── mode / bracketKind / placementMode ──────────────────────

assert.equal(bracket5.bracket.mode, CONSOLATION_MODE);
assert.equal(bracket5.bracket.bracketKind, BracketKind.CONSOLATION);
assert.equal(bracket5.bracket.placementMode, "random");
assert.equal(bracket5.bracket.finalized, true);
assert.equal(isConsolationBracket(bracket5.bracket), true);
assert.equal(hasCreatedConsolationBracket(bracket5.bracket), true);

for (const slot of bracket5.bracket.slots) {
  if (!slot.isBye) {
    assert.equal(slot.advancementSource, CONSOLATION_MODE);
  }
}

// ── matchId 形式（bracketKind と組み合わせて識別） ───────────

assert.ok(bracket5.bracket.matches.every((match) => /^final-r\d+-m\d+$/.test(match.matchId)));

// ── buildPersistedConsolationBracket ────────────────────────

const persisted = buildPersistedConsolationBracket(bracket5);
assert.equal(persisted.mode, CONSOLATION_MODE);
assert.equal(persisted.bracketKind, BracketKind.CONSOLATION);
assert.equal(persisted.finalized, true);
assert.equal(hasCreatedConsolationBracket(persisted), true);
assert.equal(Object.keys(persisted.matchIds).length, bracket5.bracket.matches.length);
assert.ok(persisted.matchIds[bracket5.bracket.matches[0].matchId]);

// ── 参加者不足 ──────────────────────────────────────────────

const invalid0 = buildConsolationBracket([]);
assert.equal(invalid0.valid, false);

const invalid1 = buildConsolationBracket(makeParticipants(1));
assert.equal(invalid1.valid, false);

// ── 既存 single elimination テスト退行なし ──────────────────

const seEntries = makeParticipants(5, "se");
const seResult = buildSingleEliminationBracket({ entries: seEntries, random: () => 0.42 });
assert.equal(seResult.valid, true);
assert.equal(seResult.bracket.mode, "single_elimination");
assert.equal(seResult.bracket.bracketSize, 8);
assert.equal(Object.hasOwn(seResult.bracket, "bracketKind"), false);
assert.equal(countFirstRoundDoubleByeMatches(seResult.bracket), 0);

const seBracketA = buildSingleEliminationBracket({
  entries: makeParticipants(8, "a"),
  random: () => 0.1,
});
const seBracketB = buildSingleEliminationBracket({
  entries: makeParticipants(8, "b"),
  random: () => 0.9,
});
assert.notDeepEqual(
  collectEntryIds(seBracketA.bracket),
  collectEntryIds(seBracketB.bracket)
);

console.log("consolation-bracket.test.mjs: all passed");
