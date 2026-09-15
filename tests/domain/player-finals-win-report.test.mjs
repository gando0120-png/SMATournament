/**
 * 参加者決勝勝利報告ドメイン
 */
import assert from "node:assert/strict";
import { MatchFormat } from "../../js/domain/aggregate-match-format.js";
import { formatFinalsMatchResultDetail } from "../../js/domain/finals-match-result.js";
import { buildPublicTournamentView } from "../../js/domain/public-tournament-view.js";
import { buildPublicTournamentSnapshot } from "../../js/domain/public-tournament-snapshot.js";
import {
  EntryStatus,
  FinalsMatchResolution,
  MatchResultStatus,
  SET_WINNING_SCORE,
  TournamentStatus,
} from "../../js/domain/constants.js";
import { RankingMode } from "../../js/domain/loss-band/constants.js";
import {
  PLAYER_FINALS_ALREADY_OFFICIAL_MESSAGE,
  PLAYER_FINALS_CHAMPION_MESSAGE,
  PLAYER_FINALS_ELIMINATED_MESSAGE,
  PLAYER_FINALS_NOT_ADVANCED_MESSAGE,
  PLAYER_FINALS_UNSUPPORTED_FORMAT_MESSAGE,
  PLAYER_FINALS_WAITING_OPPONENT_MESSAGE,
  PLAYER_FINALS_WIN_REPORT_SOURCE,
  PlayerFinalsMatchState,
  PlayerFinalsPageMode,
  buildPlayerWinReportPlayedPayload,
  evaluatePlayerFinalsWinReport,
  formatPlayerWinReportResultSummary,
  isPlayerWinReportResult,
  resolvePlayerFinalsMatchView,
  resolvePlayerFinalsPageMode,
  resolveReportWinnerEntryId,
} from "../../js/domain/player-finals-win-report.js";
import { TournamentFormat } from "../../js/domain/tournament-format.js";
import {
  buildPersistedSingleEliminationBracket,
  buildSingleEliminationBracket,
} from "../../js/domain/single-elimination-bracket.js";
import { buildByeMatchResultPayload } from "../../js/domain/finals-match-progress.js";
import { getByeWinnerTeam } from "../../js/domain/finals-match-bye.js";
import { listByeMatchesNeedingResults } from "../../js/domain/finals-match-progress.js";

function team(entryId, teamName, seed = 1) {
  return { entryId, teamName, seed, isBye: false };
}

function makeOpenTournament(overrides = {}) {
  return {
    name: "テスト大会",
    status: TournamentStatus.OPEN,
    participantResultEntryEnabled: true,
    tournamentFormat: TournamentFormat.QUALIFYING_AND_FINALS,
    ...overrides,
  };
}

function makeFourTeamBracket() {
  const sma = team("sma", "SMA", 1);
  const b = team("b", "チームB", 2);
  const c = team("c", "チームC", 3);
  const d = team("d", "チームD", 4);
  return {
    teams: { sma, b, c, d },
    bracket: {
      finalized: true,
      bracketSize: 4,
      roundCount: 2,
      matchFormat: MatchFormat.HEAD_TO_HEAD_SETS,
      matches: [
        {
          matchId: "final-r1-m1",
          roundNumber: 1,
          matchNumber: 1,
          roundLabel: "準決勝",
          team1: sma,
          team2: b,
          nextMatchId: "final-r2-m1",
          nextTeamSlot: "team1",
          isFinal: false,
        },
        {
          matchId: "final-r1-m2",
          roundNumber: 1,
          matchNumber: 2,
          roundLabel: "準決勝",
          team1: c,
          team2: d,
          nextMatchId: "final-r2-m1",
          nextTeamSlot: "team2",
          isFinal: false,
        },
        {
          matchId: "final-r2-m1",
          roundNumber: 2,
          matchNumber: 1,
          roundLabel: "決勝",
          team1: null,
          team2: null,
          nextMatchId: null,
          isFinal: true,
        },
      ],
    },
  };
}

function playedResult(match, winner, loser, winnerSide = "team1") {
  return {
    matchId: match.matchId,
    roundNumber: match.roundNumber,
    matchNumber: match.matchNumber,
    status: MatchResultStatus.FINISHED,
    resolution: FinalsMatchResolution.PLAYED,
    team1: winnerSide === "team1" ? winner : loser,
    team2: winnerSide === "team1" ? loser : winner,
    winner,
    loser,
    winnerSide,
    team1SetWins: winnerSide === "team1" ? 2 : 0,
    team2SetWins: winnerSide === "team1" ? 0 : 2,
    sets: [],
  };
}

