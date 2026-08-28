/**
 * 公開スナップショット（下位トーナメント対応）Domain テスト
 */
import assert from "node:assert/strict";
import { TournamentStatus, EntryStatus } from "../../js/domain/constants.js";
import { TournamentFormat } from "../../js/domain/tournament-format.js";
import {
  buildPublicTournamentSnapshot,
  buildPublicTournamentViewFromSnapshot,
  findForbiddenSnapshotFields,
  PUBLIC_SNAPSHOT_SCHEMA_VERSION,
} from "../../js/domain/public-tournament-snapshot.js";
import { hasPublicConsolationBracket } from "../../js/domain/public-tournament-view.js";
import {
  buildConsolationBracket,
  buildPersistedConsolationBracket,
  buildConsolationByeMatchResultPayload,
} from "../../js/domain/consolation-bracket.js";
import {
  buildFinalsBracket,
  buildPersistedFinalsBracket,
} from "../../js/domain/finals-bracket.js";
import { listByeMatchesNeedingResults } from "../../js/domain/finals-match-progress.js";
import { getByeWinnerTeam } from "../../js/domain/finals-match-bye.js";
import { ensureFinalsTeamWithSeed } from "../../js/domain/finals-match-result-payload.js";
import { BracketKind } from "../../js/domain/bracket-collections.js";

function makeTournament(overrides = {}) {
  return {
    id: "tournament-1",
    name: "テスト大会",
    eventDate: "2026-07-24",
    venue: "テスト会場",
    status: TournamentStatus.OPEN,
    tournamentFormat: TournamentFormat.QUALIFYING_AND_FINALS,
    blockCount: 4,
    qualifiersPerBlock: 2,
    maxTeams: 64,
    teamSize: 3,
    courtCount: 2,
    publicViewEnabled: true,
    createdBy: "operator-should-not-leak",
    ...overrides,
  };
}

function makeEntry(id, teamName = `Team ${id}`) {
  return {
    id,
    teamName,
    status: EntryStatus.CONFIRMED,
    email: "secret@example.com",
    comment: "内部",
  };
}

function makeMainBracket() {
  const qualifiers = Array.from({ length: 8 }, (_, index) => ({
    entryId: `q-${index + 1}`,
    teamName: `Q ${index + 1}`,
    seed: index + 1,
    blockId: "A",
    blockName: "A",
    source: "block_winner",
  }));
  return buildPersistedFinalsBracket(buildFinalsBracket(qualifiers));
}

function makeConsolationData(participantCount = 5) {
  const participants = Array.from({ length: participantCount }, (_, index) => ({
    entryId: `p-${index + 1}`,
    teamName: index === 2 ? null : `P ${index + 1}`,
  }));
  const preview = buildConsolationBracket(participants, { random: () => 0.42 });
  const bracket = buildPersistedConsolationBracket(preview);
  const resultsMap = new Map();
  for (const match of listByeMatchesNeedingResults(preview.bracket)) {
    const winner = ensureFinalsTeamWithSeed(
      getByeWinnerTeam(match.team1, match.team2),
      match.matchNumber
    );
    resultsMap.set(match.matchId, buildConsolationByeMatchResultPayload(match, winner));
  }
  return { bracket, resultsMap, preview };
}

// ── 下位未作成 ───────────────────────────────────────────────

const baseSnapshot = buildPublicTournamentSnapshot({
  tournament: makeTournament(),
  entries: [makeEntry("e1")],
  finalsBracket: makeMainBracket(),
  finalsResultsMap: new Map(),
  finalsSessionsMap: new Map(),
});

assert.equal(baseSnapshot.schemaVersion, PUBLIC_SNAPSHOT_SCHEMA_VERSION);
assert.equal(Object.hasOwn(baseSnapshot, "consolationBracket"), false);
assert.equal(Object.hasOwn(baseSnapshot, "consolationMatchResults"), false);
assert.deepEqual(findForbiddenSnapshotFields(baseSnapshot), []);

const baseView = buildPublicTournamentViewFromSnapshot(baseSnapshot);
assert.equal(hasPublicConsolationBracket(baseView.sections.consolationBracket), false);

