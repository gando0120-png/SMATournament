/**
 * 旧 fixed_block advancement のメモリ上 enrichment smoke テスト
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  enrichFixedBlockQualifiersForBracket,
  needsFixedBlockQualifierEnrichment,
} from "../../js/domain/fixed-block-finals-advancement.js";
import { buildFinalsBracketFromAdvancement } from "../../js/domain/finals-bracket.js";
import { buildPersistedFinalsAdvancement } from "../../js/domain/finals-advancement.js";
import { classifyError, ErrorCodes } from "../../js/lib/errors.js";
import { FinalsAdvancementMode } from "../../js/domain/constants.js";
import { TournamentFormat } from "../../js/domain/tournament-format.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const serviceSource = readFileSync(
  join(root, "js/services/finals-bracket-service.js"),
  "utf8"
);
const pageSource = readFileSync(
  join(root, "js/ui/pages/tournament-finals-bracket-page.js"),
  "utf8"
);

const previewFn =
  serviceSource.match(/export async function previewFinalsBracket[\s\S]*?(?=export async function saveFinalsBracket)/)?.[0] ??
  "";
const resolveFn =
  serviceSource.match(/async function resolveAdvancementForBracket[\s\S]*?(?=\/\*\*[\s\S]*?resolveFinalsAdvancementForBracketBuild)/)?.[0] ??
  "";

assert.doesNotMatch(previewFn, /setDoc|updateDoc/, "previewFinalsBracket must not write Firestore");
assert.doesNotMatch(resolveFn, /setDoc|updateDoc/, "resolveAdvancementForBracket must not write Firestore");
assert.doesNotMatch(serviceSource, /persistBackfill/);
assert.match(serviceSource, /resolveFinalsAdvancementForBracketBuild/);
assert.match(serviceSource, /advancement: resolvedAdvancement/);

assert.match(pageSource, /console\.error\("\[finals-bracket\] loadPage failed", error\)/);
assert.match(pageSource, /console\.error\("\[finals-bracket\] init failed", error\)/);

const permissionError = classifyError({ code: "permission-denied", message: "denied" });
assert.equal(permissionError.code, ErrorCodes.PERMISSION_DENIED);
assert.match(permissionError.message, /Firestore Rules で拒否/);

const genericError = classifyError({ code: "finals-bracket/invalid-qualifiers", message: "invalid" });
assert.notEqual(genericError.code, ErrorCodes.PERMISSION_DENIED);
assert.equal(genericError.message, "invalid");

const legacyStrippedAdvancement = {
  finalized: true,
  mode: FinalsAdvancementMode.FIXED_BLOCK_QUALIFIERS,
  qualifierCount: 8,
  qualifiers: [
    { entryId: "e-A-1", blockId: "A", blockRank: 1 },
    { entryId: "e-A-2", blockId: "A", blockRank: 2 },
    { entryId: "e-B-1", blockId: "B", blockRank: 1 },
    { entryId: "e-B-2", blockId: "B", blockRank: 2 },
    { entryId: "e-C-1", blockId: "C", blockRank: 1 },
    { entryId: "e-C-2", blockId: "C", blockRank: 2 },
    { entryId: "e-D-1", blockId: "D", blockRank: 1 },
    { entryId: "e-D-2", blockId: "D", blockRank: 2 },
  ],
};

assert.equal(needsFixedBlockQualifierEnrichment(legacyStrippedAdvancement.qualifiers), true);

const enrichedQualifiers = enrichFixedBlockQualifiersForBracket(
  legacyStrippedAdvancement.qualifiers,
  {
    entries: legacyStrippedAdvancement.qualifiers.map((q) => ({
      id: q.entryId,
      teamName: `Team ${q.entryId}`,
    })),
    blockDraw: {
      blocks: [
        { id: "A", name: "Aブロック" },
        { id: "B", name: "Bブロック" },
        { id: "C", name: "Cブロック" },
        { id: "D", name: "Dブロック" },
      ],
    },
  }
);

assert.equal(enrichedQualifiers.every((q) => q.teamName), true);
assert.equal(enrichedQualifiers.every((q) => q.blockName), true);

const bracketPreview = buildFinalsBracketFromAdvancement({
  ...legacyStrippedAdvancement,
  qualifiers: enrichedQualifiers,
});
assert.equal(bracketPreview.canFinalize, true);
assert.equal(bracketPreview.bracket.bracketSize, 8);
assert.equal(
  bracketPreview.bracket.slots.every((slot) => slot.entryId && slot.teamName),
  true
);

const newPersisted = buildPersistedFinalsAdvancement(
  {
    canFinalize: true,
    mode: FinalsAdvancementMode.FIXED_BLOCK_QUALIFIERS,
    completion: { totalMatches: 1, finishedMatches: 1 },
    qualifyingStandings: { blocks: [] },
    selection: {
      valid: true,
      qualifierCount: 2,
      qualifiersPerBlock: 1,
      blockCount: 2,
      qualifiers: [
        {
          entryId: "e-A-1",
          teamName: "Alpha",
          blockId: "A",
          blockName: "Aブロック",
          blockRank: 1,
        },
        {
          entryId: "e-B-1",
          teamName: "Beta",
          blockId: "B",
          blockName: "Bブロック",
          blockRank: 1,
        },
      ],
    },
  },
  {
    tournament: {
      tournamentFormat: TournamentFormat.QUALIFYING_AND_FINALS,
      blockCount: 2,
      qualifiersPerBlock: 1,
    },
  }
);

for (const qualifier of newPersisted.qualifiers) {
  assert.ok(qualifier.teamName);
  assert.ok(qualifier.blockName);
}

console.log("finals-bracket-legacy-enrichment.smoke.mjs: all passed");
