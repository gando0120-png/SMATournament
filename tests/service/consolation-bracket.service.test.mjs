/**
 * 下位トーナメントサービス層テスト（Firestore 非依存）
 */
import assert from "node:assert/strict";
import { EntryStatus } from "../../js/domain/constants.js";
import { TournamentFormat } from "../../js/domain/tournament-format.js";
import {
  BracketKind,
  resolveBracketCollections,
  resolveOptionsBracketKind,
} from "../../js/domain/bracket-collections.js";
import {
  buildConsolationBracket,
  buildConsolationByeMatchResultPayload,
  buildPersistedConsolationBracket,
} from "../../js/domain/consolation-bracket.js";
import {
  assessConsolationEligibility,
  buildConsolationParticipants,
  ConsolationEligibilityReasonCode,
} from "../../js/domain/consolation-participants.js";
import { mapConsolationEligibilityToErrorCode } from "../../js/domain/consolation-participants.js";
import {
  listByeMatchesNeedingResults,
  resolveFinalsMatchTeams,
} from "../../js/domain/finals-match-progress.js";
import { ensureFinalsTeamWithSeed } from "../../js/domain/finals-match-result-payload.js";
import { getByeWinnerTeam } from "../../js/domain/finals-match-bye.js";

function makeEntry(id, status = EntryStatus.CONFIRMED) {
  return { id, status, teamName: `Team ${id}`, email: `x-${id}@example.com` };
}

function makeQualifiers(count) {
  return Array.from({ length: count }, (_, index) => ({
    entryId: `q-${index + 1}`,
    teamName: `Q ${index + 1}`,
    seed: index + 1,
  }));
}

function eligibleBase(overrides = {}) {
  const qualifierIds = overrides.qualifierIds ?? makeQualifiers(8).map((q) => q.entryId);
  const entries = overrides.entries ?? [
    ...qualifierIds.map((id) => makeEntry(id)),
    makeEntry("p-1"),
    makeEntry("p-2"),
    makeEntry("p-3"),
  ];
  return {
    tournament: { tournamentFormat: TournamentFormat.QUALIFYING_AND_FINALS },
    entries,
    advancement: { finalized: true, qualifiers: makeQualifiers(8) },
    mainBracket: { finalized: true, mode: "fixed", bracketSize: 8 },
    tournamentResults: null,
    consolationBracket: null,
    ...overrides,
  };
}

assert.equal(resolveOptionsBracketKind({}), BracketKind.MAIN);
assert.equal(resolveOptionsBracketKind({ bracketKind: BracketKind.CONSOLATION }), BracketKind.CONSOLATION);
assert.throws(() => resolveOptionsBracketKind({ bracketKind: "unknown" }), /Invalid bracket kind/);

assert.deepEqual(resolveBracketCollections(BracketKind.MAIN).results, "finalsMatchResults");
assert.deepEqual(resolveBracketCollections(BracketKind.CONSOLATION).results, "consolationMatchResults");

const eligible = assessConsolationEligibility(eligibleBase());
assert.equal(eligible.eligible, true);
assert.equal(eligible.reasonCode, ConsolationEligibilityReasonCode.ELIGIBLE);

const legacy = assessConsolationEligibility(
  eligibleBase({ tournament: { tournamentFormat: undefined } })
);
assert.equal(legacy.reasonCode, ConsolationEligibilityReasonCode.UNSUPPORTED_FORMAT);
assert.equal(mapConsolationEligibilityToErrorCode(legacy), "consolation-bracket/unsupported-format");

const singleElim = assessConsolationEligibility(
  eligibleBase({ tournament: { tournamentFormat: TournamentFormat.SINGLE_ELIMINATION } })
);
assert.equal(mapConsolationEligibilityToErrorCode(singleElim), "consolation-bracket/unsupported-format");

const noAdvancement = assessConsolationEligibility(
  eligibleBase({ advancement: { finalized: false, qualifiers: [] } })
);
assert.equal(mapConsolationEligibilityToErrorCode(noAdvancement), "consolation-bracket/advancement-not-finalized");

