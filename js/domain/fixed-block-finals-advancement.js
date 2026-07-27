/**
 * 新形式（固定 blockCount）決勝進出選出（DOM / Firestore 非依存）
 */
import { areStandingsEntriesTied } from "./qualifying-standings.js";
import { isBlockDrawFinalized } from "./block-draw-state.js";

/**
 * @param {{ qualifyingStandings: object, blockCount: number, qualifiersPerBlock: number }} params
 */
export function selectFixedBlockQualifiers({ qualifyingStandings, blockCount, qualifiersPerBlock }) {
  const errors = [];
  const qualifiers = [];

  if (!qualifyingStandings?.blocks?.length) {
    return {
      valid: false,
      errors: ["予選順位表を取得できません。"],
      qualifiers: [],
      qualifierCount: blockCount * qualifiersPerBlock,
    };
  }

  if (qualifyingStandings.blocks.length !== blockCount) {
    return {
      valid: false,
      errors: [`ブロック数が一致しません（${qualifyingStandings.blocks.length} / ${blockCount}）。`],
      qualifiers: [],
      qualifierCount: blockCount * qualifiersPerBlock,
    };
  }

  const sortedBlocks = [...qualifyingStandings.blocks].sort((a, b) =>
    String(a.blockId).localeCompare(String(b.blockId), "ja")
  );

  for (const block of sortedBlocks) {
    const blockLabel = block.blockName || block.blockId || "ブロック";
    const standings = block.standings || [];

    if (standings.length < qualifiersPerBlock) {
      errors.push(`${blockLabel}に${qualifiersPerBlock}位までの順位がありません。`);
      continue;
    }

    const atRankLimit = standings.filter((entry) => entry.rank <= qualifiersPerBlock);
    if (atRankLimit.length > qualifiersPerBlock) {
      errors.push(`${blockLabel}の${qualifiersPerBlock}位が確定していません。`);
      continue;
    }

    if (atRankLimit.length < qualifiersPerBlock) {
      errors.push(`${blockLabel}に${qualifiersPerBlock}位までの順位がありません。`);
      continue;
    }

    const selected = standings.slice(0, qualifiersPerBlock);
    const next = standings[qualifiersPerBlock];
    if (next && areStandingsEntriesTied(selected[qualifiersPerBlock - 1], next)) {
      errors.push(`${blockLabel}の${qualifiersPerBlock}位が確定していません。`);
      continue;
    }

    for (const entry of selected) {
      qualifiers.push({
        entryId: entry.entryId,
        blockId: block.blockId,
        blockRank: entry.rank,
        teamName: entry.teamName,
        blockName: block.blockName,
      });
    }
  }

  const expectedCount = blockCount * qualifiersPerBlock;
  const seenEntryIds = new Set();

  for (const qualifier of qualifiers) {
    if (seenEntryIds.has(qualifier.entryId)) {
      errors.push(`entryId ${qualifier.entryId} が重複しています。`);
    }
    seenEntryIds.add(qualifier.entryId);
  }

  if (errors.length === 0 && qualifiers.length !== expectedCount) {
    errors.push(`選出数が一致しません（${qualifiers.length} / ${expectedCount}）。`);
  }

  return {
    valid: errors.length === 0,
    errors,
    qualifiers,
    qualifierCount: expectedCount,
  };
}

/**
 * @param {{ blockDraw: object|null, blockCount: number }} params
 */
export function validateFixedBlockAdvancementPrerequisites({ blockDraw, blockCount }) {
  if (!isBlockDrawFinalized(blockDraw)) {
    return { valid: false, message: "ブロック抽選が確定していません。" };
  }

  if (!Array.isArray(blockDraw.blocks) || blockDraw.blocks.length !== blockCount) {
    return {
      valid: false,
      message: `ブロック数が一致しません（${blockDraw?.blocks?.length ?? 0} / ${blockCount}）。`,
    };
  }

  return { valid: true, message: null };
}

/**
 * @param {Array<{ blockId: string, blockName?: string, qualifiers: Array<{ entryId: string, blockRank: number, teamName?: string }> }>} blockGroups
 */
export function formatFixedBlockAdvancementPreviewMessage(blockGroups, qualifierCount) {
  const lines = [
    `各ブロック上位${blockGroups[0]?.qualifiers?.length ?? "—"}チームが決勝進出します。`,
    "",
    `決勝進出予定：${qualifierCount}チーム`,
    "",
  ];

  for (const group of blockGroups) {
    lines.push(group.blockName || group.blockId);
    for (const qualifier of group.qualifiers) {
      lines.push(`${qualifier.blockRank}位 ${qualifier.teamName || qualifier.entryId}`);
    }
    lines.push("");
  }

  return lines.join("\n").trim();
}

/**
 * @param {Array<{ blockId: string, blockName?: string, blockRank: number, entryId: string, teamName?: string }>} qualifiers
 */
export function groupFixedBlockQualifiersByBlock(qualifiers) {
  const groups = new Map();

  for (const qualifier of qualifiers) {
    if (!groups.has(qualifier.blockId)) {
      groups.set(qualifier.blockId, {
        blockId: qualifier.blockId,
        blockName: qualifier.blockName || qualifier.blockId,
        qualifiers: [],
      });
    }
    groups.get(qualifier.blockId).qualifiers.push(qualifier);
  }

  return [...groups.values()]
    .sort((a, b) => String(a.blockId).localeCompare(String(b.blockId), "ja"))
    .map((group) => ({
      ...group,
      qualifiers: [...group.qualifiers].sort((a, b) => a.blockRank - b.blockRank),
    }));
}
