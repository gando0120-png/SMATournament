/**
 * 下位トーナメント対象者・適格性ドメインテスト
 */
import assert from "node:assert/strict";
import { EntryStatus } from "../../js/domain/constants.js";
import { TournamentFormat } from "../../js/domain/tournament-format.js";
import {
  BracketKind,
  CONSOLATION_MIN_PARTICIPANTS,
  resolveBracketCollections,
  isValidBracketKind,
} from "../../js/domain/bracket-collections.js";
import {
  buildConsolationParticipants,
  assessConsolationEligibility,
  ConsolationEligibilityReasonCode,
} from "../../js/domain/consolation-participants.js";

function makeEntry(id, status = EntryStatus.CONFIRMED, teamName = `Team ${id}`) {
  return { id, status, teamName, email: `user-${id}@example.com` };
}

function makeQualifier(entryId, overrides = {}) {
  return { entryId, teamName: `Q ${entryId}`, seed: 1, ...overrides };
}

function makeAdvancement(qualifierEntryIds) {
  return {
    finalized: true,
    qualifiers: qualifierEntryIds.map((entryId, index) =>
      makeQualifier(entryId, { seed: index + 1 })
    ),
  };
}

function eligibleContext(overrides = {}) {
  const qualifierIds = overrides.qualifierIds ?? ["q-1", "q-2", "q-3", "q-4", "q-5", "q-6", "q-7", "q-8"];
  const entries = overrides.entries ?? [
    ...qualifierIds.map((id) => makeEntry(id)),
    makeEntry("p-1"),
    makeEntry("p-2"),
    makeEntry("p-3"),
  ];

  return {
    tournament: { tournamentFormat: TournamentFormat.QUALIFYING_AND_FINALS },
    entries,
    advancement: makeAdvancement(qualifierIds),
    mainBracket: { finalized: true, bracketSize: 8 },
    tournamentResults: null,
    consolationBracket: null,
    ...overrides,
  };
}

// ── bracket-collections ─────────────────────────────────────

assert.equal(isValidBracketKind(BracketKind.MAIN), true);
assert.equal(isValidBracketKind(BracketKind.CONSOLATION), true);
assert.equal(isValidBracketKind("invalid"), false);

assert.deepEqual(resolveBracketCollections(BracketKind.MAIN), {
  bracket: "finalsBracket",
  sessions: "finalsMatchSessions",
  results: "finalsMatchResults",
});
assert.deepEqual(resolveBracketCollections(BracketKind.CONSOLATION), {
  bracket: "consolationBracket",
  sessions: "consolationMatchSessions",
  results: "consolationMatchResults",
});
assert.throws(() => resolveBracketCollections("unknown"), /Invalid bracket kind/);

assert.equal(CONSOLATION_MIN_PARTICIPANTS, 2);

// ── buildConsolationParticipants: 人数別 ────────────────────

function countParticipants(totalConfirmed, qualifierCount) {
  const qualifierIds = Array.from({ length: qualifierCount }, (_, i) => `q-${i + 1}`);
  const entries = [
    ...qualifierIds.map((id) => makeEntry(id)),
    ...Array.from({ length: totalConfirmed - qualifierCount }, (_, i) => makeEntry(`p-${i + 1}`)),
  ];
  return buildConsolationParticipants(entries, makeAdvancement(qualifierIds)).length;
}

assert.equal(countParticipants(8, 8), 0);
assert.equal(countParticipants(9, 8), 1);
assert.equal(countParticipants(10, 8), 2);
assert.equal(countParticipants(11, 8), 3);
assert.equal(countParticipants(13, 8), 5);
assert.equal(countParticipants(16, 8), 8);
assert.equal(countParticipants(21, 8), 13);

// ── 上位進出者が混入しない ──────────────────────────────────

