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
  return 0;
}

/**
 * 表示用のみ。順位・選出判定には使わない。
 * @param {object} a
 * @param {object} b
 * @returns {number}
 */
export function compareStandingsEntriesForDisplay(a, b) {
  const metric = compareStandingsEntries(a, b);
  if (metric !== 0) {
    return metric;
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
 * @param {string[]|Iterable<string>} entryIds
 * @returns {string[]}
 */
export function normalizeEntryIds(entryIds) {
  return [...entryIds].map(String).sort((a, b) => a.localeCompare(b, "ja"));
}

/**
 * @param {string[]|Iterable<string>} entryIds
 * @returns {string}
 */
export function entryIdsGroupKey(entryIds) {
  return normalizeEntryIds(entryIds).join("|");
}

/**
 * @param {object[]} rankedEntries - metrics 順（同値は任意順）の配列
 * @returns {Array<{ entryIds: string[], entries: object[], rank: number }>}
 */
export function findTiedStandingGroups(rankedEntries) {
  const groups = [];
  let index = 0;

  while (index < rankedEntries.length) {
    let end = index + 1;
    while (
      end < rankedEntries.length &&
      areStandingsEntriesTied(rankedEntries[index], rankedEntries[end])
    ) {
      end += 1;
    }

    if (end - index >= 2) {
      const entries = rankedEntries.slice(index, end);
      groups.push({
        entryIds: normalizeEntryIds(entries.map((entry) => entry.entryId)),
        entries,
        rank: entries[0].rank ?? index + 1,
      });
    }

    index = end;
  }

  return groups;
}

/**
 * @param {object[]} orderedEntries - 最終表示／選出順。needsMolkkyOut 付き
 */
export function assignStandingsRanksWithMolkkyOut(orderedEntries) {
  let rank = 1;

  return orderedEntries.map((entry, index) => {
    if (index > 0) {
      const prev = orderedEntries[index - 1];
      if (areStandingsEntriesTied(prev, entry)) {
        if (prev.needsMolkkyOut && entry.needsMolkkyOut) {
          // 未解消の同値 → 同順位を維持
        } else {
          // モルックアウトで順序確定済み → 連番
          rank = index + 1;
        }
      } else {
        rank = index + 1;
      }
    }

    return {
      ...entry,
      rank,
    };
  });
}

/**
 * @param {object[]} sortedEntries
 */
export function assignStandingsRanks(sortedEntries) {
  let rank = 1;

  const ranked = sortedEntries.map((entry, index) => {
    if (index > 0 && !areStandingsEntriesTied(sortedEntries[index - 1], entry)) {
      rank = index + 1;
    }

    return {
      ...entry,
      rank,
    };
  });

  const tiedIds = new Set();
  for (const group of findTiedStandingGroups(ranked)) {
    for (const entryId of group.entryIds) {
      tiedIds.add(entryId);
    }
  }

  return ranked.map((entry) => ({
    ...entry,
    needsMolkkyOut: tiedIds.has(entry.entryId),
  }));
}

/**
 * @param {object|null|undefined} group
 * @param {object[]} tiedEntries
 */
function isValidOrderedEntryIds(group, tiedEntries) {
  if (!group || !Array.isArray(group.orderedEntryIds)) {
    return false;
  }
  const expected = normalizeEntryIds(tiedEntries.map((entry) => entry.entryId));
  const ordered = group.orderedEntryIds.map(String);
  if (ordered.length !== expected.length) {
    return false;
  }
  const orderedKey = entryIdsGroupKey(ordered);
  const expectedKey = entryIdsGroupKey(expected);
  if (orderedKey !== expectedKey) {
    return false;
  }
  return new Set(ordered).size === ordered.length;
}

/**
 * ブロック内のモルックアウト解消を順位へ反映する。
 * @param {object|null|undefined} qualifyingStandings
 * @param {object|null|undefined} resolutions
 */
export function applyMolkkyOutResolutions(qualifyingStandings, resolutions) {
  if (!qualifyingStandings?.blocks?.length) {
    return qualifyingStandings;
  }

  const blockGroups = Array.isArray(resolutions?.blockGroups) ? resolutions.blockGroups : [];

  const blocks = qualifyingStandings.blocks.map((block) => {
    const resolutionByKey = new Map();
    for (const group of blockGroups) {
      if (group?.blockId !== block.blockId || !Array.isArray(group.entryIds)) {
        continue;
      }
      resolutionByKey.set(entryIdsGroupKey(group.entryIds), group);
    }

    const metricSorted = [...(block.standings || [])].sort((a, b) => {
      const metric = compareStandingsEntries(a, b);
      if (metric !== 0) {
        return metric;
      }
      return compareStandingsEntriesForDisplay(a, b);
    });

    const ordered = [];
    let index = 0;
    while (index < metricSorted.length) {
      let end = index + 1;
      while (
        end < metricSorted.length &&
        areStandingsEntriesTied(metricSorted[index], metricSorted[end])
      ) {
        end += 1;
      }

      const group = metricSorted.slice(index, end);
      if (group.length === 1) {
        ordered.push({ ...group[0], needsMolkkyOut: false });
      } else {
        const key = entryIdsGroupKey(group.map((entry) => entry.entryId));
        const resolution = resolutionByKey.get(key);
        if (isValidOrderedEntryIds(resolution, group)) {
          const byId = new Map(group.map((entry) => [entry.entryId, entry]));
          for (const entryId of resolution.orderedEntryIds) {
            ordered.push({ ...byId.get(String(entryId)), needsMolkkyOut: false });
          }
        } else {
          for (const entry of group) {
            ordered.push({ ...entry, needsMolkkyOut: true });
          }
        }
      }

      index = end;
    }

    return {
      ...block,
      standings: assignStandingsRanksWithMolkkyOut(ordered),
    };
  });

  return {
    ...qualifyingStandings,
    blocks,
  };
}

/**
 * @param {object|null|undefined} qualifyingStandings
 */
export function listUnresolvedBlockMolkkyOutGroups(qualifyingStandings) {
  const groups = [];
  for (const block of qualifyingStandings?.blocks || []) {
    const ranked = block.standings || [];
    for (const tied of findTiedStandingGroups(ranked)) {
      if (!tied.entries.every((entry) => entry.needsMolkkyOut)) {
        continue;
      }
      groups.push({
        blockId: block.blockId,
        blockName: block.blockName,
        entryIds: tied.entryIds,
        entries: tied.entries,
        rank: tied.rank,
      });
    }
  }
  return groups;
}

/**
 * @param {object|null|undefined} qualifyingStandings
 */
export function hasUnresolvedBlockMolkkyOuts(qualifyingStandings) {
  return listUnresolvedBlockMolkkyOutGroups(qualifyingStandings).length > 0;
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

  const sorted = [...entries].sort((a, b) => {
    const metric = compareStandingsEntries(a, b);
    if (metric !== 0) {
      return metric;
    }
    return compareStandingsEntriesForDisplay(a, b);
  });
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
