/**
 * ブロック数・配分・通過設定の検証（DOM / Firestore 非依存）
 */

export const ALLOWED_BLOCK_COUNTS = [4, 8, 16, 32];

export const INITIAL_QUALIFIERS_PER_BLOCK = [1, 2];

/** 決勝トーナメント枠数（大会設定で選択可能） */
export const ALLOWED_FINAL_TEAM_COUNTS = [4, 8, 16, 32];

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
 * @param {number} finalTeamCount
 */
export function isAllowedFinalTeamCount(finalTeamCount) {
  return Number.isInteger(finalTeamCount) && ALLOWED_FINAL_TEAM_COUNTS.includes(finalTeamCount);
}

/**
 * 自動通過・ワイルドカード・決勝枠の計算
 * @param {{
 *   blockCount: number,
 *   qualifiersPerBlock: number,
 *   finalTeamCount: number,
 *   teamCount?: number|null,
 * }} params
 */
export function computeQualifyingAdvancementCounts({
  blockCount,
  qualifiersPerBlock,
  finalTeamCount,
  teamCount = null,
}) {
  const errors = [];

  if (!isAllowedBlockCount(blockCount)) {
    errors.push(`ブロック数は ${ALLOWED_BLOCK_COUNTS.join(" / ")} から選択してください。`);
  }
  if (qualifiersPerBlock !== 1 && qualifiersPerBlock !== 2) {
    errors.push("各ブロック自動通過順位は 1 または 2 を選択してください。");
  }
  if (!isAllowedFinalTeamCount(finalTeamCount)) {
    errors.push(
      `決勝トーナメント枠数は ${ALLOWED_FINAL_TEAM_COUNTS.join(" / ")} から選択してください。`
    );
  }

  if (errors.length > 0) {
    return {
      valid: false,
      errors,
      autoPassCount: null,
      wildcardCount: null,
      finalTeamCount: isAllowedFinalTeamCount(finalTeamCount) ? finalTeamCount : null,
    };
  }

  const autoPassCount = blockCount * qualifiersPerBlock;
  if (autoPassCount > finalTeamCount) {
    return {
      valid: false,
      errors: [
        `自動通過 ${autoPassCount} チームが決勝枠 ${finalTeamCount} チームを超えています。`,
      ],
      autoPassCount,
      wildcardCount: null,
      finalTeamCount,
    };
  }

  if (Number.isInteger(teamCount) && teamCount >= 1 && finalTeamCount > teamCount) {
    return {
      valid: false,
      errors: [
        `決勝枠 ${finalTeamCount} チームが参加チーム数 ${teamCount} を超えています。`,
      ],
      autoPassCount,
      wildcardCount: null,
      finalTeamCount,
    };
  }

  return {
    valid: true,
    errors: [],
    autoPassCount,
    wildcardCount: finalTeamCount - autoPassCount,
    finalTeamCount,
  };
}

/**
 * 既存大会の finalTeamCount 補完方針:
 * 1. 保存済み finalTeamCount が 4/8/16/32 ならそれを使用
 * 2. 未設定なら autoPass = blockCount × qualifiersPerBlock を使用
 *    - 通常は 4/8/16/32 のいずれか（= WC0 の従来挙動）
 *    - 32ブロック×2位通過のみ autoPass=64。既存互換のため 64 を返す（新規UIでは選択不可）
 * 3. 新規作成・設定変更では必ず 4/8/16/32 を保存し、autoPass ≤ finalTeamCount を強制
 *
 * @param {{ blockCount?: number|null, qualifiersPerBlock?: number|null, finalTeamCount?: number|null }} tournamentLike
 * @returns {number|null}
 */
