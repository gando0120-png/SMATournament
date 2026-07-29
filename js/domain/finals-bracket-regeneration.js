/**
 * 決勝トーナメント再生成の可否判定・配置再抽選（DOM / Firestore 非依存）
 */
import { MatchSessionStatus } from "./constants.js";
import { hasCreatedConsolationBracket } from "./consolation-bracket.js";
import { isTournamentOpen } from "../lib/tournament-status.js";
import { TournamentFormat, resolveTournamentFormat } from "./tournament-format.js";
import { isSingleEliminationBracket } from "./single-elimination-bracket.js";

export const FinalsBracketRegenerationReasonCode = Object.freeze({
  ELIGIBLE: "ELIGIBLE",
  TOURNAMENT_NOT_OPEN: "TOURNAMENT_NOT_OPEN",
  BRACKET_NOT_FINALIZED: "BRACKET_NOT_FINALIZED",
  UNSUPPORTED_FORMAT: "UNSUPPORTED_FORMAT",
  CONSOLATION_EXISTS: "CONSOLATION_EXISTS",
  HAS_PLAYED_RESULTS: "HAS_PLAYED_RESULTS",
  HAS_SESSIONS: "HAS_SESSIONS",
});

/**
 * @param {Iterable<object>|Map<string, object>|null|undefined} results
 */
export function countPlayedFinalsMatchResults(results) {
  const list = results instanceof Map ? [...results.values()] : [...(results ?? [])];
  return list.filter((result) => result?.resolution === "played").length;
}

/**
 * @param {Iterable<object>|Map<string, object>|null|undefined} results
 */
export function listByeOnlyFinalsMatchResults(results) {
  const list = results instanceof Map ? [...results.values()] : [...(results ?? [])];
  return list.filter((result) => result?.resolution === "bye");
}

/**
 * @param {Iterable<object>|Map<string, object>|null|undefined} sessions
 */
export function countBlockingFinalsMatchSessions(sessions) {
  const list = sessions instanceof Map ? [...sessions.values()] : [...(sessions ?? [])];
  // 進行中に加え、開始済み（finished含む）も再生成を拒否する
  return list.filter((session) => {
    if (!session) {
      return false;
    }
    return (
      session.status === MatchSessionStatus.PLAYING ||
      session.status === MatchSessionStatus.FINISHED ||
      session.status === "playing" ||
      session.status === "finished"
    );
  }).length;
}

/**
 * @param {object} params
 * @param {object|null|undefined} params.tournament
 * @param {object|null|undefined} params.bracket
 * @param {Map<string, object>|object[]|null|undefined} params.resultsMap
 * @param {Map<string, object>|object[]|null|undefined} params.sessionsMap
 * @param {object|null|undefined} params.consolationBracket
 */
export function assessFinalsBracketRegeneration({
  tournament,
  bracket,
  resultsMap,
  sessionsMap,
  consolationBracket = null,
} = {}) {
  const playedResultCount = countPlayedFinalsMatchResults(resultsMap);
  const byeResultCount = listByeOnlyFinalsMatchResults(resultsMap).length;
  const sessionCount = countBlockingFinalsMatchSessions(sessionsMap);
  const format = resolveTournamentFormat(tournament);
  const isSingleElim =
    format === TournamentFormat.SINGLE_ELIMINATION || isSingleEliminationBracket(bracket);

  if (!isTournamentOpen(tournament)) {
    return {
      canRegenerate: false,
      reasonCode: FinalsBracketRegenerationReasonCode.TOURNAMENT_NOT_OPEN,
      playedResultCount,
      byeResultCount,
      sessionCount,
      message: "大会は終了済みのため、トーナメントを再生成できません。",
    };
  }

  if (!bracket?.finalized) {
    return {
      canRegenerate: false,
      reasonCode: FinalsBracketRegenerationReasonCode.BRACKET_NOT_FINALIZED,
      playedResultCount,
      byeResultCount,
      sessionCount,
      message: "決勝トーナメントが未生成のため、再生成できません。",
    };
  }

  if (isSingleElim) {
    return {
      canRegenerate: false,
      reasonCode: FinalsBracketRegenerationReasonCode.UNSUPPORTED_FORMAT,
      playedResultCount,
      byeResultCount,
      sessionCount,
      message: "この大会形式ではトーナメント再生成に対応していません。",
    };
  }

  if (hasCreatedConsolationBracket(consolationBracket)) {
    return {
      canRegenerate: false,
      reasonCode: FinalsBracketRegenerationReasonCode.CONSOLATION_EXISTS,
      playedResultCount,
      byeResultCount,
      sessionCount,
      message: "下位トーナメント作成後は、決勝トーナメントを再生成できません。",
    };
  }

  if (playedResultCount > 0) {
    return {
      canRegenerate: false,
      reasonCode: FinalsBracketRegenerationReasonCode.HAS_PLAYED_RESULTS,
      playedResultCount,
      byeResultCount,
      sessionCount,
      message: "試合結果が登録されているため、トーナメントを再生成できません。",
    };
  }

  if (sessionCount > 0) {
    return {
      canRegenerate: false,
      reasonCode: FinalsBracketRegenerationReasonCode.HAS_SESSIONS,
      playedResultCount,
      byeResultCount,
      sessionCount,
      message: "開始済みの試合があるため、トーナメントを再生成できません。",
    };
  }

  return {
    canRegenerate: true,
    reasonCode: FinalsBracketRegenerationReasonCode.ELIGIBLE,
    playedResultCount: 0,
    byeResultCount,
    sessionCount: 0,
    message: null,
  };
}

/**
 * 旧形式: seed を再抽選して並べ替える（決定的 seed 配置の再生成用）
 * @param {object[]} qualifiers
 * @param {() => number} [random]
 */
export function reseedLegacyQualifiersForRegeneration(qualifiers, random = Math.random) {
  if (!Array.isArray(qualifiers) || qualifiers.length === 0) {
    return [];
  }
  const arr = [...qualifiers];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.map((qualifier, index) => ({
    ...qualifier,
    seed: index + 1,
  }));
}
