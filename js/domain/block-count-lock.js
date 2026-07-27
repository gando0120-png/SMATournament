/**
 * blockCount 変更可否（blockDraw 状態基準、structureLocked とは独立）
 */

/**
 * @param {object|null|undefined} blockDraw
 */
export function isBlockCountEditable(blockDraw) {
  if (!blockDraw) {
    return true;
  }
  return blockDraw.status === "draft";
}

/**
 * @param {object|null|undefined} blockDraw
 */
export function blockCountChangeRequiresDraftDiscard(blockDraw) {
  return blockDraw?.status === "draft";
}
