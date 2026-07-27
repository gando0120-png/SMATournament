/**
 * 新形式（固定 blockCount）ブロック抽選（DOM / Firestore 非依存）
 */
import {
  calculateBlockDistribution,
  validateBlockConfiguration,
  MIN_TEAMS_PER_BLOCK,
  MAX_TEAMS_PER_BLOCK,
} from "./block-configuration.js";

/**
 * 0-based index からブロック ID を生成（A〜Z, AA〜AF）
 * @param {number} index
 */
export function getFixedBlockLabel(index) {
  if (!Number.isInteger(index) || index < 0 || index >= 32) {
    return String(index);
  }
  if (index < 26) {
    return String.fromCharCode(65 + index);
  }
  return `A${String.fromCharCode(65 + (index - 26))}`;
}

/**
 * @template T
 * @param {T[]} items
 * @param {() => number} random
 */
export function shuffleArrayWithRandom(items, random = Math.random) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * 大ブロックになる block index をランダムに選ぶ
 * @param {number} blockCount
 * @param {number} largerBlockCount
 * @param {() => number} [random]
 */
export function assignLargerBlockIndices(blockCount, largerBlockCount, random = Math.random) {
  if (largerBlockCount <= 0) {
    return [];
  }
  const indices = Array.from({ length: blockCount }, (_, index) => index);
  const shuffled = shuffleArrayWithRandom(indices, random);
  return shuffled.slice(0, largerBlockCount).sort((a, b) => a - b);
}

/**
 * @param {Array<{ id: string }>} entries
 * @param {number} blockCount
 * @param {ReturnType<typeof calculateBlockDistribution>} distribution
 * @param {number[]} largerBlockIndices
 */
function buildBlocksFromDistribution(entries, blockCount, distribution, largerBlockIndices) {
  const largerIndexSet = new Set(largerBlockIndices);
  const blocks = Array.from({ length: blockCount }, (_, index) => {
    const id = getFixedBlockLabel(index);
    const targetSize = largerIndexSet.has(index)
      ? distribution.maxBlockSize
      : distribution.minBlockSize;
    return {
      id,
      name: `${id}ブロック`,
      entryIds: [],
      targetSize,
    };
  });

  let cursor = 0;
  for (const block of blocks) {
    for (let i = 0; i < block.targetSize; i += 1) {
      block.entryIds.push(entries[cursor].id);
      cursor += 1;
    }
  }

  return blocks.map(({ id, name, entryIds }) => ({ id, name, entryIds }));
}

/**
 * @param {{ entries: Array<{ id: string }>, blockCount: number, random?: () => number }} params
 */
export function distributeEntriesToFixedBlocks({ entries, blockCount, random = Math.random }) {
  const teamCount = entries.length;
  const distribution = calculateBlockDistribution(teamCount, blockCount);
  const largerBlockIndices = assignLargerBlockIndices(
    blockCount,
    distribution.largerBlockCount,
    random
  );
  const largerBlockIds = largerBlockIndices.map((index) => getFixedBlockLabel(index));
  const blocks = buildBlocksFromDistribution(
    shuffleArrayWithRandom(entries, random),
    blockCount,
    distribution,
    largerBlockIndices
  );

  return {
    blockCount,
    distribution: {
      baseSize: distribution.baseSize,
      largerBlockCount: distribution.largerBlockCount,
      smallerBlockCount: distribution.smallerBlockCount,
      minBlockSize: distribution.minBlockSize,
      maxBlockSize: distribution.maxBlockSize,
      largerBlockIds,
    },
    blocks,
  };
}

/**
 * @param {{ entries: Array<{ id: string }>, blocks: Array<{ id: string, entryIds: string[] }>, blockCount: number, distribution?: object|null }} params
 */
