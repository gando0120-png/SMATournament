/**
 * ブロック ID 並び順テスト
 */
import assert from "node:assert/strict";
import { compareBlockIds, sortBlocksByBlockId } from "../../js/domain/block-order.js";
import { getFixedBlockLabel } from "../../js/domain/fixed-block-draw.js";

const labels32 = Array.from({ length: 32 }, (_, index) => getFixedBlockLabel(index));
assert.deepEqual(labels32.slice(0, 3), ["A", "B", "C"]);
assert.deepEqual(labels32.slice(25, 32), ["Z", "AA", "AB", "AC", "AD", "AE", "AF"]);

const shuffled = ["AA", "B", "A", "AF", "AB", "Z"];
const sorted = [...shuffled].sort(compareBlockIds);
assert.deepEqual(sorted, ["A", "B", "Z", "AA", "AB", "AF"]);

const blocks = sortBlocksByBlockId([
  { blockId: "AF", blockName: "AF" },
  { blockId: "A", blockName: "A" },
  { blockId: "AA", blockName: "AA" },
  { blockId: "B", blockName: "B" },
]);
assert.deepEqual(
  blocks.map((block) => block.blockId),
  ["A", "B", "AA", "AF"]
);

console.log("block-order.test.mjs: all passed");
