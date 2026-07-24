/**
 * 公開大会 ViewModel スモークテスト
 */
import assert from "node:assert/strict";
import {
  buildFinalsBracket,
  buildPersistedFinalsBracket,
} from "../../js/domain/finals-bracket.js";
import {
  buildPublicTournamentView,
  isPublicViewEnabled,
} from "../../js/domain/public-tournament-view.js";
import { TournamentStatus, EntryStatus } from "../../js/domain/constants.js";

function makeTournament(overrides = {}) {
  return {
    id: "tournament-1",
    name: "テスト大会",
    eventDate: "2026-07-24",
    venue: "テスト会場",
    status: TournamentStatus.OPEN,
    maxTeams: 8,
    courtCount: 2,
    ...overrides,
  };
}

function makeEntry(id, teamName, status = EntryStatus.CONFIRMED) {
  return {
    id,
    teamName,
    status,
    representativeName: `${teamName}代表`,
    member2: "メンバー2",
  };
}

function testPublicViewEnabledStrict() {
  assert.equal(isPublicViewEnabled({}), false);
  assert.equal(isPublicViewEnabled({ publicViewEnabled: true }), true);
  assert.equal(isPublicViewEnabled({ publicViewEnabled: false }), false);
}

function testEmptyTournamentView() {
  const view = buildPublicTournamentView({
    tournament: makeTournament({ status: TournamentStatus.DRAFT }),
    entries: [],
  });

  assert.equal(view.tournament.statusLabel, "準備中");
  assert.equal(view.entries.ready, false);
  assert.equal(view.entries.emptyMessage, "参加チームはまだ登録されていません");
  assert.equal(view.blocks.ready, false);
  assert.equal(view.schedule.ready, false);
  assert.equal(view.standings.ready, false);
  assert.equal(view.finalsAdvancement.ready, false);
  assert.equal(view.finalsBracket.ready, false);
  assert.equal(view.finalResults.ready, false);
}

function testHighlightEntry() {
  const view = buildPublicTournamentView({
    tournament: makeTournament(),
    entries: [makeEntry("e1", "SMA"), makeEntry("e2", "Team A")],
    highlightEntryId: "e1",
  });

  assert.equal(view.entries.items[0].highlighted, true);
  assert.equal(view.entries.items[1].highlighted, false);
}

function testEightTeamNoByeFinalsDisplay() {
  const qualifiers = Array.from({ length: 8 }, (_, index) => ({
    entryId: `entry-${index + 1}`,
    teamName: `Team ${index + 1}`,
    seed: index + 1,
    blockId: "A",
    blockName: "A",
    source: "block_winner",
  }));

  const bracketResult = buildFinalsBracket(qualifiers);
  const bracket = buildPersistedFinalsBracket(bracketResult);

  const view = buildPublicTournamentView({
    tournament: makeTournament(),
    entries: qualifiers.map((q, i) => makeEntry(q.entryId, q.teamName)),
    finalsBracket: bracket,
    finalsResultsMap: new Map(),
    finalsSessionsMap: new Map(),
  });

  assert.equal(view.finalsBracket.ready, true);
  const round2Match = view.finalsBracket.rounds
    .flatMap((round) => round.matches)
    .find((match) => match.matchNumber === 1 && match.displayStatus === "waiting_opponent");

  assert.ok(round2Match);
  assert.equal(round2Match.team1.type, "pending");
  assert.equal(round2Match.team2.type, "pending");
  assert.equal(round2Match.team1.label, "前ラウンド結果待ち");
}

function testSixTeamEightBracketWithByes() {
  const qualifiers = Array.from({ length: 6 }, (_, index) => ({
    entryId: `entry-${index + 1}`,
    teamName: `Team ${index + 1}`,
    seed: index + 1,
    blockId: "A",
    blockName: "A",
    source: "block_winner",
  }));

  const bracketResult = buildFinalsBracket(qualifiers);
  const bracket = buildPersistedFinalsBracket(bracketResult);
  const round1 = viewRound1Teams(bracket);

  const byeCount = round1.filter(
    (match) => match.team1?.isBye || match.team2?.isBye
  ).length;
  assert.equal(byeCount, 2);

  const view = buildPublicTournamentView({
    tournament: makeTournament(),
    entries: qualifiers.map((q) => makeEntry(q.entryId, q.teamName)),
    finalsBracket: bracket,
    finalsResultsMap: new Map(),
    finalsSessionsMap: new Map(),
  });

  const round1View = view.finalsBracket.rounds[0].matches;
  const singleByeMatches = round1View.filter(
    (match) =>
      (match.team1.type === "bye" && match.team2.type === "team") ||
      (match.team2.type === "bye" && match.team1.type === "team")
  );
  assert.equal(singleByeMatches.length, 2);
}

function viewRound1Teams(bracket) {
  return bracket.matches.filter((match) => match.roundNumber === 1);
}

function testClosedTournamentFinalResults() {
  const view = buildPublicTournamentView({
    tournament: makeTournament({ status: TournamentStatus.CLOSED }),
    entries: [makeEntry("e1", "SMA")],
    tournamentResults: {
      finalized: true,
      champion: { entryId: "e1", teamName: "SMA" },
      runnerUp: { entryId: "e2", teamName: "Team A" },
      placements: [
        { entryId: "e1", teamName: "SMA", placementLabel: "優勝" },
        { entryId: "e2", teamName: "Team A", placementLabel: "準優勝" },
      ],
    },
  });

  assert.equal(view.finalResults.ready, true);
  assert.equal(view.finalResults.champion.teamName, "SMA");
  assert.equal(view.tournament.statusLabel, "大会終了");
}

function testPublicViewDisabledDetection() {
  assert.equal(isPublicViewEnabled(makeTournament({ publicViewEnabled: false })), false);
  assert.equal(isPublicViewEnabled(makeTournament({})), false);
}

function run() {
  testPublicViewEnabledStrict();
  testEmptyTournamentView();
  testHighlightEntry();
  testEightTeamNoByeFinalsDisplay();
  testSixTeamEightBracketWithByes();
  testClosedTournamentFinalResults();
  testPublicViewDisabledDetection();
  console.log("public-tournament-view.smoke: all tests passed");
}

run();
