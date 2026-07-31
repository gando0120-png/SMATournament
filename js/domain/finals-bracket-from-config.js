/**
 * 上位ブラケット生成（H2H / multi を設定で分岐）
 */
import {
  MatchFormat,
  normalizeAggregateMatchRules,
  resolveMatchFormat,
} from "./aggregate-match-format.js";
import { resolveBracketMatchConfig } from "./bracket-match-config.js";
import { buildFinalsBracketFromAdvancement } from "./finals-bracket.js";
import { buildMultiTeamBracket } from "./multi-team-bracket.js";

/**
 * @param {object|null|undefined} advancement
 * @returns {Array<{ entryId: string, teamName: string|null, seed?: number|null }>}
 */
function extractAdvancementEntries(advancement) {
  const rows = [];
  for (const q of advancement?.qualifiers ?? []) {
    if (!q || q.isBye === true) continue;
    if (typeof q.entryId !== "string" || !q.entryId) continue;
    rows.push({
      entryId: q.entryId,
      teamName: q.teamName ?? null,
      seed: q.seed ?? null,
    });
  }
  return rows;
}

/**
 * @param {object|null|undefined} advancement
 * @param {object|null|undefined} tournament
 * @param {{ random?: () => number, regenerate?: boolean }} [options]
 */
export function buildMainBracketFromAdvancement(advancement, tournament, options = {}) {
  const config = resolveBracketMatchConfig(tournament, "main");
  if (config.enabled === false) {
    return {
      valid: false,
      canFinalize: false,
      message: "上位トーナメントは実施しない設定です。",
      bracket: null,
    };
  }

  const matchFormat = resolveMatchFormat(config.matchFormat);
  if (matchFormat === MatchFormat.MULTI_TEAM_TOTAL) {
    const entries = extractAdvancementEntries(advancement);
    if (entries.length < 2) {
      return {
        valid: false,
        canFinalize: false,
        message: "決勝進出チームが不足しています。",
        bracket: null,
      };
    }
    const multi = buildMultiTeamBracket({
      entries,
      aggregateMatchRules: normalizeAggregateMatchRules(config.aggregateMatchRules || {}),
      random: options.random,
    });
    if (!multi.canFinalize || !multi.bracket) {
      return {
        valid: false,
        canFinalize: false,
        message: multi.message || "上位トーナメント表を作成できません。",
        bracket: null,
      };
    }
    // QF の Rules は mode == single_elimination を拒否するため mode を外す
    const { mode: _mode, ...multiBracket } = multi.bracket;
    return {
      valid: true,
      canFinalize: true,
      message: null,
      bracket: {
        ...multiBracket,
        qualifierCount: entries.length,
        matchFormat: MatchFormat.MULTI_TEAM_TOTAL,
      },
    };
  }

  return buildFinalsBracketFromAdvancement(advancement, options);
}
