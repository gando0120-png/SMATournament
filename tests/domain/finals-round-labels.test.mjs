/**
 * 決勝ラウンド名生成テスト
 */
import assert from "node:assert/strict";
import {
  FINALS_ROUND_LABELS,
  getFinalsRoundLabel,
  roundCountFor,
} from "../../js/domain/finals-bracket.js";
import { groupBracketMatchesByRound } from "../../js/domain/finals-bracket-display.js";
import { buildSingleEliminationBracket } from "../../js/domain/single-elimination-bracket.js";
import {
  buildFinalsMatchProgressIndex,
  resolveFinalsMatchTeams,
  FinalsMatchDisplayStatus,
} from "../../js/domain/finals-match-progress.js";
import { FinalsMatchResolution, MatchResultStatus } from "../../js/domain/constants.js";

const EXPECTED_LABELS = {
  2: ["決勝"],
  4: ["準決勝", "決勝"],
  8: ["1回戦", "準決勝", "決勝"],
  16: ["1回戦", "準々決勝", "準決勝", "決勝"],
  32: ["1回戦", "2回戦", "準々決勝", "準決勝", "決勝"],
  64: ["1回戦", "2回戦", "3回戦", "準々決勝", "準決勝", "決勝"],
};

for (const [sizeText, expectedLabels] of Object.entries(EXPECTED_LABELS)) {
  const size = Number(sizeText);
  assert.equal(roundCountFor(size), expectedLabels.length, `roundCount size=${size}`);
  assert.deepEqual(FINALS_ROUND_LABELS[size], expectedLabels, `FINALS_ROUND_LABELS size=${size}`);
  expectedLabels.forEach((label, index) => {
    assert.equal(getFinalsRoundLabel(size, index + 1), label, `size=${size} round=${index + 1}`);
  });
}

const entries8 = Array.from({ length: 8 }, (_, index) => ({
  entryId: `entry-${index + 1}`,
  teamName: `Team ${index + 1}`,
}));
const built8 = buildSingleEliminationBracket({ entries: entries8, random: () => 0.42 });
assert.equal(built8.valid, true);

const bracket8 = built8.bracket;
const grouped8 = groupBracketMatchesByRound(bracket8);
assert.deepEqual(
  grouped8.map((round) => round.roundLabel),
  EXPECTED_LABELS[8],
  "8枠生成ブラケットのラウンド名"
);

const bracketWithStaleLabels = {
  bracketSize: 8,
  matches: bracket8.matches.map((match) => ({
    ...match,
    roundLabel: "誤ったラベル",
  })),
};
assert.deepEqual(
  groupBracketMatchesByRound(bracketWithStaleLabels).map((round) => round.roundLabel),
  EXPECTED_LABELS[8],
  "保存済み誤ラベルより bracketSize から再計算"
);

function getMatchTeamsForDisplay(entry) {
  const { match, result, session, resolvedTeams } = entry;

  if (result?.winner) {
    const team1 = result.team1 ?? resolvedTeams.team1;
    const team2 = result.team2 ?? resolvedTeams.team2;
    return {
      team1,
      team2,
      winnerEntryId: result.winner.entryId,
    };
  }

  if (session?.team1 && session?.team2) {
    return {
      team1: session.team1,
      team2: session.team2,
      winnerEntryId: null,
    };
  }

  if (match.roundNumber === 1) {
    return {
      team1: match.team1?.isBye ? null : match.team1,
      team2: match.team2?.isBye ? null : match.team2,
      winnerEntryId: null,
    };
  }

  return {
    team1: resolvedTeams.team1,
    team2: resolvedTeams.team2,
    winnerEntryId: null,
  };
}

function buildBracketDisplayRounds(bracket, progressIndex) {
  return groupBracketMatchesByRound(bracket).map((round) => ({
    ...round,
    matches: round.matches.map((match) => {
      const entry = progressIndex.get(match.matchId);
      const displayStatus = entry?.displayStatus ?? FinalsMatchDisplayStatus.WAITING_OPPONENT;
      const teams = getMatchTeamsForDisplay(
        entry ?? {
          match,
          resolvedTeams: resolveFinalsMatchTeams({ match, bracket, resultsMap: new Map() }),
        }
      );
      return { match, displayStatus, teams };
    }),
  }));
}

function renderAdminTeamLine({ team, highlightWinner, isWinner, isLoser }) {
  if (!team) {
    return "pending";
  }
  const winnerMark = highlightWinner && isWinner ? "✓ " : "";
  const loserClass = highlightWinner && isLoser ? "loser" : "";
  return `${winnerMark}${team.teamName ?? "—"}${loserClass}`;
}

function renderDisplayRounds(rounds) {
  return rounds
    .map((round) =>
      round.matches
        .map(({ match, displayStatus, teams }) => {
          const highlight = displayStatus === FinalsMatchDisplayStatus.FINISHED;
          const team1Html = renderAdminTeamLine({
            team: teams.team1,
            highlightWinner: highlight,
            isWinner: teams.winnerEntryId === teams.team1?.entryId,
            isLoser:
              highlight &&
              Boolean(teams.winnerEntryId) &&
              Boolean(teams.team1?.entryId) &&
              teams.winnerEntryId !== teams.team1.entryId,
          });
          const team2Html = renderAdminTeamLine({
            team: teams.team2,
            highlightWinner: highlight,
            isWinner: teams.winnerEntryId === teams.team2?.entryId,
            isLoser:
              highlight &&
              Boolean(teams.winnerEntryId) &&
              Boolean(teams.team2?.entryId) &&
              teams.winnerEntryId !== teams.team2.entryId,
          });
          return `${match.matchId}:${displayStatus}:${team1Html}:${team2Html}`;
        })
        .join("|")
    )
    .join("\n");
}

const firstRoundMatch = bracket8.matches.find((match) => match.roundNumber === 1);
const resultsMap = new Map();
resultsMap.set(firstRoundMatch.matchId, {
  status: MatchResultStatus.FINISHED,
  resolution: FinalsMatchResolution.PLAYED,
  winner: firstRoundMatch.team1,
  loser: firstRoundMatch.team2,
  winnerSide: "team1",
  team1: firstRoundMatch.team1,
  team2: firstRoundMatch.team2,
});

const progressIndex = buildFinalsMatchProgressIndex(bracket8, resultsMap, new Map());
const displayRounds = buildBracketDisplayRounds(bracket8, progressIndex);

assert.doesNotThrow(() => renderDisplayRounds(displayRounds), "試合確定後の再描画");

const finishedCard = displayRounds[0].matches.find(
  (item) => item.match.matchId === firstRoundMatch.matchId
);
assert.equal(finishedCard.displayStatus, FinalsMatchDisplayStatus.FINISHED);
assert.match(renderDisplayRounds(displayRounds), /✓ /, "終了済み勝者表示");

const semiMatch = bracket8.matches.find(
  (match) => match.roundNumber === 2 && match.nextTeamSlot === "team1" && match.matchNumber === 1
);
const feederMatch = bracket8.matches.find((match) => match.nextMatchId === semiMatch.matchId);
const resolvedSemi = resolveFinalsMatchTeams({
  match: semiMatch,
  bracket: bracket8,
  resultsMap,
});
const winnerInSemi =
  resolvedSemi.team1?.entryId === firstRoundMatch.team1.entryId ||
  resolvedSemi.team2?.entryId === firstRoundMatch.team1.entryId;
assert.equal(
  winnerInSemi || feederMatch.matchId === firstRoundMatch.matchId,
  true,
  "1回戦勝者が準決勝へ反映"
);

console.log("finals-round-labels.test.mjs: all passed");
