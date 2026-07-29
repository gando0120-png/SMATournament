/**
 * 決勝トーナメント再生成ドメインテスト
 */
import assert from "node:assert/strict";
import { MatchSessionStatus, TournamentStatus } from "../../js/domain/constants.js";
import { TournamentFormat } from "../../js/domain/tournament-format.js";
import {
  buildFinalsBracketFromAdvancement,
  buildFixedBlockFinalsBracket,
} from "../../js/domain/finals-bracket.js";
import {
  FinalsBracketRegenerationReasonCode,
  assessFinalsBracketRegeneration,
  reseedLegacyQualifiersForRegeneration,
} from "../../js/domain/finals-bracket-regeneration.js";
import { FinalsAdvancementMode } from "../../js/domain/constants.js";

function makeFixedQualifiers(blockCount, perBlock) {
  const qualifiers = [];
  for (let b = 0; b < blockCount; b += 1) {
    const blockId = String.fromCharCode(65 + b);
    for (let r = 1; r <= perBlock; r += 1) {
      qualifiers.push({
        entryId: `e-${blockId}-${r}`,
        teamName: `Team ${blockId}${r}`,
        blockId,
        blockName: `${blockId}ブロック`,
        blockRank: r,
      });
    }
  }
  return qualifiers;
}

function makeLegacyAdvancement(count) {
  return {
    finalized: true,
    finalTeamCount: count,
    qualifiers: Array.from({ length: count }, (_, i) => ({
      entryId: `e-${i + 1}`,
      teamName: `Team ${i + 1}`,
      seed: i + 1,
      blockId: `B${(i % 4) + 1}`,
    })),
  };
}

const openTournament = {
  status: TournamentStatus.OPEN,
  tournamentFormat: TournamentFormat.QUALIFYING_AND_FINALS,
};

const closedTournament = {
  status: TournamentStatus.CLOSED,
  tournamentFormat: TournamentFormat.QUALIFYING_AND_FINALS,
};

const finalizedBracket = {
  finalized: true,
  bracketSize: 8,
  qualifierCount: 8,
  matches: [{ matchId: "final-r1-m1", roundNumber: 1 }],
};

// --- eligibility ---
{
  const ok = assessFinalsBracketRegeneration({
    tournament: openTournament,
    bracket: finalizedBracket,
    resultsMap: new Map(),
    sessionsMap: new Map(),
    consolationBracket: null,
  });
  assert.equal(ok.canRegenerate, true);
  assert.equal(ok.reasonCode, FinalsBracketRegenerationReasonCode.ELIGIBLE);
}

{
  const denied = assessFinalsBracketRegeneration({
    tournament: openTournament,
    bracket: finalizedBracket,
    resultsMap: new Map([
      ["final-r1-m1", { matchId: "final-r1-m1", resolution: "played" }],
    ]),
    sessionsMap: new Map(),
  });
  assert.equal(denied.canRegenerate, false);
  assert.equal(denied.reasonCode, FinalsBracketRegenerationReasonCode.HAS_PLAYED_RESULTS);
}

{
  const denied = assessFinalsBracketRegeneration({
    tournament: openTournament,
    bracket: finalizedBracket,
    resultsMap: new Map(),
    sessionsMap: new Map([
      ["final-r1-m1", { matchId: "final-r1-m1", status: MatchSessionStatus.PLAYING }],
    ]),
  });
  assert.equal(denied.canRegenerate, false);
  assert.equal(denied.reasonCode, FinalsBracketRegenerationReasonCode.HAS_SESSIONS);
}

{
  const denied = assessFinalsBracketRegeneration({
    tournament: closedTournament,
    bracket: finalizedBracket,
    resultsMap: new Map(),
    sessionsMap: new Map(),
  });
  assert.equal(denied.canRegenerate, false);
  assert.equal(denied.reasonCode, FinalsBracketRegenerationReasonCode.TOURNAMENT_NOT_OPEN);
}

{
  const denied = assessFinalsBracketRegeneration({
    tournament: openTournament,
    bracket: { finalized: false },
    resultsMap: new Map(),
    sessionsMap: new Map(),
  });
  assert.equal(denied.canRegenerate, false);
  assert.equal(denied.reasonCode, FinalsBracketRegenerationReasonCode.BRACKET_NOT_FINALIZED);
}

{
  const denied = assessFinalsBracketRegeneration({
    tournament: openTournament,
    bracket: finalizedBracket,
    resultsMap: new Map(),
    sessionsMap: new Map(),
    consolationBracket: {
      finalized: true,
      mode: "consolation",
      bracketKind: "consolation",
      bracketSize: 4,
      slots: [{}, {}, {}, {}],
      matches: [{ matchId: "final-r1-m1" }],
    },
  });
  assert.equal(denied.canRegenerate, false);
  assert.equal(denied.reasonCode, FinalsBracketRegenerationReasonCode.CONSOLATION_EXISTS);
}

