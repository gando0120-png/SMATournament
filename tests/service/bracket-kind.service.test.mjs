/**
 * bracketKind コレクションパス解決テスト（Firestore 非依存）
 */
import assert from "node:assert/strict";
import {
  BracketKind,
  BRACKET_COLLECTIONS,
  resolveBracketCollections,
  resolveOptionsBracketKind,
} from "../../js/domain/bracket-collections.js";

assert.equal(resolveOptionsBracketKind(undefined), BracketKind.MAIN);
assert.equal(resolveOptionsBracketKind(null), BracketKind.MAIN);
assert.equal(resolveOptionsBracketKind({}), BracketKind.MAIN);

const main = resolveBracketCollections(BracketKind.MAIN);
assert.equal(main.bracket, "finalsBracket");
assert.equal(main.sessions, "finalsMatchSessions");
assert.equal(main.results, "finalsMatchResults");

const consolation = resolveBracketCollections(BracketKind.CONSOLATION);
assert.equal(consolation.bracket, "consolationBracket");
assert.equal(consolation.sessions, "consolationMatchSessions");
assert.equal(consolation.results, "consolationMatchResults");

assert.notEqual(main.results, consolation.results);
assert.notEqual(main.sessions, consolation.sessions);

assert.throws(() => resolveBracketCollections("main-extra"), /Invalid bracket kind/);
assert.throws(() => resolveOptionsBracketKind({ bracketKind: "finals" }), /Invalid bracket kind/);

assert.deepEqual(BRACKET_COLLECTIONS[BracketKind.MAIN].results, "finalsMatchResults");
assert.deepEqual(BRACKET_COLLECTIONS[BracketKind.CONSOLATION].results, "consolationMatchResults");

console.log("bracket-kind.service.test.mjs: all passed");