export function resolveStoredOrDerivedFinalTeamCount(tournamentLike) {
  if (isAllowedFinalTeamCount(tournamentLike?.finalTeamCount)) {
    return tournamentLike.finalTeamCount;
  }
  const blockCount = tournamentLike?.blockCount;
  const qualifiersPerBlock = tournamentLike?.qualifiersPerBlock;
  if (
    isAllowedBlockCount(blockCount) &&
    (qualifiersPerBlock === 1 || qualifiersPerBlock === 2)
  ) {
    return blockCount * qualifiersPerBlock;
  }
  return null;
}

/**
 * 既存補完値を含む進出数の内訳（新規バリデーションより緩い）
 * @param {{ blockCount: number, qualifiersPerBlock: number, finalTeamCount: number }} params
 */
export function describeQualifyingAdvancementCounts({
  blockCount,
  qualifiersPerBlock,
  finalTeamCount,
}) {
  if (
    !isAllowedBlockCount(blockCount) ||
    (qualifiersPerBlock !== 1 && qualifiersPerBlock !== 2) ||
    !Number.isInteger(finalTeamCount) ||
    finalTeamCount < 1
  ) {
    return {
      valid: false,
      autoPassCount: null,
      wildcardCount: null,
      finalTeamCount: null,
    };
  }
  const autoPassCount = blockCount * qualifiersPerBlock;
  if (autoPassCount > finalTeamCount) {
    return {
      valid: false,
      autoPassCount,
      wildcardCount: null,
      finalTeamCount,
    };
  }
  return {
    valid: true,
    autoPassCount,
    wildcardCount: finalTeamCount - autoPassCount,
    finalTeamCount,
  };
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
 * @param {{ teamCount: number, blockCount: number, qualifiersPerBlock: number, finalTeamCount?: number|null }} params
 */
export function buildQualifyingConfigurationPreview({
  teamCount,
  blockCount,
  qualifiersPerBlock,
  finalTeamCount = null,
}) {
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
      autoPassCount: validation.qualifierCount,
      wildcardCount: null,
      finalTeamCount: null,
    };
  }

  const { distribution, qualifierCount } = validation;
  const resolvedFinalTeamCount =
    finalTeamCount == null
      ? resolveStoredOrDerivedFinalTeamCount({
          blockCount,
          qualifiersPerBlock,
          finalTeamCount: null,
        })
      : finalTeamCount;

  const advancement = computeQualifyingAdvancementCounts({
    blockCount,
    qualifiersPerBlock,
    finalTeamCount: resolvedFinalTeamCount,
    teamCount,
  });

  // 既存補完で 64 など ALLOWED 外が出る場合は describe で内訳のみ返す
  if (!advancement.valid && !isAllowedFinalTeamCount(resolvedFinalTeamCount)) {
    const described = describeQualifyingAdvancementCounts({
      blockCount,
      qualifiersPerBlock,
      finalTeamCount: resolvedFinalTeamCount,
    });
    if (described.valid) {
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
        qualifierCount: described.finalTeamCount,
        autoPassCount: described.autoPassCount,
        wildcardCount: described.wildcardCount,
        finalTeamCount: described.finalTeamCount,
      };
    }
  }

  if (!advancement.valid) {
    return {
      valid: false,
      errors: advancement.errors,
      blockCount,
      minBlockSize: distribution.minBlockSize,
      maxBlockSize: distribution.maxBlockSize,
      largerBlockCount: distribution.largerBlockCount,
      smallerBlockCount: distribution.smallerBlockCount,
      largerBlockTeamSize: distribution.maxBlockSize,
      smallerBlockTeamSize: distribution.minBlockSize,
      qualifierCount: advancement.finalTeamCount ?? qualifierCount,
      autoPassCount: advancement.autoPassCount,
      wildcardCount: advancement.wildcardCount,
      finalTeamCount: advancement.finalTeamCount,
    };
  }

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
    qualifierCount: advancement.finalTeamCount,
    autoPassCount: advancement.autoPassCount,
    wildcardCount: advancement.wildcardCount,
    finalTeamCount: advancement.finalTeamCount,
  };
}
