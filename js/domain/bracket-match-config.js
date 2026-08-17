/**
 * 上位 / 下位トーナメントの試合形式設定（独立 + 後方互換）
 */
import { BracketKind } from "./bracket-collections.js";
import {
  MatchFormat,
  normalizeAggregateMatchRules,
  resolveMatchFormat,
  validateAggregateMatchRulesInput,
} from "./aggregate-match-format.js";
import {
  normalizeFinalsMatchRules,
  resolveFinalsWinsRequired,
  validateFinalsMatchRulesInput,
} from "./finals-match-format.js";
import { TournamentFormat } from "./tournament-format.js";
import { RankingMode } from "./loss-band/constants.js";
import {
  normalizeLossBandSideOptions,
  resolveRankingMode,
  validateSideRankingMode,
} from "./loss-band/config.js";

export { RankingMode } from "./loss-band/constants.js";
export {
  formatLossBandTournamentStatusLabel,
  normalizeLossBandSideOptions,
  resolveRankingMode,
  resolveMainRankingMode,
} from "./loss-band/config.js";

export const BracketMatchSide = {
  MAIN: "main",
  CONSOLATION: "consolation",
};

/**
 * @param {object|null|undefined} side
 */
function emptySide(enabled = true) {
  return {
    enabled: Boolean(enabled),
    matchFormat: MatchFormat.HEAD_TO_HEAD_SETS,
    finalsMatchRules: normalizeFinalsMatchRules({ winsRequired: 2 }),
    aggregateMatchRules: null,
  };
}

/**
 * @param {object|null|undefined} side
 * @param {{ enabledDefault?: boolean }} [options]
 */
export function normalizeBracketMatchSide(side, options = {}) {
  const enabledDefault = options.enabledDefault !== false;
  if (!side || typeof side !== "object") {
    return emptySide(enabledDefault);
  }

  const enabled = side.enabled == null ? enabledDefault : Boolean(side.enabled);
  const matchFormat = resolveMatchFormat(side.matchFormat);
  const finalsMatchRules = normalizeFinalsMatchRules({
    winsRequired: side.winsRequired ?? side.finalsMatchRules?.defaultWinsRequired,
    finalsMatchRules: side.finalsMatchRules,
  });

  const normalized = {
    enabled,
    matchFormat,
    finalsMatchRules,
    aggregateMatchRules:
      matchFormat === MatchFormat.MULTI_TEAM_TOTAL
        ? normalizeAggregateMatchRules(side.aggregateMatchRules || side)
        : null,
  };

  // rankingMode は明示時のみ保持（未設定 = single_elimination 扱い）
  if (
    side.rankingMode === RankingMode.LOSS_BAND ||
    side.rankingMode === RankingMode.SINGLE_ELIMINATION
  ) {
    normalized.rankingMode = resolveRankingMode(side.rankingMode);
  }

  if (normalized.rankingMode === RankingMode.LOSS_BAND) {
    Object.assign(normalized, normalizeLossBandSideOptions(side));
  }

  return normalized;
}

/**
 * 旧共通設定 → upper/lower 補完（読み取り専用。保存はしない）
 * @param {object|null|undefined} tournament
 */
export function normalizeBracketMatchConfig(tournament = {}) {
  const format = tournament?.tournamentFormat;
  const nested = tournament?.bracketMatchConfig;

  if (nested && typeof nested === "object") {
    const main = normalizeBracketMatchSide(nested.main ?? nested.upper, {
      enabledDefault: true,
    });
    const consolationDefaultEnabled = format === TournamentFormat.QUALIFYING_AND_FINALS;
    const consolation = normalizeBracketMatchSide(
      nested.consolation ?? nested.lower,
      { enabledDefault: consolationDefaultEnabled }
    );
    // SE では下位を常に無効
    if (format === TournamentFormat.SINGLE_ELIMINATION) {
      consolation.enabled = false;
    }
    return { main, consolation };
  }

  // 旧構造からの補完
  const legacyFormat = resolveMatchFormat(tournament?.matchFormat);
  const legacyRules = normalizeFinalsMatchRules(tournament);
  const legacyAggregate =
    legacyFormat === MatchFormat.MULTI_TEAM_TOTAL
      ? normalizeAggregateMatchRules(tournament?.aggregateMatchRules || tournament)
      : null;

  const main = {
    enabled: true,
    matchFormat: legacyFormat,
    finalsMatchRules: legacyRules,
    aggregateMatchRules: legacyAggregate,
  };

  // 下位は従来どおり QF のみ利用可能。形式は上位の H2H 設定を共有していたため H2H を既定にする。
  const consolation =
    format === TournamentFormat.QUALIFYING_AND_FINALS
      ? {
          enabled: true,
          matchFormat: MatchFormat.HEAD_TO_HEAD_SETS,
          finalsMatchRules: { ...legacyRules, roundOverrides: { ...legacyRules.roundOverrides } },
          aggregateMatchRules: null,
        }
      : emptySide(false);

  return { main, consolation };
}

