/**
 * 公開スナップショット生成スモークテスト
 */
import assert from "node:assert/strict";
import {
  buildFinalsBracket,
  buildPersistedFinalsBracket,
} from "../../js/domain/finals-bracket.js";
import {
  buildPublicTournamentSnapshot,
  findForbiddenSnapshotFields,
  buildPublicTournamentViewFromSnapshot,
} from "../../js/domain/public-tournament-snapshot.js";
import { isPublicViewEnabled } from "../../js/domain/public-tournament-view.js";
import { EntryStatus, TournamentStatus } from "../../js/domain/constants.js";

function makeTournament(overrides = {}) {
  return {
    id: "tournament-1",
    name: "テスト大会",
    eventDate: "2026-07-24",
    venue: "テスト会場",
    status: TournamentStatus.OPEN,
    maxTeams: 8,
    teamSize: 3,
    courtCount: 2,
    publicViewEnabled: true,
    participantResultEntryEnabled: false,
    createdBy: "operator-uid-should-not-leak",
    ...overrides,
  };
}

function makeEntry(id, teamName) {
  return {
    id,
    teamName,
    status: EntryStatus.CONFIRMED,
    representativeName: "代表者",
    member2: "メンバー2",
    email: "secret@example.com",
    comment: "内部メモ",
  };
}

function testPublicViewEnabledStrict() {
  assert.equal(isPublicViewEnabled({}), false);
  assert.equal(isPublicViewEnabled({ publicViewEnabled: undefined }), false);
  assert.equal(isPublicViewEnabled({ publicViewEnabled: true }), true);
  assert.equal(isPublicViewEnabled({ publicViewEnabled: false }), false);
}

function testSnapshotExcludesForbiddenFields() {
  const snapshot = buildPublicTournamentSnapshot({
    tournament: makeTournament(),
    entries: [makeEntry("e1", "SMA")],
  });

  const forbidden = findForbiddenSnapshotFields(snapshot);
  assert.deepEqual(forbidden, []);
  assert.equal(snapshot.tournament.createdBy, undefined);
  assert.equal(snapshot.registration.items[0].email, undefined);
  assert.equal(snapshot.registration.items[0].comment, undefined);
  assert.ok(snapshot.registration.items[0].members.includes("代表者"));
  assert.equal(snapshot.schemaVersion, 2);
}

function testEightTeamNoByeInSnapshotView() {
  const qualifiers = Array.from({ length: 8 }, (_, index) => ({
    entryId: `entry-${index + 1}`,
    teamName: `Team ${index + 1}`,
    seed: index + 1,
    blockId: "A",
    blockName: "A",
    source: "block_winner",
  }));
  const bracket = buildPersistedFinalsBracket(buildFinalsBracket(qualifiers));

  const snapshot = buildPublicTournamentSnapshot({
    tournament: makeTournament(),
    entries: qualifiers.map((q) => makeEntry(q.entryId, q.teamName)),
    finalsBracket: bracket,
    finalsResultsMap: new Map(),
    finalsSessionsMap: new Map(),
  });

  const view = buildPublicTournamentViewFromSnapshot(snapshot);
  const round2Match = view.finalsBracket.rounds
    .flatMap((round) => round.matches)
    .find((match) => match.matchNumber === 1 && match.displayStatus === "waiting_opponent");

  assert.ok(round2Match);
  assert.equal(round2Match.team1.type, "pending");
  assert.equal(round2Match.team2.type, "pending");
}

function testSixTeamEightBracketByeInSnapshot() {
  const qualifiers = Array.from({ length: 6 }, (_, index) => ({
    entryId: `entry-${index + 1}`,
    teamName: `Team ${index + 1}`,
    seed: index + 1,
    blockId: "A",
    blockName: "A",
    source: "block_winner",
  }));
  const bracket = buildPersistedFinalsBracket(buildFinalsBracket(qualifiers));

  const snapshot = buildPublicTournamentSnapshot({
    tournament: makeTournament(),
    entries: qualifiers.map((q) => makeEntry(q.entryId, q.teamName)),
    finalsBracket: bracket,
    finalsResultsMap: new Map(),
    finalsSessionsMap: new Map(),
  });

  const view = buildPublicTournamentViewFromSnapshot(snapshot);
  const round1 = view.finalsBracket.rounds[0].matches;
  const byeMatches = round1.filter(
    (match) =>
      (match.team1?.type === "bye" && match.team2?.type === "team") ||
      (match.team2?.type === "bye" && match.team1?.type === "team")
  );
  assert.equal(byeMatches.length, 2);
  assert.equal(findForbiddenSnapshotFields(snapshot).length, 0);
}

