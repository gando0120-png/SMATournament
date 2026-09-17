/**
 * block-configuration ドメインテスト
 */
import assert from "node:assert/strict";
import {
  ALLOWED_BLOCK_COUNTS,
  calculateBlockDistribution,
  computeQualifyingAdvancementCounts,
  formatBlockDistributionLabel,
  isAllowedBlockCount,
  validateBlockConfiguration,
} from "../../js/domain/block-configuration.js";

function testDistribution(teamCount, blockCount, expected) {
  const result = calculateBlockDistribution(teamCount, blockCount);
  assert.equal(result.baseSize, expected.baseSize);
  assert.equal(result.largerBlockCount, expected.largerBlockCount);
  assert.equal(result.smallerBlockCount, expected.smallerBlockCount);
  assert.equal(result.minBlockSize, expected.minBlockSize);
  assert.equal(result.maxBlockSize, expected.maxBlockSize);
}

// --- 配分計算 ---

testDistribution(59, 16, {
  baseSize: 3,
  largerBlockCount: 11,
  smallerBlockCount: 5,
  minBlockSize: 3,
  maxBlockSize: 4,
});

testDistribution(61, 16, {
  baseSize: 3,
  largerBlockCount: 13,
  smallerBlockCount: 3,
  minBlockSize: 3,
  maxBlockSize: 4,
});

testDistribution(64, 16, {
  baseSize: 4,
  largerBlockCount: 0,
  smallerBlockCount: 16,
  minBlockSize: 4,
  maxBlockSize: 4,
});

testDistribution(22, 6, {
  baseSize: 3,
  largerBlockCount: 4,
  smallerBlockCount: 2,
  minBlockSize: 3,
  maxBlockSize: 4,
});

{
  const result = validateBlockConfiguration({
    teamCount: 22,
    blockCount: 6,
    qualifiersPerBlock: 1,
  });
  assert.equal(result.valid, true);
  assert.equal(result.qualifierCount, 6);
  assert.equal(result.distribution.largerBlockCount, 4);
  assert.equal(result.distribution.smallerBlockCount, 2);
}

{
  const advancement = computeQualifyingAdvancementCounts({
    blockCount: 6,
    qualifiersPerBlock: 2,
    finalTeamCount: 16,
    teamCount: 22,
  });
  assert.equal(advancement.valid, true);
  assert.equal(advancement.autoPassCount, 12);
  assert.equal(advancement.wildcardCount, 4);
}

{
  const config = validateBlockConfiguration({
    teamCount: 22,
    blockCount: 6,
    qualifiersPerBlock: 2,
  });
  assert.equal(config.valid, true);
  assert.equal(config.qualifierCount, 12);
}

{
  const overflow = computeQualifyingAdvancementCounts({
    blockCount: 6,
    qualifiersPerBlock: 2,
    finalTeamCount: 8,
    teamCount: 22,
  });
  assert.equal(overflow.valid, false);
}

// --- validateBlockConfiguration ---

{
  const result = validateBlockConfiguration({ teamCount: 47, blockCount: 16 });
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some((message) => message.includes("48")),
    "47チームは最小人数不足で invalid"
  );
}

{
  const result = validateBlockConfiguration({
    teamCount: 64,
    blockCount: 16,
    qualifiersPerBlock: 1,
  });
  assert.equal(result.valid, true);
  assert.equal(result.qualifierCount, 16);
}

{
  const result = validateBlockConfiguration({
    teamCount: 64,
    blockCount: 16,
    qualifiersPerBlock: 2,
  });
  assert.equal(result.valid, true);
  assert.equal(result.qualifierCount, 32);
}

{
  const result = validateBlockConfiguration({
    teamCount: 96,
    blockCount: 32,
    qualifiersPerBlock: 2,
  });
  assert.equal(result.valid, true);
  assert.equal(result.qualifierCount, 64);
  assert.equal(result.distribution.baseSize, 3);
  assert.equal(result.distribution.largerBlockCount, 0);
}

{
  const result = validateBlockConfiguration({
    teamCount: 95,
    blockCount: 32,
    qualifiersPerBlock: 2,
  });
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some((message) => message.includes("blockCount × 3")),
    "95チームは最小ブロック人数不足で invalid"
  );
}

{
  const result = validateBlockConfiguration({
    teamCount: 128,
    blockCount: 32,
    qualifiersPerBlock: 2,
  });
  assert.equal(result.valid, true);
  assert.equal(result.qualifierCount, 64);
}

{
  const result = validateBlockConfiguration({
    teamCount: 64,
    blockCount: 16,
    qualifiersPerBlock: 3,
  });
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some((message) => message.includes("qualifiersPerBlock")),
    "通過数3は初期仕様外で invalid"
  );
}

{
  const result = validateBlockConfiguration({
    teamCount: 8,
    blockCount: 4,
    qualifiersPerBlock: 2,
  });
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some((message) => message.includes("最小ブロック人数")),
    "qualifiersPerBlock >= minBlockSize は invalid"
  );
  assert.ok(
    result.errors.some((message) => message.includes("blockCount × 3")),
    "teamCount 不足も invalid"
  );
}

{
  const result = validateBlockConfiguration({
    teamCount: 48,
    blockCount: 16,
    qualifiersPerBlock: 1,
  });
  assert.equal(result.valid, true);
  assert.equal(result.minBlockSize, 3);
  assert.equal(result.qualifierCount, 16);
}

{
  assert.deepEqual(ALLOWED_BLOCK_COUNTS, [4, 6, 7, 8, 16, 32]);
  for (const blockCount of ALLOWED_BLOCK_COUNTS) {
    assert.equal(isAllowedBlockCount(blockCount), true);
  }
  assert.equal(isAllowedBlockCount(5), false);
  assert.equal(isAllowedBlockCount(12), false);
}

testDistribution(26, 7, {
  baseSize: 3,
  largerBlockCount: 5,
  smallerBlockCount: 2,
  minBlockSize: 3,
  maxBlockSize: 4,
});

{
  const result = validateBlockConfiguration({
    teamCount: 26,
    blockCount: 7,
    qualifiersPerBlock: 2,
  });
  assert.equal(result.valid, true);
  assert.equal(result.distribution.largerBlockCount, 5);
  assert.equal(result.distribution.smallerBlockCount, 2);
  assert.equal(
    formatBlockDistributionLabel(result.distribution, 7),
    "4人×5ブロック / 3人×2ブロック"
  );
}

{
  const caseA = computeQualifyingAdvancementCounts({
    blockCount: 7,
    qualifiersPerBlock: 1,
    finalTeamCount: 8,
    teamCount: 26,
  });
  assert.equal(caseA.valid, true);
  assert.equal(caseA.autoPassCount, 7);
  assert.equal(caseA.wildcardCount, 1);
}

{
  const caseB = computeQualifyingAdvancementCounts({
    blockCount: 7,
    qualifiersPerBlock: 2,
    finalTeamCount: 16,
    teamCount: 26,
  });
  assert.equal(caseB.valid, true);
  assert.equal(caseB.autoPassCount, 14);
  assert.equal(caseB.wildcardCount, 2);
}

{
  const caseC = computeQualifyingAdvancementCounts({
    blockCount: 6,
    qualifiersPerBlock: 2,
    finalTeamCount: 16,
    teamCount: 22,
  });
  assert.equal(caseC.valid, true);
  assert.equal(caseC.autoPassCount, 12);
  assert.equal(caseC.wildcardCount, 4);
}

console.log("block-configuration.test.mjs: all passed");
