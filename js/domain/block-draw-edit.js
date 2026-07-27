/**
 * blockDraw draft の手動編集・検証（DOM / Firestore 非依存）
 */
import {
  MIN_TEAMS_PER_BLOCK,
  MAX_TEAMS_PER_BLOCK,
} from "./block-configuration.js";

/**
 * @param {Array<{ id: string, entryIds: string[] }>} blocks
 */
export function collectAllEntryIdsFromBlocks(blocks) {
  const ids = [];
  for (const block of blocks || []) {
    for (const entryId of block.entryIds || []) {
      ids.push(entryId);
    }
  }
  return ids;
}

/**
 * 手動編集後の distribution を実配置から再計算（baseSize 等の自動抽選メタは保持）
 * @param {Array<{ id: string, entryIds: string[] }>} blocks
 * @param {object} [previousDistribution]
 */
export function recalculateDistributionFromBlocks(blocks, previousDistribution = {}) {
  const blockSizesById = {};
  const sizes = [];

  for (const block of blocks || []) {
    const size = (block.entryIds || []).length;
    blockSizesById[block.id] = size;
    sizes.push(size);
  }

  const minBlockSize = sizes.length > 0 ? Math.min(...sizes) : 0;
  const maxBlockSize = sizes.length > 0 ? Math.max(...sizes) : 0;
  const largerBlockIds = (blocks || [])
    .filter((block) => (block.entryIds || []).length === maxBlockSize)
    .map((block) => block.id);

  return {
    ...previousDistribution,
    minBlockSize,
    maxBlockSize,
    blockSizeDifference: maxBlockSize - minBlockSize,
    blockSizesById,
    largerBlockIds,
  };
}

/**
 * @param {{ confirmedEntryIds: string[], blocks: Array<{ id?: string, name?: string, entryIds?: string[] }>, expectedBlockCount: number }} params
 */
