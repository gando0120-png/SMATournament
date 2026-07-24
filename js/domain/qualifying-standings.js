/**
 * 予選ブロック順位の集計・ソート（DOM 非依存）
 */
import { MatchResultStatus } from "./constants.js";

/**
 * @param {object} a
 * @param {object} b
 * @returns {number}
 */
export function compareStandingsEntries(a, b) {
  if (b.setWins !== a.setWins) {
    return b.setWins - a.setWins;
  }
  if (b.setDraws !== a.setDraws) {
    return b.setDraws - a.setDraws;
  }
  if (b.totalScore !== a.totalScore) {
    return b.totalScore - a.totalScore;
  }
  return String(a.teamName ?? "").localeCompare(String(b.teamName ?? ""), "ja");
}

/**
 * @param {object} a
 * @param {object} b
 */
export function areStandingsEntriesTied(a, b) {
  return (
    a.setWins === b.setWins &&
    a.setDraws === b.setDraws &&
    a.totalScore === b.totalScore
  );
}

/**
 * @param {object[]} sortedEntries
 */
export function assignStandingsRanks(sortedEntries) {
  let rank = 1;

  return sortedEntries.map((entry, index) => {
    if (index > 0 && !areStandingsEntriesTied(sortedEntries[index - 1], entry)) {
      rank = index + 1;
    }

    return {
      ...entry,
      rank,
    };
  });
}

/**
 * @param {object} team
 */
function createEmptyTeamStanding(team) {
  return {
    entryId: team.entryId,
    teamName: team.teamName ?? "—",
    symbol: team.symbol ?? "",
    playedMatches: 0,
    setWins: 0,
    setDraws: 0,
    setLosses: 0,
    totalScore: 0,
    scheduledMatches: 0,
    finishedMatches: 0,
    remainingMatches: 0,
  };
}

/**
 * @param {Map<string, object>} standingsByEntry
 * @param {object|null|undefined} team
 */
function ensureTeamStanding(standingsByEntry, team) {
  if (!team?.entryId || standingsByEntry.has(team.entryId)) {
    return;
  }
  standingsByEntry.set(team.entryId, createEmptyTeamStanding(team));
}

/**
 * @param {object} entry
 * @param {object|null|undefined} stats
 */
function addTeamStats(entry, stats) {
  if (!stats) {
    return;
  }
  entry.setWins += stats.setWins ?? 0;
  entry.setDraws += stats.setDraws ?? 0;
  entry.setLosses += stats.setLosses ?? 0;
  entry.totalScore += stats.totalScore ?? 0;
}

/**
 * @param {object} match
 * @param {object} result
 */
function isFinishedResultForMatch(match, result) {
  if (result?.status !== MatchResultStatus.FINISHED) {
    return false;
  }
  return (
    result.team1?.entryId === match.team1?.entryId &&
    result.team2?.entryId === match.team2?.entryId
  );
}

/**
 * @param {object} block
 * @param {Map<string, object>} resultsMap
 */
export function buildBlockStandings(block, resultsMap) {
  const standingsByEntry = new Map();

  for (const team of block.teams || []) {
    ensureTeamStanding(standingsByEntry, team);
  }

  for (const round of block.rounds || []) {
    for (const match of round.matches || []) {
      const team1Id = match.team1?.entryId;
      const team2Id = match.team2?.entryId;

      ensureTeamStanding(standingsByEntry, match.team1);
      ensureTeamStanding(standingsByEntry, match.team2);

      if (team1Id) {
        standingsByEntry.get(team1Id).scheduledMatches += 1;
      }
      if (team2Id) {
        standingsByEntry.get(team2Id).scheduledMatches += 1;
      }

      const result = resultsMap.get(match.matchId);
      if (!isFinishedResultForMatch(match, result)) {
        continue;
      }

      if (team1Id) {
        const team1Entry = standingsByEntry.get(team1Id);
        team1Entry.finishedMatches += 1;
        team1Entry.playedMatches += 1;
        addTeamStats(team1Entry, result.team1Stats);
      }

      if (team2Id) {
        const team2Entry = standingsByEntry.get(team2Id);
        team2Entry.finishedMatches += 1;
        team2Entry.playedMatches += 1;
        addTeamStats(team2Entry, result.team2Stats);
      }
    }
  }

  const entries = [...standingsByEntry.values()].map((entry) => ({
    entryId: entry.entryId,
    teamName: entry.teamName,
    symbol: entry.symbol,
    playedMatches: entry.playedMatches,
    setWins: entry.setWins,
    setDraws: entry.setDraws,
    setLosses: entry.setLosses,
    totalScore: entry.totalScore,
    remainingMatches: entry.scheduledMatches - entry.finishedMatches,
  }));

  const sorted = [...entries].sort(compareStandingsEntries);
  return assignStandingsRanks(sorted);
}

/**
 * @param {object|null|undefined} persistedSchedule
 * @param {Map<string, object>} resultsMap
 */
export function buildQualifyingStandings(persistedSchedule, resultsMap) {
  if (!persistedSchedule?.finalized) {
    return null;
  }

  const blocks = (persistedSchedule.blocks || []).map((block) => ({
    blockId: block.blockId,
    blockName: block.blockName,
    teamCount: block.teamCount,
    standings: buildBlockStandings(block, resultsMap),
  }));

  return {
    finalized: true,
    blocks,
  };
}
