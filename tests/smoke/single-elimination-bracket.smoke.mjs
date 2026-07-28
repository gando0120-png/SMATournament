/**
 * 一発トーナメント smoke テスト
 */
import assert from "node:assert/strict";
import { EntryStatus, TournamentStatus } from "../../js/domain/constants.js";
import { TournamentFormat } from "../../js/domain/tournament-format.js";
import {
  buildSingleEliminationBracket,
  buildPersistedSingleEliminationBracket,
  resolveSingleEliminationBracketSize,
} from "../../js/domain/single-elimination-bracket.js";
import {
  buildPublicTournamentView,
} from "../../js/domain/public-tournament-view.js";
import {
  validateTournamentCompletion,
  getTournamentResultParticipants,
} from "../../js/domain/tournament-results.js";
import { listByeMatchesNeedingResults } from "../../js/domain/finals-match-progress.js";

function makeEntries(count) {
  return Array.from({ length: count }, (_, index) => ({
    entryId: `e-${index + 1}`,
    teamName: `Team ${index + 1}`,
  }));
}

function makeEntryDocs(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `e-${index + 1}`,
    teamName: `Team ${index + 1}`,
    status: EntryStatus.CONFIRMED,
  }));
}

const threeTeam = resolveSingleEliminationBracketSize(3);
assert.equal(threeTeam.bracketSize, 4);
assert.equal(threeTeam.byeCount, 1);

const fiveTeam = buildSingleEliminationBracket({ entries: makeEntries(5), random: () => 0.3 });
assert.equal(fiveTeam.bracket.bracketSize, 8);
assert.equal(fiveTeam.bracket.byeCount, 3);
assert.equal(listByeMatchesNeedingResults(fiveTeam.bracket).length, 3);

const sixteenTeam = buildSingleEliminationBracket({ entries: makeEntries(16), random: () => 0.5 });
assert.equal(sixteenTeam.bracket.byeCount, 0);

const fortyTeam = buildSingleEliminationBracket({ entries: makeEntries(40), random: () => 0.5 });
assert.equal(fortyTeam.bracket.bracketSize, 64);
assert.equal(fortyTeam.bracket.byeCount, 24);

const persisted = buildPersistedSingleEliminationBracket(fiveTeam);
assert.equal(persisted.mode, "single_elimination");
assert.equal(persisted.teamCount, 5);
assert.equal(persisted.finalized, true);

const participants = getTournamentResultParticipants(persisted, null);
assert.equal(participants.length, 5);

const publicView = buildPublicTournamentView({
  tournament: {
    id: "se-1",
    name: "一発TN",
    status: TournamentStatus.OPEN,
    tournamentFormat: TournamentFormat.SINGLE_ELIMINATION,
    publicViewEnabled: true,
  },
  entries: makeEntryDocs(5),
  blockDraw: null,
  schedule: null,
  finalsAdvancement: null,
  finalsBracket: persisted,
  finalsResultsMap: new Map(),
  finalsSessionsMap: new Map(),
});
assert.equal(publicView.finalsAdvancement.ready, false);
assert.equal(publicView.blocks.ready, false);
assert.equal(publicView.standings.ready, false);
assert.equal(publicView.finalsBracket.ready, true);

const completionBlocked = validateTournamentCompletion({
  bracket: persisted,
  resultsMap: new Map(),
  qualifiers: participants,
  advancement: null,
});
assert.equal(completionBlocked.canFinalize, false);

assert.equal(TournamentFormat.SINGLE_ELIMINATION, "single_elimination");

for (const teamCount of [29, 31, 32]) {
  const generated = buildSingleEliminationBracket({
    entries: makeEntries(teamCount),
    random: () => 0.42,
  });
  assert.equal(generated.canFinalize, true, `teamCount=${teamCount}`);
  assert.equal(generated.bracket.bracketSize, 32, `teamCount=${teamCount}`);
  assert.equal(listByeMatchesNeedingResults(generated.bracket).length, 32 - teamCount);
}

console.log("single-elimination-bracket.smoke.mjs: all passed");
