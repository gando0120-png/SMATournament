/**
 * 公開大会ページ用 ViewModel 生成（DOM / Firestore 非依存）
 */
import {
  EntryStatus,
  FinalsQualifierSource,
  FinalsQualifierSourceLabels,
  MatchResultStatus,
  PublicTournamentProgressStatusLabels,
  PublicTournamentStatusLabels,
  TournamentStatus,
} from "./constants.js";
import { buildQualifyingStandings } from "./qualifying-standings.js";
import { normalizeQualifyingScheduleForDisplay } from "./qualifying-schedule-persist.js";
import { mergeMatchResultsIntoSchedule } from "./qualifying-match-result.js";
import { resolveMatchDisplayState, getMatchDisplayStatusLabel } from "./qualifying-match-session.js";
import {
  buildFinalsMatchProgressIndex,
  resolveFinalsMatchTeams,
  getFinalsMatchDisplayStatusLabel,
  getFinalsChampionAndRunnerUp,
  FinalsMatchDisplayStatus,
} from "./finals-match-progress.js";
import { isByeTeam } from "./finals-match-bye.js";
import { getFinalsRoundLabel } from "./finals-bracket.js";

/**
 * @param {object|null|undefined} tournament
 */
export function isPublicViewEnabled(tournament) {
  return tournament?.publicViewEnabled === true;
}

/**
 * @param {object|null|undefined} tournament
 * @param {{ hasStarted?: boolean }} [options]
 */
export function getPublicTournamentStatusLabel(tournament, options = {}) {
  const status = tournament?.status;
  if (status === TournamentStatus.OPEN && options.hasStarted) {
    return PublicTournamentProgressStatusLabels.inProgress;
  }
  return PublicTournamentStatusLabels[status] ?? status ?? "—";
}

/**
 * 公開表示用にエントリーをサニタイズ（メール・内部メモ等を除外）
 * @param {object} entry
 */
export function sanitizeEntryForPublic(entry) {
  const members = [entry.representativeName, entry.member2, entry.member3].filter(
    (name) => typeof name === "string" && name.trim().length > 0
  );

  return {
    entryId: entry.id ?? entry.entryId,
    teamName: entry.teamName ?? "—",
    status: entry.status ?? null,
    members,
  };
}

/**
 * @param {string|null|undefined} entryId
 * @param {string|null|undefined} highlightEntryId
 */
export function isHighlightedEntry(entryId, highlightEntryId) {
  return Boolean(entryId && highlightEntryId && entryId === highlightEntryId);
}

/**
 * @param {object|null|undefined} result
 */
function formatQualifyingResultDisplay(match, result) {
  if (!result || result.status !== MatchResultStatus.FINISHED) {
    return {
      hasResult: false,
      summary: "未入力",
      setLines: [],
    };
  }

  const team1Name = match.homeTeamName ?? match.team1?.teamName ?? "—";
  const team2Name = match.awayTeamName ?? match.team2?.teamName ?? "—";
  const team1Wins = result.team1Stats?.setWins ?? 0;
  const team2Wins = result.team2Stats?.setWins ?? 0;

  const setLines = (result.sets ?? []).map((set) => ({
    label: `第${set.setNumber}セット`,
    score: `${set.team1Score} - ${set.team2Score}`,
  }));

  return {
    hasResult: true,
    summary: `${team1Name} ${team1Wins} - ${team2Wins} ${team2Name}`,
    setLines,
  };
}

/**
 * @param {object} match
 * @param {object|null|undefined} session
 * @param {object|null|undefined} result
 */