// ── 下位作成済み ─────────────────────────────────────────────

const { bracket: consolationBracket, resultsMap: consolationResultsMap } =
  makeConsolationData(5);

const consolationSnapshot = buildPublicTournamentSnapshot({
  tournament: makeTournament(),
  entries: [
    ...Array.from({ length: 8 }, (_, i) => makeEntry(`q-${i + 1}`, `Q ${i + 1}`)),
    ...Array.from({ length: 5 }, (_, i) => makeEntry(`p-${i + 1}`, i === 2 ? null : `P ${i + 1}`)),
  ],
  finalsBracket: makeMainBracket(),
  finalsResultsMap: new Map([[
    "final-r1-m1",
    {
      matchId: "final-r1-m1",
      roundNumber: 1,
      matchNumber: 1,
      status: "finished",
      resolution: "played",
      team1: { entryId: "q-1", teamName: "Q 1", seed: 1 },
      team2: { entryId: "q-2", teamName: "Q 2", seed: 2 },
      winner: { entryId: "q-1", teamName: "Q 1", seed: 1 },
      loser: { entryId: "q-2", teamName: "Q 2", seed: 2 },
      sets: [],
      team1SetWins: 2,
      team2SetWins: 0,
      winnerSide: "team1",
    },
  ]]),
  finalsSessionsMap: new Map(),
  consolationBracket,
  consolationResultsMap,
  consolationSessionsMap: new Map(),
});

assert.equal(Object.hasOwn(consolationSnapshot, "consolationBracket"), true);
assert.equal(Object.hasOwn(consolationSnapshot, "consolationMatchResults"), true);
assert.equal(consolationSnapshot.consolationBracket.title, "下位トーナメント");
assert.equal(consolationSnapshot.consolationBracket.teamCount, 5);
assert.ok(consolationSnapshot.consolationMatchResults.length >= 1);
assert.deepEqual(findForbiddenSnapshotFields(consolationSnapshot), []);

const consolationView = buildPublicTournamentViewFromSnapshot(consolationSnapshot);
assert.equal(hasPublicConsolationBracket(consolationView.sections.consolationBracket), true);
assert.equal(consolationView.sections.consolationBracket.showSeed, false);
assert.ok(consolationView.sections.consolationBracket.rounds.length >= 1);

// main / consolation 分離
assert.notEqual(
  consolationView.sections.bracket.rounds[0]?.matches[0]?.resultSummary,
  consolationView.sections.consolationBracket.rounds[0]?.matches[0]?.resultSummary
);

// ── 後方互換（consolation フィールドなし） ───────────────────

const legacyV2Snapshot = {
  schemaVersion: 2,
  tournament: baseSnapshot.tournament,
  registration: baseSnapshot.registration,
  qualifying: baseSnapshot.qualifying,
  advancement: baseSnapshot.advancement,
  bracket: baseSnapshot.bracket,
  results: baseSnapshot.results,
  qualifyingResults: [],
  finalsMatchResults: [],
};

const legacyView = buildPublicTournamentViewFromSnapshot(legacyV2Snapshot);
assert.equal(legacyView.finalsBracket.ready, baseView.finalsBracket.ready);
assert.equal(hasPublicConsolationBracket(legacyView.sections.consolationBracket), false);

// consolationBracket のみ（results 空）
const bracketOnlySnapshot = {
  ...legacyV2Snapshot,
  consolationBracket: consolationSnapshot.consolationBracket,
};
const bracketOnlyView = buildPublicTournamentViewFromSnapshot(bracketOnlySnapshot);
assert.equal(hasPublicConsolationBracket(bracketOnlyView.sections.consolationBracket), true);

// consolationMatchResults 空配列
const emptyResultsSnapshot = {
  ...consolationSnapshot,
  consolationMatchResults: [],
};
const emptyResultsView = buildPublicTournamentViewFromSnapshot(emptyResultsSnapshot);
assert.equal(hasPublicConsolationBracket(emptyResultsView.sections.consolationBracket), true);

