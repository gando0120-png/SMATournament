/**
 * 公開下位トーナメント smoke テスト
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BracketKind } from "../../js/domain/bracket-collections.js";
import { TournamentFormat } from "../../js/domain/tournament-format.js";
import { TournamentStatus, EntryStatus } from "../../js/domain/constants.js";
import {
  buildPublicTournamentSnapshot,
  buildPublicTournamentViewFromSnapshot,
  findForbiddenSnapshotFields,
} from "../../js/domain/public-tournament-snapshot.js";
import { hasPublicConsolationBracket } from "../../js/domain/public-tournament-view.js";
import {
  buildConsolationBracket,
  buildPersistedConsolationBracket,
  buildConsolationByeMatchResultPayload,
} from "../../js/domain/consolation-bracket.js";
import {
  buildFinalsMatchProgressIndex,
  listByeMatchesNeedingResults,
  resolveFinalsMatchTeams,
} from "../../js/domain/finals-match-progress.js";
import { getByeWinnerTeam } from "../../js/domain/finals-match-bye.js";
import { ensureFinalsTeamWithSeed } from "../../js/domain/finals-match-result-payload.js";
import {
  resolveActiveBracketKindFromViewParam,
  syncPublicBracketViewUrl,
} from "../../js/ui/consolation-bracket-ui.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");
const publicPage = readFileSync(resolve(root, "js/ui/pages/tournament-public-page.js"), "utf8");
const publicHtml = readFileSync(resolve(root, "tournament-public.html"), "utf8");
const snapshotService = readFileSync(
  resolve(root, "js/services/public-tournament-snapshot-service.js"),
  "utf8"
);
const consolationService = readFileSync(
  resolve(root, "js/services/consolation-bracket-service.js"),
  "utf8"
);

function makeTournament() {
  return {
    id: "t1",
    name: "Test",
    status: TournamentStatus.OPEN,
    tournamentFormat: TournamentFormat.QUALIFYING_AND_FINALS,
    blockCount: 4,
    qualifiersPerBlock: 2,
    venue: "V",
    eventDate: "2026-08-01",
    publicViewEnabled: true,
    createdBy: "op",
    email: "secret@example.com",
  };
}

function buildConsolationSnapshot(participantCount) {
  const participants = Array.from({ length: participantCount }, (_, i) => ({
    entryId: `p-${i + 1}`,
    teamName: `P ${i + 1}`,
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
  return buildPublicTournamentSnapshot({
    tournament: makeTournament(),
    entries: participants.map((p) => ({ id: p.entryId, teamName: p.teamName, status: EntryStatus.CONFIRMED })),
    finalsResultsMap: new Map(),
    finalsSessionsMap: new Map(),
    consolationBracket: bracket,
    consolationResultsMap: resultsMap,
    consolationSessionsMap: new Map(),
  });
}

// ── ソース構造 ───────────────────────────────────────────────

assert.match(publicHtml, /id="publicBracketKindTabs"/);
assert.match(publicPage, /activeBracketKind/);
assert.match(publicPage, /hasPublicConsolationBracket/);
assert.match(publicPage, /getActivePublicBracketSection/);
assert.match(publicPage, /下位トーナメント優勝/);
assert.match(publicPage, /syncPublicBracketViewUrl/);
assert.doesNotMatch(publicPage, /startFinalsMatchSession/);
assert.doesNotMatch(publicPage, /saveFinalsMatchResult/);
assert.match(snapshotService, /getConsolationBracket/);
assert.match(snapshotService, /bracketKind: BracketKind\.CONSOLATION/);
assert.match(consolationService, /withPublicSnapshotRebuild/);

// ── タブ / URL ───────────────────────────────────────────────

assert.equal(resolveActiveBracketKindFromViewParam(null, false), BracketKind.MAIN);
assert.equal(resolveActiveBracketKindFromViewParam("consolation", true), BracketKind.CONSOLATION);
assert.equal(resolveActiveBracketKindFromViewParam("consolation", false), BracketKind.MAIN);

// ── snapshot ─────────────────────────────────────────────────

const noConsolation = buildPublicTournamentSnapshot({
  tournament: makeTournament(),
  entries: [],
  finalsResultsMap: new Map(),
  finalsSessionsMap: new Map(),
});
assert.equal(Object.hasOwn(noConsolation, "consolationBracket"), false);

const withConsolation = buildConsolationSnapshot(5);
assert.equal(Object.hasOwn(withConsolation, "consolationBracket"), true);
assert.equal(Object.hasOwn(withConsolation, "consolationMatchResults"), true);
assert.deepEqual(findForbiddenSnapshotFields(withConsolation), []);
assert.equal(withConsolation.tournament.email, undefined);

const view = buildPublicTournamentViewFromSnapshot(withConsolation);
assert.equal(hasPublicConsolationBracket(view.sections.consolationBracket), true);
assert.equal(view.sections.consolationBracket.title, "下位トーナメント");

// legacy v2 後方互換
const legacyView = buildPublicTournamentViewFromSnapshot({
  schemaVersion: 2,
  tournament: noConsolation.tournament,
  registration: noConsolation.registration,
  qualifying: noConsolation.qualifying,
  advancement: noConsolation.advancement,
  bracket: noConsolation.bracket,
  results: noConsolation.results,
  qualifyingResults: [],
  finalsMatchResults: [],
});
assert.equal(hasPublicConsolationBracket(legacyView.sections.consolationBracket), false);

// single_elimination は consolation なし
const singleElimSnap = buildPublicTournamentSnapshot({
  tournament: { ...makeTournament(), tournamentFormat: TournamentFormat.SINGLE_ELIMINATION },
  entries: [],
  finalsResultsMap: new Map(),
  finalsSessionsMap: new Map(),
});
assert.equal(Object.hasOwn(singleElimSnap, "consolationBracket"), false);

// ── BYE 数 / 次ラウンド / 分離 ───────────────────────────────

for (const count of [3, 5, 13]) {
  const snap = buildConsolationSnapshot(count);
  const v = buildPublicTournamentViewFromSnapshot(snap);
  assert.ok(v.sections.consolationBracket.byeCount >= 1, `expected byeCount for count=${count}`);

  const preview = buildConsolationBracket(
    Array.from({ length: count }, (_, i) => ({
      entryId: `p-${i + 1}`,
      teamName: `P ${i + 1}`,
    })),
    { random: () => 0.42 }
  );
  const bracketOnlySnap = buildPublicTournamentSnapshot({
    tournament: makeTournament(),
    entries: [],
    finalsResultsMap: new Map(),
    finalsSessionsMap: new Map(),
    consolationBracket: buildPersistedConsolationBracket(preview),
    consolationResultsMap: new Map(),
    consolationSessionsMap: new Map(),
  });
  const bracketView = buildPublicTournamentViewFromSnapshot(bracketOnlySnap);
  const round1 = bracketView.sections.consolationBracket.rounds[0]?.matches ?? [];
  const byeSlots = round1.filter(
    (m) => m.team1?.type === "bye" || m.team2?.type === "bye"
  ).length;
  assert.ok(byeSlots >= 1, `expected bye slot display for count=${count}`);

  const round1WithResults = v.sections.consolationBracket.rounds[0]?.matches ?? [];
  const autoAdvance = round1WithResults.filter((m) =>
    m.resultSummary?.includes("自動進出")
  ).length;
  assert.ok(autoAdvance >= 1, `expected auto-advance result for count=${count}`);
}

const preview = buildConsolationBracket(
  [
    { entryId: "p-1", teamName: "P1" },
    { entryId: "p-2", teamName: "P2" },
    { entryId: "p-3", teamName: "P3" },
  ],
  { random: () => 0.42 }
);
const consolationResults = new Map();
for (const match of listByeMatchesNeedingResults(preview.bracket)) {
  const winner = ensureFinalsTeamWithSeed(
    getByeWinnerTeam(match.team1, match.team2),
    match.matchNumber
  );
  consolationResults.set(match.matchId, buildConsolationByeMatchResultPayload(match, winner));
}
const byeMatch = listByeMatchesNeedingResults(preview.bracket)[0];
const feederNext = preview.bracket.matches.find((m) => m.matchId === byeMatch.nextMatchId);
const resolved = resolveFinalsMatchTeams({
  match: feederNext,
  bracket: preview.bracket,
  resultsMap: consolationResults,
});
const byeWinnerId = consolationResults.get(byeMatch.matchId).winner.entryId;
assert.ok(
  resolved.team1?.entryId === byeWinnerId || resolved.team2?.entryId === byeWinnerId
);

const mainResults = new Map();
mainResults.set(byeMatch.matchId, {
  matchId: byeMatch.matchId,
  winner: { entryId: "ghost", teamName: "Ghost", seed: 1 },
});
const mainResolved = resolveFinalsMatchTeams({
  match: feederNext,
  bracket: preview.bracket,
  resultsMap: mainResults,
});
assert.notEqual(mainResolved.team1?.entryId, byeWinnerId);
assert.notEqual(mainResolved.team2?.entryId, byeWinnerId);

const cIndex = buildFinalsMatchProgressIndex(preview.bracket, consolationResults, new Map());
const mIndex = buildFinalsMatchProgressIndex(preview.bracket, mainResults, new Map());
assert.notEqual(cIndex.get(byeMatch.matchId)?.result, mIndex.get(byeMatch.matchId)?.result);

console.log("public-consolation-bracket.smoke.mjs: all passed");