/**
 * @param {object|null|undefined} tournament
 * @param {"main"|"consolation"|string} side
 */
export function resolveBracketMatchConfig(tournament, side = BracketMatchSide.MAIN) {
  const config = normalizeBracketMatchConfig(tournament);
  if (side === BracketMatchSide.CONSOLATION || side === BracketKind.CONSOLATION || side === "lower") {
    return config.consolation;
  }
  return config.main;
}

/**
 * @param {object|null|undefined} tournament
 * @param {"main"|"consolation"|string} [side]
 */
export function isBracketSideMultiTeam(tournament, side = BracketMatchSide.MAIN) {
  return resolveBracketMatchConfig(tournament, side).matchFormat === MatchFormat.MULTI_TEAM_TOTAL;
}

/**
 * SE 互換: 大会全体の matchFormat（main を参照）
 * @param {object|null|undefined} tournament
 */
export function isMultiTeamTotalFormatCompat(tournament) {
  return isBracketSideMultiTeam(tournament, BracketMatchSide.MAIN);
}

/**
 * @param {object} side
 * @param {{ label: string, requiredEnabled?: boolean, allowLossBand?: boolean, teamCount?: number|null }} options
 */
export function validateBracketMatchSideInput(side, options = {}) {
  const label = options.label || "トーナメント";
  const allowLossBand = options.allowLossBand !== false;
  const errors = {};
  const enabled = side?.enabled !== false;

  if (options.requiredEnabled && !enabled) {
    errors.enabled = `${label}は実施する必要があります。`;
    return { valid: false, errors, values: null, message: `${label}の設定を確認してください。` };
  }

  if (!enabled) {
    return {
      valid: true,
      errors: {},
      values: emptySide(false),
      message: null,
    };
  }

  const rankingCheck = validateSideRankingMode(side, {
    label,
    allowLossBand,
    teamCount: options.teamCount,
  });
  if (!rankingCheck.valid) {
    return rankingCheck;
  }

  const matchFormat = resolveMatchFormat(side?.matchFormat);
  if (matchFormat === MatchFormat.MULTI_TEAM_TOTAL) {
    const agg = validateAggregateMatchRulesInput({
      teamCount: side?.teamCount ?? side?.aggregateMatchRules?.teamCount,
      qualifiersCount: side?.qualifiersCount ?? side?.aggregateMatchRules?.qualifiersCount,
      setCount: side?.setCount ?? side?.aggregateMatchRules?.setCount,
      aggregateMatchRules: side?.aggregateMatchRules,
    });
    if (!agg.valid) {
      if (agg.errors?.teamCount) {
        errors.teamCount = `${label}の1試合のチーム数を選択してください。`;
      }
      if (agg.errors?.qualifiersCount) {
        errors.qualifiersCount = `${label}の通過数は、1試合のチーム数未満にしてください。`;
      }
      if (agg.errors?.setCount) {
        errors.setCount = `${label}のセット数は2固定です。`;
      }
      return {
        valid: false,
        errors,
        values: null,
        message: `${label}の複数チーム設定を確認してください。`,
      };
    }
    const multiValues = {
      enabled: true,
      matchFormat: MatchFormat.MULTI_TEAM_TOTAL,
      finalsMatchRules: normalizeFinalsMatchRules({ winsRequired: 2 }),
      aggregateMatchRules: agg.values.aggregateMatchRules,
    };
    if (rankingCheck.values.rankingMode === RankingMode.LOSS_BAND) {
      multiValues.rankingMode = RankingMode.LOSS_BAND;
    } else if (side?.rankingMode === RankingMode.SINGLE_ELIMINATION) {
      multiValues.rankingMode = RankingMode.SINGLE_ELIMINATION;
    }
    return {
      valid: true,
      errors: {},
      values: multiValues,
      message: null,
    };
  }

  const overrideSource =
    side?.roundOverrides ?? side?.finalsMatchRules?.roundOverrides ?? {};
  const h2h = validateFinalsMatchRulesInput({
    defaultWinsRequired:
      side?.defaultWinsRequired ??
      side?.winsRequired ??
      side?.finalsMatchRules?.defaultWinsRequired,
    useRoundOverrides:
      side?.useRoundOverrides ?? Object.keys(overrideSource).length > 0,
    roundOverrides: overrideSource,
    finalsMatchRules: side?.finalsMatchRules,
  });
  if (!h2h.valid) {
    if (h2h.errors) {
      for (const [key, message] of Object.entries(h2h.errors)) {
        errors[key] = `${label}の${message}`;
      }
    }
    return {
      valid: false,
      errors: Object.keys(errors).length
        ? errors
        : { winsRequired: `${label}の勝利条件を確認してください。` },
      values: null,
      message: h2h.message || `${label}の勝利条件を確認してください。`,
    };
  }

  /** @type {Record<string, unknown>} */
  const values = {
    enabled: true,
    matchFormat: MatchFormat.HEAD_TO_HEAD_SETS,
    finalsMatchRules: h2h.values.finalsMatchRules,
    aggregateMatchRules: null,
    winsRequired: h2h.values.winsRequired,
  };

  if (rankingCheck.values.rankingMode === RankingMode.LOSS_BAND) {
    values.rankingMode = RankingMode.LOSS_BAND;
    values.rematchAvoidance = rankingCheck.values.rematchAvoidance === true;
    values.thirdPlaceMatch = rankingCheck.values.thirdPlaceMatch === true;
    values.exchangeMatches = rankingCheck.values.exchangeMatches === true;
    values.guaranteedMatchCount = rankingCheck.values.guaranteedMatchCount;
  } else if (side?.rankingMode === RankingMode.SINGLE_ELIMINATION) {
    values.rankingMode = RankingMode.SINGLE_ELIMINATION;
  }

  return {
    valid: true,
    errors: {},
    values,
    message: null,
  };
}

