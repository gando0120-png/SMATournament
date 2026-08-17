/**
 * loss_band の rankingMode 解決・検証（純関数）
 */
import { MatchFormat } from "../aggregate-match-format.js";
import {
  LOSS_BAND_DEFAULT_GUARANTEED_MATCH_COUNT,
  LOSS_BAND_TEAM_COUNT,
  RankingMode,
} from "./constants.js";
import { resolveGuaranteedMatchCount } from "./exchange.js";

/**
 * @param {unknown} value
 * @returns {"single_elimination"|"loss_band"}
 */
export function resolveRankingMode(value) {
  if (value && typeof value === "object" && "rankingMode" in value) {
    return resolveRankingMode(value.rankingMode);
  }
  if (value === RankingMode.LOSS_BAND) {
    return RankingMode.LOSS_BAND;
  }
  return RankingMode.SINGLE_ELIMINATION;
}

/**
 * 大会ドキュメント / bracketMatchConfig から main の rankingMode を解決
 * @param {object|null|undefined} tournament
 */
export function resolveMainRankingMode(tournament) {
  const main = tournament?.bracketMatchConfig?.main ?? tournament?.bracketMatchConfig?.upper;
  return resolveRankingMode(main ?? tournament?.rankingMode);
}

/**
 * loss_band オプションを正規化（rankingMode=loss_band 時のみ利用）
 * @param {object|null|undefined} side
 */
export function normalizeLossBandSideOptions(side = {}) {
  return {
    rematchAvoidance: side.rematchAvoidance === true,
    thirdPlaceMatch: side.thirdPlaceMatch === true,
    exchangeMatches: side.exchangeMatches === true,
    guaranteedMatchCount: resolveGuaranteedMatchCount({
      guaranteedMatchCount:
        side.guaranteedMatchCount ?? LOSS_BAND_DEFAULT_GUARANTEED_MATCH_COUNT,
    }),
  };
}

/**
 * 運営ステータスの日本語表示
 * @param {string|null|undefined} status
 */
export function formatLossBandTournamentStatusLabel(status) {
  switch (status) {
    case "active":
      return "順位決定戦進行中";
    case "finals_pending":
      return "決勝待ち";
    case "third_place_pending":
      return "3位決定戦待ち";
    case "exchange_pending":
      return "交流戦進行中";
    case "completed":
      return "完了";
    default:
      return status ? String(status) : "未開始";
  }
}

/**
 * main 側のみ loss_band 可。multi との併用は不可。
 * 64チーム・H2H・BYEなし（Phase 6）。
 * @param {object|null|undefined} side
 * @param {{ label?: string, allowLossBand?: boolean, teamCount?: number|null }} [options]
 */
export function validateSideRankingMode(side, options = {}) {
  const label = options.label || "トーナメント";
  const allowLossBand = options.allowLossBand !== false;
  const rankingMode = resolveRankingMode(side);
  const matchFormat =
    side?.matchFormat === MatchFormat.MULTI_TEAM_TOTAL
      ? MatchFormat.MULTI_TEAM_TOTAL
      : MatchFormat.HEAD_TO_HEAD_SETS;

  if (rankingMode === RankingMode.LOSS_BAND) {
    if (!allowLossBand) {
      return {
        valid: false,
        errors: { rankingMode: `${label}に敗戦帯方式は設定できません。` },
        values: null,
        message: `${label}に敗戦帯方式は設定できません。`,
      };
    }
    if (matchFormat === MatchFormat.MULTI_TEAM_TOTAL) {
      return {
        valid: false,
        errors: {
          rankingMode: "複数チーム総得点形式に敗戦帯方式は設定できません。",
        },
        values: null,
        message: "複数チーム総得点形式に敗戦帯方式は設定できません。",
      };
    }

    const rawTeamCount =
      options.teamCount ?? side?.teamCount ?? side?.maxTeams ?? side?.bracketTeamCount;
    const teamCount =
      rawTeamCount == null || rawTeamCount === ""
        ? null
        : Number.parseInt(String(rawTeamCount), 10);
    if (teamCount !== LOSS_BAND_TEAM_COUNT) {
      return {
        valid: false,
        errors: {
          rankingMode: `順位決定方式は${LOSS_BAND_TEAM_COUNT}チーム・1対1形式のみ対応しています（BYEなし）。`,
        },
        values: null,
        message: `順位決定方式は${LOSS_BAND_TEAM_COUNT}チーム・1対1形式のみ対応しています。`,
      };
    }

    const lossBandOptions = normalizeLossBandSideOptions(side);
    return {
      valid: true,
      errors: {},
      values: {
        rankingMode: RankingMode.LOSS_BAND,
        ...lossBandOptions,
      },
      message: null,
    };
  }

  return {
    valid: true,
    errors: {},
    values: { rankingMode },
    message: null,
  };
}
