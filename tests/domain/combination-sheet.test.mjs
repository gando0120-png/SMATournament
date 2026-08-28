/**
 * 組み合わせ帳票 ViewModel ドメインテスト
 */
import assert from "node:assert/strict";
import {
  COMBINATION_SHEET_SCHEMA_VERSION,
  CombinationSheetErrorCode,
  CombinationSheetOrientation,
  CombinationSheetType,
  QUALIFYING_BLOCKS_PER_PAGE,
  SINGLE_ELIMINATION_MATCHES_PER_PAGE,
  buildQualifyingBlocksCombinationSheet,
  buildSingleEliminationCombinationSheet,
  canBuildQualifyingBlocksCombinationSheet,
  canBuildSingleEliminationCombinationSheet,
  formatCombinationSheetEventDate,
  parseCombinationSheetUrlType,
  resolveSingleEliminationSheetOrientation,
} from "../../js/domain/combination-sheet.js";
import {
  buildPersistedSingleEliminationBracket,
  buildSingleEliminationBracket,
} from "../../js/domain/single-elimination-bracket.js";
import { MatchFormat } from "../../js/domain/aggregate-match-format.js";

function makeTournament(overrides = {}) {
  return {
    id: "t1",
    name: "第1回テスト大会",
    eventDate: "2026-08-30",
    venue: "○○グラウンド",
    tournamentFormat: "qualifying_and_finals",
    ...overrides,
  };
}

function makeEntries(pairs) {
  return pairs.map(([id, teamName]) => ({ id, teamName }));
}

function makeFinalizedBlockDraw(blocks, extra = {}) {
  return {
    status: "finalized",
    blocks,
    ...extra,
  };
}

function sheetJson(value) {
  return JSON.parse(JSON.stringify(value));
}

assert.equal(formatCombinationSheetEventDate("2026-08-30"), "2026年8月30日");
assert.equal(formatCombinationSheetEventDate("2026-08-01"), "2026年8月1日");
assert.equal(formatCombinationSheetEventDate(""), "—");
assert.equal(formatCombinationSheetEventDate(null), "—");
assert.equal(formatCombinationSheetEventDate("未定"), "未定");
assert.equal(parseCombinationSheetUrlType("qualifying"), "qualifying");
assert.equal(parseCombinationSheetUrlType("single-elimination"), "single-elimination");
assert.equal(parseCombinationSheetUrlType("png"), null);

const draftDraw = makeFinalizedBlockDraw(
  [{ id: "A", name: "Aブロック", entryIds: ["e-1"] }],
  { status: "draft" }
);
assert.equal(canBuildQualifyingBlocksCombinationSheet(draftDraw), false);
const draftResult = buildQualifyingBlocksCombinationSheet({
  tournament: makeTournament(),
  blockDraw: draftDraw,
  entries: makeEntries([["e-1", "チームA"]]),
});
assert.equal(draftResult.ok, false);
assert.equal(draftResult.code, CombinationSheetErrorCode.BLOCK_DRAW_NOT_FINALIZED);
assert.match(draftResult.message, /確定していません/);
assert.equal(draftResult.sheet, null);

