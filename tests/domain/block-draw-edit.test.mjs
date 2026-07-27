/**
 * blockDraw 編集ドメインテスト
 */
import assert from "node:assert/strict";
import {
  validateEditableBlockDraw,
  moveEntryBetweenBlocks,
  swapEntriesBetweenBlocks,
  detectConfirmedEntryMismatch,
  recalculateDistributionFromBlocks,
  formatBlockSizeImbalanceWarning,
} from "../../js/domain/block-draw-edit.js";
import {
  isBlockDrawEditable,
  isBlockDrawFinalized,
} from "../../js/domain/block-draw-state.js";
import { distributeEntriesToFixedBlocks } from "../../js/domain/fixed-block-draw.js";

const entries = Array.from({ length: 12 }, (_, index) => ({
  id: `e-${index + 1}`,
  teamName: `Team ${index + 1}`,
}));

const confirmedEntryIds = entries.map((entry) => entry.id);

function buildBlocks(count = 4) {
  return Array.from({ length: count }, (_, index) => ({
    id: String.fromCharCode(65 + index),
    name: `${String.fromCharCode(65 + index)}ブロック`,
    entryIds: [`e-${index * 3 + 1}`, `e-${index * 3 + 2}`, `e-${index * 3 + 3}`],
  }));
}

const validBlocks = buildBlocks(4);

assert.equal(
  validateEditableBlockDraw({
    confirmedEntryIds,
    blocks: validBlocks,
    expectedBlockCount: 4,
  }).valid,
  true
);

const balanced = validateEditableBlockDraw({
  confirmedEntryIds,
  blocks: validBlocks,
  expectedBlockCount: 4,
});
assert.equal(balanced.warnings.length, 0);

const imbalancedEntryIds = Array.from({ length: 14 }, (_, index) => `e-${index + 1}`);
const imbalancedBlocks = [
  { id: "A", name: "Aブロック", entryIds: ["e-1", "e-2", "e-3", "e-4", "e-5"] },
  { id: "B", name: "Bブロック", entryIds: ["e-6", "e-7", "e-8"] },
  { id: "C", name: "Cブロック", entryIds: ["e-9", "e-10", "e-11"] },
  { id: "D", name: "Dブロック", entryIds: ["e-12", "e-13", "e-14"] },
];

const imbalanced = validateEditableBlockDraw({
  confirmedEntryIds: imbalancedEntryIds,
  blocks: imbalancedBlocks,
  expectedBlockCount: 4,
});
assert.equal(imbalanced.valid, true);
assert.equal(imbalanced.warnings[0]?.code, "BLOCK_SIZE_IMBALANCE");
assert.equal(imbalanced.warnings[0]?.difference, 2);
assert.ok(formatBlockSizeImbalanceWarning(imbalanced.warnings).includes("人数差"));

const twoTeamBlock = buildBlocks(4).map((block, index) =>
  index === 0 ? { ...block, entryIds: ["e-1", "e-2"] } : block
);
assert.equal(
  validateEditableBlockDraw({
    confirmedEntryIds,
    blocks: twoTeamBlock,
    expectedBlockCount: 4,
  }).valid,
  false
);

const nineTeamBlock = buildBlocks(4).map((block, index) =>
  index === 0
    ? {
        ...block,
        entryIds: ["e-1", "e-2", "e-3", "e-4", "e-5", "e-6", "e-7", "e-8", "e-9"],
      }
    : { ...block, entryIds: [] }
);
assert.equal(
  validateEditableBlockDraw({
    confirmedEntryIds: ["e-1", "e-2", "e-3", "e-4", "e-5", "e-6", "e-7", "e-8", "e-9"],
    blocks: nineTeamBlock.slice(0, 1).concat(buildBlocks(4).slice(1)),
    expectedBlockCount: 4,
  }).valid,
  false
);

const duplicateBlocks = buildBlocks(4).map((block, index) =>
  index === 1 ? { ...block, entryIds: [...block.entryIds, "e-1"] } : block
);
assert.equal(
  validateEditableBlockDraw({
    confirmedEntryIds,
    blocks: duplicateBlocks,
    expectedBlockCount: 4,
  }).valid,
  false
);

const missingBlocks = buildBlocks(4).map((block, index) =>
  index === 3 ? { ...block, entryIds: block.entryIds.slice(0, 2) } : block
);
assert.equal(
  validateEditableBlockDraw({
    confirmedEntryIds,
    blocks: missingBlocks,
    expectedBlockCount: 4,
  }).valid,
  false
);