// teamName null でも生成可能
const nullNameSnapshot = buildPublicTournamentSnapshot({
  tournament: makeTournament(),
  entries: [makeEntry("p-1", null)],
  consolationBracket: makeConsolationData(3).bracket,
  consolationResultsMap: makeConsolationData(3).resultsMap,
  finalsResultsMap: new Map(),
  finalsSessionsMap: new Map(),
});
assert.deepEqual(findForbiddenSnapshotFields(nullNameSnapshot), []);
const nullNameView = buildPublicTournamentViewFromSnapshot(nullNameSnapshot);
assert.ok(nullNameView.sections.consolationBracket.rounds.length >= 1);

// played 結果が consolationMatchResults に含まれる
consolationResultsMap.set("final-r1-m2", {
  matchId: "final-r1-m2",
  roundNumber: 1,
  matchNumber: 2,
  status: "finished",
  resolution: "played",
  team1: { entryId: "p-1", teamName: "P 1", seed: 1 },
  team2: { entryId: "p-2", teamName: "P 2", seed: 2 },
  winner: { entryId: "p-1", teamName: "P 1", seed: 1 },
  loser: { entryId: "p-2", teamName: "P 2", seed: 2 },
  sets: [{ setNumber: 1, team1Score: 21, team2Score: 10, winner: "team1" }],
  team1SetWins: 1,
  team2SetWins: 0,
  winnerSide: "team1",
  bracketKind: BracketKind.CONSOLATION,
});
const playedSnapshot = buildPublicTournamentSnapshot({
  tournament: makeTournament(),
  entries: [makeEntry("p-1")],
  consolationBracket,
  consolationResultsMap,
  finalsResultsMap: new Map(),
  finalsSessionsMap: new Map(),
});
assert.ok(
  playedSnapshot.consolationMatchResults.some((result) => result.resolution === "played")
);
assert.ok(
  playedSnapshot.consolationMatchResults.some((result) => result.resolution === "bye")
);

function makeQualifyingScheduleThreeRounds() {
  return {
    finalized: true,
    blocks: [
      {
        blockId: "A",
        blockName: "Aブロック",
        teamCount: 4,
        courtNumbers: [1, 2],
        teams: [
          { entryId: "e1", teamName: "SMA" },
          { entryId: "e2", teamName: "チームA" },
          { entryId: "e3", teamName: "チームB" },
          { entryId: "e4", teamName: "チームC" },
        ],
        rounds: [
          {
            roundNumber: 1,
            byes: [],
            matches: [
              {
                matchId: "qualifying-A-R1-M1",
                roundNumber: 1,
                matchNumber: 1,
                courtNumber: 1,
                team1: { entryId: "e1", teamName: "SMA" },
                team2: { entryId: "e2", teamName: "チームA" },
                status: "waiting",
                result: null,
              },
              {
                matchId: "qualifying-A-R1-M2",
                roundNumber: 1,
                matchNumber: 2,
                courtNumber: 2,
                team1: { entryId: "e3", teamName: "チームB" },
                team2: { entryId: "e4", teamName: "チームC" },
                status: "waiting",
                result: null,
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
                matchNumber: 1,
                courtNumber: 1,
                team1: { entryId: "e1", teamName: "SMA" },
                team2: { entryId: "e3", teamName: "チームB" },
                status: "waiting",
                result: null,
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
                matchNumber: 1,
                courtNumber: 1,
                team1: { entryId: "e1", teamName: "SMA" },
                team2: { entryId: "e4", teamName: "チームC" },
                status: "waiting",
                result: null,
              },
            ],
          },
        ],
      },
    ],
  };
}

function makeTimeScheduleSettings(overrides = {}) {
  return {
    configured: true,
    dayStartTime: "09:00",
    matchDurationMinutes: 20,
    matchIntervalMinutes: 5,
    qualifyingToFinalsIntervalMinutes: 60,
    ...overrides,
  };
}

