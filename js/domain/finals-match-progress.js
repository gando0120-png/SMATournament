/**
 * 決勝試合進行・チーム解決（DOM / Firestore 非依存）
 */
import {
  FinalsMatchResolution,
  MatchResultStatus,
  MatchSessionStatus,
} from "./constants.js";
import { isSingleByeMatch, isDoubleByeMatch, getByeWinnerTeam } from "./finals-match-bye.js";

export const FinalsMatchDisplayStatus = {
  WAITING_OPPONENT: "waiting_opponent",
  READY: "ready",
  PLAYING: "playing",
  FINISHED: "finished",
  BYE: "bye",
};

const FINALS_MATCH_DISPLAY_STATUS_LABELS = {
  [FinalsMatchDisplayStatus.WAITING_OPPONENT]: "対戦相手未定",
  [FinalsMatchDisplayStatus.READY]: "開始可能",
  [FinalsMatchDisplayStatus.PLAYING]: "試合中",
  [FinalsMatchDisplayStatus.FINISHED]: "終了",
  [FinalsMatchDisplayStatus.BYE]: "BYE通過",
};

/**
 * @param {string} status
 */
export function getFinalsMatchDisplayStatusLabel(status) {
  return FINALS_MATCH_DISPLAY_STATUS_LABELS[status] ?? status ?? "—";
}

/**
 * @param {object|null|undefined} team
 */
export function normalizeFinalsTeam(team) {
  if (!team || team.isBye || !team.entryId) {
    return null;
  }

  return {
    entryId: team.entryId,
    teamName: team.teamName,
    seed: team.seed ?? null,
    blockId: team.blockId ?? null,
    blockName: team.blockName ?? null,
    isBye: false,
  };
}

/**
 * @param {object|null|undefined} bracket
 * @param {string} matchId
 */
export function findBracketMatch(bracket, matchId) {
  return bracket?.matches?.find((match) => match.matchId === matchId) ?? null;
}

/**
 * @param {object|null|undefined} bracket
 * @param {string} matchId
 */
export function findFeederMatches(bracket, matchId) {
  return (bracket?.matches ?? []).filter((match) => match.nextMatchId === matchId);
}

/**
 * @param {object} params
 * @param {object} params.match
 * @param {object} params.bracket
 * @param {Map<string, object>} params.resultsMap
 */
export function resolveFinalsMatchTeams({ match, bracket, resultsMap }) {
  if (!match) {
    return {
      team1: null,
      team2: null,
      resolved: false,
      reason: "match_not_found",
      byeWinner: null,
    };
  }

  if (match.roundNumber === 1) {
    if (isDoubleByeMatch(match.team1, match.team2)) {
      return {
        team1: null,
        team2: null,
        resolved: false,
        reason: "double_bye",
        byeWinner: null,
      };
    }

    if (isSingleByeMatch(match.team1, match.team2)) {
      const byeWinner = getByeWinnerTeam(match.team1, match.team2);
      return {
        team1: byeWinner,
        team2: null,
        resolved: false,
        reason: "bye",
        byeWinner,
      };
    }

    const team1 = normalizeFinalsTeam(match.team1);
    const team2 = normalizeFinalsTeam(match.team2);

    return {
      team1,
      team2,
      resolved: Boolean(team1 && team2),
      reason: team1 && team2 ? null : "teams_pending",
      byeWinner: null,
    };
  }

  const feeders = findFeederMatches(bracket, match.matchId);
  if (feeders.length === 0) {
    return {
      team1: null,
      team2: null,
      resolved: false,
      reason: "no_feeders",
      byeWinner: null,
    };
  }

  let team1 = null;
  let team2 = null;
  let pendingFeeder = false;

  for (const feeder of feeders) {
    const result = resultsMap.get(feeder.matchId);
    if (!result || result.status !== MatchResultStatus.FINISHED || !result.winner?.entryId) {
      pendingFeeder = true;
      continue;
    }

    const winner = normalizeFinalsTeam(result.winner);
    if (feeder.nextTeamSlot === "team1") {
      team1 = winner;
    } else if (feeder.nextTeamSlot === "team2") {
      team2 = winner;
    }
  }

  if (pendingFeeder || !team1 || !team2) {
    return {
      team1,
      team2,
      resolved: false,
      reason: "feeders_pending",
      byeWinner: null,
    };
  }

  if (team1.entryId === team2.entryId) {
    return {
      team1,
      team2,
      resolved: false,
      reason: "duplicate_team",
      byeWinner: null,
    };
  }

  return {
    team1,
    team2,
    resolved: true,
    reason: null,
    byeWinner: null,
  };
}

