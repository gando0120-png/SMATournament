/**
 * ワイルドカード比較モード（raw / normalized）
 * DOM / Firestore 非依存
 */

export const WildcardComparisonMode = {
  RAW: "raw",
  NORMALIZED: "normalized",
};

export const ALLOWED_WILDCARD_COMPARISON_MODES = [
  WildcardComparisonMode.RAW,
  WildcardComparisonMode.NORMALIZED,
];

/**
 * 未設定・不正値は既存挙動の raw
 * @param {unknown} value
 * @returns {"raw"|"normalized"}
 */
export function resolveWildcardComparisonMode(value) {
  return value === WildcardComparisonMode.NORMALIZED
    ? WildcardComparisonMode.NORMALIZED
    : WildcardComparisonMode.RAW;
}

/**
 * @param {unknown} value
 */
export function isAllowedWildcardComparisonMode(value) {
  return ALLOWED_WILDCARD_COMPARISON_MODES.includes(value);
}

/**
 * WC がある新設定では normalized を推奨（試合数差の公平性）
 * @param {{ wildcardCount?: number|null }} params
 * @returns {"raw"|"normalized"}
 */
export function recommendWildcardComparisonMode({ wildcardCount = 0 } = {}) {
  return Number(wildcardCount) > 0
    ? WildcardComparisonMode.NORMALIZED
    : WildcardComparisonMode.RAW;
}

/**
 * @param {object} entry
 * @returns {number}
 */
export function computePlayedSets(entry) {
  const wins = Number(entry?.setWins) || 0;
  const draws = Number(entry?.setDraws) || 0;
  const losses = Number(entry?.setLosses) || 0;
  return wins + draws + losses;
}

/**
 * セット勝率（比較用。丸めない）
 * @param {object} entry
 * @returns {number}
 */
export function computeNormalizedSetWinRate(entry) {
  const playedSets = computePlayedSets(entry);
  if (playedSets <= 0) {
    return 0;
  }
  return (Number(entry?.setWins) || 0) / playedSets;
}

/**
 * 1試合あたり平均得点（比較用。丸めない）
 * @param {object} entry
 * @returns {number}
 */
export function computeAverageScorePerMatch(entry) {
  const playedMatches = Number(entry?.playedMatches) || 0;
  if (playedMatches <= 0) {
    return 0;
  }
  return (Number(entry?.totalScore) || 0) / playedMatches;
}

/**
 * 表示用セット勝率（例: 75.0）
 * @param {number} rate
 * @param {number} [digits=1]
 */
export function formatSetWinRatePercent(rate, digits = 1) {
  if (!Number.isFinite(rate)) {
    return "—";
  }
  return `${(rate * 100).toFixed(digits)}%`;
}

/**
 * 表示用平均得点（例: 88.5）
 * @param {number} average
 * @param {number} [digits=1]
 */
export function formatAverageScore(average, digits = 1) {
  if (!Number.isFinite(average)) {
    return "—";
  }
  return average.toFixed(digits);
}

/**
 * raw: 既存どおり setWins → setDraws → totalScore
 * @param {object} a
 * @param {object} b
 */
export function compareWildcardCandidatesRaw(a, b) {
  if (b.setWins !== a.setWins) {
    return b.setWins - a.setWins;
  }
  if (b.setDraws !== a.setDraws) {
    return b.setDraws - a.setDraws;
  }
  if (b.totalScore !== a.totalScore) {
    return b.totalScore - a.totalScore;
  }
  return 0;
}

/**
 * normalized: セット勝率 → 平均得点
 * @param {object} a
 * @param {object} b
 */
export function compareWildcardCandidatesNormalized(a, b) {
  const rateA = a.setWinRate ?? computeNormalizedSetWinRate(a);
  const rateB = b.setWinRate ?? computeNormalizedSetWinRate(b);
  if (rateB !== rateA) {
    return rateB - rateA;
  }
  const avgA = a.averageScore ?? computeAverageScorePerMatch(a);
  const avgB = b.averageScore ?? computeAverageScorePerMatch(b);
  if (avgB !== avgA) {
    return avgB - avgA;
  }
  return 0;
}

/**
 * @param {object} a
 * @param {object} b
 * @param {"raw"|"normalized"} mode
 */
export function compareWildcardCandidates(a, b, mode) {
  return resolveWildcardComparisonMode(mode) === WildcardComparisonMode.NORMALIZED
    ? compareWildcardCandidatesNormalized(a, b)
    : compareWildcardCandidatesRaw(a, b);
}

/**
 * @param {object} a
 * @param {object} b
 * @param {"raw"|"normalized"} mode
 */
export function areWildcardCandidatesTied(a, b, mode) {
  return compareWildcardCandidates(a, b, mode) === 0;
}

/**
 * 候補に比較用メトリクスを付与
 * @param {object} entry
 */
export function enrichWildcardCandidateMetrics(entry) {
  const setWinRate = computeNormalizedSetWinRate(entry);
  const averageScore = computeAverageScorePerMatch(entry);
  return {
    ...entry,
    playedSets: computePlayedSets(entry),
    setWinRate,
    averageScore,
  };
}

/**
 * 同一順位帯の WC 候補を比較順に並べ、進出枠で in/out を付与
 * @param {object[]} candidates
 * @param {{
 *   wildcardSlots: number,
 *   comparisonMode?: string|null,
 * }} options
 */
export function buildWildcardCandidatePreview(candidates, options = {}) {
  const mode = resolveWildcardComparisonMode(options.comparisonMode);
  const wildcardSlots = Number.isInteger(options.wildcardSlots)
    ? Math.max(0, options.wildcardSlots)
    : 0;

  const ranked = [...(candidates || [])]
    .map(enrichWildcardCandidateMetrics)
    .sort((a, b) => {
      const metric = compareWildcardCandidates(a, b, mode);
      if (metric !== 0) {
        return metric;
      }
      return String(a.teamName ?? "").localeCompare(String(b.teamName ?? ""), "ja");
    })
    .map((entry, index) => {
      const wildcardRank = index + 1;
      return {
        ...entry,
        wildcardRank,
        advances: wildcardRank <= wildcardSlots,
      };
    });

  return {
    comparisonMode: mode,
    wildcardSlots,
    candidates: ranked,
  };
}