{
  const schedule = makeQualifyingScheduleThreeRounds();
  const snapshot = buildPublicTournamentSnapshot({
    tournament: makeTournament(),
    entries: [
      makeEntry("e1", "SMA"),
      makeEntry("e2", "チームA"),
      makeEntry("e3", "チームB"),
      makeEntry("e4", "チームC"),
    ],
    schedule,
    timeSchedule: makeTimeScheduleSettings(),
  });

  assert.equal(snapshot.qualifying.timeSchedule.rounds["1"].startTime, "09:00");
  assert.equal(snapshot.qualifying.timeSchedule.rounds["2"].startTime, "09:25");
  assert.equal(snapshot.qualifying.timeSchedule.rounds["3"].startTime, "09:50");
  assert.equal("dayStartTime" in snapshot.qualifying.timeSchedule, false);
  assert.equal("matchDurationMinutes" in snapshot.qualifying.timeSchedule, false);
  assert.equal("overrides" in snapshot.qualifying.timeSchedule, false);

  const round1 = snapshot.qualifying.schedule.blocks[0].rounds[0];
  const round2 = snapshot.qualifying.schedule.blocks[0].rounds[1];
  const round3 = snapshot.qualifying.schedule.blocks[0].rounds[2];
  assert.equal(round1.roundHeading, "第1節　9:00開始予定");
  assert.equal(round2.roundHeading, "第2節　9:25開始予定");
  assert.equal(round3.roundHeading, "第3節　9:50開始予定");
  assert.equal(round1.matches[0].scheduledStartLabel, "9:00予定");
  assert.equal(round1.matches[1].scheduledStartLabel, "9:00予定");
  assert.equal(round2.matches[0].scheduledStartLabel, "9:25予定");
  assert.equal(round3.matches[0].scheduledStartLabel, "9:50予定");
  assert.equal(round1.matches[0].scheduledStartTime, "09:00");
  assert.equal(findForbiddenSnapshotFields(snapshot).length, 0);

  const view = buildPublicTournamentViewFromSnapshot(snapshot);
  assert.equal(
    view.sections.qualifying.schedule.blocks[0].rounds[1].roundHeading,
    "第2節　9:25開始予定"
  );
  assert.equal(
    view.sections.qualifying.schedule.blocks[0].rounds[1].matches[0].scheduledStartLabel,
    "9:25予定"
  );
  assert.equal(view.sections.qualifying.timeSchedule.rounds["3"].startTime, "09:50");
}

{
  const snapshot = buildPublicTournamentSnapshot({
    tournament: makeTournament(),
    entries: [makeEntry("e1", "SMA"), makeEntry("e2", "チームA")],
    schedule: makeQualifyingScheduleThreeRounds(),
  });
  assert.equal(snapshot.qualifying.timeSchedule, null);
  assert.equal(snapshot.qualifying.schedule.blocks[0].rounds[0].roundHeading, "第1節");
  assert.equal(snapshot.qualifying.schedule.blocks[0].rounds[0].scheduledStartTime, null);
  assert.equal(snapshot.qualifying.schedule.blocks[0].rounds[0].matches[0].scheduledStartLabel, null);
}

{
  const snapshot = buildPublicTournamentSnapshot({
    tournament: makeTournament(),
    entries: [makeEntry("e1", "SMA")],
    timeSchedule: makeTimeScheduleSettings(),
  });
  assert.equal(snapshot.qualifying.timeSchedule, null);
}