const advancement = { finalized: true, qualifiers: [] };

{
  const page = resolvePlayerFinalsPageMode({
    tournament: makeOpenTournament(),
    finalsAdvancement: null,
    finalsBracket: null,
  });
  assert.equal(page.pageMode, PlayerFinalsPageMode.QUALIFYING);
}

{
  const { bracket } = makeFourTeamBracket();
  const page = resolvePlayerFinalsPageMode({
    tournament: makeOpenTournament(),
    finalsAdvancement: advancement,
    finalsBracket: bracket,
  });
  assert.equal(page.pageMode, PlayerFinalsPageMode.FINALS);
}

{
  const generated = buildSingleEliminationBracket({
    entries: [
      { entryId: "sma", teamName: "SMA" },
      { entryId: "b", teamName: "チームB" },
      { entryId: "c", teamName: "チームC" },
      { entryId: "d", teamName: "チームD" },
    ],
    random: () => 0.2,
  });
  const bracket = buildPersistedSingleEliminationBracket(generated);
  const page = resolvePlayerFinalsPageMode({
    tournament: makeOpenTournament({ tournamentFormat: TournamentFormat.SINGLE_ELIMINATION }),
    finalsAdvancement: null,
    finalsBracket: bracket,
  });
  assert.equal(page.pageMode, PlayerFinalsPageMode.FINALS);
}

{
  const page = resolvePlayerFinalsPageMode({
    tournament: makeOpenTournament({
      bracketMatchConfig: { main: { rankingMode: RankingMode.LOSS_BAND } },
    }),
    finalsAdvancement: advancement,
    finalsBracket: makeFourTeamBracket().bracket,
  });
  assert.equal(page.pageMode, PlayerFinalsPageMode.UNAVAILABLE);
  assert.equal(page.reason, PLAYER_FINALS_UNSUPPORTED_FORMAT_MESSAGE);
}

{
  const { teams, bracket } = makeFourTeamBracket();
  const view = resolvePlayerFinalsMatchView({
    entryId: teams.sma.entryId,
    tournament: makeOpenTournament(),
    finalsAdvancement: advancement,
    bracket,
    resultsMap: new Map(),
  });
  assert.equal(view.state, PlayerFinalsMatchState.PLAYABLE);
  assert.equal(view.matchId, "final-r1-m1");
  assert.equal(view.roundLabel, "準決勝");
  assert.equal(view.teamName, "SMA");
  assert.equal(view.opponentName, "チームB");
  assert.equal(view.canReport, true);
}

{
  const { teams, bracket } = makeFourTeamBracket();
  const sf1 = bracket.matches[0];
  const resultsMap = new Map([
    [sf1.matchId, playedResult(sf1, teams.sma, teams.b, "team1")],
  ]);
  const view = resolvePlayerFinalsMatchView({
    entryId: teams.sma.entryId,
    tournament: makeOpenTournament(),
    finalsAdvancement: advancement,
    bracket,
    resultsMap,
  });
  assert.equal(view.state, PlayerFinalsMatchState.WAITING_OPPONENT);
  assert.equal(view.message, PLAYER_FINALS_WAITING_OPPONENT_MESSAGE);
  assert.equal(view.canReport, false);
}

{
  const { teams, bracket } = makeFourTeamBracket();
  const sf1 = bracket.matches[0];
  const resultsMap = new Map([
    [sf1.matchId, playedResult(sf1, teams.sma, teams.b, "team1")],
  ]);
  const view = resolvePlayerFinalsMatchView({
    entryId: teams.b.entryId,
    tournament: makeOpenTournament(),
    finalsAdvancement: advancement,
    bracket,
    resultsMap,
  });
  assert.equal(view.state, PlayerFinalsMatchState.ELIMINATED);
  assert.equal(view.message, PLAYER_FINALS_ELIMINATED_MESSAGE);
}

