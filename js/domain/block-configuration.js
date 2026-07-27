/**
 * ブロック数・配分・通過設定の検証（DOM / Firestore 非依存）
 */

export const ALLOWED_BLOCK_COUNTS = [4, 8, 16, 32];

export const INITIAL_QUALIFIERS_PER_BLOCK = [1, 2];

export const SUPPORTED_FINALS_BRACKET_SIZES = [4, 8, 16, 32, 64];

export const MIN_TEAMS_PER_BLOCK = 3;

export const MAX_TEAMS_PER_BLOCK = 8;

/**
 * @param {number} blockCount
 */
export function isAllowedBlockCount(blockCount) {
  return Number.isInteger(blockCount) && ALLOWED_BLOCK_COUNTS.includes(blockCount);
}

/**
 * @param {number} teamCount
 * @param {number} blockCount
 * @returns {{
 *   baseSize: number,
 *   largerBlockCount: number,
 *   smallerBlockCount: number,
 *   minBlockSize: number,
 *   maxBlockSize: number,
 * }}
 */
export function calculateBlockDistribution(teamCount, blockCount) {
  const baseSize = Math.floor(teamCount / blockCount);
  const largerBlockCount = teamCount % blockCount;
  const smallerBlockCount = blockCount - largerBlockCount;
  const maxBlockSize = largerBlockCount > 0 ? baseSize + 1 : baseSize;

  return {
    baseSize,
    largerBlockCount,
    smallerBlockCount,
    minBlockSize: baseSize,
    maxBlockSize,
  };
}

/**
 * @param {number|null|undefined} qualifiersPerBlock
 */
function isInitialQualifiersPerBlock(qualifiersPerBlock) {
  return (
    qualifiersPerBlock === 1 ||
    qualifiersPerBlock === 2
  );
}

/**
 * @param {{ teamCount: number, blockCount: number, qualifiersPerBlock?: number|null }} params
 * @returns {{
 *   valid: boolean,
 *   errors: string[],
 *   warnings: string[],
 *   distribution: ReturnType<typeof calculateBlockDistribution> | null,
 *   qualifierCount: number | null,
 *   minBlockSize: number | null,
 *   maxBlockSize: number | null,
 * }}
 */
export function validateBlockConfiguration({ teamCount, blockCount, qualifiersPerBlock = null }) {
  const errors = [];
  const warnings = [];

  if (!Number.isInteger(teamCount) || teamCount < 1) {
    errors.push("teamCount は 1 以上の整数である必要があります。");
  }

  if (!isAllowedBlockCount(blockCount)) {
    errors.push(`blockCount は ${ALLOWED_BLOCK_COUNTS.join(" / ")} のいずれかである必要があります。`);
  }

  let distribution = null;
  let minBlockSize = null;
  let maxBlockSize = null;
  let qualifierCount = null;

  if (
    Number.isInteger(teamCount) &&
    teamCount >= 1 &&
    isAllowedBlockCount(blockCount)
  ) {
    distribution = calculateBlockDistribution(teamCount, blockCount);
    minBlockSize = distribution.minBlockSize;
    maxBlockSize = distribution.maxBlockSize;

    if (teamCount < blockCount * MIN_TEAMS_PER_BLOCK) {
      errors.push(
        `teamCount (${teamCount}) は blockCount × ${MIN_TEAMS_PER_BLOCK} (${blockCount * MIN_TEAMS_PER_BLOCK}) 以上である必要があります。`
      );
    }

    if (maxBlockSize > MAX_TEAMS_PER_BLOCK) {
      errors.push(
        `最大ブロック人数 (${maxBlockSize}) は ${MAX_TEAMS_PER_BLOCK} 以下である必要があります。`
      );
    }

    if (qualifiersPerBlock != null) {
      if (!isInitialQualifiersPerBlock(qualifiersPerBlock)) {
        errors.push(
          `qualifiersPerBlock は ${INITIAL_QUALIFIERS_PER_BLOCK.join(" または ")} である必要があります。`
        );
      } else if (qualifiersPerBlock >= minBlockSize) {
        errors.push(
          `qualifiersPerBlock (${qualifiersPerBlock}) は最小ブロック人数 (${minBlockSize}) 未満である必要があります。`
        );
      }

      if (isInitialQualifiersPerBlock(qualifiersPerBlock)) {
        qualifierCount = blockCount * qualifiersPerBlock;
        if (!SUPPORTED_FINALS_BRACKET_SIZES.includes(qualifierCount)) {
          errors.push(
            `決勝進出数 (${qualifierCount}) は ${SUPPORTED_FINALS_BRACKET_SIZES.join(" / ")} のいずれかである必要があります。`
          );
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    distribution,
    qualifierCount,
    minBlockSize,
    maxBlockSize,
  };
}

/**
 * 予選＋決勝の設定プレビュー（フォーム表示用）
 * @param {{ teamCount: number, blockCount: number, qualifiersPerBlock: number }} params
 */
export function buildQualifyingConfigurationPreview({ teamCount, blockCount, qualifiersPerBlock }) {
  const validation = validateBlockConfiguration({ teamCount, blockCount, qualifiersPerBlock });
  if (!validation.valid || !validation.distribution) {
    return {
      valid: false,
      errors: validation.errors,
      blockCount,
      minBlockSize: validation.minBlockSize,
      maxBlockSize: validation.maxBlockSize,
      largerBlockCount: validation.distribution?.largerBlockCount ?? null,
      smallerBlockCount: validation.distribution?.smallerBlockCount ?? null,
      qualifierCount: validation.qualifierCount,
    };
  }

  const { distribution, qualifierCount } = validation;

  return {
    valid: true,
    errors: [],
    blockCount,
    minBlockSize: distribution.minBlockSize,
    maxBlockSize: distribution.maxBlockSize,
    largerBlockCount: distribution.largerBlockCount,
    smallerBlockCount: distribution.smallerBlockCount,
    largerBlockTeamSize: distribution.maxBlockSize,
    smallerBlockTeamSize: distribution.minBlockSize,
    qualifierCount,
  };
}