function buildQualifyingMatchView(match, session, result) {
  const displayState = resolveMatchDisplayState(session, result);
  const resultDisplay = formatQualifyingResultDisplay(match, result);

  return {
    matchId: match.matchId,
    roundNumber: match.roundNumber,
    courtNumber: match.court ?? match.courtNumber,
    team1: {
      entryId: match.homeEntryId ?? match.team1?.entryId ?? null,
      teamName: match.homeTeamName ?? match.team1?.teamName ?? "—",
    },
    team2: {
      entryId: match.awayEntryId ?? match.team2?.entryId ?? null,
      teamName: match.awayTeamName ?? match.team2?.teamName ?? "—",
    },
    status: displayState.status,
    statusLabel: getMatchDisplayStatusLabel(displayState.status),
    result: resultDisplay,
  };
}

/**
 * @param {object|null|undefined} blockDraw
 * @param {object[]} entries
 * @param {string|null|undefined} highlightEntryId
 */
function buildBlocksSection(blockDraw, entries, highlightEntryId) {
  if (!blockDraw?.blocks?.length) {
    return {
      ready: false,
      emptyMessage: "ブロック分けはまだ確定していません",
      blocks: [],
    };
  }

  const entryById = new Map(entries.map((entry) => [entry.entryId, entry]));

  const blocks = blockDraw.blocks.map((block) => ({
    blockId: block.id ?? block.blockId,
    blockName: block.name ?? block.blockName,
    teams: (block.entryIds ?? []).map((entryId) => {
      const entry = entryById.get(entryId);
      return {
        entryId,
        teamName: entry?.teamName ?? entryId,
        highlighted: isHighlightedEntry(entryId, highlightEntryId),
      };
    }),
  }));

  return { ready: true, emptyMessage: null, blocks };
}

/**
 * @param {object|null|undefined} schedule
 * @param {Map<string, object>} resultsMap
 * @param {Map<string, object>} sessionsMap
 * @param {string|null|undefined} highlightEntryId
 */
function buildScheduleSection(schedule, resultsMap, sessionsMap, highlightEntryId) {
  if (!schedule?.finalized) {
    return {
      ready: false,
      emptyMessage: "予選対戦表はまだ確定していません",
      blocks: [],
    };
  }

  const displaySchedule = normalizeQualifyingScheduleForDisplay(schedule);
  const merged = mergeMatchResultsIntoSchedule(displaySchedule, resultsMap);

  const blocks = merged.blocks.map((block) => ({
    blockId: block.blockId,
    blockName: block.blockName,
    rounds: block.rounds.map((round) => ({
      roundNumber: round.roundNumber,
      roundLabel: `第${round.roundNumber}節`,
      matches: round.matches.map((match) => {
        const session = sessionsMap.get(match.matchId) ?? null;
        const result = resultsMap.get(match.matchId) ?? match.result ?? null;
        const view = buildQualifyingMatchView(match, session, result);
        return {
          ...view,
          team1: {
            ...view.team1,
            highlighted: isHighlightedEntry(view.team1.entryId, highlightEntryId),
          },
          team2: {
            ...view.team2,
            highlighted: isHighlightedEntry(view.team2.entryId, highlightEntryId),
          },
        };
      }),
    })),
  }));

  return { ready: true, emptyMessage: null, blocks };
}

/**
 * @param {object|null|undefined} schedule
 * @param {Map<string, object>} resultsMap
 * @param {boolean} advancementFinalized
 * @param {string|null|undefined} highlightEntryId
 */
function buildStandingsSection(schedule, resultsMap, advancementFinalized, highlightEntryId) {
  if (!schedule?.finalized) {
    return {
      ready: false,
      emptyMessage: "予選結果はまだ入力されていません",
      label: null,
      blocks: [],
    };
  }

  const standings = buildQualifyingStandings(schedule, resultsMap);
  const hasAnyResults = resultsMap.size > 0;

  if (!hasAnyResults) {
    return {
      ready: false,
      emptyMessage: "予選結果はまだ入力されていません",
      label: null,
      blocks: [],
    };
  }

  return {
    ready: true,
    emptyMessage: null,
    label: advancementFinalized ? "確定順位" : "暫定順位",
    blocks: standings.blocks.map((block) => ({
      blockId: block.blockId,
      blockName: block.blockName,
      rows: block.standings.map((row) => ({
        rank: row.rank,
        entryId: row.entryId,
        teamName: row.teamName,
        playedMatches: row.playedMatches,
        setWins: row.setWins,
        setDraws: row.setDraws,
        setLosses: row.setLosses,
        totalScore: row.totalScore,
        remainingMatches: row.remainingMatches,
        highlighted: isHighlightedEntry(row.entryId, highlightEntryId),
      })),
    })),
  };
}

