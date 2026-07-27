/**
 * blockDraw 編集可否（新形式 draft / 旧形式・確定済み）
 */

/**
 * @param {object|null|undefined} blockDraw
 */
export function isBlockDrawDraft(blockDraw) {
  return blockDraw?.status === "draft";
}

/**
 * 確定済み（新形式 finalized、旧形式 status 未定義含む）
 * @param {object|null|undefined} blockDraw
 */
export function isBlockDrawFinalized(blockDraw) {
  if (!blockDraw || !Array.isArray(blockDraw.blocks) || blockDraw.blocks.length === 0) {
    return false;
  }
  return blockDraw.status !== "draft";
}

/**
 * @param {object|null|undefined} blockDraw
 */
export function isBlockDrawEditable(blockDraw) {
  return isBlockDrawDraft(blockDraw);
}
