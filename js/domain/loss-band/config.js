/**
 * loss_band の rankingMode 解決・検証（純関数）
 */
import { MatchFormat } from "../aggregate-match-format.js";
import { RankingMode } from "./constants.js";

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
 * main 側のみ loss_band 可。multi との併用は不可。
 * @param {object|null|undefined} side
 * @param {{ label?: string, allowLossBand?: boolean }} [options]
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
  }

  return {
    valid: true,
    errors: {},
    values: { rankingMode },
    message: null,
  };
}