const shuffledBlocks = [
  { id: "C", name: "Cブロック", entryIds: ["e-7", "e-8"] },
  { id: "A", name: "Aブロック", entryIds: ["e-1", "e-2", "e-3"] },
  { id: "B", name: "Bブロック", entryIds: ["e-4", "e-5", "e-6"] },
];
const staleEntries = makeEntries([
  ["e-1", "最新A"],
  ["e-2", "最新B"],
  ["e-3", "最新C"],
  ["e-4", "最新D"],
  ["e-5", "最新E"],
  ["e-6", "最新F"],
  ["e-7", "最新G"],
  ["e-8", "最新H"],
]);
const qualifying = buildQualifyingBlocksCombinationSheet({
  tournament: makeTournament(),
  blockDraw: makeFinalizedBlockDraw(shuffledBlocks),
  entries: staleEntries,
});
assert.equal(qualifying.ok, true);
assert.equal(qualifying.sheet.schemaVersion, COMBINATION_SHEET_SCHEMA_VERSION);
assert.equal(qualifying.sheet.type, CombinationSheetType.QUALIFYING_BLOCKS);
assert.equal(qualifying.sheet.summary.title, "予選組み合わせ");
assert.equal(qualifying.sheet.summary.teamCount, 8);
assert.equal(qualifying.sheet.summary.blockCount, 3);
assert.equal(qualifying.sheet.page.pageSize, "A4");
assert.equal(qualifying.sheet.page.orientation, CombinationSheetOrientation.PORTRAIT);
assert.deepEqual(
  qualifying.sheet.blocks.map((block) => block.blockId),
  ["A", "B", "C"]
);
assert.deepEqual(
  qualifying.sheet.blocks[0].teams.map((team) => team.entryId),
  ["e-1", "e-2", "e-3"]
);
assert.deepEqual(
  qualifying.sheet.blocks[0].teams.map((team) => team.position),
  [1, 2, 3]
);
assert.deepEqual(
  qualifying.sheet.blocks[0].teams.map((team) => team.name),
  ["最新A", "最新B", "最新C"]
);
assert.equal(qualifying.sheet.tournament.eventDateLabel, "2026年8月30日");
assert.equal(qualifying.sheet.tournament.venue, "○○グラウンド");
const qualifyingDump = JSON.stringify(qualifying.sheet);
assert.equal(qualifyingDump.includes("email"), false);
assert.equal(qualifyingDump.includes("member"), false);
assert.equal(qualifyingDump.includes("phone"), false);

const legacyDraw = {
  blocks: [{ id: "B", name: "Bブロック", entryIds: ["e-2"] }, { id: "A", name: "Aブロック", entryIds: ["e-1"] }],
};
assert.equal(canBuildQualifyingBlocksCombinationSheet(legacyDraw), true);
const legacySheet = buildQualifyingBlocksCombinationSheet({
  tournament: makeTournament(),
  blockDraw: legacyDraw,
  entries: makeEntries([["e-1", "旧A"], ["e-2", "旧B"]]),
});
assert.equal(legacySheet.ok, true);
assert.deepEqual(
  legacySheet.sheet.blocks.map((block) => block.blockId),
  ["A", "B"]
);

const longName = "あ".repeat(80);
const longNameSheet = buildQualifyingBlocksCombinationSheet({
  tournament: makeTournament(),
  blockDraw: makeFinalizedBlockDraw([{ id: "A", name: "Aブロック", entryIds: ["e-long"] }]),
  entries: makeEntries([["e-long", longName]]),
});
assert.equal(longNameSheet.ok, true);
assert.equal(longNameSheet.sheet.blocks[0].teams[0].name, longName);

const emptyBlockSheet = buildQualifyingBlocksCombinationSheet({
  tournament: makeTournament(),
  blockDraw: makeFinalizedBlockDraw([
    { id: "A", name: "Aブロック", entryIds: [] },
    { id: "B", name: "Bブロック", entryIds: ["e-1"] },
  ]),
  entries: makeEntries([["e-1", "残チーム"]]),
});
assert.equal(emptyBlockSheet.ok, true);
assert.equal(emptyBlockSheet.sheet.blocks[0].teams.length, 0);
assert.equal(emptyBlockSheet.sheet.blocks[1].teams[0].name, "残チーム");

const noTournament = buildQualifyingBlocksCombinationSheet({
  blockDraw: makeFinalizedBlockDraw([{ id: "A", name: "Aブロック", entryIds: ["e-1"] }]),
  entries: [],
});
assert.equal(noTournament.ok, false);
assert.equal(noTournament.code, CombinationSheetErrorCode.TOURNAMENT_INVALID);

const noBlocks = buildQualifyingBlocksCombinationSheet({
  tournament: makeTournament(),
  blockDraw: { status: "finalized", blocks: [] },
  entries: [],
});
assert.equal(noBlocks.ok, false);

