/**
 * block-configuration ドメインテスト
 */
import assert from "node:assert/strict";
import {
  calculateBlockDistribution,
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

testDistribution(48, 16, {
  baseSize: 3,
  largerBlockCount: 0,
  smallerBlockCount: 16,
  minBlockSize: 3,
  maxBlockSize: 3,
});

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

console.log("block-configuration.test.mjs: all passed");
