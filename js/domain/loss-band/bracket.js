/**
 * loss-band 枠サイズ・ラウンド数・帯人数の一般式（純関数）
 * 枠 B ∈ {32, 64, 128}。実参加 N は (B/2, B]。
 */

/** @type {ReadonlyArray<32|64|128>} */
export const LOSS_BAND_ALLOWED_BRACKET_SIZES = Object.freeze([32, 64, 128]);

/**
 * @param {unknown} value
 * @returns {value is 32|64|128}
 */
export function isLossBandBracketSize(value) {
  return value === 32 || value === 64 || value === 128;
}

/**
 * 実参加数から枠サイズを推定。範囲外は null。
 * 17–32 → 32 / 33–64 → 64 / 65–128 → 128
 * @param {number} teamCount
 * @returns {32|64|128|null}
 */
export function resolveLossBandBracketSize(teamCount) {
  if (!Number.isInteger(teamCount)) return null;
  if (teamCount >= 17 && teamCount <= 32) return 32;
  if (teamCount >= 33 && teamCount <= 64) return 64;
  if (teamCount >= 65 && teamCount <= 128) return 128;
  return null;
}

/**
 * 枠に対する実参加数の許可範囲
 * @param {32|64|128} bracketSize
 * @returns {{ min: number, max: number }}
 */
export function teamCountRangeForBracketSize(bracketSize) {
  if (!isLossBandBracketSize(bracketSize)) {
    const error = new Error(`invalid bracketSize: ${bracketSize}`);
    error.code = "loss-band/invalid-bracket-size";
    throw error;
  }
  return { min: bracketSize / 2 + 1, max: bracketSize };
}

/**
 * @param {number} teamCount
 * @param {32|64|128|null|undefined} [explicitBracketSize]
 * @returns {{
 *   valid: true,
 *   bracketSize: 32|64|128,
 *   teamCount: number,
 *   min: number,
 *   max: number
 * } | {
 *   valid: false,
 *   error: string,
 *   code: string
 * }}
 */
export function resolveAndValidateLossBandSize(teamCount, explicitBracketSize) {
  if (!Number.isInteger(teamCount) || teamCount < 1) {
    return {
      valid: false,
      error: `teamCount must be a positive integer, got ${teamCount}`,
      code: "loss-band/invalid-team-count",
    };
  }

  /** @type {32|64|128|null} */
  let bracketSize = null;
  if (explicitBracketSize != null) {
    if (!isLossBandBracketSize(explicitBracketSize)) {
      return {
        valid: false,
        error: `bracketSize must be 32, 64, or 128, got ${explicitBracketSize}`,
        code: "loss-band/invalid-bracket-size",
      };
    }
    bracketSize = explicitBracketSize;
  } else {
    bracketSize = resolveLossBandBracketSize(teamCount);
    if (bracketSize == null) {
      return {
        valid: false,
        error: `teamCount ${teamCount} is outside loss-band ranges (17–32 / 33–64 / 65–128)`,
        code: "loss-band/invalid-team-count",
      };
    }
  }

  const { min, max } = teamCountRangeForBracketSize(bracketSize);
  if (teamCount < min || teamCount > max) {
    return {
      valid: false,
      error: `teamCount ${teamCount} is not valid for bracketSize ${bracketSize} (expected ${min}–${max})`,
      code: "loss-band/team-count-bracket-mismatch",
    };
  }

  return { valid: true, bracketSize, teamCount, min, max };
}

/**
 * 順位決定ラウンド数（決勝を含まない）
 * @param {32|64|128} bracketSize
 */
export function rankingRoundCount(bracketSize) {
  if (!isLossBandBracketSize(bracketSize)) {
    const error = new Error(`invalid bracketSize: ${bracketSize}`);
    error.code = "loss-band/invalid-bracket-size";
    throw error;
  }
  return Math.log2(bracketSize) - 1;
}

/**
 * 決勝ラウンド番号（表示・識別用）
 * @param {32|64|128} bracketSize
 */
export function finalRoundNumber(bracketSize) {
  return rankingRoundCount(bracketSize) + 1;
}

/**
 * 3位決定戦ラウンド番号（表示・識別用）
 * @param {32|64|128} bracketSize
 */
export function thirdPlaceRoundNumber(bracketSize) {
  return rankingRoundCount(bracketSize) + 2;
}

/**
 * 標準最低保証実試合数 = rankingRoundCount(B)
 * @param {32|64|128} bracketSize
 */
export function defaultGuaranteedMatchCount(bracketSize) {
  return rankingRoundCount(bracketSize);
}

/**
 * @param {number} n
 * @param {number} k
 */
export function binomialCoefficient(n, k) {
  if (!Number.isInteger(n) || !Number.isInteger(k) || n < 0 || k < 0 || k > n) {
    return 0;
  }
  let result = 1;
  for (let i = 1; i <= k; i += 1) {
    result = (result * (n - i + 1)) / i;
  }
  return result;
}

/**
 * BYEなし・枠ちょうど時のラウンド開始帯人数
 * count(L) = C(r-1, L) * B / 2^(r-1)  (L = 0..r-1)
 * @param {32|64|128} bracketSize
 * @param {number} roundNumber 1-based ranking round
 * @returns {Record<number, number>|null} round が範囲外なら null
 */
export function expectedBandCountsAtRoundStart(bracketSize, roundNumber) {
  if (!isLossBandBracketSize(bracketSize)) {
    const error = new Error(`invalid bracketSize: ${bracketSize}`);
    error.code = "loss-band/invalid-bracket-size";
    throw error;
  }
  const maxRound = rankingRoundCount(bracketSize);
  if (
    !Number.isInteger(roundNumber) ||
    roundNumber < 1 ||
    roundNumber > maxRound
  ) {
    return null;
  }
  const unit = bracketSize / 2 ** (roundNumber - 1);
  /** @type {Record<number, number>} */
  const counts = {};
  for (let lossCount = 0; lossCount <= roundNumber - 1; lossCount += 1) {
    counts[lossCount] = binomialCoefficient(roundNumber - 1, lossCount) * unit;
  }
  return counts;
}

/**
 * 全順位決定ラウンドの帯期待値マップ（BYEなし）
 * @param {32|64|128} bracketSize
 * @returns {Record<number, Record<number, number>>}
 */
export function buildExpectedBandCountsTable(bracketSize) {
  const maxRound = rankingRoundCount(bracketSize);
  /** @type {Record<number, Record<number, number>>} */
  const table = {};
  for (let r = 1; r <= maxRound; r += 1) {
    table[r] = expectedBandCountsAtRoundStart(bracketSize, r);
  }
  return table;
}

/**
 * state から bracketSize を解決（未設定時は teamCount から推定）
 * @param {object|null|undefined} state
 * @returns {32|64|128}
 */
export function bracketSizeFromState(state) {
  if (isLossBandBracketSize(state?.bracketSize)) {
    return state.bracketSize;
  }
  const teamCount = state?.teamCount;
  const resolved = resolveLossBandBracketSize(teamCount);
  if (resolved == null) {
    const error = new Error(
      `cannot resolve bracketSize from state (teamCount=${teamCount})`
    );
    error.code = "loss-band/invalid-bracket-size";
    throw error;
  }
  return resolved;
}

/**
 * @param {object|null|undefined} state
 */
export function rankingRoundCountFromState(state) {
  return rankingRoundCount(bracketSizeFromState(state));
}