export function validateEditableBlockDraw({ confirmedEntryIds, blocks, expectedBlockCount }) {
  const errors = [];
  const warnings = [];
  const confirmedSet = new Set(confirmedEntryIds || []);
  const seenEntryIds = new Set();
  const blockSizes = [];

  if (!Array.isArray(blocks) || blocks.length !== expectedBlockCount) {
    errors.push("blocks の件数が blockCount と一致しません。");
  }

  for (const block of blocks || []) {
    if (!block.id || !block.name) {
      errors.push("ブロックに id または name がありません。");
    }

    const entryIds = block.entryIds || [];
    blockSizes.push(entryIds.length);

    if (entryIds.length === 0) {
      errors.push(`空ブロックがあります（${block.id ?? "—"}）。`);
    }

    if (entryIds.length < MIN_TEAMS_PER_BLOCK) {
      errors.push(
        `${block.name || block.id || "ブロック"}は${MIN_TEAMS_PER_BLOCK}チーム未満です（${entryIds.length}チーム）。`
      );
    }

    if (entryIds.length > MAX_TEAMS_PER_BLOCK) {
      errors.push(
        `${block.name || block.id || "ブロック"}は${MAX_TEAMS_PER_BLOCK}チームを超えています（${entryIds.length}チーム）。`
      );
    }

    for (const entryId of entryIds) {
      if (!confirmedSet.has(entryId)) {
        errors.push(`不明な entryId が含まれています（${entryId}）。`);
      }
      if (seenEntryIds.has(entryId)) {
        errors.push(`entryId が重複しています（${entryId}）。`);
      }
      seenEntryIds.add(entryId);
    }
  }

  for (const entryId of confirmedEntryIds || []) {
    if (!seenEntryIds.has(entryId)) {
      errors.push(`未配置の entryId があります（${entryId}）。`);
    }
  }

  if (seenEntryIds.size !== (confirmedEntryIds || []).length) {
    errors.push("確定エントリーが全件配置されていません。");
  }

  if (blockSizes.length > 0) {
    const minBlockSize = Math.min(...blockSizes);
    const maxBlockSize = Math.max(...blockSizes);
    const difference = maxBlockSize - minBlockSize;
    if (difference >= 2) {
      warnings.push({
        code: "BLOCK_SIZE_IMBALANCE",
        minBlockSize,
        maxBlockSize,
        difference,
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * @param {Array<{ id: string, entryIds: string[] }>} blocks
 * @param {string} fromBlockId
 * @param {string} entryId
 * @param {string} toBlockId
 */
export function moveEntryBetweenBlocks(blocks, fromBlockId, entryId, toBlockId) {
  if (fromBlockId === toBlockId) {
    throw Object.assign(new Error("移動元と移動先が同じブロックです。"), {
      code: "block-draw/same-block",
    });
  }

  const next = (blocks || []).map((block) => ({
    ...block,
    entryIds: [...(block.entryIds || [])],
  }));

  const fromBlock = next.find((block) => block.id === fromBlockId);
  const toBlock = next.find((block) => block.id === toBlockId);

  if (!fromBlock || !toBlock) {
    throw Object.assign(new Error("指定したブロックが見つかりません。"), {
      code: "block-draw/block-not-found",
    });
  }

  if (!fromBlock.entryIds.includes(entryId)) {
    throw Object.assign(new Error("移動するチームがブロックに存在しません。"), {
      code: "block-draw/entry-not-found",
    });
  }

  if (fromBlock.entryIds.length <= MIN_TEAMS_PER_BLOCK) {
    throw Object.assign(
      new Error(`移動後、${fromBlock.name || fromBlock.id}が2チーム以下になります。`),
      { code: "block-draw/source-too-small" }
    );
  }

  if (toBlock.entryIds.length >= MAX_TEAMS_PER_BLOCK) {
    throw Object.assign(
      new Error(`移動後、${toBlock.name || toBlock.id}が9チーム以上になります。`),
      { code: "block-draw/destination-too-large" }
    );
  }

  fromBlock.entryIds = fromBlock.entryIds.filter((id) => id !== entryId);
  toBlock.entryIds.push(entryId);

  return next;
}

/**
 * @param {Array<{ id: string, entryIds: string[] }>} blocks
 * @param {string} blockIdA
 * @param {string} entryIdA
 * @param {string} blockIdB
 * @param {string} entryIdB
 */
export function swapEntriesBetweenBlocks(blocks, blockIdA, entryIdA, blockIdB, entryIdB) {
  if (entryIdA === entryIdB) {
    throw Object.assign(new Error("同じチーム同士は入替できません。"), {
      code: "block-draw/same-entry",
    });
  }

  if (blockIdA === blockIdB) {
    throw Object.assign(new Error("同一ブロック内の入替はできません。"), {
      code: "block-draw/same-block",
    });
  }

  const next = (blocks || []).map((block) => ({
    ...block,
    entryIds: [...(block.entryIds || [])],
  }));

  const blockA = next.find((block) => block.id === blockIdA);
  const blockB = next.find((block) => block.id === blockIdB);

  if (!blockA || !blockB) {
    throw Object.assign(new Error("指定したブロックが見つかりません。"), {
      code: "block-draw/block-not-found",
    });
  }

  const indexA = blockA.entryIds.indexOf(entryIdA);
  const indexB = blockB.entryIds.indexOf(entryIdB);

  if (indexA === -1 || indexB === -1) {
    throw Object.assign(new Error("入替するチームがブロックに存在しません。"), {
      code: "block-draw/entry-not-found",
    });
  }

  blockA.entryIds[indexA] = entryIdB;
  blockB.entryIds[indexB] = entryIdA;

  return next;
}

/**
 * @param {string[]} draftEntryIds
 * @param {Array<{ id: string, teamName?: string }>} confirmedEntries
 */
export function detectConfirmedEntryMismatch(draftEntryIds, confirmedEntries) {
  const draftSet = new Set(draftEntryIds);
  const confirmedList = confirmedEntries || [];
  const confirmedSet = new Set(confirmedList.map((entry) => entry.id));

  const added = confirmedList.filter((entry) => !draftSet.has(entry.id));
  const removedIds = [...draftSet].filter((entryId) => !confirmedSet.has(entryId));

  return {
    matches: added.length === 0 && removedIds.length === 0,
    added,
    removedIds,
  };
}

/**
 * @param {ReturnType<typeof detectConfirmedEntryMismatch>} mismatch
 * @param {Map<string, { teamName?: string }>} [entryLookup]
 */
export function formatEntryMismatchMessage(mismatch, entryLookup = new Map()) {
  const lines = ["ブロック抽選後に確定エントリーが変更されています。", ""];

  if (mismatch.added.length > 0) {
    lines.push(`追加：${mismatch.added.length}チーム`);
    for (const entry of mismatch.added) {
      lines.push(`・${entry.teamName || entry.id}`);
    }
    lines.push("");
  }

  if (mismatch.removedIds.length > 0) {
    lines.push(`解除：${mismatch.removedIds.length}チーム`);
    for (const entryId of mismatch.removedIds) {
      const entry = entryLookup.get(entryId);
      lines.push(`・${entry?.teamName || entryId}`);
    }
    lines.push("");
  }

  lines.push("再抽選するか、配置を修正してください。");
  return lines.join("\n");
}

/**
 * @param {Array<{ code: string, minBlockSize: number, maxBlockSize: number, difference: number }>} warnings
 */
export function formatBlockSizeImbalanceWarning(warnings) {
  const warning = warnings.find((item) => item.code === "BLOCK_SIZE_IMBALANCE");
  if (!warning) {
    return null;
  }

  return [
    "ブロック間の人数差が2チーム以上あります。",
    "",
    `最大：${warning.maxBlockSize}チーム`,
    `最小：${warning.minBlockSize}チーム`,
    "",
    "このまま確定することもできます。",
  ].join("\n");
}

/**
 * @param {Array<{ code: string, difference: number }>} warnings
 */
export function formatBlockSizeImbalanceConfirmMessage(warnings) {
  const warning = warnings.find((item) => item.code === "BLOCK_SIZE_IMBALANCE");
  if (!warning) {
    return null;
  }

  return `ブロック間の人数差が${warning.difference}チームあります。\n\nこの配置で確定しますか？`;
}
