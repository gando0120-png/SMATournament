/**
 * 決勝試合結果ペイロード構築（DOM / Firestore 非依存）
 */
import {
  FinalsMatchResolution,
  MatchResultStatus,
} from "./constants.js";
import { buildPlayedFinalsMatchResultTeams } from "./finals-match-progress.js";

/**
 * @param {object|null|undefined} team
 * @param {number} [fallbackSeed]
 */
export function ensureFinalsTeamWithSeed(team, fallbackSeed = 1) {
  if (!team?.entryId) {
    return null;
  }

  const seed =
    typeof team.seed === "number" && Number.isInteger(team.seed)
      ? team.seed
      : fallbackSeed;

  return {
    entryId: team.entryId,
    teamName: team.teamName ?? "—",
    seed,
    blockId: team.blockId ?? null,
    blockName: team.blockName ?? null,
    isBye: false,
  };
}

/**
 * @param {object} params
 */
export function buildPlayedFinalsMatchResultPayload({
  match,
  team1,
  team2,
  validatedData,
}) {
  const { sets, team1SetWins, team2SetWins, winnerSide, winsRequired } = validatedData;
  const normalizedTeam1 = ensureFinalsTeamWithSeed(team1, match.matchNumber * 2 - 1);
  const normalizedTeam2 = ensureFinalsTeamWithSeed(team2, match.matchNumber * 2);
  const { winner, loser } = buildPlayedFinalsMatchResultTeams(
    normalizedTeam1,
    normalizedTeam2,
    winnerSide
  );

  const payload = {
    matchId: match.matchId,
    roundNumber: match.roundNumber,
    matchNumber: match.matchNumber,
    status: MatchResultStatus.FINISHED,
    resolution: FinalsMatchResolution.PLAYED,
    team1: normalizedTeam1,
    team2: normalizedTeam2,
    sets,
    team1SetWins,
    team2SetWins,
    winnerSide,
    winner: ensureFinalsTeamWithSeed(winner, normalizedTeam1?.seed ?? 1),
    loser: ensureFinalsTeamWithSeed(loser, normalizedTeam2?.seed ?? 2),
  };

  if (winsRequired === 2 || winsRequired === 3) {
    payload.winsRequired = winsRequired;
  }

  return payload;
}

/**
 * @param {object} match
 * @param {object} team1
 * @param {object} team2
 */
export function buildFinalsMatchSessionPayload({ match, team1, team2 }) {
  return {
    matchId: match.matchId,
    roundNumber: match.roundNumber,
    matchNumber: match.matchNumber,
    team1: ensureFinalsTeamWithSeed(team1, match.matchNumber * 2 - 1),
    team2: ensureFinalsTeamWithSeed(team2, match.matchNumber * 2),
  };
}