const manyBlocks = makeFinalizedBlockDraw(
  Array.from({ length: 9 }, (_, index) => ({
    id: String.fromCharCode(65 + index),
    name: `${String.fromCharCode(65 + index)}ブロック`,
    entryIds: [`e-${index + 1}`],
  }))
);
const pagedQualifying = buildQualifyingBlocksCombinationSheet({
  tournament: makeTournament(),
  blockDraw: manyBlocks,
  entries: makeEntries(Array.from({ length: 9 }, (_, index) => [`e-${index + 1}`, `T${index + 1}`])),
});
assert.equal(pagedQualifying.ok, true);
assert.ok(pagedQualifying.sheet.pages.length >= 2);
assert.equal(pagedQualifying.sheet.pages[0].blocks.length, QUALIFYING_BLOCKS_PER_PAGE);
assert.equal(pagedQualifying.sheet.pages[1].isContinuation, true);
assert.match(pagedQualifying.sheet.pages[1].heading, /続き/);

assert.equal(canBuildSingleEliminationCombinationSheet(null), false);
const missingBracket = buildSingleEliminationCombinationSheet({
  tournament: makeTournament({ tournamentFormat: "single_elimination" }),
  bracket: null,
  entries: [],
});
assert.equal(missingBracket.ok, false);
assert.equal(missingBracket.code, CombinationSheetErrorCode.BRACKET_NOT_CREATED);

function makeSeEntries(count) {
  return Array.from({ length: count }, (_, index) => ({
    entryId: `se-${index + 1}`,
    teamName: `Seed ${index + 1}`,
  }));
}

function persistedSe(count, random = () => 0.42) {
  const preview = buildSingleEliminationBracket({
    entries: makeSeEntries(count),
    random,
  });
  assert.equal(preview.valid, true, `SE build failed for ${count}`);
  return buildPersistedSingleEliminationBracket(preview);
}

for (const [teamCount, expectedOrientation, expectSinglePage] of [
  [8, CombinationSheetOrientation.PORTRAIT, true],
  [16, CombinationSheetOrientation.LANDSCAPE, true],
  [32, CombinationSheetOrientation.LANDSCAPE, false],
  [64, CombinationSheetOrientation.LANDSCAPE, false],
]) {
  assert.equal(
    resolveSingleEliminationSheetOrientation(
      persistedSe(teamCount).bracketSize
    ),
    expectedOrientation,
    `orientation teamCount=${teamCount}`
  );
  const result = buildSingleEliminationCombinationSheet({
    tournament: makeTournament({ tournamentFormat: "single_elimination" }),
    bracket: persistedSe(teamCount),
    entries: makeSeEntries(teamCount).map((entry) => ({
      id: entry.entryId,
      teamName: `Live ${entry.entryId}`,
    })),
  });
  assert.equal(result.ok, true, `ok teamCount=${teamCount}`);
  assert.equal(result.sheet.type, CombinationSheetType.SINGLE_ELIMINATION_BRACKET);
  assert.equal(result.sheet.page.orientation, expectedOrientation, `page orientation ${teamCount}`);
  assert.equal(result.sheet.summary.teamCount, teamCount);
  if (expectSinglePage) {
    assert.equal(result.sheet.pages.length, 1, `pages teamCount=${teamCount}`);
    assert.equal(result.sheet.pages[0].layout, "bracket");
  } else {
    assert.ok(result.sheet.pages.length >= 2, `split teamCount=${teamCount}`);
    assert.ok(
      result.sheet.pages.some((page) => page.isContinuation),
      `continuation teamCount=${teamCount}`
    );
    assert.ok(
      result.sheet.pages.every((page) =>
        (page.rounds ?? []).every(
          (round) => round.matches.length <= SINGLE_ELIMINATION_MATCHES_PER_PAGE
        )
      ),
      `readable chunks teamCount=${teamCount}`
    );
  }
}

const se5 = persistedSe(5);
const se5Live = buildSingleEliminationCombinationSheet({
  tournament: makeTournament({ tournamentFormat: "single_elimination" }),
  bracket: se5,
  entries: makeSeEntries(5).map((entry) => ({
    id: entry.entryId,
    teamName: `更新-${entry.entryId}`,
  })),
});
assert.equal(se5Live.ok, true);
assert.equal(canBuildSingleEliminationCombinationSheet(se5), true);
const firstRound = se5Live.sheet.bracket.rounds[0];
assert.ok(firstRound.matches.length >= 1);
const byeMatch = firstRound.matches.find((match) => match.team1.isBye || match.team2.isBye);
assert.ok(byeMatch, "expected a BYE in 5-team bracket");
const byeTeam = byeMatch.team1.isBye ? byeMatch.team1 : byeMatch.team2;
assert.equal(byeTeam.isBye, true);
assert.equal(byeTeam.isPending, false);
assert.equal(byeTeam.displayName, "BYE");
assert.equal(byeTeam.entryId, null);

