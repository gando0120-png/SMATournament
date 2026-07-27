/**
 * tournament-format 互換読取ドメインテスト
 */
import assert from "node:assert/strict";
import {
  TournamentFormat,
  resolveBlockCount,
  resolveFinalQualifierCount,
  resolveQualifiersPerBlock,
  resolveTournamentFormat,
  usesLegacyFinalsAdvancement,
} from "../../js/domain/tournament-format.js";

// --- resolveTournamentFormat ---

assert.equal(resolveTournamentFormat({}), TournamentFormat.QUALIFYING_AND_FINALS);
assert.equal(resolveTournamentFormat(undefined), TournamentFormat.QUALIFYING_AND_FINALS);
assert.equal(
  resolveTournamentFormat({ tournamentFormat: TournamentFormat.SINGLE_ELIMINATION }),
  TournamentFormat.SINGLE_ELIMINATION
);

// --- resolveBlockCount ---

assert.equal(
  resolveBlockCount({
    tournament: { blockCount: 16 },
    blockDraw: { blockCount: 8 },
    teamCount: 59,
  }),
  16,
  "新大会は tournament.blockCount を優先"
);

assert.equal(
  resolveBlockCount({
    tournament: { preferredBlockSize: 4 },
    blockDraw: { blockCount: 15 },
    teamCount: 59,
  }),
  15,
  "旧大会は blockDraw.blockCount を優先"
);

assert.equal(
  resolveBlockCount({
    tournament: { preferredBlockSize: 4 },
    blockDraw: null,
    teamCount: 59,
  }),
  15,
  "blockDraw がなければ preferredBlockSize から算出"
);

assert.equal(
  resolveBlockCount({
    tournament: { preferredBlockSize: 4 },
    blockDraw: null,
    teamCount: null,
  }),
  null,
  "teamCount 未指定時は算出しない"
);

assert.equal(
  resolveBlockCount({
    tournament: {},
    blockDraw: null,
    teamCount: 59,
  }),
  null,
  "preferredBlockSize も teamCount も不十分なら null"
);

// --- resolveQualifiersPerBlock ---

assert.equal(resolveQualifiersPerBlock({}), null);
assert.equal(resolveQualifiersPerBlock({ qualifiersPerBlock: 1 }), 1);
assert.equal(resolveQualifiersPerBlock({ qualifiersPerBlock: 2 }), 2);
assert.equal(resolveQualifiersPerBlock({ qualifiersPerBlock: 3 }), null);

// --- usesLegacyFinalsAdvancement ---

assert.equal(usesLegacyFinalsAdvancement({}), true);
assert.equal(usesLegacyFinalsAdvancement({ qualifiersPerBlock: 1 }), false);

// --- resolveFinalQualifierCount ---

assert.equal(
  resolveFinalQualifierCount({
    tournament: { blockCount: 16, qualifiersPerBlock: 2 },
    teamCount: 64,
  }),
  32,
  "新形式の決勝進出数は blockCount × qualifiersPerBlock"
);

assert.equal(
  resolveFinalQualifierCount({
    tournament: { preferredBlockSize: 4 },
    teamCount: 59,
  }),
  8,
  "旧形式は既定8枠"
);

assert.equal(
  resolveFinalQualifierCount({
    tournament: { blockCount: 16, qualifiersPerBlock: 2 },
    teamCount: null,
  }),
  32,
  "blockCount は tournament から解決可能"
);

console.log("tournament-format-resolve.test.mjs: all passed");