{
  const { teams, bracket } = makeFourTeamBracket();
  const sf1 = bracket.matches[0];
  const sf2 = bracket.matches[1];
  const final = bracket.matches[2];
  const resultsMap = new Map([
    [sf1.matchId, playedResult(sf1, teams.sma, teams.b, "team1")],
    [sf2.matchId, playedResult(sf2, teams.c, teams.d, "team1")],
    [final.matchId, playedResult(final, teams.sma, teams.c, "team1")],
  ]);
  const champ = resolvePlayerFinalsMatchView({
    entryId: teams.sma.entryId,
    tournament: makeOpenTournament(),
    finalsAdvancement: advancement,
    bracket,
    resultsMap,
  });
  assert.equal(champ.state, PlayerFinalsMatchState.CHAMPION);
  assert.equal(champ.message, PLAYER_FINALS_CHAMPION_MESSAGE);
  const runner = resolvePlayerFinalsMatchView({
    entryId: teams.c.entryId,
    tournament: makeOpenTournament(),
    finalsAdvancement: advancement,
    bracket,
    resultsMap,
  });
  assert.equal(runner.state, PlayerFinalsMatchState.ELIMINATED);
}

{
  const { bracket } = makeFourTeamBracket();
  const view = resolvePlayerFinalsMatchView({
    entryId: "outsider",
    tournament: makeOpenTournament(),
    finalsAdvancement: advancement,
    bracket,
    resultsMap: new Map(),
  });
  assert.equal(view.state, PlayerFinalsMatchState.NOT_ADVANCED);
  assert.equal(view.message, PLAYER_FINALS_NOT_ADVANCED_MESSAGE);
}

{
  const generated = buildSingleEliminationBracket({
    entries: [
      { entryId: "sma", teamName: "SMA" },
      { entryId: "b", teamName: "チームB" },
      { entryId: "c", teamName: "チームC" },
    ],
    random: () => 0.3,
  });
  const bracket = buildPersistedSingleEliminationBracket(generated);
  const byeMatches = listByeMatchesNeedingResults(bracket);
  assert.ok(byeMatches.length >= 1);
  const byeMatch = byeMatches[0];
  const winner = getByeWinnerTeam(byeMatch.team1, byeMatch.team2);
  const resultsMap = new Map();
  const before = resolvePlayerFinalsMatchView({
    entryId: winner.entryId,
    tournament: makeOpenTournament({ tournamentFormat: TournamentFormat.SINGLE_ELIMINATION }),
    bracket,
    resultsMap,
  });
  assert.notEqual(before.state, PlayerFinalsMatchState.PLAYABLE);
  assert.notEqual(before.matchId, byeMatch.matchId);

  resultsMap.set(byeMatch.matchId, buildByeMatchResultPayload(byeMatch, winner));
  const after = resolvePlayerFinalsMatchView({
    entryId: winner.entryId,
    tournament: makeOpenTournament({ tournamentFormat: TournamentFormat.SINGLE_ELIMINATION }),
    bracket,
    resultsMap,
  });
  assert.ok(
    after.state === PlayerFinalsMatchState.PLAYABLE ||
      after.state === PlayerFinalsMatchState.WAITING_OPPONENT
  );
  assert.notEqual(after.matchId, byeMatch.matchId);
}

{
  const generated = buildSingleEliminationBracket({
    entries: [
      { entryId: "se-a", teamName: "SE-A" },
      { entryId: "se-b", teamName: "SE-B" },
      { entryId: "se-c", teamName: "SE-C" },
    ],
    random: () => 0.2,
  });
  const bracket = buildPersistedSingleEliminationBracket(generated);
  const byeMatch = listByeMatchesNeedingResults(bracket)[0];
  const byeWinner = getByeWinnerTeam(byeMatch.team1, byeMatch.team2);
  const realMatch = bracket.matches.find(
    (match) => match.roundNumber === 1 && match.matchId !== byeMatch.matchId
  );
  const finalMatch = bracket.matches.find((match) => match.roundNumber === 2);
  const playedWinner =
    realMatch.team1.entryId === byeWinner.entryId ? realMatch.team2 : realMatch.team1;
  const playedLoser =
    realMatch.team1.entryId === playedWinner.entryId ? realMatch.team2 : realMatch.team1;
  const resultsMap = new Map([
    [
      realMatch.matchId,
      {
        matchId: realMatch.matchId,
        status: MatchResultStatus.FINISHED,
        resolution: FinalsMatchResolution.PLAYED,
        winner: playedWinner,
        loser: playedLoser,
        winnerSide: realMatch.team1.entryId === playedWinner.entryId ? "team1" : "team2",
        source: PLAYER_FINALS_WIN_REPORT_SOURCE,
      },
    ],
  ]);
  const byeView = resolvePlayerFinalsMatchView({
    entryId: byeWinner.entryId,
    tournament: makeOpenTournament({ tournamentFormat: TournamentFormat.SINGLE_ELIMINATION }),
    bracket,
    resultsMap,
  });
  assert.equal(byeView.state, PlayerFinalsMatchState.PLAYABLE);
  assert.equal(byeView.matchId, finalMatch.matchId);
  assert.equal(byeView.opponentName, playedWinner.teamName);
  const playedView = resolvePlayerFinalsMatchView({
    entryId: playedWinner.entryId,
    tournament: makeOpenTournament({ tournamentFormat: TournamentFormat.SINGLE_ELIMINATION }),
    bracket,
    resultsMap,
  });
  assert.equal(playedView.state, PlayerFinalsMatchState.PLAYABLE);
  assert.equal(playedView.matchId, finalMatch.matchId);
  assert.equal(playedView.opponentName, byeWinner.teamName);
}

