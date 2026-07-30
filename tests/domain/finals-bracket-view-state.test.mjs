/**
 * 運営トーナメント表示状態の保持テスト
 */
import assert from "node:assert/strict";
import { BracketKind } from "../../js/domain/bracket-collections.js";
import { BracketViewMode } from "../../js/domain/finals-bracket-display.js";
import {
  applyBracketViewStateToSearchParams,
  buildBracketViewStateSessionKey,
  normalizeBracketViewState,
  readBracketViewStateFromSearch,
  readBracketViewStateFromSession,
  resolveAdminBracketViewState,
  writeBracketViewStateToSession,
} from "../../js/ui/finals-bracket-view-state.js";
import {
  buildBracketPageHref,
  buildFinalsMatchPageHref,
} from "../../js/ui/consolation-bracket-ui.js";

const rounds = [
  { roundNumber: 1, roundLabel: "1回戦", matches: [] },
  { roundNumber: 2, roundLabel: "準決勝", matches: [] },
  { roundNumber: 3, roundLabel: "決勝", matches: [] },
];

assert.equal(
  buildBracketViewStateSessionKey("t1", BracketKind.MAIN),
  "sma.finalsBracketView.t1.finals"
);
assert.equal(
  buildBracketViewStateSessionKey("t1", BracketKind.CONSOLATION),
  "sma.finalsBracketView.t1.consolation"
);

assert.deepEqual(normalizeBracketViewState({ viewMode: "round", roundNumber: 2 }), {
  viewMode: BracketViewMode.ROUND,
  roundNumber: 2,
});
assert.equal(normalizeBracketViewState({ viewMode: "nope" }), null);
assert.deepEqual(normalizeBracketViewState({ viewMode: "overall", roundNumber: "3" }), {
  viewMode: BracketViewMode.BOARD,
  roundNumber: 3,
});

assert.deepEqual(
  readBracketViewStateFromSearch("viewMode=board&round=2"),
  { viewMode: BracketViewMode.BOARD, roundNumber: 2 }
);
assert.equal(readBracketViewStateFromSearch("viewMode=garbage"), null);
assert.equal(readBracketViewStateFromSearch(""), null);

const memory = new Map();
const fakeStorage = {
  getItem: (key) => (memory.has(key) ? memory.get(key) : null),
  setItem: (key, value) => {
    memory.set(key, String(value));
  },
};

writeBracketViewStateToSession(
  "t1",
  BracketKind.MAIN,
  { viewMode: BracketViewMode.ROUND, roundNumber: 2 },
  fakeStorage
);
writeBracketViewStateToSession(
  "t1",
  BracketKind.CONSOLATION,
  { viewMode: BracketViewMode.BOARD, roundNumber: 1 },
  fakeStorage
);

assert.deepEqual(readBracketViewStateFromSession("t1", BracketKind.MAIN, fakeStorage), {
  viewMode: BracketViewMode.ROUND,
  roundNumber: 2,
});
assert.deepEqual(readBracketViewStateFromSession("t1", BracketKind.CONSOLATION, fakeStorage), {
  viewMode: BracketViewMode.BOARD,
  roundNumber: 1,
});

const defaults = resolveAdminBracketViewState({
  tournamentId: "t-new",
  bracketKind: BracketKind.MAIN,
  search: "",
  rounds,
  storage: fakeStorage,
});
assert.equal(defaults.viewMode, BracketViewMode.ROUND);
assert.equal(defaults.source, "default");

const fromSession = resolveAdminBracketViewState({
  tournamentId: "t1",
  bracketKind: BracketKind.MAIN,
  search: "",
  rounds,
  storage: fakeStorage,
});
assert.equal(fromSession.viewMode, BracketViewMode.ROUND);
assert.equal(fromSession.roundNumber, 2);
assert.equal(fromSession.source, "session");

const fromUrl = resolveAdminBracketViewState({
  tournamentId: "t1",
  bracketKind: BracketKind.MAIN,
  search: "viewMode=board&round=3",
  rounds,
  storage: fakeStorage,
});
assert.equal(fromUrl.viewMode, BracketViewMode.BOARD);
assert.equal(fromUrl.roundNumber, 3);
assert.equal(fromUrl.source, "url");

const invalidRound = resolveAdminBracketViewState({
  tournamentId: "t1",
  bracketKind: BracketKind.MAIN,
  search: "viewMode=round&round=99",
  rounds,
  storage: fakeStorage,
});
assert.equal(invalidRound.roundNumber, 3);

const urlModeSessionRound = resolveAdminBracketViewState({
  tournamentId: "t1",
  bracketKind: BracketKind.MAIN,
  search: "viewMode=round",
  rounds,
  storage: fakeStorage,
});
assert.equal(urlModeSessionRound.viewMode, BracketViewMode.ROUND);
assert.equal(urlModeSessionRound.roundNumber, 2);

const params = applyBracketViewStateToSearchParams(new URLSearchParams({ id: "t1" }), {
  viewMode: BracketViewMode.BOARD,
  roundNumber: 2,
});
assert.equal(params.get("viewMode"), "board");
assert.equal(params.get("round"), "2");

assert.equal(
  buildBracketPageHref("abc123", BracketKind.MAIN, {
    viewMode: BracketViewMode.ROUND,
    roundNumber: 2,
  }),
  "tournament-finals-bracket.html?id=abc123&viewMode=round&round=2"
);
assert.equal(
  buildBracketPageHref("abc123", BracketKind.CONSOLATION, {
    viewMode: BracketViewMode.BOARD,
    roundNumber: 1,
  }),
  "tournament-finals-bracket.html?id=abc123&view=consolation&viewMode=board&round=1"
);
assert.match(
  buildFinalsMatchPageHref("abc123", "final-r2-m1", {
    bracketKind: BracketKind.MAIN,
    enterResult: true,
    viewMode: BracketViewMode.ROUND,
    roundNumber: 2,
  }),
  /viewMode=round/
);
assert.match(
  buildFinalsMatchPageHref("abc123", "final-r2-m1", {
    bracketKind: BracketKind.MAIN,
    enterResult: true,
    viewMode: BracketViewMode.ROUND,
    roundNumber: 2,
  }),
  /round=2/
);

console.log("finals-bracket-view-state.test.mjs: ok");