/**
 * @param {object} match
 * @param {object} winnerTeam
 */
export function buildByeMatchResultPayload(match, winnerTeam) {
  const team1 = normalizeFinalsTeam(match.team1);
  const team2 = normalizeFinalsTeam(match.team2);
  const winnerSide =
    team1?.entryId === winnerTeam.entryId
      ? "team1"
      : team2?.entryId === winnerTeam.entryId
        ? "team2"
        : "team1";

  return {
    matchId: match.matchId,
    roundNumber: match.roundNumber,
    matchNumber: match.matchNumber,
    status: MatchResultStatus.FINISHED,
    resolution: FinalsMatchResolution.BYE,
    team1,
    team2,
    sets: [],
    team1SetWins: 0,
    team2SetWins: 0,
    winnerSide,
    winner: winnerTeam,
    loser: null,
  };
}

/**
 * @param {object} params
 */
export function resolveFinalsMatchDisplayStatus({
  match,
  bracket,
  resultsMap,
  sessionsMap,
}) {
  const result = resultsMap.get(match.matchId);
  if (result?.status === MatchResultStatus.FINISHED) {
    if (result.resolution === FinalsMatchResolution.BYE) {
      return FinalsMatchDisplayStatus.BYE;
    }
    return FinalsMatchDisplayStatus.FINISHED;
  }

  const session = sessionsMap.get(match.matchId);
  if (session?.status === MatchSessionStatus.PLAYING) {
    return FinalsMatchDisplayStatus.PLAYING;
  }

  const teams = resolveFinalsMatchTeams({ match, bracket, resultsMap });
  if (teams.reason === "bye") {
    return FinalsMatchDisplayStatus.BYE;
  }

  if (!teams.resolved) {
    return FinalsMatchDisplayStatus.WAITING_OPPONENT;
  }

  return FinalsMatchDisplayStatus.READY;
}

/**
 * @param {object} params
 */
export function evaluateFinalsMatchStart({
  match,
  bracket,
  resultsMap,
  sessionsMap,
}) {
  if (!match) {
    return { canStart: false, message: "試合が見つかりません。" };
  }

  const existingResult = resultsMap.get(match.matchId);
  if (existingResult?.status === MatchResultStatus.FINISHED) {
    return { canStart: false, message: "終了済みの試合です。" };
  }

  if (match.roundNumber === 1 && isDoubleByeMatch(match.team1, match.team2)) {
    return { canStart: false, message: "両側BYEの試合は不正です。" };
  }

  const teams = resolveFinalsMatchTeams({ match, bracket, resultsMap });
  if (teams.reason === "bye") {
    return { canStart: false, message: "BYE試合は自動進出します。", isBye: true };
  }

  if (!teams.resolved) {
    return { canStart: false, message: "対戦相手が未定のため開始できません。" };
  }

  if (match.roundNumber > 1) {
    const feeders = findFeederMatches(bracket, match.matchId);
    for (const feeder of feeders) {
      const feederResult = resultsMap.get(feeder.matchId);
      if (!feederResult || feederResult.status !== MatchResultStatus.FINISHED) {
        return { canStart: false, message: "前ラウンドの試合が未終了です。" };
      }
    }
  }

  for (const [otherMatchId, session] of sessionsMap.entries()) {
    if (otherMatchId === match.matchId) {
      continue;
    }
    if (session.status !== MatchSessionStatus.PLAYING) {
      continue;
    }

    const otherResult = resultsMap.get(otherMatchId);
    if (otherResult?.status === MatchResultStatus.FINISHED) {
      continue;
    }

    const activeIds = new Set(
      [session.team1?.entryId, session.team2?.entryId].filter(Boolean)
    );
    if (
      activeIds.has(teams.team1.entryId) ||
      activeIds.has(teams.team2.entryId)
    ) {
      return {
        canStart: false,
        message: "同じチームが別の未終了試合に参加中です。",
      };
    }
  }

  return {
    canStart: true,
    message: null,
    team1: teams.team1,
    team2: teams.team2,
  };
}

