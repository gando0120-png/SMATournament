/**
 * 下位トーナメント管理 UI smoke テスト
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BracketKind } from "../../js/domain/bracket-collections.js";
import { ConsolationEligibilityReasonCode } from "../../js/domain/consolation-participants.js";
import { EntryStatus } from "../../js/domain/constants.js";
import { TournamentFormat } from "../../js/domain/tournament-format.js";
import {
  assessConsolationEligibility,
  buildConsolationParticipants,
} from "../../js/domain/consolation-participants.js";
import {
  buildConsolationBracket,
  buildPersistedConsolationBracket,
  resolveConsolationBracketSize,
} from "../../js/domain/consolation-bracket.js";
import {
  buildFinalsMatchProgressIndex,
  resolveFinalsMatchTeams,
} from "../../js/domain/finals-match-progress.js";
import { listByeMatchesNeedingResults } from "../../js/domain/finals-match-progress.js";
import { buildConsolationByeMatchResultPayload } from "../../js/domain/consolation-bracket.js";
import { ensureFinalsTeamWithSeed } from "../../js/domain/finals-match-result-payload.js";
import { getByeWinnerTeam } from "../../js/domain/finals-match-bye.js";
import {
  buildBracketPageHref,
  buildConsolationCreateConfirmMessage,
  buildFinalsMatchPageHref,
  getConsolationEligibilityHintMessage,
  resolveActiveBracketKindFromViewParam,
  resolveMatchPageBracketKind,
  shouldShowConsolationCreateButton,
  shouldShowConsolationEligibilityHint,
} from "../../js/ui/consolation-bracket-ui.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");
const bracketPage = readFileSync(
  resolve(root, "js/ui/pages/tournament-finals-bracket-page.js"),
  "utf8"
);
const bracketHtml = readFileSync(resolve(root, "tournament-finals-bracket.html"), "utf8");
const componentsCss = readFileSync(resolve(root, "css/components.css"), "utf8");

function makeEntry(id, status = EntryStatus.CONFIRMED) {
  return { id, status, teamName: `Team ${id}` };
}

function makeQualifiers(count) {
  return Array.from({ length: count }, (_, index) => ({
    entryId: `q-${index + 1}`,
    teamName: `Q ${index + 1}`,
    seed: index + 1,
  }));
}

function eligibleBase(overrides = {}) {
  return {
    tournament: { tournamentFormat: TournamentFormat.QUALIFYING_AND_FINALS },
    entries: [
      ...makeQualifiers(8).map((q) => makeEntry(q.entryId)),
      makeEntry("p-1"),
      makeEntry("p-2"),
      makeEntry("p-3"),
    ],
    advancement: { finalized: true, qualifiers: makeQualifiers(8) },
    mainBracket: { finalized: true, mode: "fixed", bracketSize: 8 },
    tournamentResults: null,
    consolationBracket: null,
    ...overrides,
  };
}

// ── ページソース構造 ─────────────────────────────────────────

assert.match(bracketHtml, /id="bracketKindTabs"/);
assert.match(bracketHtml, /id="createConsolationBtn"/);
assert.match(bracketHtml, /上位トーナメント/);
assert.match(bracketHtml, /下位トーナメント/);
assert.match(bracketPage, /activeBracketKind/);
assert.match(bracketPage, /createConsolationPending/);
assert.match(bracketPage, /createConsolationBracket/);
assert.match(bracketPage, /assessConsolationEligibility/);
assert.match(bracketPage, /renderActiveBracketView/);
assert.match(bracketPage, /syncBracketViewUrl/);
assert.match(bracketPage, /buildFinalsMatchPageHref/);
assert.match(bracketPage, /bracketKind:\s*activeBracketKind/);
assert.match(bracketPage, /startFinalsMatchSession\(tournamentId, matchId, \{ bracketKind: activeBracketKind \}\)/);
assert.doesNotMatch(bracketPage, /allowMatchActions:\s*false/);

const matchPage = readFileSync(resolve(root, "js/ui/pages/tournament-finals-match-page.js"), "utf8");
assert.match(matchPage, /resolveMatchPageBracketKind/);
assert.match(matchPage, /getBracketServiceOptions/);
assert.match(matchPage, /getConsolationBracket/);
assert.match(matchPage, /saveFinalsMatchResult\([\s\S]*getBracketServiceOptions\(\)/);
assert.match(matchPage, /shouldAutoEnterResult = true/);

// ── 作成ボタン表示条件 ───────────────────────────────────────

const eligible = assessConsolationEligibility(eligibleBase());
assert.equal(
  shouldShowConsolationCreateButton(eligible, false, BracketKind.MAIN, true),
  true
);

const oneTeam = assessConsolationEligibility(
  eligibleBase({
    entries: [...makeQualifiers(8).map((q) => makeEntry(q.entryId)), makeEntry("p-1")],
  })
);
assert.equal(
  shouldShowConsolationCreateButton(oneTeam, false, BracketKind.MAIN, true),
  false
);
assert.equal(shouldShowConsolationEligibilityHint(oneTeam.reasonCode), true);

const singleElim = assessConsolationEligibility(
  eligibleBase({ tournament: { tournamentFormat: TournamentFormat.SINGLE_ELIMINATION } })
);
assert.equal(
  shouldShowConsolationCreateButton(singleElim, false, BracketKind.MAIN, true),
  false
);
assert.equal(shouldShowConsolationEligibilityHint(singleElim.reasonCode), false);

const legacy = assessConsolationEligibility(
  eligibleBase({ tournament: { tournamentFormat: undefined } })
);
assert.equal(
  shouldShowConsolationCreateButton(legacy, false, BracketKind.MAIN, true),
  false
);

const noAdvancement = assessConsolationEligibility(
  eligibleBase({ advancement: { finalized: false, qualifiers: [] } })
);
assert.match(getConsolationEligibilityHintMessage(noAdvancement.reasonCode), /決勝進出者/);

const noMain = assessConsolationEligibility(eligibleBase({ mainBracket: { finalized: false } }));
assert.match(getConsolationEligibilityHintMessage(noMain.reasonCode), /上位トーナメント/);

const already = assessConsolationEligibility(
  eligibleBase({
    consolationBracket: buildPersistedConsolationBracket(
      buildConsolationBracket([{ entryId: "p-1" }, { entryId: "p-2" }], { random: () => 0.5 })
    ),
  })
);
assert.equal(
  shouldShowConsolationCreateButton(already, true, BracketKind.MAIN, true),
  false
);

// ── タブ / URL ───────────────────────────────────────────────

assert.equal(resolveActiveBracketKindFromViewParam(null, false), BracketKind.MAIN);
assert.equal(resolveActiveBracketKindFromViewParam("consolation", false), BracketKind.MAIN);
assert.equal(resolveActiveBracketKindFromViewParam("consolation", true), BracketKind.CONSOLATION);
assert.equal(
  buildBracketPageHref("abc123", BracketKind.CONSOLATION),
  "tournament-finals-bracket.html?id=abc123&view=consolation"
);
assert.equal(buildBracketPageHref("abc123", BracketKind.MAIN), "tournament-finals-bracket.html?id=abc123");
assert.equal(
  buildFinalsMatchPageHref("abc123", "final-r1-m1", { bracketKind: BracketKind.CONSOLATION, enterResult: true }),
  "tournament-finals-match.html?id=abc123&matchId=final-r1-m1&enterResult=1&bracketKind=consolation"
);
assert.equal(resolveMatchPageBracketKind("bracketKind=consolation"), BracketKind.CONSOLATION);
assert.equal(resolveMatchPageBracketKind(""), BracketKind.MAIN);

// ── 確認ダイアログ文言 / BYE ─────────────────────────────────

for (const [count, expectedBye] of [
  [3, 1],
  [5, 3],
  [13, 3],
]) {
  const participants = buildConsolationParticipants(
    [
      ...makeQualifiers(8).map((q) => makeEntry(q.entryId)),
      ...Array.from({ length: count }, (_, i) => makeEntry(`p-${i + 1}`)),
    ],
    { finalized: true, qualifiers: makeQualifiers(8) }
  );
  const preview = buildConsolationBracket(participants, { random: () => 0.42 });
  const byeMatches = listByeMatchesNeedingResults(preview.bracket);
  assert.equal(byeMatches.length, expectedBye, `bye count=${count}`);
  const sizeResult = resolveConsolationBracketSize(count);
  assert.equal(sizeResult.byeCount, expectedBye);
  assert.match(buildConsolationCreateConfirmMessage(count), new RegExp(`${count}チーム`));
}

// ── main / consolation 結果分離 ─────────────────────────────

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
const mainResults = new Map();
mainResults.set("final-r1-m1", {
  matchId: "final-r1-m1",
  winner: { entryId: "ghost", teamName: "Ghost", seed: 1 },
});
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
const mainResolved = resolveFinalsMatchTeams({
  match: feederNext,
  bracket: preview.bracket,
  resultsMap: mainResults,
});
assert.notEqual(mainResolved.team1?.entryId, byeWinnerId);
assert.notEqual(mainResolved.team2?.entryId, byeWinnerId);

const consolationIndex = buildFinalsMatchProgressIndex(
  preview.bracket,
  consolationResults,
  new Map()
);
const mainIndex = buildFinalsMatchProgressIndex(preview.bracket, mainResults, new Map());
assert.notEqual(consolationIndex.get(byeMatch.matchId)?.result, mainIndex.get(byeMatch.matchId)?.result);

// ── CSS ──────────────────────────────────────────────────────

assert.match(componentsCss, /\.bracket-kind-tabs/);
assert.match(componentsCss, /\.bracket-kind-tabs__btn--active/);

console.log("consolation-bracket-admin.smoke.mjs: all passed");