{
  const { teams, bracket } = makeFourTeamBracket();
  const built2 = buildPlayerWinReportPlayedPayload({
    match: bracket.matches[0],
    team1: teams.sma,
    team2: teams.b,
    winnerEntryId: "sma",
    winsRequired: 2,
  });
  assert.equal(built2.valid, true);
  assert.equal(built2.data.resolution, FinalsMatchResolution.PLAYED);
  assert.equal(built2.data.source, PLAYER_FINALS_WIN_REPORT_SOURCE);
  assert.equal(built2.data.reportedByEntryId, "sma");
  assert.equal(built2.data.winner.entryId, "sma");
  assert.equal(built2.data.loser.entryId, "b");
  assert.equal(built2.data.team1SetWins, 2);
  assert.equal(built2.data.team2SetWins, 0);
  assert.equal(built2.data.sets.length, 2);
  assert.equal(built2.data.sets[0].team1Score, SET_WINNING_SCORE);
  assert.equal(isPlayerWinReportResult(built2.data), true);
  assert.equal(formatPlayerWinReportResultSummary(built2.data), "SMA（勝利報告）");
  assert.doesNotMatch(formatPlayerWinReportResultSummary(built2.data), /2\s*-\s*0|50/);

  const built3 = buildPlayerWinReportPlayedPayload({
    match: bracket.matches[0],
    team1: teams.sma,
    team2: teams.b,
    winnerEntryId: "b",
    winsRequired: 3,
  });
  assert.equal(built3.valid, true);
  assert.equal(built3.data.winner.entryId, "b");
  assert.equal(built3.data.team2SetWins, 3);
  assert.equal(built3.data.sets.length, 3);
  assert.equal(built3.data.winsRequired, 3);
}

{
  const { teams, bracket } = makeFourTeamBracket();
  const tournament = makeOpenTournament();
  const evalOk = evaluatePlayerFinalsWinReport({
    tournament,
    finalsAdvancement: advancement,
    bracket,
    resultsMap: new Map(),
    entryId: teams.sma.entryId,
    clientWinnerEntryId: teams.b.entryId,
  });
  assert.equal(evalOk.ok, true);
  assert.equal(evalOk.winnerEntryId, "sma");
  assert.equal(evalOk.payload.winner.entryId, "sma");
  assert.equal(resolveReportWinnerEntryId("sma", "b"), "sma");

  const spoofMatch = evaluatePlayerFinalsWinReport({
    tournament,
    finalsAdvancement: advancement,
    bracket,
    resultsMap: new Map(),
    entryId: teams.sma.entryId,
    clientMatchId: "final-r1-m2",
  });
  assert.equal(spoofMatch.ok, false);
  assert.equal(spoofMatch.message, PLAYER_FINALS_ALREADY_OFFICIAL_MESSAGE);

  const otherTeam = evaluatePlayerFinalsWinReport({
    tournament,
    finalsAdvancement: advancement,
    bracket,
    resultsMap: new Map(),
    entryId: teams.c.entryId,
    clientMatchId: "final-r1-m1",
  });
  assert.equal(otherTeam.ok, false);

  const resultsMap = new Map([
    [
      "final-r1-m1",
      playedResult(bracket.matches[0], teams.sma, teams.b, "team1"),
    ],
  ]);
  const duplicate = evaluatePlayerFinalsWinReport({
    tournament,
    finalsAdvancement: advancement,
    bracket,
    resultsMap,
    entryId: teams.sma.entryId,
    clientMatchId: "final-r1-m1",
  });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.message, PLAYER_FINALS_ALREADY_OFFICIAL_MESSAGE);

  const bothSidesFirst = evaluatePlayerFinalsWinReport({
    tournament,
    finalsAdvancement: advancement,
    bracket,
    resultsMap: new Map(),
    entryId: teams.sma.entryId,
  });
  const bothSidesSecond = evaluatePlayerFinalsWinReport({
    tournament,
    finalsAdvancement: advancement,
    bracket,
    resultsMap: new Map([["final-r1-m1", bothSidesFirst.payload]]),
    entryId: teams.b.entryId,
  });
  assert.equal(bothSidesFirst.ok, true);
  assert.equal(bothSidesSecond.ok, false);
  assert.match(bothSidesSecond.message, /敗退|すでに結果が確定/);
  const opponentStale = evaluatePlayerFinalsWinReport({
    tournament,
    finalsAdvancement: advancement,
    bracket,
    resultsMap: new Map([["final-r1-m1", bothSidesFirst.payload]]),
    entryId: teams.b.entryId,
    clientMatchId: "final-r1-m1",
  });
  assert.equal(opponentStale.ok, false);
  assert.equal(opponentStale.message, PLAYER_FINALS_ALREADY_OFFICIAL_MESSAGE);
}