/**
 * @param {object|null|undefined} advancement
 * @param {string|null|undefined} highlightEntryId
 */
function buildFinalsAdvancementSection(advancement, highlightEntryId) {
  if (!advancement?.finalized || !advancement.qualifiers?.length) {
    return {
      ready: false,
      emptyMessage: "決勝進出チームはまだ確定していません",
      groups: [],
    };
  }

  const groups = [
    {
      source: FinalsQualifierSource.BLOCK_WINNER,
      label: FinalsQualifierSourceLabels[FinalsQualifierSource.BLOCK_WINNER],
      teams: [],
    },
    {
      source: FinalsQualifierSource.WILDCARD,
      label: FinalsQualifierSourceLabels[FinalsQualifierSource.WILDCARD],
      teams: [],
    },
  ];

  for (const qualifier of advancement.qualifiers) {
    const group =
      qualifier.source === FinalsQualifierSource.WILDCARD ? groups[1] : groups[0];
    group.teams.push({
      entryId: qualifier.entryId,
      teamName: qualifier.teamName,
      seed: qualifier.seed,
      blockName: qualifier.blockName ?? null,
      highlighted: isHighlightedEntry(qualifier.entryId, highlightEntryId),
    });
  }

  return {
    ready: true,
    emptyMessage: null,
    groups: groups.filter((group) => group.teams.length > 0),
  };
}

/**
 * @param {object|null|undefined} team
 */
function formatFinalsTeamLine(team) {
  if (!team) {
    return { type: "pending", label: "前ラウンド結果待ち" };
  }
  if (isByeTeam(team)) {
    return { type: "bye", label: "BYE" };
  }
  return {
    type: "team",
    entryId: team.entryId,
    teamName: team.teamName,
    seed: team.seed ?? null,
  };
}

/**
 * @param {object} params
 */
function getFinalsMatchTeamsForPublicDisplay({ match, bracket, resultsMap, progressEntry }) {
  const result = progressEntry?.result ?? resultsMap.get(match.matchId) ?? null;

  if (result?.winner) {
    return {
      team1: formatFinalsTeamLine(result.team1 ?? progressEntry?.resolvedTeams?.team1),
      team2: formatFinalsTeamLine(result.team2 ?? progressEntry?.resolvedTeams?.team2),
      winnerEntryId: result.winner.entryId ?? null,
      resultSummary: buildFinalsResultSummary(result),
    };
  }

  if (match.roundNumber === 1) {
    return {
      team1: formatFinalsTeamLine(match.team1),
      team2: formatFinalsTeamLine(match.team2),
      winnerEntryId: null,
      resultSummary: null,
    };
  }

  const resolved = progressEntry?.resolvedTeams ?? resolveFinalsMatchTeams({ match, bracket, resultsMap });
  return {
    team1: formatFinalsTeamLine(resolved.team1),
    team2: formatFinalsTeamLine(resolved.team2),
    winnerEntryId: null,
    resultSummary: null,
  };
}

/**
 * @param {object|null|undefined} result
 */