const unknownBlocks = buildBlocks(4).map((block, index) =>
  index === 0 ? { ...block, entryIds: [...block.entryIds, "unknown"] } : block
);
assert.equal(
  validateEditableBlockDraw({
    confirmedEntryIds,
    blocks: unknownBlocks,
    expectedBlockCount: 4,
  }).valid,
  false
);

assert.equal(
  validateEditableBlockDraw({
    confirmedEntryIds,
    blocks: validBlocks,
    expectedBlockCount: 8,
  }).valid,
  false
);

assert.equal(isBlockDrawEditable({ status: "draft", blocks: [{}] }), true);
assert.equal(isBlockDrawEditable({ status: "finalized", blocks: [{}] }), false);
assert.equal(isBlockDrawEditable({ blocks: [{}] }), false);

assert.equal(isBlockDrawFinalized({ status: "finalized", blocks: [{}] }), true);
assert.equal(isBlockDrawFinalized({ blocks: [{}] }), true);
assert.equal(isBlockDrawFinalized({ status: "draft", blocks: [{}] }), false);

const moveBlocks = [
  { id: "A", name: "Aブロック", entryIds: ["e-1", "e-2", "e-3", "e-4"] },
  { id: "B", name: "Bブロック", entryIds: ["e-5", "e-6", "e-7"] },
  { id: "C", name: "Cブロック", entryIds: ["e-8", "e-9", "e-10"] },
  { id: "D", name: "Dブロック", entryIds: ["e-11", "e-12"] },
];

const moved = moveEntryBetweenBlocks(moveBlocks, "A", "e-1", "B");
assert.ok(moved.find((block) => block.id === "B").entryIds.includes("e-1"));
assert.ok(!moved.find((block) => block.id === "A").entryIds.includes("e-1"));

assert.throws(
  () => moveEntryBetweenBlocks(validBlocks, "A", "e-1", "A"),
  (error) => error.code === "block-draw/same-block"
);

assert.throws(
  () => moveEntryBetweenBlocks(validBlocks, "A", "e-1", "B"),
  (error) => error.code === "block-draw/source-too-small"
);

const largeTarget = [
  { id: "A", name: "Aブロック", entryIds: ["e-1", "e-2", "e-3", "e-4"] },
  {
    id: "B",
    name: "Bブロック",
    entryIds: ["e-5", "e-6", "e-7", "e-8", "e-9", "e-10", "e-11", "e-12"],
  },
];
assert.throws(
  () => moveEntryBetweenBlocks(largeTarget, "A", "e-1", "B"),
  (error) => error.code === "block-draw/destination-too-large"
);

const swapped = swapEntriesBetweenBlocks(validBlocks, "A", "e-1", "B", "e-4");
assert.ok(swapped.find((block) => block.id === "A").entryIds.includes("e-4"));
assert.ok(swapped.find((block) => block.id === "B").entryIds.includes("e-1"));

assert.throws(
  () => swapEntriesBetweenBlocks(validBlocks, "A", "e-1", "A", "e-2"),
  (error) => error.code === "block-draw/same-block"
);

assert.throws(
  () => swapEntriesBetweenBlocks(validBlocks, "A", "e-1", "A", "e-1"),
  (error) => error.code === "block-draw/same-entry"
);

const mismatchAdded = detectConfirmedEntryMismatch(
  confirmedEntryIds,
  [...entries, { id: "e-new", teamName: "New Team" }]
);
assert.equal(mismatchAdded.matches, false);
assert.equal(mismatchAdded.added.length, 1);

const mismatchRemoved = detectConfirmedEntryMismatch(confirmedEntryIds, entries.slice(0, -1));
assert.equal(mismatchRemoved.matches, false);
assert.equal(mismatchRemoved.removedIds.length, 1);
assert.equal(mismatchRemoved.removedIds[0], "e-12");

const draw = distributeEntriesToFixedBlocks({
  entries,
  blockCount: 4,
  random: () => 0.5,
});
const redistributed = recalculateDistributionFromBlocks(draw.blocks, draw.distribution);
assert.equal(redistributed.minBlockSize, 3);
assert.equal(redistributed.maxBlockSize, 3);
assert.equal(redistributed.blockSizeDifference, 0);

console.log("block-draw-edit.test.mjs: all passed");