/**
 * @param {object} params
 */
export function canModifyFinalsMatchResult({
  match,
  bracket,
  resultsMap,
  sessionsMap,
  newWinnerEntryId,
}) {
  const existing = resultsMap.get(match.matchId);
  if (!existing || existing.status !== MatchResultStatus.FINISHED) {
    return { allowed: true, message: null };
  }

  if (existing.resolution === FinalsMatchResolution.BYE) {
    return { allowed: false, message: "BYE通過結果は修正できません。" };
  }

  const oldWinnerId = existing.winner?.entryId;
  if (!oldWinnerId || oldWinnerId === newWinnerEntryId) {
    return { allowed: true, message: null };
  }

  let nextMatchId = match.nextMatchId;
  while (nextMatchId) {
    if (sessionsMap.has(nextMatchId) || resultsMap.has(nextMatchId)) {
      return {
        allowed: false,
        message: "次の試合がすでに開始されているため、勝者が変わる修正はできません。",
      };
    }

    const nextMatch = findBracketMatch(bracket, nextMatchId);
    nextMatchId = nextMatch?.nextMatchId ?? null;
  }

  return { allowed: true, message: null };
}

/**
 * @param {object|null|undefined} bracket
 * @param {Map<string, object>} resultsMap
 */
export function getFinalsChampionAndRunnerUp(bracket, resultsMap) {
  if (!bracket?.matches?.length) {
    return { champion: null, runnerUp: null, complete: false };
  }

  const finalMatch =
    bracket.matches.find((match) => !match.nextMatchId) ??
    bracket.matches.find((match) => match.roundNumber === bracket.roundCount);

  if (!finalMatch) {
    return { champion: null, runnerUp: null, complete: false };
  }

  const result = resultsMap.get(finalMatch.matchId);
  if (!result || result.status !== MatchResultStatus.FINISHED || !result.winner?.entryId) {
    return { champion: null, runnerUp: null, complete: false };
  }

  const champion = result.winner;
  const runnerUp =
    result.loser ??
    (result.winnerSide === "team1" ? result.team2 : result.team1) ??
    null;

  return { champion, runnerUp, complete: true };
}

/**
 * @param {object|null|undefined} bracket
 * @param {Map<string, object>} resultsMap
 * @param {Map<string, object>} sessionsMap
 */
export function buildFinalsMatchProgressIndex(bracket, resultsMap, sessionsMap) {
  const index = new Map();

  for (const match of bracket?.matches ?? []) {
    const displayStatus = resolveFinalsMatchDisplayStatus({
      match,
      bracket,
      resultsMap,
      sessionsMap,
    });
    const resolvedTeams = resolveFinalsMatchTeams({ match, bracket, resultsMap });
    const result = resultsMap.get(match.matchId) ?? null;
    const session = sessionsMap.get(match.matchId) ?? null;

    index.set(match.matchId, {
      match,
      displayStatus,
      resolvedTeams,
      result,
      session,
      startEvaluation: evaluateFinalsMatchStart({
        match,
        bracket,
        resultsMap,
        sessionsMap,
      }),
    });
  }

  return index;
}

/**
 * @param {object|null|undefined} bracket
 */
export function listByeMatchesNeedingResults(bracket) {
  return (bracket?.matches ?? []).filter(
    (match) =>
      match.roundNumber === 1 && isSingleByeMatch(match.team1, match.team2)
  );
}

/**
 * @param {object|null|undefined} bracket
 */
export function listDoubleByeMatches(bracket) {
  return (bracket?.matches ?? []).filter(
    (match) =>
      match.roundNumber === 1 && isDoubleByeMatch(match.team1, match.team2)
  );
}

/**
 * @param {object} team1
 * @param {object} team2
 * @param {"team1"|"team2"} winnerSide
 */
export function buildPlayedFinalsMatchResultTeams(team1, team2, winnerSide) {
  const winner = winnerSide === "team1" ? team1 : team2;
  const loser = winnerSide === "team1" ? team2 : team1;

  return { winner, loser };
}
