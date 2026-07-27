/**
 * fixed-block-draw ドメインテスト
 */
import assert from "node:assert/strict";
import { validateBlockConfiguration } from "../../js/domain/block-configuration.js";
import {
  assignLargerBlockIndices,
  distributeEntriesToFixedBlocks,
  getFixedBlockLabel,
  validateGeneratedBlockDraw,
} from "../../js/domain/fixed-block-draw.js";
import { buildQualifyingScheduleFromBlockDraw } from "../../js/domain/qualifying-schedule.js";

function makeEntries(count, prefix = "entry") {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index + 1}`,
    teamName: `Team ${index + 1}`,
  }));
}

function blockSizes(blocks) {
  return blocks.map((block) => block.entryIds.length);
}

function assertDistribution(draw, expectedLarger, expectedSmall) {
  const sizes = blockSizes(draw.blocks).sort((a, b) => a - b);
  const maxSize = sizes[sizes.length - 1];
  const minSize = sizes[0];
  assert.equal(maxSize - minSize <= 1, true);
  assert.equal(
    sizes.filter((size) => size === maxSize).length,
    expectedLarger
  );
  assert.equal(
    sizes.filter((size) => size === minSize).length,
    expectedSmall
  );
}

assert.equal(getFixedBlockLabel(0), "A");
assert.equal(getFixedBlockLabel(25), "Z");
assert.equal(getFixedBlockLabel(26), "AA");
assert.equal(getFixedBlockLabel(31), "AF");

{
  const draw = distributeEntriesToFixedBlocks({
    entries: makeEntries(59),
    blockCount: 16,
    random: () => 0,
  });
  assert.equal(draw.blockCount, 16);
  assert.equal(draw.distribution.baseSize, 3);
  assert.equal(draw.distribution.largerBlockCount, 11);
  assertDistribution(draw, 11, 5);
  assert.equal(draw.blocks.flatMap((block) => block.entryIds).length, 59);
  const validation = validateGeneratedBlockDraw({
    entries: makeEntries(59),
    blocks: draw.blocks,
    blockCount: 16,
    distribution: draw.distribution,
  });
  assert.equal(validation.valid, true);
}

{
  const draw = distributeEntriesToFixedBlocks({
    entries: makeEntries(61),
    blockCount: 16,
    random: () => 0.5,
  });
  assertDistribution(draw, 13, 3);
}

{
  const draw = distributeEntriesToFixedBlocks({
    entries: makeEntries(48),
    blockCount: 16,
    random: () => 0,
  });
  assert.deepEqual(blockSizes(draw.blocks), Array(16).fill(3));
}

{
  const validation = validateBlockConfiguration({
    teamCount: 47,
    blockCount: 16,
    qualifiersPerBlock: 1,
  });
  assert.equal(validation.valid, false);
}

{
  const draw = distributeEntriesToFixedBlocks({
    entries: makeEntries(96),
    blockCount: 32,
    random: () => 0,
  });
  assert.deepEqual(blockSizes(draw.blocks), Array(32).fill(3));
  const config = validateBlockConfiguration({
    teamCount: 96,
    blockCount: 32,
    qualifiersPerBlock: 2,
  });
  assert.equal(config.valid, true);
  assert.equal(config.qualifierCount, 64);
}

{
  const randomValues = [0.1, 0.9, 0.2, 0.8];
  let index = 0;
  const random = () => {
    const value = randomValues[index % randomValues.length];
    index += 1;
    return value;
  };
  const first = assignLargerBlockIndices(16, 11, random);
  index = 0;
  const second = assignLargerBlockIndices(16, 11, () => 0.99);
  assert.notDeepEqual(first, second);
}

{
  const draw = distributeEntriesToFixedBlocks({
    entries: makeEntries(59),
    blockCount: 16,
    random: () => 0,
  });
  const duplicated = draw.blocks.map((block, blockIndex) =>
    blockIndex === 0
      ? { ...block, entryIds: [...block.entryIds, draw.blocks[1].entryIds[0]] }
      : block
  );
  const validation = validateGeneratedBlockDraw({
    entries: makeEntries(59),
    blocks: duplicated,
    blockCount: 16,
    distribution: draw.distribution,
  });
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((message) => message.includes("重複")));
}

{
  const draw = distributeEntriesToFixedBlocks({
    entries: makeEntries(10),
    blockCount: 4,
    random: () => 0,
  });
  draw.blocks[0].entryIds.pop();
  const validation = validateGeneratedBlockDraw({
    entries: makeEntries(10),
    blocks: draw.blocks,
    blockCount: 4,
  });
  assert.equal(validation.valid, false);
}

{
  const draw = distributeEntriesToFixedBlocks({
    entries: makeEntries(10),
    blockCount: 4,
    random: () => 0,
  });
  draw.blocks[0].entryIds.push("unknown-entry");
  const validation = validateGeneratedBlockDraw({
    entries: makeEntries(10),
    blocks: draw.blocks,
    blockCount: 4,
  });
  assert.equal(validation.valid, false);
}

{
  const draw = distributeEntriesToFixedBlocks({
    entries: makeEntries(10),
    blockCount: 4,
    random: () => 0,
  });
  const validation = validateGeneratedBlockDraw({
    entries: makeEntries(10),
    blocks: draw.blocks.slice(0, 3),
    blockCount: 4,
  });
  assert.equal(validation.valid, false);
}

{
  const draw = distributeEntriesToFixedBlocks({
    entries: makeEntries(10),
    blockCount: 4,
    random: () => 0,
  });
  draw.blocks[0].entryIds = [];
  const validation = validateGeneratedBlockDraw({
    entries: makeEntries(10),
    blocks: draw.blocks,
    blockCount: 4,
  });
  assert.equal(validation.valid, false);
}

{
  const draw = distributeEntriesToFixedBlocks({
    entries: makeEntries(10),
    blockCount: 4,
    random: () => 0,
  });
  draw.blocks[0].entryIds = draw.blocks[0].entryIds.concat(draw.blocks[1].entryIds);
  draw.blocks[1].entryIds = [];
  const validation = validateGeneratedBlockDraw({
    entries: makeEntries(10),
    blocks: draw.blocks,
    blockCount: 4,
  });
  assert.equal(validation.valid, false);
}

{
  assert.equal(
    validateBlockConfiguration({ teamCount: 32, blockCount: 4, qualifiersPerBlock: 1 }).valid,
    true
  );
  assert.equal(
    validateBlockConfiguration({ teamCount: 33, blockCount: 4, qualifiersPerBlock: 1 }).valid,
    false
  );
  assert.equal(
    validateBlockConfiguration({ teamCount: 64, blockCount: 8, qualifiersPerBlock: 2 }).valid,
    true
  );
  assert.equal(
    validateBlockConfiguration({ teamCount: 65, blockCount: 8, qualifiersPerBlock: 2 }).valid,
    false
  );
}

{
  const draw = distributeEntriesToFixedBlocks({
    entries: makeEntries(59),
    blockCount: 16,
    random: () => 0,
  });
  const schedule = buildQualifyingScheduleFromBlockDraw(draw, makeEntries(59));
  assert.equal(schedule.hasUnsupportedBlock, false);
  assert.equal(schedule.blocks.length, 16);
}

console.log("fixed-block-draw.test.mjs: all passed");
