/**
 * 下位トーナメントコート番号割当ドメインテスト
 */
import assert from "node:assert/strict";
import {
  assignConsolationCourtNumber,
  assignConsolationCourtsToBracket,
  ensureConsolationCourtNumbers,
  resolveConsolationCourtRange,
  resolveMainBracketMaxCourtNumber,
  resolveMatchCourtNumber,
} from "../../js/domain/finals-court-assignment.js";
import { buildConsolationBracket } from "../../js/domain/consolation-bracket.js";
import { buildPublicTournamentView } from "../../js/domain/public-tournament-view.js";
import { TournamentFormat } from "../../js/domain/tournament-format.js";
import { TournamentStatus, EntryStatus } from "../../js/domain/constants.js";

function makeMainBracket(size) {
  const matches = [];
  const roundCount = Math.log2(size);
  for (let roundNumber = 1; roundNumber <= roundCount; roundNumber += 1) {
    const matchesInRound = size / 2 ** roundNumber;
    for (let matchNumber = 1; matchNumber <= matchesInRound; matchNumber += 1) {
      matches.push({
        matchId: `final-r${roundNumber}-m${matchNumber}`,
        roundNumber,
        matchNumber,
      });
    }
  }
  return { finalized: true, bracketSize: size, matches };
}

assert.equal(resolveMatchCourtNumber({ courtNumber: 9, matchNumber: 1 }), 9);
assert.equal(resolveMatchCourtNumber({ matchNumber: 3 }), 3);
assert.equal(resolveMatchCourtNumber({}), null);

// 上位16チーム → 1回戦8試合 → 最大コート8
const main16 = makeMainBracket(16);
assert.equal(resolveMainBracketMaxCourtNumber(main16), 8);

const range = resolveConsolationCourtRange({
  mainBracket: main16,
  tournamentCourtCount: 16,
});
assert.deepEqual(range, {
  mainMaxCourt: 8,
  startCourt: 9,
  endCourt: 16,
  poolSize: 8,
});

assert.equal(assignConsolationCourtNumber(1, range), 9);
assert.equal(assignConsolationCourtNumber(8, range), 16);
assert.equal(assignConsolationCourtNumber(9, range), 9);
assert.equal(assignConsolationCourtNumber(10, range), 10);

const participants = Array.from({ length: 16 }, (_, i) => ({
  entryId: `p-${i + 1}`,
  teamName: `P ${i + 1}`,
}));
const preview = buildConsolationBracket(participants, { random: () => 0.42 });
assert.equal(preview.valid, true);

const withCourts = assignConsolationCourtsToBracket(preview.bracket, {
  mainBracket: main16,
  tournamentCourtCount: 16,
});

assert.equal(withCourts.courtAssignment.startCourt, 9);
assert.equal(withCourts.courtAssignment.endCourt, 16);

const round1 = withCourts.matches.filter((m) => m.roundNumber === 1);
assert.equal(round1.length, 8);
assert.deepEqual(
  round1.map((m) => m.courtNumber),
  [9, 10, 11, 12, 13, 14, 15, 16]
);

const round2 = withCourts.matches.filter((m) => m.roundNumber === 2);
assert.ok(round2.every((m) => m.courtNumber >= 9 && m.courtNumber <= 16));
assert.equal(round2[0].courtNumber, 9);
assert.ok(round2.every((m) => m.courtNumber !== 1));

// 試合数がプールを超える場合は循環（下位20チーム → 1回戦16試合）
const manyParticipants = Array.from({ length: 20 }, (_, i) => ({
  entryId: `q-${i + 1}`,
  teamName: `Q ${i + 1}`,
}));
const manyPreview = buildConsolationBracket(manyParticipants, { random: () => 0.42 });
const manyCourts = assignConsolationCourtsToBracket(manyPreview.bracket, {
  mainBracket: main16,
  tournamentCourtCount: 16,
});
const manyR1 = manyCourts.matches.filter((m) => m.roundNumber === 1);
assert.equal(manyR1.length, 16);
assert.deepEqual(
  manyR1.slice(0, 10).map((m) => m.courtNumber),
  [9, 10, 11, 12, 13, 14, 15, 16, 9, 10]
);

// 上位のみ（下位なし）の公開ビューでコートが従来どおり
const mainOnlyView = buildPublicTournamentView({
  tournament: {
    id: "t1",
    name: "Main only",
    status: TournamentStatus.OPEN,
    tournamentFormat: TournamentFormat.QUALIFYING_AND_FINALS,
    courtCount: 16,
    publicViewEnabled: true,
  },
  entries: [],
  finalsBracket: main16,
  finalsResultsMap: new Map(),
  finalsSessionsMap: new Map(),
});
const mainRound1Courts = mainOnlyView.sections.bracket.rounds[0].matches.map((m) => m.courtNumber);
assert.deepEqual(mainRound1Courts, [1, 2, 3, 4, 5, 6, 7, 8]);

// 既存データ（courtNumber なし）は表示時に再計算
const legacyBracket = {
  finalized: true,
  matches: preview.bracket.matches.map(({ courtNumber, ...rest }) => rest),
};
const ensured = ensureConsolationCourtNumbers(legacyBracket, {
  mainBracket: main16,
  tournamentCourtCount: 16,
});
assert.equal(ensured.matches[0].courtNumber, 9);

// 保存済み courtNumber は上書きしない
const preserved = ensureConsolationCourtNumbers(withCourts, {
  mainBracket: main16,
  tournamentCourtCount: 16,
});
assert.equal(preserved.matches[0].courtNumber, 9);

// 公開ビューでも下位が 9 から
const publicView = buildPublicTournamentView({
  tournament: {
    id: "t2",
    name: "With consolation",
    status: TournamentStatus.OPEN,
    tournamentFormat: TournamentFormat.QUALIFYING_AND_FINALS,
    courtCount: 16,
    publicViewEnabled: true,
  },
  entries: participants.map((p) => ({
    id: p.entryId,
    teamName: p.teamName,
    status: EntryStatus.CONFIRMED,
  })),
  finalsBracket: main16,
  finalsResultsMap: new Map(),
  finalsSessionsMap: new Map(),
  consolationBracket: {
    finalized: true,
    ...preview.bracket,
  },
  consolationResultsMap: new Map(),
  consolationSessionsMap: new Map(),
});
const consolationR1 = publicView.sections.consolationBracket.rounds[0].matches;
assert.deepEqual(
  consolationR1.map((m) => m.courtNumber),
  [9, 10, 11, 12, 13, 14, 15, 16]
);

console.log("finals-court-assignment.test.mjs: ok");
