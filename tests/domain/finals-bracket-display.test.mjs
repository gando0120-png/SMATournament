/**
 * 決勝トーナメント表表示ドメインテスト
 */
import assert from "node:assert/strict";
import { getFinalsRoundLabel, FINALS_ROUND_LABELS } from "../../js/domain/finals-bracket.js";
import {
  BracketViewMode,
  formatFinalsMatchCourtLabel,
  getFinalsMatchCardStateClass,
  groupBracketMatchesByRound,
  mapFinalsStatusLabelToDisplayStatus,
  resolveDefaultBracketViewMode,
  resolveInitialBracketRoundNumber,
  getAdjacentBracketRoundNumbers,
} from "../../js/domain/finals-bracket-display.js";
import { FinalsMatchDisplayStatus } from "../../js/domain/finals-match-progress.js";

assert.equal(formatFinalsMatchCourtLabel(1), "コート1");
assert.equal(formatFinalsMatchCourtLabel(3), "コート3");

for (const size of [8, 16, 32, 64]) {
  const labels = FINALS_ROUND_LABELS[size];
  assert.ok(labels.length > 0, `bracketSize=${size}`);
  labels.forEach((label, index) => {
    assert.equal(getFinalsRoundLabel(size, index + 1), label);
  });
}

function makeBracket(size, statusByMatchId) {
  const roundCount = Math.log2(size);
  const matches = [];
  let matchNumber = 1;
  for (let roundNumber = 1; roundNumber <= roundCount; roundNumber += 1) {
    const roundMatchCount = size / 2 ** roundNumber;
    for (let index = 0; index < roundMatchCount; index += 1) {
      const matchId = `r${roundNumber}-m${index + 1}`;
      matches.push({
        matchId,
        roundNumber,
        matchNumber: matchNumber++,
        roundLabel: getFinalsRoundLabel(size, roundNumber),
      });
    }
  }
  return {
    bracketSize: size,
    matches,
    getDisplayStatus(match) {
      return statusByMatchId[match.matchId] ?? FinalsMatchDisplayStatus.WAITING_OPPONENT;
    },
  };
}

function roundsFromBracket(bracket, statusByMatchId) {
  return groupBracketMatchesByRound(bracket).map((round) => ({
    ...round,
    matches: round.matches.map((match) => ({
      ...match,
      displayStatus: statusByMatchId[match.matchId] ?? FinalsMatchDisplayStatus.WAITING_OPPONENT,
    })),
  }));
}

const bracket8 = makeBracket(8, {});
const grouped8 = groupBracketMatchesByRound(bracket8);
assert.equal(grouped8.length, 3);
assert.equal(grouped8[0].roundLabel, "1回戦");
assert.equal(grouped8[0].matches.length, 4);
assert.equal(grouped8[0].matches[0].matchNumber, 1);
assert.equal(grouped8[0].matches[1].matchNumber, 2);
assert.equal(grouped8[2].roundLabel, getFinalsRoundLabel(8, 3));

const playingRound = resolveInitialBracketRoundNumber(
  roundsFromBracket(makeBracket(16, {}), {
    "r2-m1": FinalsMatchDisplayStatus.PLAYING,
    "r1-m1": FinalsMatchDisplayStatus.READY,
  }),
  (match) => match.displayStatus
);
assert.equal(playingRound, 2, "進行中ラウンド優先");

const unfinishedRound = resolveInitialBracketRoundNumber(
  roundsFromBracket(makeBracket(16, {}), {
    "r1-m1": FinalsMatchDisplayStatus.FINISHED,
    "r1-m2": FinalsMatchDisplayStatus.READY,
    "r2-m1": FinalsMatchDisplayStatus.WAITING_OPPONENT,
  }),
  (match) => match.displayStatus
);
assert.equal(unfinishedRound, 1, "未終了の最も早いラウンド");

const allFinishedRound = resolveInitialBracketRoundNumber(
  roundsFromBracket(makeBracket(8, {}), Object.fromEntries(
    makeBracket(8, {}).matches.map((match) => [match.matchId, FinalsMatchDisplayStatus.FINISHED])
  )),
  (match) => match.displayStatus
);
assert.equal(allFinishedRound, 3, "全終了時は決勝");

const byeRound = resolveInitialBracketRoundNumber(
  roundsFromBracket(makeBracket(8, {}), {
    "r1-m1": FinalsMatchDisplayStatus.BYE,
    "r1-m2": FinalsMatchDisplayStatus.FINISHED,
    "r1-m3": FinalsMatchDisplayStatus.FINISHED,
    "r1-m4": FinalsMatchDisplayStatus.FINISHED,
    "r2-m1": FinalsMatchDisplayStatus.READY,
    "r2-m2": FinalsMatchDisplayStatus.FINISHED,
  }),
  (match) => match.displayStatus
);
assert.equal(byeRound, 2, "BYEは終了扱いで次の未終了ラウンド");

const adjacent = getAdjacentBracketRoundNumbers(grouped8, grouped8[1].roundNumber);
assert.equal(adjacent.previous, grouped8[0].roundNumber);
assert.equal(adjacent.next, grouped8[2].roundNumber);

assert.equal(resolveDefaultBracketViewMode(767), BracketViewMode.ROUND);
assert.equal(resolveDefaultBracketViewMode(768), BracketViewMode.BOARD);

assert.equal(
  getFinalsMatchCardStateClass(FinalsMatchDisplayStatus.PLAYING),
  "finals-bracket__match--playing"
);
assert.equal(
  getFinalsMatchCardStateClass(FinalsMatchDisplayStatus.FINISHED),
  "finals-bracket__match--finished"
);
assert.equal(getFinalsMatchCardStateClass(FinalsMatchDisplayStatus.BYE), "finals-bracket__match--bye");

assert.equal(mapFinalsStatusLabelToDisplayStatus("BYE通過"), FinalsMatchDisplayStatus.BYE);
assert.equal(mapFinalsStatusLabelToDisplayStatus("試合中"), FinalsMatchDisplayStatus.PLAYING);

console.log("finals-bracket-display.test.mjs: all passed");