function buildFinalsResultSummary(result) {
  if (!result || result.status !== MatchResultStatus.FINISHED) {
    return null;
  }

  if (result.resolution === "bye") {
    return result.winner?.teamName ? `${result.winner.teamName}（BYE通過）` : "BYE通過";
  }

  const winner = result.winner?.teamName ?? "—";
  const loser = result.loser?.teamName ?? "—";
  const winnerSets = result.winnerSide === "team1" ? result.team1SetWins : result.team2SetWins;
  const loserSets = result.winnerSide === "team1" ? result.team2SetWins : result.team1SetWins;

  if (winnerSets != null && loserSets != null) {
    return `${winner} ${winnerSets} - ${loserSets} ${loser}`;
  }

  return `${winner} の勝ち`;
}

/**
 * @param {object|null|undefined} bracket
 * @param {Map<string, object>} resultsMap
 * @param {Map<string, object>} sessionsMap
 * @param {string|null|undefined} highlightEntryId
 */
function buildFinalsBracketSection(bracket, resultsMap, sessionsMap, highlightEntryId) {
  if (!bracket?.finalized) {
    return {
      ready: false,
      emptyMessage: "決勝トーナメントはまだ作成されていません",
      rounds: [],
      champion: null,
      runnerUp: null,
    };
  }

  const progressIndex = buildFinalsMatchProgressIndex(bracket, resultsMap, sessionsMap);
  const roundsMap = new Map();

  for (const match of bracket.matches ?? []) {
    if (!roundsMap.has(match.roundNumber)) {
      roundsMap.set(match.roundNumber, {
        roundNumber: match.roundNumber,
        roundLabel: match.roundLabel ?? getFinalsRoundLabel(bracket.bracketSize, match.roundNumber),
        matches: [],
      });
    }

    const progressEntry = progressIndex.get(match.matchId);
    const displayStatus = progressEntry?.displayStatus ?? FinalsMatchDisplayStatus.WAITING_OPPONENT;
    const teams = getFinalsMatchTeamsForPublicDisplay({
      match,
      bracket,
      resultsMap,
      progressEntry,
    });

    const applyHighlight = (teamLine) => {
      if (teamLine?.type !== "team") {
        return teamLine;
      }
      return {
        ...teamLine,
        highlighted: isHighlightedEntry(teamLine.entryId, highlightEntryId),
      };
    };

    roundsMap.get(match.roundNumber).matches.push({
      matchId: match.matchId,
      matchNumber: match.matchNumber,
      displayStatus,
      statusLabel: getFinalsMatchDisplayStatusLabel(displayStatus),
      team1: applyHighlight(teams.team1),
      team2: applyHighlight(teams.team2),
      winnerEntryId: teams.winnerEntryId,
      resultSummary: teams.resultSummary,
    });
  }

  const rounds = [...roundsMap.values()]
    .sort((a, b) => a.roundNumber - b.roundNumber)
    .map((round) => ({
      ...round,
      matches: round.matches.sort((a, b) => a.matchNumber - b.matchNumber),
    }));

  const { champion, runnerUp, complete } = getFinalsChampionAndRunnerUp(bracket, resultsMap);

  return {
    ready: true,
    emptyMessage: null,
    rounds,
    champion: complete && champion
      ? {
          entryId: champion.entryId,
          teamName: champion.teamName,
          seed: champion.seed ?? null,
          highlighted: isHighlightedEntry(champion.entryId, highlightEntryId),
        }
      : null,
    runnerUp: complete && runnerUp
      ? {
          entryId: runnerUp.entryId,
          teamName: runnerUp.teamName,
          seed: runnerUp.seed ?? null,
          highlighted: isHighlightedEntry(runnerUp.entryId, highlightEntryId),
        }
      : null,
  };
}

/**
 * @param {object|null|undefined} tournamentResults
 * @param {string|null|undefined} highlightEntryId
 */