{
  const { teams, bracket } = makeFourTeamBracket();
  const evalSf = evaluatePlayerFinalsWinReport({
    tournament: makeOpenTournament({
      finalsMatchRules: { defaultWinsRequired: 3 },
    }),
    finalsAdvancement: advancement,
    bracket,
    resultsMap: new Map(),
    entryId: teams.sma.entryId,
  });
  assert.equal(evalSf.ok, true);
  assert.equal(evalSf.winsRequired, 3);
  assert.equal(evalSf.payload.sets.length, 3);
}

{
  const { teams, bracket } = makeFourTeamBracket();
  const built = buildPlayerWinReportPlayedPayload({
    match: bracket.matches[0],
    team1: teams.sma,
    team2: teams.b,
    winnerEntryId: "sma",
    winsRequired: 2,
  });
  const detail = formatFinalsMatchResultDetail(built.data);
  assert.equal(detail.isPlayerWinReport, true);
  assert.equal(detail.sets.length, 0);
  assert.equal(detail.summaryLabel, "勝利報告");

  const view = buildPublicTournamentView({
    tournament: makeOpenTournament({ id: "t1", name: "公開" }),
    entries: [
      { id: "sma", teamName: "SMA", status: EntryStatus.CONFIRMED },
      { id: "b", teamName: "チームB", status: EntryStatus.CONFIRMED },
      { id: "c", teamName: "チームC", status: EntryStatus.CONFIRMED },
      { id: "d", teamName: "チームD", status: EntryStatus.CONFIRMED },
    ],
    finalsAdvancement: advancement,
    finalsBracket: bracket,
    finalsResultsMap: new Map([["final-r1-m1", built.data]]),
    finalsSessionsMap: new Map(),
  });
  const summary = view.sections.bracket.rounds[0].matches[0].resultSummary;
  assert.match(summary, /勝利報告/);
  assert.doesNotMatch(summary, /2\s*-\s*0|50/);

  const snapshot = buildPublicTournamentSnapshot({
    tournament: makeOpenTournament({ id: "t1", name: "公開" }),
    entries: [
      { id: "sma", teamName: "SMA", status: EntryStatus.CONFIRMED },
      { id: "b", teamName: "チームB", status: EntryStatus.CONFIRMED },
    ],
    finalsAdvancement: advancement,
    finalsBracket: bracket,
    finalsResultsMap: new Map([["final-r1-m1", built.data]]),
    finalsSessionsMap: new Map(),
  });
  const serialized = snapshot.finalsMatchResults.find((item) => item.matchId === "final-r1-m1");
  assert.equal(serialized.source, PLAYER_FINALS_WIN_REPORT_SOURCE);

  const nextMatch = view.sections.bracket.rounds.find((round) => round.roundNumber === 2)?.matches[0];
  assert.equal(nextMatch.team1.entryId, "sma");
  assert.equal(nextMatch.team1.teamName, "SMA");
  assert.equal(nextMatch.team2.type, "pending");
}

console.log("player-finals-win-report.test.mjs: all passed");
