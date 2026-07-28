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

console.log("public-tournament-snapshot.test.mjs: all passed");
