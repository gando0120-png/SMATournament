/**
 * ブロック ID の表示順（A〜Z, AA〜AF）
 */
import { getFixedBlockLabel } from "./fixed-block-draw.js";

const BLOCK_LABEL_TO_INDEX = new Map(
  Array.from({ length: 32 }, (_, index) => [getFixedBlockLabel(index), index])
);

/**
 * @param {string|null|undefined} blockId
 */
export function getFixedBlockSortIndex(blockId) {
  if (blockId == null) {
    return Number.MAX_SAFE_INTEGER;
  }
  const key = String(blockId);
  if (BLOCK_LABEL_TO_INDEX.has(key)) {
    return BLOCK_LABEL_TO_INDEX.get(key);
  }
  return Number.MAX_SAFE_INTEGER - 1;
}

/**
 * @param {string|null|undefined} blockIdA
 * @param {string|null|undefined} blockIdB
 */
export function compareBlockIds(blockIdA, blockIdB) {
  const indexDiff = getFixedBlockSortIndex(blockIdA) - getFixedBlockSortIndex(blockIdB);
  if (indexDiff !== 0) {
    return indexDiff;
  }
  return String(blockIdA ?? "").localeCompare(String(blockIdB ?? ""), "ja");
}

/**
 * @template {{ blockId?: string|null, id?: string|null, blockName?: string|null, name?: string|null }} T
 * @param {T[]} blocks
 * @param {"blockId"|"id"} [idKey]
 */
export function sortBlocksByBlockId(blocks, idKey = "blockId") {
  return [...blocks].sort((left, right) => {
    const leftId = left[idKey] ?? left.blockId ?? left.id ?? null;
    const rightId = right[idKey] ?? right.blockId ?? right.id ?? null;
    return compareBlockIds(leftId, rightId);
  });
}
