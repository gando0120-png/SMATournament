/**
 * 予選試合セッションの状態解決（DOM 非依存）
 */
import { MatchResultStatus, MatchSessionStatus } from "./constants.js";

export const MatchDisplayStatus = {
  NOT_STARTED: "notStarted",
  PLAYING: "playing",
  FINISHED: "finished",
};

const MATCH_DISPLAY_STATUS_LABELS = {
  [MatchDisplayStatus.NOT_STARTED]: "未開始",
  [MatchDisplayStatus.PLAYING]: "試合中",
  [MatchDisplayStatus.FINISHED]: "終了",
};

/**
 * @param {string} status
 */
export function getMatchDisplayStatusLabel(status) {
  return MATCH_DISPLAY_STATUS_LABELS[status] ?? status ?? "—";
}

/**
 * @param {object|null|undefined} persistedSchedule
 * @param {string} matchId
 */
export function findScheduleMatchContext(persistedSchedule, matchId) {
  if (!persistedSchedule?.finalized || !matchId) {
    return null;
  }

  for (const block of persistedSchedule.blocks || []) {
    for (const round of block.rounds || []) {
      for (const match of round.matches || []) {
        if (match.matchId === matchId) {
          return {
            matchId: match.matchId,
            blockId: block.blockId,
            blockName: block.blockName,
            roundNumber: round.roundNumber,
            courtNumber: match.courtNumber,
            team1: match.team1,
            team2: match.team2,
          };
        }
      }
    }
  }

  return null;
}

/**
 * @param {object|null|undefined} session
 * @param {object|null|undefined} result
 */
export function resolveMatchDisplayState(session, result) {
  if (result?.status === MatchResultStatus.FINISHED) {
    return {
      status: MatchDisplayStatus.FINISHED,
      session: session ?? null,
      result,
    };
  }

  if (session?.status === MatchSessionStatus.PLAYING) {
    return {
      status: MatchDisplayStatus.PLAYING,
      session,
      result: result ?? null,
    };
  }

  return {
    status: MatchDisplayStatus.NOT_STARTED,
    session: null,
    result: result ?? null,
  };
}

/**
 * @param {string} result
 */
export function getSetResultLabel(result) {
  if (result === "team1") {
    return "チーム1";
  }
  if (result === "team2") {
    return "チーム2";
  }
  if (result === "draw") {
    return "引分";
  }
  return "—";
}

/**
 * @param {object|null|undefined} result
 */
export function formatFinishedResultDetail(result) {
  if (!result?.sets?.length) {
    return {
      sets: [],
      team1StatsLine: null,
      team2StatsLine: null,
    };
  }

  const sets = [...result.sets]
    .sort((a, b) => (a.setNumber ?? 0) - (b.setNumber ?? 0))
    .map((set) => ({
      setNumber: set.setNumber,
      label: `第${set.setNumber}セット`,
      scoreLine: `${set.team1Score} - ${set.team2Score}`,
      resultLabel: getSetResultLabel(set.result),
    }));

  const team1Stats = result.team1Stats ?? {};
  const team2Stats = result.team2Stats ?? {};

  return {
    sets,
    team1StatsLine: `${team1Stats.setWins ?? 0}勝 ${team1Stats.setDraws ?? 0}分 ${team1Stats.setLosses ?? 0}敗 / ${team1Stats.totalScore ?? 0}点`,
    team2StatsLine: `${team2Stats.setWins ?? 0}勝 ${team2Stats.setDraws ?? 0}分 ${team2Stats.setLosses ?? 0}敗 / ${team2Stats.totalScore ?? 0}点`,
  };
}