{
  const fiveRoundSchedule = {
    finalized: true,
    blocks: [
      {
        blockId: "A",
        blockName: "Aブロック",
        teamCount: 4,
        courtNumbers: [1],
        teams: [],
        rounds: [1, 2, 3, 4, 5].map((roundNumber) => ({
          roundNumber,
          byes: [],
          matches: [
            {
              matchId: `qualifying-A-R${roundNumber}-M1`,
              roundNumber,
              courtNumber: 1,
              team1: { entryId: "q-1", teamName: "Q 1" },
              team2: { entryId: "q-2", teamName: "Q 2" },
            },
          ],
        })),
      },
    ],
  };
  const snapshot = buildPublicTournamentSnapshot({
    tournament: makeTournament(),
    entries: Array.from({ length: 8 }, (_, i) => makeEntry(`q-${i + 1}`, `Q ${i + 1}`)),
    schedule: fiveRoundSchedule,
    finalsBracket: makeMainBracket(),
    timeSchedule: {
      configured: true,
      dayStartTime: "10:00",
      matchDurationMinutes: 20,
      matchIntervalMinutes: 5,
      qualifyingToFinalsIntervalMinutes: 60,
    },
  });
  assert.equal(snapshot.bracket.timeSchedule.rounds["1"].startTime, "13:00");
  assert.equal(snapshot.bracket.timeSchedule.rounds["2"].startTime, "13:25");
  assert.equal(snapshot.bracket.timeSchedule.rounds["3"].startTime, "13:50");
  assert.equal(snapshot.bracket.rounds[0].roundHeading, "1回戦　13:00開始予定");
  assert.equal(snapshot.bracket.rounds[1].roundHeading, "準決勝　13:25開始予定");
  assert.equal(snapshot.bracket.rounds[2].roundHeading, "決勝　13:50開始予定");
  assert.equal(snapshot.bracket.rounds[0].matches[0].scheduledStartLabel, "13:00予定");
  assert.equal(snapshot.bracket.rounds[1].matches[0].scheduledStartLabel, "13:25予定");
  assert.equal(snapshot.bracket.rounds[2].matches[0].scheduledStartLabel, "13:50予定");
  assert.equal("dayStartTime" in snapshot.bracket.timeSchedule, false);

  const view = buildPublicTournamentViewFromSnapshot(snapshot);
  assert.equal(view.sections.bracket.rounds[2].roundHeading, "決勝　13:50開始予定");
  assert.equal(view.sections.bracket.rounds[2].matches[0].scheduledStartLabel, "13:50予定");
}

{
  const snapshot = buildPublicTournamentSnapshot({
    tournament: makeTournament(),
    entries: Array.from({ length: 8 }, (_, i) => makeEntry(`q-${i + 1}`, `Q ${i + 1}`)),
    finalsBracket: makeMainBracket(),
  });
  assert.equal(snapshot.bracket.timeSchedule, null);
  assert.equal(snapshot.bracket.rounds[0].roundHeading, "1回戦");
  assert.equal(snapshot.bracket.rounds[0].matches[0].scheduledStartLabel, null);
}

{
  const seEntries = Array.from({ length: 16 }, (_, i) => makeEntry(`e${i + 1}`, `T${i + 1}`));
  const seBracket = buildPersistedFinalsBracket(
    buildFinalsBracket(
      seEntries.map((entry, index) => ({
        entryId: entry.id,
        teamName: entry.teamName,
        seed: index + 1,
      }))
    )
  );
  assert.equal(seBracket.roundCount, 4);
  const snapshot = buildPublicTournamentSnapshot({
    tournament: makeTournament({ tournamentFormat: TournamentFormat.SINGLE_ELIMINATION }),
    entries: seEntries,
    finalsBracket: seBracket,
    timeSchedule: {
      configured: true,
      dayStartTime: "09:00",
      matchDurationMinutes: 20,
      matchIntervalMinutes: 5,
      qualifyingToFinalsIntervalMinutes: 0,
    },
  });
  assert.equal(snapshot.bracket.timeSchedule.rounds["1"].startTime, "09:00");
  assert.equal(snapshot.bracket.timeSchedule.rounds["2"].startTime, "09:25");
  assert.equal(snapshot.bracket.timeSchedule.rounds["3"].startTime, "09:50");
  assert.equal(snapshot.bracket.timeSchedule.rounds["4"].startTime, "10:15");
  assert.equal(snapshot.bracket.rounds[0].roundHeading, "1回戦　9:00開始予定");
  assert.equal(snapshot.bracket.rounds[1].roundHeading, "準々決勝　9:25開始予定");
  assert.equal(snapshot.bracket.rounds[2].roundHeading, "準決勝　9:50開始予定");
  assert.equal(snapshot.bracket.rounds[3].roundHeading, "決勝　10:15開始予定");
}

{
  assert.equal(
    consolationSnapshot.consolationBracket.rounds[0]?.scheduledStartLabel,
    undefined
  );
}

