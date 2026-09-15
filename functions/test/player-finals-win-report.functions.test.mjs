/**
 * 決勝勝利報告 Functions 配線・domain 連携
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MatchFormat } from "../vendor/domain/aggregate-match-format.js";
import {
  FinalsMatchResolution,
  MatchResultStatus,
  MatchSessionStatus,
  TournamentStatus,
} from "../vendor/domain/constants.js";
import {
  PLAYER_FINALS_ALREADY_OFFICIAL_MESSAGE,
  PLAYER_FINALS_WIN_REPORT_SOURCE,
  evaluatePlayerFinalsWinReport,
  resolveReportWinnerEntryId,
} from "../vendor/domain/player-finals-win-report.js";
import { TournamentFormat } from "../vendor/domain/tournament-format.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

{
  const indexJs = readFileSync(resolve(root, "index.js"), "utf8");
  assert.match(indexJs, /listMyCurrentFinalsMatchCallable/);
  assert.match(indexJs, /reportMyFinalsWinCallable/);
  assert.match(indexJs, /player-finals\//);
  const qualifyingImpl = readFileSync(resolve(root, "src/player-qualifying-results.js"), "utf8");
  assert.doesNotMatch(qualifyingImpl, /reportMyFinalsWin/);
  assert.doesNotMatch(qualifyingImpl, /consolationResultsMap: new Map\(\)/);

  const impl = readFileSync(resolve(root, "src/player-finals-win-report.js"), "utf8");
  assert.match(impl, /runTransaction/);
  assert.match(impl, /rebuildPublicSnapshotAdmin/);
  assert.match(impl, /resolvePlayerIdentity/);
  assert.match(impl, /evaluatePlayerFinalsWinReport/);
  assert.match(impl, /clientWinnerEntryId: input\.winnerEntryId/);
  assert.match(impl, /MAIN_RESULTS_COLLECTION = "finalsMatchResults"/);
  assert.doesNotMatch(impl, /consolationMatchResults/);
  assert.match(impl, /MatchSessionStatus.FINISHED/);

  const snapshotImpl = readFileSync(resolve(root, "src/player-qualifying-results.js"), "utf8");
  assert.match(snapshotImpl, /loadCollectionMap\(db, tournamentId, "consolationMatchResults"\)/);
  assert.doesNotMatch(
    snapshotImpl,
    /consolationResultsMap: new Map\(\)/
  );
}

function team(entryId, teamName, seed = 1) {
  return { entryId, teamName, seed, isBye: false };
}

const sma = team("sma", "SMA", 1);
const b = team("b", "チームB", 2);
const c = team("c", "チームC", 3);
const d = team("d", "チームD", 4);
const bracket = {
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
};
const tournament = {
  status: TournamentStatus.OPEN,
  participantResultEntryEnabled: true,
  tournamentFormat: TournamentFormat.QUALIFYING_AND_FINALS,
};
const advancement = { finalized: true };

{
  assert.equal(resolveReportWinnerEntryId("sma", "b"), "sma");
  const ok = evaluatePlayerFinalsWinReport({
    tournament,
    finalsAdvancement: advancement,
    bracket,
    resultsMap: new Map(),
    entryId: "sma",
    clientWinnerEntryId: "b",
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.winnerEntryId, "sma");
  assert.equal(ok.payload.winner.entryId, "sma");
  assert.equal(ok.payload.source, PLAYER_FINALS_WIN_REPORT_SOURCE);
  assert.equal(ok.sessionFields.status, MatchSessionStatus.FINISHED);

  const spoofMatch = evaluatePlayerFinalsWinReport({
    tournament,
    finalsAdvancement: advancement,
    bracket,
    resultsMap: new Map(),
    entryId: "sma",
    clientMatchId: "final-r1-m2",
  });
  assert.equal(spoofMatch.ok, false);

  const otherTeam = evaluatePlayerFinalsWinReport({
    tournament,
    finalsAdvancement: advancement,
    bracket,
    resultsMap: new Map(),
    entryId: "c",
    clientMatchId: "final-r1-m1",
  });
  assert.equal(otherTeam.ok, false);

  const first = evaluatePlayerFinalsWinReport({
    tournament,
    finalsAdvancement: advancement,
    bracket,
    resultsMap: new Map(),
    entryId: "sma",
  });
  const secondSame = evaluatePlayerFinalsWinReport({
    tournament,
    finalsAdvancement: advancement,
    bracket,
    resultsMap: new Map([["final-r1-m1", first.payload]]),
    entryId: "sma",
    clientMatchId: "final-r1-m1",
  });
  const opponent = evaluatePlayerFinalsWinReport({
    tournament,
    finalsAdvancement: advancement,
    bracket,
    resultsMap: new Map([["final-r1-m1", first.payload]]),
    entryId: "b",
  });
  assert.equal(secondSame.ok, false);
  assert.equal(secondSame.message, PLAYER_FINALS_ALREADY_OFFICIAL_MESSAGE);
  assert.equal(opponent.ok, false);
  assert.match(opponent.message, /敗退|すでに結果が確定/);
  assert.equal(first.payload.status, MatchResultStatus.FINISHED);
  assert.equal(first.payload.resolution, FinalsMatchResolution.PLAYED);
}

console.log("player-finals-win-report.functions.test.mjs: ok");