function buildFinalResultsSection(tournament, tournamentResults, highlightEntryId) {
  if (tournament?.status !== TournamentStatus.CLOSED) {
    return {
      ready: false,
      emptyMessage: "最終結果はまだ確定していません",
      placements: [],
      champion: null,
      runnerUp: null,
    };
  }

  if (!tournamentResults?.finalized) {
    return {
      ready: false,
      emptyMessage: "最終結果はまだ確定していません",
      placements: [],
      champion: null,
      runnerUp: null,
    };
  }

  const placements = (tournamentResults.placements ?? []).map((placement) => ({
    entryId: placement.entryId,
    teamName: placement.teamName,
    placementLabel: placement.placementLabel ?? placement.label ?? "—",
    rank: placement.rank ?? null,
    highlighted: isHighlightedEntry(placement.entryId, highlightEntryId),
  }));

  return {
    ready: true,
    emptyMessage: null,
    champion: tournamentResults.champion
      ? {
          entryId: tournamentResults.champion.entryId,
          teamName: tournamentResults.champion.teamName,
          highlighted: isHighlightedEntry(tournamentResults.champion.entryId, highlightEntryId),
        }
      : null,
    runnerUp: tournamentResults.runnerUp
      ? {
          entryId: tournamentResults.runnerUp.entryId,
          teamName: tournamentResults.runnerUp.teamName,
          highlighted: isHighlightedEntry(tournamentResults.runnerUp.entryId, highlightEntryId),
        }
      : null,
    placements,
  };
}

/**
 * @param {object} params
 */
export function buildPublicTournamentView({
  tournament,
  entries = [],
  blockDraw = null,
  schedule = null,
  qualifyingResultsMap = new Map(),
  qualifyingSessionsMap = new Map(),
  finalsAdvancement = null,
  finalsBracket = null,
  finalsResultsMap = new Map(),
  finalsSessionsMap = new Map(),
  tournamentResults = null,
  highlightEntryId = null,
}) {
  const publicEntries = entries
    .filter((entry) => entry.status !== EntryStatus.CANCELLED)
    .map(sanitizeEntryForPublic)
    .map((entry) => ({
      ...entry,
      highlighted: isHighlightedEntry(entry.entryId, highlightEntryId),
    }));

  const confirmedCount = publicEntries.filter(
    (entry) => entry.status === EntryStatus.CONFIRMED
  ).length;

  const hasStarted = Boolean(
    blockDraw?.blocks?.length || schedule?.finalized || finalsAdvancement?.finalized
  );

  return {
    tournament: {
      id: tournament.id,
      name: tournament.name ?? "（名称未設定）",
      eventDate: tournament.eventDate ?? null,
      venue: tournament.venue ?? null,
      status: tournament.status,
      statusLabel: getPublicTournamentStatusLabel(tournament, { hasStarted }),
      maxTeams: tournament.maxTeams ?? null,
      courtCount: tournament.courtCount ?? null,
      entryCount: publicEntries.length,
      confirmedCount,
      publicViewEnabled: isPublicViewEnabled(tournament),
      participantResultEntryEnabled: tournament.participantResultEntryEnabled === true,
    },
    entries: {
      ready: publicEntries.length > 0,
      emptyMessage: "参加チームはまだ登録されていません",
      items: publicEntries,
    },
    blocks: buildBlocksSection(blockDraw, publicEntries, highlightEntryId),
    schedule: buildScheduleSection(
      schedule,
      qualifyingResultsMap,
      qualifyingSessionsMap,
      highlightEntryId
    ),
    standings: buildStandingsSection(
      schedule,
      qualifyingResultsMap,
      Boolean(finalsAdvancement?.finalized),
      highlightEntryId
    ),
    finalsAdvancement: buildFinalsAdvancementSection(finalsAdvancement, highlightEntryId),
    finalsBracket: buildFinalsBracketSection(
      finalsBracket,
      finalsResultsMap,
      finalsSessionsMap,
      highlightEntryId
    ),
    finalResults: buildFinalResultsSection(tournament, tournamentResults, highlightEntryId),
    highlightEntryId: highlightEntryId ?? null,
  };
}