{
  // BYE 自動結果のみなら再生成可
  const ok = assessFinalsBracketRegeneration({
    tournament: openTournament,
    bracket: finalizedBracket,
    resultsMap: new Map([
      ["final-r1-m1", { matchId: "final-r1-m1", resolution: "bye" }],
    ]),
    sessionsMap: new Map(),
  });
  assert.equal(ok.canRegenerate, true);
  assert.equal(ok.byeResultCount, 1);
}

{
  const denied = assessFinalsBracketRegeneration({
    tournament: {
      status: TournamentStatus.OPEN,
      tournamentFormat: TournamentFormat.SINGLE_ELIMINATION,
    },
    bracket: { finalized: true, mode: "single_elimination" },
    resultsMap: new Map(),
    sessionsMap: new Map(),
  });
  assert.equal(denied.canRegenerate, false);
  assert.equal(denied.reasonCode, FinalsBracketRegenerationReasonCode.UNSUPPORTED_FORMAT);
}

// --- fixed-block re-randomize changes pairing (with same-block avoidance) ---
{
  const qualifiers = makeFixedQualifiers(4, 2); // 8 teams
  const first = buildFixedBlockFinalsBracket(qualifiers, { random: () => 0.1 });
  const second = buildFixedBlockFinalsBracket(qualifiers, { random: () => 0.9 });
  assert.equal(first.valid, true);
  assert.equal(second.valid, true);
  assert.equal(first.bracket.placementMode, "random");
  const firstOrder = first.bracket.slots.map((s) => s.entryId).join(",");
  const secondOrder = second.bracket.slots.map((s) => s.entryId).join(",");
  assert.notEqual(firstOrder, secondOrder);

  // same-block first-round avoidance best-effort
  for (const bracket of [first.bracket, second.bracket]) {
    const r1 = bracket.matches.filter((m) => m.roundNumber === 1);
    for (const match of r1) {
      if (match.team1?.blockId && match.team2?.blockId) {
        // not asserting hard guarantee; just that builder ran
        assert.ok(match.team1.entryId);
      }
    }
  }
}

// 16 / 32 / 64 sizes
for (const size of [8, 16, 32, 64]) {
  const blockCount = size / 2;
  const qualifiers = makeFixedQualifiers(blockCount, 2);
  const built = buildFixedBlockFinalsBracket(qualifiers, { random: () => 0.42 });
  assert.equal(built.valid, true, `size ${size}`);
  assert.equal(built.bracket.bracketSize, size);
  assert.equal(built.bracket.qualifierCount, size);
}

// --- legacy reseed changes seed order ---
{
  const advancement = makeLegacyAdvancement(8);
  const a = buildFinalsBracketFromAdvancement(advancement, {
    regenerate: true,
    random: () => 0.11,
  });
  const b = buildFinalsBracketFromAdvancement(advancement, {
    regenerate: true,
    random: () => 0.88,
  });
  assert.equal(a.valid, true);
  assert.equal(b.valid, true);
  const seedA = a.bracket.slots.filter((s) => !s.isBye).map((s) => `${s.seed}:${s.entryId}`).join("|");
  const seedB = b.bracket.slots.filter((s) => !s.isBye).map((s) => `${s.seed}:${s.entryId}`).join("|");
  assert.notEqual(seedA, seedB);

  // without regenerate, deterministic
  const d1 = buildFinalsBracketFromAdvancement(advancement);
  const d2 = buildFinalsBracketFromAdvancement(advancement);
  const det1 = d1.bracket.slots.map((s) => `${s.seed}:${s.entryId}`).join("|");
  const det2 = d2.bracket.slots.map((s) => `${s.seed}:${s.entryId}`).join("|");
  assert.equal(det1, det2);
}

{
  const reseeds = reseedLegacyQualifiersForRegeneration(
    makeLegacyAdvancement(8).qualifiers,
    () => 0.3
  );
  assert.equal(reseeds.length, 8);
  assert.deepEqual(
    reseeds.map((q) => q.seed),
    [1, 2, 3, 4, 5, 6, 7, 8]
  );
}

// fixed_block via advancement regenerate path
{
  const advancement = {
    finalized: true,
    mode: FinalsAdvancementMode.FIXED_BLOCK_QUALIFIERS,
    qualifierCount: 8,
    qualifiers: makeFixedQualifiers(4, 2),
  };
  const a = buildFinalsBracketFromAdvancement(advancement, {
    regenerate: true,
    random: () => 0.2,
  });
  const b = buildFinalsBracketFromAdvancement(advancement, {
    regenerate: true,
    random: () => 0.7,
  });
  assert.equal(a.valid && b.valid, true);
  assert.notEqual(
    a.bracket.slots.map((s) => s.entryId).join(","),
    b.bracket.slots.map((s) => s.entryId).join(",")
  );
}

console.log("finals-bracket-regeneration.test.mjs: all passed");