const mixedEntries = [
  makeEntry("q-1"),
  makeEntry("q-2"),
  makeEntry("p-1"),
  makeEntry("p-2"),
];
const mixedAdvancement = makeAdvancement(["q-1", "q-2"]);
const mixedParticipants = buildConsolationParticipants(mixedEntries, mixedAdvancement);
assert.deepEqual(
  mixedParticipants.map((p) => p.entryId).sort(),
  ["p-1", "p-2"]
);
assert.ok(mixedParticipants.every((p) => !["q-1", "q-2"].includes(p.entryId)));

// ── qualifier isBye は除外集合に入れない ───────────────────

const byeAdvancement = {
  finalized: true,
  qualifiers: [
    makeQualifier("q-1"),
    { isBye: true, entryId: "bye-slot", teamName: null },
  ],
};
const byeEntries = [makeEntry("q-1"), makeEntry("p-1"), makeEntry("p-2")];
const byeParticipants = buildConsolationParticipants(byeEntries, byeAdvancement);
assert.deepEqual(
  byeParticipants.map((p) => p.entryId).sort(),
  ["p-1", "p-2"]
);

// ── confirmed 以外を含めない ────────────────────────────────

const statusEntries = [
  makeEntry("c-1", EntryStatus.CONFIRMED),
  makeEntry("p-1", EntryStatus.PENDING),
  makeEntry("a-1", EntryStatus.APPLIED),
  makeEntry("w-1", EntryStatus.WAITLISTED),
  makeEntry("x-1", EntryStatus.CANCELLED),
  makeEntry("c-2", EntryStatus.CONFIRMED),
];
const statusParticipants = buildConsolationParticipants(statusEntries, { finalized: true, qualifiers: [] });
assert.deepEqual(statusParticipants.map((p) => p.entryId).sort(), ["c-1", "c-2"]);

// ── entryId 重複を除去 ──────────────────────────────────────

const dupEntries = [
  { id: "dup-1", status: EntryStatus.CONFIRMED, teamName: "A" },
  { id: "dup-1", status: EntryStatus.CONFIRMED, teamName: "B" },
  makeEntry("unique-1"),
];
const dupParticipants = buildConsolationParticipants(dupEntries, { finalized: true, qualifiers: [] });
assert.equal(dupParticipants.length, 2);
assert.equal(dupParticipants.filter((p) => p.entryId === "dup-1").length, 1);

// ── teamName null でもクラッシュしない ──────────────────────

const nullNameEntries = [{ id: "n-1", status: EntryStatus.CONFIRMED, teamName: null }];
const nullNameParticipants = buildConsolationParticipants(nullNameEntries, {
  finalized: true,
  qualifiers: [],
});
assert.deepEqual(nullNameParticipants, [{ entryId: "n-1", teamName: null }]);

// ── email を返さない ────────────────────────────────────────

const piiParticipants = buildConsolationParticipants([makeEntry("e-1")], {
  finalized: true,
  qualifiers: [],
});
assert.equal(Object.hasOwn(piiParticipants[0], "email"), false);
assert.deepEqual(Object.keys(piiParticipants[0]).sort(), ["entryId", "teamName"]);

// ── entryId 欠落は除外 ──────────────────────────────────────

const noIdEntries = [
  { status: EntryStatus.CONFIRMED, teamName: "No Id" },
  makeEntry("ok-1"),
];
const noIdParticipants = buildConsolationParticipants(noIdEntries, {
  finalized: true,
  qualifiers: [],
});
assert.deepEqual(noIdParticipants, [{ entryId: "ok-1", teamName: "Team ok-1" }]);

// entryId フィールド直接指定も可
const directEntryId = buildConsolationParticipants(
  [{ entryId: "direct-1", status: EntryStatus.CONFIRMED, teamName: "Direct" }],
  { finalized: true, qualifiers: [] }
);
assert.deepEqual(directEntryId, [{ entryId: "direct-1", teamName: "Direct" }]);

// ── assessConsolationEligibility ────────────────────────────