const noMain = assessConsolationEligibility(eligibleBase({ mainBracket: { finalized: false } }));
assert.equal(mapConsolationEligibilityToErrorCode(noMain), "consolation-bracket/main-bracket-not-finalized");

const completed = assessConsolationEligibility(eligibleBase({ tournamentResults: { finalized: true } }));
assert.equal(mapConsolationEligibilityToErrorCode(completed), "consolation-bracket/tournament-completed");

const already = assessConsolationEligibility(
  eligibleBase({
    consolationBracket: buildPersistedConsolationBracket(
      buildConsolationBracket([{ entryId: "p-1" }, { entryId: "p-2" }], { random: () => 0.5 })
    ),
  })
);
assert.equal(mapConsolationEligibilityToErrorCode(already), "consolation-bracket/already-created");

const oneTeam = assessConsolationEligibility(
  eligibleBase({
    entries: [...makeQualifiers(8).map((q) => makeEntry(q.entryId)), makeEntry("p-1")],
  })
);
assert.equal(mapConsolationEligibilityToErrorCode(oneTeam), "consolation-bracket/not-enough-participants");

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
  assert.equal(participants.length, count, `count=${count}`);
  const preview = buildConsolationBracket(participants, { random: () => 0.42 });
  assert.equal(preview.valid, true, `count=${count}`);
  const byeMatches = listByeMatchesNeedingResults(preview.bracket);
  assert.equal(byeMatches.length, expectedBye, `count=${count}`);
}

// BYE 勝者が consolation bracket 内で次ラウンド解決される
const bracketPreview = buildConsolationBracket(
  [
    { entryId: "p-1", teamName: "P1" },
    { entryId: "p-2", teamName: "P2" },
    { entryId: "p-3", teamName: "P3" },
  ],
  { random: () => 0.42 }
);
const consolationResults = new Map();
for (const match of listByeMatchesNeedingResults(bracketPreview.bracket)) {
  const winner = ensureFinalsTeamWithSeed(
    getByeWinnerTeam(match.team1, match.team2),
    match.matchNumber
  );
  consolationResults.set(match.matchId, buildConsolationByeMatchResultPayload(match, winner));
}
const byeMatch = listByeMatchesNeedingResults(bracketPreview.bracket)[0];
const feederNext = bracketPreview.bracket.matches.find((m) => m.matchId === byeMatch.nextMatchId);
assert.ok(feederNext);
const resolved = resolveFinalsMatchTeams({
  match: feederNext,
  bracket: bracketPreview.bracket,
  resultsMap: consolationResults,
});
const byeWinnerId = consolationResults.get(byeMatch.matchId).winner.entryId;
assert.ok(
  resolved.team1?.entryId === byeWinnerId || resolved.team2?.entryId === byeWinnerId,
  "BYE winner should appear in next-round slot"
);

// main / consolation 分離（resultsMap が別なら互いに影響しない）
const mainBracketPreview = buildConsolationBracket(
  [
    { entryId: "m-1", teamName: "M1" },
    { entryId: "m-2", teamName: "M2" },
    { entryId: "m-3", teamName: "M3" },
  ],
  { random: () => 0.1 }
);
const mainResults = new Map();
const mainBye = listByeMatchesNeedingResults(mainBracketPreview.bracket)[0];
mainResults.set("final-r9-m9", {
  matchId: "final-r9-m9",
  winner: { entryId: "ghost", teamName: "Ghost", seed: 1 },
});
const consolationResolved = resolveFinalsMatchTeams({
  match: feederNext,
  bracket: bracketPreview.bracket,
  resultsMap: consolationResults,
});
const mainResolved = resolveFinalsMatchTeams({
  match: mainBracketPreview.bracket.matches[0],
  bracket: mainBracketPreview.bracket,
  resultsMap: mainResults,
});
assert.ok(consolationResolved.team1?.entryId === byeWinnerId || consolationResolved.team2?.entryId === byeWinnerId);
assert.notEqual(mainResolved.team1?.entryId, "ghost");
assert.notEqual(mainResolved.team2?.entryId, "ghost");

console.log("consolation-bracket.service.test.mjs: all passed");