function testClosedFinalResultsInSnapshot() {
  const snapshot = buildPublicTournamentSnapshot({
    tournament: makeTournament({ status: TournamentStatus.CLOSED }),
    entries: [makeEntry("e1", "SMA")],
    tournamentResults: {
      finalized: true,
      champion: { entryId: "e1", teamName: "SMA" },
      runnerUp: { entryId: "e2", teamName: "Team A" },
      placements: [
        { entryId: "e1", teamName: "SMA", placementLabel: "優勝" },
      ],
    },
  });

  const view = buildPublicTournamentViewFromSnapshot(snapshot);
  assert.equal(view.finalResults.ready, true);
  assert.equal(view.finalResults.champion.teamName, "SMA");
}

function testQualifyingScheduledTimesInSnapshot() {
  const schedule = {
    finalized: true,
    blocks: [
      {
        blockId: "A",
        blockName: "Aブロック",
        teamCount: 4,
        courtNumbers: [1],
        teams: [{ entryId: "e1", teamName: "SMA" }],
        rounds: [
          {
            roundNumber: 1,
            byes: [],
            matches: [
              {
                matchId: "qualifying-A-R1-M1",
                roundNumber: 1,
                courtNumber: 1,
                team1: { entryId: "e1", teamName: "SMA" },
                team2: { entryId: "e2", teamName: "チームA" },
              },
            ],
          },
          {
            roundNumber: 2,
            byes: [],
            matches: [
              {
                matchId: "qualifying-A-R2-M1",
                roundNumber: 2,
                courtNumber: 1,
                team1: { entryId: "e1", teamName: "SMA" },
                team2: { entryId: "e2", teamName: "チームA" },
              },
            ],
          },
          {
            roundNumber: 3,
            byes: [],
            matches: [
              {
                matchId: "qualifying-A-R3-M1",
                roundNumber: 3,
                courtNumber: 1,
                team1: { entryId: "e1", teamName: "SMA" },
                team2: { entryId: "e2", teamName: "チームA" },
              },
            ],
          },
        ],
      },
    ],
  };

  const withTimes = buildPublicTournamentSnapshot({
    tournament: makeTournament(),
    entries: [makeEntry("e1", "SMA"), makeEntry("e2", "チームA")],
    schedule,
    timeSchedule: {
      configured: true,
      dayStartTime: "09:00",
      matchDurationMinutes: 20,
      matchIntervalMinutes: 5,
      qualifyingToFinalsIntervalMinutes: 60,
    },
  });
  assert.equal(withTimes.qualifying.timeSchedule.rounds["1"].startTime, "09:00");
  assert.equal(withTimes.qualifying.timeSchedule.rounds["2"].startTime, "09:25");
  assert.equal(withTimes.qualifying.timeSchedule.rounds["3"].startTime, "09:50");
  const view = buildPublicTournamentViewFromSnapshot(withTimes);
  assert.equal(view.sections.qualifying.schedule.blocks[0].rounds[0].roundHeading, "第1節　9:00開始予定");
  assert.equal(view.sections.qualifying.schedule.blocks[0].rounds[2].matches[0].scheduledStartLabel, "9:50予定");

  const withoutTimes = buildPublicTournamentSnapshot({
    tournament: makeTournament(),
    entries: [makeEntry("e1", "SMA"), makeEntry("e2", "チームA")],
    schedule,
  });
  assert.equal(withoutTimes.qualifying.timeSchedule, null);
  assert.equal(withoutTimes.qualifying.schedule.blocks[0].rounds[0].roundHeading, "第1節");
}

function run() {
  testPublicViewEnabledStrict();
  testSnapshotExcludesForbiddenFields();
  testEightTeamNoByeInSnapshotView();
  testSixTeamEightBracketByeInSnapshot();
  testClosedFinalResultsInSnapshot();
  testQualifyingScheduledTimesInSnapshot();
  console.log("public-tournament-snapshot.smoke: all tests passed");
}

run();