/**
 * 作成/編集入力から bracketMatchConfig とレガシーミラーを構築
 * @param {object} input
 * @param {string} tournamentFormat
 */
export function buildBracketMatchConfigForSave(input, tournamentFormat) {
  if (tournamentFormat === TournamentFormat.SINGLE_ELIMINATION) {
    const matchFormat = resolveMatchFormat(input.matchFormat);
    const rankingMode =
      input.rankingMode ?? input.bracketMatchConfig?.main?.rankingMode;
    const lossBandFields = {
      rematchAvoidance:
        input.rematchAvoidance ?? input.bracketMatchConfig?.main?.rematchAvoidance,
      thirdPlaceMatch:
        input.thirdPlaceMatch ?? input.bracketMatchConfig?.main?.thirdPlaceMatch,
      exchangeMatches:
        input.exchangeMatches ?? input.bracketMatchConfig?.main?.exchangeMatches,
      guaranteedMatchCount:
        input.guaranteedMatchCount ??
        input.bracketMatchConfig?.main?.guaranteedMatchCount,
    };
    const bracketTeamCount = Number.parseInt(String(input.maxTeams ?? ""), 10);
    const mainResult =
      matchFormat === MatchFormat.MULTI_TEAM_TOTAL
        ? validateBracketMatchSideInput(
            {
              enabled: true,
              matchFormat: MatchFormat.MULTI_TEAM_TOTAL,
              ...input,
              rankingMode,
              aggregateMatchRules: input.aggregateMatchRules,
            },
            {
              label: "トーナメント",
              requiredEnabled: true,
              allowLossBand: true,
              teamCount: bracketTeamCount,
            }
          )
        : validateBracketMatchSideInput(
            {
              enabled: true,
              matchFormat: MatchFormat.HEAD_TO_HEAD_SETS,
              winsRequired: input.winsRequired,
              defaultWinsRequired: input.defaultWinsRequired ?? input.winsRequired,
              useRoundOverrides: input.useRoundOverrides,
              roundOverrides: input.roundOverrides,
              finalsMatchRules: input.finalsMatchRules,
              rankingMode,
              ...lossBandFields,
            },
            {
              label: "トーナメント",
              requiredEnabled: true,
              allowLossBand: true,
              teamCount: bracketTeamCount,
            }
          );

    if (!mainResult.valid) {
      return { valid: false, errors: mainResult.errors, values: null, message: mainResult.message };
    }

    const config = {
      main: mainResult.values,
      consolation: emptySide(false),
    };
    return {
      valid: true,
      errors: {},
      values: {
        bracketMatchConfig: config,
        // レガシーミラー
        matchFormat: config.main.matchFormat,
        aggregateMatchRules: config.main.aggregateMatchRules,
        winsRequired:
          config.main.matchFormat === MatchFormat.HEAD_TO_HEAD_SETS
            ? config.main.finalsMatchRules.defaultWinsRequired
            : 2,
        finalsMatchRules: config.main.finalsMatchRules,
      },
      message: null,
    };
  }

  // qualifying_and_finals
  const mainInput = input.bracketMatchConfig?.main || input.mainBracketMatch || {
    enabled: input.mainEnabled !== false,
    matchFormat: input.mainMatchFormat ?? MatchFormat.HEAD_TO_HEAD_SETS,
    winsRequired: input.winsRequired,
    defaultWinsRequired: input.defaultWinsRequired ?? input.winsRequired,
    useRoundOverrides: input.useRoundOverrides,
    roundOverrides: input.roundOverrides,
    finalsMatchRules: input.finalsMatchRules,
    teamCount: input.mainTeamCount,
    qualifiersCount: input.mainQualifiersCount,
    aggregateMatchRules: input.mainAggregateMatchRules,
  };

  const consolationInput = input.bracketMatchConfig?.consolation || input.consolationBracketMatch || {
    enabled: input.consolationEnabled !== false,
    matchFormat: input.consolationMatchFormat ?? MatchFormat.HEAD_TO_HEAD_SETS,
    winsRequired: input.consolationWinsRequired,
    defaultWinsRequired: input.consolationDefaultWinsRequired ?? input.consolationWinsRequired,
    useRoundOverrides: input.consolationUseRoundOverrides,
    roundOverrides: input.consolationRoundOverrides,
    finalsMatchRules: input.consolationFinalsMatchRules,
    teamCount: input.consolationTeamCount,
    qualifiersCount: input.consolationQualifiersCount,
    aggregateMatchRules: input.consolationAggregateMatchRules,
  };

  const qfBracketTeamCount = Number.parseInt(
    String(input.finalTeamCount ?? input.maxTeams ?? ""),
    10
  );
  const mainResult = validateBracketMatchSideInput(mainInput, {
    label: "上位トーナメント",
    requiredEnabled: false,
    allowLossBand: true,
    teamCount: qfBracketTeamCount,
  });
  const consolationResult = validateBracketMatchSideInput(consolationInput, {
    label: "下位トーナメント",
    requiredEnabled: false,
    allowLossBand: false,
  });

  const errors = {};
  if (!mainResult.valid) Object.assign(errors, prefixErrors(mainResult.errors, "main"));
  if (!consolationResult.valid) {
    Object.assign(errors, prefixErrors(consolationResult.errors, "consolation"));
  }

  if (Object.keys(errors).length > 0) {
    return {
      valid: false,
      errors,
      values: null,
      message: "決勝トーナメント設定を確認してください。",
    };
  }

  const config = {
    main: mainResult.values,
    consolation: consolationResult.values,
  };

  if (!config.main.enabled && !config.consolation.enabled) {
    return {
      valid: false,
      errors: {
        bracketMatchConfig: "上位または下位トーナメントのどちらかは実施する必要があります。",
      },
      values: null,
      message: "上位または下位トーナメントのどちらかは実施する必要があります。",
    };
  }

  // レガシーミラーは上位を正とする（旧クライアント互換）
  const mirrorRules =
    config.main.enabled && config.main.matchFormat === MatchFormat.HEAD_TO_HEAD_SETS
      ? config.main.finalsMatchRules
      : normalizeFinalsMatchRules({ winsRequired: 2 });

  return {
    valid: true,
    errors: {},
    values: {
      bracketMatchConfig: config,
      matchFormat: MatchFormat.HEAD_TO_HEAD_SETS,
      aggregateMatchRules: null,
      winsRequired: mirrorRules.defaultWinsRequired ?? 2,
      finalsMatchRules: mirrorRules,
    },
    message: null,
  };
}

/**
 * @param {Record<string, string>|null|undefined} errors
 * @param {string} prefix
 */
function prefixErrors(errors, prefix) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const [key, message] of Object.entries(errors || {})) {
    out[`${prefix}.${key}`] = message;
  }
  return out;
}

/**
 * resolveMatchWinsRequired 用に tournament をサイド設定で上書きしたビューを返す
 * @param {object|null|undefined} tournament
 * @param {object|null|undefined} bracket
 */
export function tournamentViewForBracketRules(tournament, bracket) {
  const kind =
    bracket?.bracketKind === BracketKind.CONSOLATION || bracket?.mode === "consolation"
      ? BracketMatchSide.CONSOLATION
      : BracketMatchSide.MAIN;
  const side = resolveBracketMatchConfig(tournament, kind);
  return {
    ...tournament,
    winsRequired: side.finalsMatchRules?.defaultWinsRequired ?? 2,
    finalsMatchRules: side.finalsMatchRules,
    matchFormat: side.matchFormat,
    aggregateMatchRules: side.aggregateMatchRules,
  };
}
