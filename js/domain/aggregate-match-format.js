/**
 * 試合形式（1対1セット先取 / 複数チーム2セット合計）
 * finalsMatchRules とは分離する。
 */

export const MatchFormat = {
  HEAD_TO_HEAD_SETS: "headToHeadSets",
  MULTI_TEAM_TOTAL: "multiTeamTotal",
};

export const AGGREGATE_SET_COUNT = 2;
export const AGGREGATE_SCORE_MIN = 0;
export const AGGREGATE_SCORE_MAX = 50;
export const AGGREGATE_TEAM_COUNTS = [2, 3, 4];
export const AGGREGATE_QUALIFIER_COUNTS = [1, 2];

export const AggregateRankingMethod = {
  TOTAL_SCORE_DESC: "totalScoreDesc",
};

export const AggregateTieBreakMethod = {
  MANUAL: "manual",
};

/**
 * @param {unknown} value
 * @returns {"headToHeadSets"|"multiTeamTotal"}
 */
export function resolveMatchFormat(value) {
  if (value === MatchFormat.MULTI_TEAM_TOTAL) {
    return MatchFormat.MULTI_TEAM_TOTAL;
  }
  return MatchFormat.HEAD_TO_HEAD_SETS;
}

/**
 * 大会の「上位/一発」側が複数チーム形式か（レガシー matchFormat または bracketMatchConfig.main）
 * @param {object|null|undefined} tournament
 */
export function isMultiTeamTotalFormat(tournament) {
  const nestedMain =
    tournament?.bracketMatchConfig?.main?.matchFormat ??
    tournament?.bracketMatchConfig?.upper?.matchFormat;
  return (
    resolveMatchFormat(nestedMain ?? tournament?.matchFormat) === MatchFormat.MULTI_TEAM_TOTAL
  );
}

/**
 * @param {object|null|undefined} input
 * @returns {{ teamCount: number, setCount: number, qualifiersCount: number, rankingMethod: string, tieBreakMethod: string }}
 */
export function normalizeAggregateMatchRules(input = {}) {
  const raw = input?.aggregateMatchRules && typeof input.aggregateMatchRules === "object"
    ? input.aggregateMatchRules
    : input;
  const teamCount = Number(raw?.teamCount);
  const qualifiersCount = Number(raw?.qualifiersCount);
  return {
    teamCount: AGGREGATE_TEAM_COUNTS.includes(teamCount) ? teamCount : 4,
    setCount: AGGREGATE_SET_COUNT,
    qualifiersCount: AGGREGATE_QUALIFIER_COUNTS.includes(qualifiersCount) ? qualifiersCount : 2,
    rankingMethod: AggregateRankingMethod.TOTAL_SCORE_DESC,
    tieBreakMethod: AggregateTieBreakMethod.MANUAL,
  };
}

/**
 * @param {object|null|undefined} input
 * @returns {{ valid: boolean, values?: object, errors?: Record<string, string>, message?: string }}
 */
export function validateAggregateMatchRulesInput(input = {}) {
  const errors = {};
  const teamCount = Number(input.teamCount ?? input.aggregateMatchRules?.teamCount);
  const qualifiersCount = Number(
    input.qualifiersCount ?? input.aggregateMatchRules?.qualifiersCount
  );
  const setCount = Number(input.setCount ?? input.aggregateMatchRules?.setCount ?? AGGREGATE_SET_COUNT);

  if (!AGGREGATE_TEAM_COUNTS.includes(teamCount)) {
    errors.teamCount = "1試合のチーム数は2〜4を選択してください。";
  }
  if (setCount !== AGGREGATE_SET_COUNT) {
    errors.setCount = "セット数は2固定です。";
  }
  if (!Number.isInteger(qualifiersCount) || qualifiersCount < 1) {
    errors.qualifiersCount = "勝ち抜けチーム数を選択してください。";
  } else if (Number.isInteger(teamCount) && qualifiersCount >= teamCount) {
    errors.qualifiersCount = "勝ち抜けチーム数は1試合のチーム数より少なくしてください。";
  } else if (!AGGREGATE_QUALIFIER_COUNTS.includes(qualifiersCount)) {
    errors.qualifiersCount = "勝ち抜けチーム数は1または2を選択してください。";
  }

  if (Object.keys(errors).length > 0) {
    return {
      valid: false,
      errors,
      values: null,
      message: "複数チーム試合の設定を確認してください。",
    };
  }

  return {
    valid: true,
    errors: {},
    values: {
      matchFormat: MatchFormat.MULTI_TEAM_TOTAL,
      aggregateMatchRules: {
        teamCount,
        setCount: AGGREGATE_SET_COUNT,
        qualifiersCount,
        rankingMethod: AggregateRankingMethod.TOTAL_SCORE_DESC,
        tieBreakMethod: AggregateTieBreakMethod.MANUAL,
      },
    },
  };
}

/**
 * @param {string|null|undefined} matchFormat
 */
export function getMatchFormatLabel(matchFormat) {
  if (resolveMatchFormat(matchFormat) === MatchFormat.MULTI_TEAM_TOTAL) {
    return "複数チーム 2セット合計";
  }
  return "1対1 セット先取";
}

/**
 * 構造ロック後に aggregate / matchFormat を変更してはいけない
 * @param {object|null|undefined} signals
 */
export function isAggregateMatchRulesLocked(signals = {}) {
  return Boolean(
    signals?.hasMaterialFinalsBracket ||
      signals?.hasFinalsBracket ||
      signals?.hasFinalsMatchResults ||
      signals?.hasConsolationBracket ||
      signals?.hasConsolationMatchResults
  );
}