const realTeam = firstRound.matches
  .flatMap((match) => [match.team1, match.team2])
  .find((team) => !team.isBye && !team.isPending);
assert.ok(realTeam);
assert.match(realTeam.name, /^更新-se-/);

const laterRound = se5Live.sheet.bracket.rounds[1];
assert.ok(laterRound);
for (const match of laterRound.matches) {
  assert.equal(match.team1.isPending, true);
  assert.equal(match.team2.isPending, true);
  assert.equal(match.team1.isBye, false);
  assert.equal(match.team2.isBye, false);
  assert.equal(match.team1.displayName, "未定");
  assert.equal(match.team2.displayName, "未定");
}

const mutated = structuredClone(se5);
const laterStored = mutated.matches.find((match) => match.roundNumber === 2);
assert.ok(laterStored);
laterStored.team1 = {
  entryId: "se-1",
  teamName: "勝者チーム",
  isBye: false,
};
laterStored.winnerEntryId = "se-1";
laterStored.score = { team1: 2, team2: 0 };
laterStored.status = "finished";
laterStored.startedAt = "2026-08-30T01:00:00.000Z";
const mutatedSheet = buildSingleEliminationCombinationSheet({
  tournament: makeTournament({ tournamentFormat: "single_elimination" }),
  bracket: mutated,
  entries: makeSeEntries(5).map((entry) => ({ id: entry.entryId, teamName: entry.teamName })),
});
assert.equal(mutatedSheet.ok, true);
const mutatedLater = mutatedSheet.sheet.bracket.rounds.find((round) => round.roundNumber === 2);
assert.equal(mutatedLater.matches[0].team1.isPending, true);
assert.equal(mutatedLater.matches[0].team1.displayName, "未定");
const dumped = sheetJson(mutatedSheet.sheet);
assert.equal(JSON.stringify(dumped).includes("winnerEntryId"), false);
assert.equal(JSON.stringify(dumped).includes("\"score\""), false);
assert.equal(JSON.stringify(dumped).includes("startedAt"), false);
assert.equal(JSON.stringify(dumped).includes("finished"), false);
assert.equal(JSON.stringify(dumped).includes("勝者チーム"), false);

const pendingNotBye = firstRound.matches[0];
assert.notEqual(pendingNotBye.team1 == null, true);
const laterPending = laterRound.matches[0].team1;
assert.equal(laterPending.isBye, false);
assert.equal(laterPending.isPending, true);

const multiTeam = persistedSe(8);
multiTeam.matchFormat = MatchFormat.MULTI_TEAM_TOTAL;
const multiResult = buildSingleEliminationCombinationSheet({
  tournament: makeTournament({ tournamentFormat: "single_elimination" }),
  bracket: multiTeam,
  entries: makeSeEntries(8).map((entry) => ({ id: entry.entryId, teamName: entry.teamName })),
});
assert.equal(multiResult.ok, false);
assert.equal(multiResult.code, CombinationSheetErrorCode.BRACKET_UNSUPPORTED);

const emailEntries = [
  {
    id: "e-1",
    teamName: "公開名",
    email: "secret@example.com",
    members: [{ name: "個人名" }],
  },
];
const noPii = buildQualifyingBlocksCombinationSheet({
  tournament: makeTournament(),
  blockDraw: makeFinalizedBlockDraw([{ id: "A", name: "Aブロック", entryIds: ["e-1"] }]),
  entries: emailEntries,
});
assert.equal(noPii.sheet.blocks[0].teams[0].name, "公開名");
assert.equal(JSON.stringify(noPii.sheet).includes("secret@example.com"), false);
assert.equal(JSON.stringify(noPii.sheet).includes("個人名"), false);

console.log("combination-sheet.test.mjs: all passed");