export function validateGeneratedBlockDraw({ entries, blocks, blockCount, distribution = null }) {
  const errors = [];
  const allowedEntryIds = new Set(entries.map((entry) => entry.id));

  if (!Array.isArray(blocks) || blocks.length !== blockCount) {
    errors.push("blocks の件数が blockCount と一致しません。");
  }

  const seenEntryIds = new Set();
  const blockSizes = [];

  for (const block of blocks || []) {
    const entryIds = block.entryIds || [];
    blockSizes.push(entryIds.length);

    if (entryIds.length === 0) {
      errors.push(`空ブロックがあります（${block.id ?? "—"}）。`);
    }

    for (const entryId of entryIds) {
      if (!allowedEntryIds.has(entryId)) {
        errors.push(`不明な entryId が含まれています（${entryId}）。`);
      }
      if (seenEntryIds.has(entryId)) {
        errors.push(`entryId が重複しています（${entryId}）。`);
      }
      seenEntryIds.add(entryId);
    }
  }

  if (seenEntryIds.size !== entries.length) {
    errors.push("確定エントリーが全件配置されていません。");
  }

  for (const entry of entries) {
    if (!seenEntryIds.has(entry.id)) {
      errors.push(`未配置の entryId があります（${entry.id}）。`);
    }
  }

  if (blockSizes.length > 0) {
    const minSize = Math.min(...blockSizes);
    const maxSize = Math.max(...blockSizes);
    if (maxSize - minSize > 1) {
      errors.push("ブロック人数差が2以上です。");
    }
    if (distribution) {
      if (minSize !== distribution.minBlockSize || maxSize !== distribution.maxBlockSize) {
        errors.push("ブロック人数が distribution と一致しません。");
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * @param {{ teamCount: number, blockCount: number, qualifiersPerBlock?: number|null, validation?: ReturnType<typeof validateBlockConfiguration> }} params
 */
export function formatBlockDrawValidationMessage({
  teamCount,
  blockCount,
  qualifiersPerBlock = null,
  validation = null,
}) {
  const result =
    validation ??
    validateBlockConfiguration({ teamCount, blockCount, qualifiersPerBlock });

  if (result.valid) {
    return null;
  }

  const requiredTeamCount = blockCount * MIN_TEAMS_PER_BLOCK;
  if (teamCount < requiredTeamCount) {
    return [
      `現在の確定チーム数では${blockCount}ブロックを作成できません。`,
      "",
      `確定チーム数：${teamCount}`,
      `必要チーム数：${requiredTeamCount}`,
      "",
      "ブロック数を変更するか、",
      "確定チーム数を増やしてください。",
    ].join("\n");
  }

  if (result.maxBlockSize != null && result.maxBlockSize > MAX_TEAMS_PER_BLOCK) {
    return [
      `${blockCount}ブロックでは1ブロックあたり最大${result.maxBlockSize}チームとなり、`,
      "予選対戦表の上限8チームを超えます。",
      "",
      "ブロック数を増やしてください。",
    ].join("\n");
  }

  return result.errors[0] ?? "ブロック抽選の条件を満たしていません。";
}

/**
 * @param {{ teamCount: number, blockCount: number, qualifiersPerBlock: number }} params
 */
export function buildBlockDrawPreviewMessage({ teamCount, blockCount, qualifiersPerBlock }) {
  const validation = validateBlockConfiguration({ teamCount, blockCount, qualifiersPerBlock });
  if (!validation.valid || !validation.distribution) {
    return formatBlockDrawValidationMessage({
      teamCount,
      blockCount,
      qualifiersPerBlock,
      validation,
    });
  }

  const { distribution, qualifierCount } = validation;
  const lines = [
    `確定${teamCount}チームを${blockCount}ブロックへ抽選します。`,
    "",
  ];

  if (distribution.largerBlockCount > 0) {
    lines.push(`${distribution.maxBlockSize}チームブロック：${distribution.largerBlockCount}`);
    lines.push(`${distribution.minBlockSize}チームブロック：${distribution.smallerBlockCount}`);
  } else {
    lines.push(`${distribution.minBlockSize}チームブロック：${blockCount}`);
  }

  lines.push(`各ブロック上位${qualifiersPerBlock}チーム通過`);
  lines.push(`決勝進出：${qualifierCount}チーム`);

  return lines.join("\n");
}