const eligible = assessConsolationEligibility(eligibleContext());
assert.equal(eligible.eligible, true);
assert.equal(eligible.reasonCode, ConsolationEligibilityReasonCode.ELIGIBLE);
assert.equal(eligible.participantCount, 3);

const singleElim = assessConsolationEligibility(
  eligibleContext({
    tournament: { tournamentFormat: TournamentFormat.SINGLE_ELIMINATION },
  })
);
assert.equal(singleElim.eligible, false);
assert.equal(singleElim.reasonCode, ConsolationEligibilityReasonCode.UNSUPPORTED_FORMAT);

const legacyFormat = assessConsolationEligibility(
  eligibleContext({ tournament: { tournamentFormat: undefined } })
);
assert.equal(legacyFormat.eligible, false);
assert.equal(legacyFormat.reasonCode, ConsolationEligibilityReasonCode.UNSUPPORTED_FORMAT);

const notFinalizedAdvancement = assessConsolationEligibility(
  eligibleContext({ advancement: { finalized: false, qualifiers: [] } })
);
assert.equal(notFinalizedAdvancement.eligible, false);
assert.equal(notFinalizedAdvancement.reasonCode, ConsolationEligibilityReasonCode.ADVANCEMENT_NOT_FINALIZED);

const notFinalizedMain = assessConsolationEligibility(
  eligibleContext({ mainBracket: { finalized: false } })
);
assert.equal(notFinalizedMain.eligible, false);
assert.equal(notFinalizedMain.reasonCode, ConsolationEligibilityReasonCode.MAIN_BRACKET_NOT_FINALIZED);

const tournamentDone = assessConsolationEligibility(
  eligibleContext({ tournamentResults: { finalized: true } })
);
assert.equal(tournamentDone.eligible, false);
assert.equal(tournamentDone.reasonCode, ConsolationEligibilityReasonCode.TOURNAMENT_ALREADY_COMPLETED);

const consolationExists = assessConsolationEligibility(
  eligibleContext({
    consolationBracket: {
      mode: BracketKind.CONSOLATION,
      finalized: true,
      bracketSize: 4,
      slots: [{}, {}, {}, {}],
      matches: [{ matchId: "final-r1-m1" }],
    },
  })
);
assert.equal(consolationExists.eligible, false);
assert.equal(consolationExists.reasonCode, ConsolationEligibilityReasonCode.CONSOLATION_ALREADY_CREATED);

const zeroParticipants = assessConsolationEligibility(
  eligibleContext({
    entries: Array.from({ length: 8 }, (_, i) => makeEntry(`q-${i + 1}`)),
    qualifierIds: undefined,
  })
);
assert.equal(zeroParticipants.participantCount, 0);
assert.equal(zeroParticipants.eligible, false);
assert.equal(zeroParticipants.reasonCode, ConsolationEligibilityReasonCode.NOT_ENOUGH_PARTICIPANTS);

const oneParticipant = assessConsolationEligibility(
  eligibleContext({
    entries: [
      ...Array.from({ length: 8 }, (_, i) => makeEntry(`q-${i + 1}`)),
      makeEntry("p-1"),
    ],
  })
);
assert.equal(oneParticipant.participantCount, 1);
assert.equal(oneParticipant.eligible, false);
assert.equal(oneParticipant.reasonCode, ConsolationEligibilityReasonCode.NOT_ENOUGH_PARTICIPANTS);

const twoParticipants = assessConsolationEligibility(
  eligibleContext({
    entries: [
      ...Array.from({ length: 8 }, (_, i) => makeEntry(`q-${i + 1}`)),
      makeEntry("p-1"),
      makeEntry("p-2"),
    ],
  })
);
assert.equal(twoParticipants.participantCount, 2);
assert.equal(twoParticipants.eligible, true);
assert.equal(twoParticipants.reasonCode, ConsolationEligibilityReasonCode.ELIGIBLE);

console.log("consolation-participants.test.mjs: all passed");