{
  const schedule = makeQualifyingScheduleThreeRounds();
  const snapshot = buildPublicTournamentSnapshot({
    tournament: makeTournament(),
    entries: [
      makeEntry("e1", "SMA"),
      makeEntry("e2", "チームA"),
      makeEntry("e3", "チームB"),
      makeEntry("e4", "チームC"),
    ],
    schedule,
    timeSchedule: makeTimeScheduleSettings({
      overrides: {
        qualifyingRounds: { "2": "09:40" },
        qualifyingMatches: { "qualifying-A-R3-M1": "10:20" },
      },
    }),
  });
  assert.equal(snapshot.qualifying.timeSchedule.rounds["1"].startTime, "09:00");
  assert.equal(snapshot.qualifying.timeSchedule.rounds["2"].startTime, "09:40");
  assert.equal(snapshot.qualifying.timeSchedule.rounds["3"].startTime, "10:05");
  assert.equal("manual" in snapshot.qualifying.timeSchedule.rounds["2"], false);
  assert.equal("matchOverrides" in snapshot.qualifying.timeSchedule, false);
  assert.equal(snapshot.qualifying.schedule.blocks[0].rounds[1].roundHeading, "第2節　9:40開始予定");
  assert.equal(snapshot.qualifying.schedule.blocks[0].rounds[2].roundHeading, "第3節　10:05開始予定");
  assert.equal(
    snapshot.qualifying.schedule.blocks[0].rounds[2].matches[0].scheduledStartTime,
    "10:20"
  );
  assert.equal(
    snapshot.qualifying.schedule.blocks[0].rounds[2].matches[0].scheduledStartLabel,
    "10:20予定"
  );
  assert.equal("scheduledStartManual" in snapshot.qualifying.schedule.blocks[0].rounds[2], false);
  const serialized = JSON.stringify(snapshot);
  assert.equal(serialized.includes("（手動）"), false);
  assert.equal(serialized.includes("時刻変更"), false);
  assert.equal(findForbiddenSnapshotFields(snapshot).length, 0);

  const view = buildPublicTournamentViewFromSnapshot(snapshot);
  assert.equal(
    view.sections.qualifying.schedule.blocks[0].rounds[1].roundHeading,
    "第2節　9:40開始予定"
  );
}

{
  const fiveRoundSchedule = {
    finalized: true,
    blocks: [
      {
        blockId: "A",
        blockName: "Aブロック",
        teamCount: 4,
        courtNumbers: [1],
        teams: [],
        rounds: [1, 2, 3, 4, 5].map((roundNumber) => ({
          roundNumber,
          byes: [],
          matches: [
            {
              matchId: `qualifying-A-R${roundNumber}-M1`,
              roundNumber,
              courtNumber: 1,
              team1: { entryId: "q-1", teamName: "Q 1" },
              team2: { entryId: "q-2", teamName: "Q 2" },
            },
          ],
        })),
      },
    ],
  };
  const snapshot = buildPublicTournamentSnapshot({
    tournament: makeTournament(),
    entries: Array.from({ length: 8 }, (_, i) => makeEntry(`q-${i + 1}`, `Q ${i + 1}`)),
    schedule: fiveRoundSchedule,
    finalsBracket: makeMainBracket(),
    timeSchedule: makeTimeScheduleSettings({
      dayStartTime: "10:00",
      overrides: {
        finalsRounds: { "2": "13:45" },
        finalsMatches: {},
        qualifyingRounds: {},
        qualifyingMatches: {},
      },
    }),
  });
  assert.equal(snapshot.bracket.timeSchedule.rounds["1"].startTime, "13:00");
  assert.equal(snapshot.bracket.timeSchedule.rounds["2"].startTime, "13:45");
  assert.equal(snapshot.bracket.timeSchedule.rounds["3"].startTime, "14:10");
  assert.equal(snapshot.bracket.rounds[1].roundHeading, "準決勝　13:45開始予定");
  assert.equal(snapshot.bracket.rounds[2].roundHeading, "決勝　14:10開始予定");
  assert.equal("manual" in snapshot.bracket.timeSchedule.rounds["2"], false);
}

console.log("public-tournament-snapshot.test.mjs: all passed");
