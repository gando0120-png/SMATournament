/**
 * 公開大会スナップショット（DOM / Firestore 非依存）
 */
import { buildPublicTournamentView, isHighlightedEntry } from "./public-tournament-view.js";

export const PUBLIC_SNAPSHOT_DOC_ID = "current";
export const PUBLIC_SNAPSHOT_SCHEMA_VERSION = 1;

/** スナップショットに含めてはいけないフィールド名 */
export const FORBIDDEN_SNAPSHOT_FIELDS = [
  "createdBy",
  "email",
  "comment",
  "privateMemo",
  "operatorUid",
  "session",
  "sessionsMap",
  "qualifyingSessionsMap",
  "finalsSessionsMap",
  "participantResultEntryEnabled",
  "publicViewEnabled",
  "token",
  "debug",
];

/**
 * @param {unknown} value
 * @param {string} path
 * @param {string[]} found
 */
function collectForbiddenFields(value, path, found) {
  if (value == null || typeof value !== "object") {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => collectForbiddenFields(item, `${path}[${index}]`, found));
    return;
  }

  for (const [key, nested] of Object.entries(value)) {
    const currentPath = path ? `${path}.${key}` : key;
    if (FORBIDDEN_SNAPSHOT_FIELDS.includes(key)) {
      found.push(currentPath);
    }
    collectForbiddenFields(nested, currentPath, found);
  }
}

/**
 * @param {object} snapshot
 */
export function findForbiddenSnapshotFields(snapshot) {
  const found = [];
  collectForbiddenFields(snapshot, "", found);
  return found;
}

/**
 * @param {object|null|undefined} timestamp
 */
function serializeDeadline(timestamp) {
  if (!timestamp) {
    return null;
  }
  if (typeof timestamp.toDate === "function") {
    return timestamp.toDate().toISOString();
  }
  if (timestamp instanceof Date) {
    return timestamp.toISOString();
  }
  if (typeof timestamp === "string") {
    return timestamp;
  }
  return null;
}

/**
 * @param {object|null|undefined} value
 */
function stripHighlightFields(value) {
  if (value == null || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => stripHighlightFields(item));
  }

  const next = {};
  for (const [key, nested] of Object.entries(value)) {
    if (key === "highlighted") {
      continue;
    }
    next[key] = stripHighlightFields(nested);
  }
  return next;
}

/**
 * @param {Map<string, object>} resultsMap
 */
function serializeQualifyingResults(resultsMap) {
  return [...resultsMap.values()].map((result) => ({
    matchId: result.matchId,
    blockId: result.blockId ?? null,
    roundNumber: result.roundNumber ?? null,
    courtNumber: result.courtNumber ?? null,
    team1: result.team1 ?? null,
    team2: result.team2 ?? null,
    sets: result.sets ?? [],
    team1Stats: result.team1Stats ?? null,
    team2Stats: result.team2Stats ?? null,
    status: result.status ?? null,
  }));
}

/**
 * @param {Map<string, object>} resultsMap
 */
function serializeFinalsMatchResults(resultsMap) {
  return [...resultsMap.values()].map((result) => ({
    matchId: result.matchId,
    roundNumber: result.roundNumber ?? null,
    matchNumber: result.matchNumber ?? null,
    status: result.status ?? null,
    resolution: result.resolution ?? null,
    team1: result.team1 ?? null,
    team2: result.team2 ?? null,
    winner: result.winner ?? null,
    loser: result.loser ?? null,
    sets: result.sets ?? [],
    team1SetWins: result.team1SetWins ?? null,
    team2SetWins: result.team2SetWins ?? null,
    winnerSide: result.winnerSide ?? null,
  }));
}

/**
 * @param {object} params
 */
export function buildPublicTournamentSnapshot({
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
}) {
  const view = buildPublicTournamentView({
    tournament,
    entries,
    blockDraw,
    schedule,
    qualifyingResultsMap,
    qualifyingSessionsMap,
    finalsAdvancement,
    finalsBracket,
    finalsResultsMap,
    finalsSessionsMap,
    tournamentResults,
    highlightEntryId: null,
  });

  const snapshot = {
    schemaVersion: PUBLIC_SNAPSHOT_SCHEMA_VERSION,
    tournament: {
      name: view.tournament.name,
      eventDate: view.tournament.eventDate,
      venue: view.tournament.venue,
      status: view.tournament.status,
      statusLabel: view.tournament.statusLabel,
      maxTeams: view.tournament.maxTeams,
      teamSize: tournament.teamSize ?? null,
      courtCount: view.tournament.courtCount,
      entryDeadline: serializeDeadline(tournament.entryDeadline),
      entryCount: view.tournament.entryCount,
      confirmedCount: view.tournament.confirmedCount,
    },
    teams: view.entries.items.map((entry) => ({
      entryId: entry.entryId,
      teamName: entry.teamName,
      members: entry.members ?? [],
    })),
    blocks: stripHighlightFields(view.blocks),
    qualifyingSchedule: stripHighlightFields(view.schedule),
    qualifyingResults: serializeQualifyingResults(qualifyingResultsMap),
    standings: stripHighlightFields(view.standings),
    finalsAdvancement: stripHighlightFields(view.finalsAdvancement),
    finalsBracket: stripHighlightFields(view.finalsBracket),
    finalsMatchResults: serializeFinalsMatchResults(finalsResultsMap),
    finalResults: stripHighlightFields(view.finalResults),
  };

  return snapshot;
}

/**
 * @param {object|null|undefined} section
 * @param {string|null|undefined} highlightEntryId
 */
function applyHighlightToTeam(entryId, highlightEntryId) {
  return isHighlightedEntry(entryId, highlightEntryId);
}

/**
 * @param {object} snapshot
 * @param {string|null|undefined} highlightEntryId
 */
export function buildPublicTournamentViewFromSnapshot(snapshot, highlightEntryId = null) {
  if (!snapshot) {
    return null;
  }

  const teams = (snapshot.teams ?? []).map((team) => ({
    entryId: team.entryId,
    teamName: team.teamName,
    members: team.members ?? [],
    status: null,
    highlighted: applyHighlightToTeam(team.entryId, highlightEntryId),
  }));

  const applyTeamHighlight = (teamLine) => {
    if (!teamLine || typeof teamLine !== "object") {
      return teamLine;
    }
    if (teamLine.entryId) {
      return {
        ...teamLine,
        highlighted: applyHighlightToTeam(teamLine.entryId, highlightEntryId),
      };
    }
    return teamLine;
  };

  const blocks = snapshot.blocks?.blocks?.map((block) => ({
    ...block,
    teams: (block.teams ?? []).map((team) => ({
      ...team,
      highlighted: applyHighlightToTeam(team.entryId, highlightEntryId),
    })),
  }));

  const scheduleBlocks = snapshot.qualifyingSchedule?.blocks?.map((block) => ({
    ...block,
    rounds: (block.rounds ?? []).map((round) => ({
      ...round,
      matches: (round.matches ?? []).map((match) => ({
        ...match,
        team1: applyTeamHighlight(match.team1),
        team2: applyTeamHighlight(match.team2),
      })),
    })),
  }));

  const standingsBlocks = snapshot.standings?.blocks?.map((block) => ({
    ...block,
    rows: (block.rows ?? []).map((row) => ({
      ...row,
      highlighted: applyHighlightToTeam(row.entryId, highlightEntryId),
    })),
  }));

  const finalsGroups = snapshot.finalsAdvancement?.groups?.map((group) => ({
    ...group,
    teams: (group.teams ?? []).map((team) => ({
      ...team,
      highlighted: applyHighlightToTeam(team.entryId, highlightEntryId),
    })),
  }));

  const finalsRounds = snapshot.finalsBracket?.rounds?.map((round) => ({
    ...round,
    matches: (round.matches ?? []).map((match) => ({
      ...match,
      team1: applyTeamHighlight(match.team1),
      team2: applyTeamHighlight(match.team2),
    })),
  }));

  const champion = snapshot.finalsBracket?.champion
    ? {
        ...snapshot.finalsBracket.champion,
        highlighted: applyHighlightToTeam(
          snapshot.finalsBracket.champion.entryId,
          highlightEntryId
        ),
      }
    : null;

  const runnerUp = snapshot.finalsBracket?.runnerUp
    ? {
        ...snapshot.finalsBracket.runnerUp,
        highlighted: applyHighlightToTeam(
          snapshot.finalsBracket.runnerUp.entryId,
          highlightEntryId
        ),
      }
    : null;

  const finalPlacements = snapshot.finalResults?.placements?.map((placement) => ({
    ...placement,
    highlighted: applyHighlightToTeam(placement.entryId, highlightEntryId),
  }));

  return {
    tournament: {
      ...snapshot.tournament,
      publicViewEnabled: true,
      participantResultEntryEnabled: false,
    },
    entries: {
      ready: teams.length > 0,
      emptyMessage: "参加チームはまだ登録されていません",
      items: teams,
    },
    blocks: snapshot.blocks
      ? { ...snapshot.blocks, blocks: blocks ?? [] }
      : { ready: false, emptyMessage: "ブロック分けはまだ確定していません", blocks: [] },
    schedule: snapshot.qualifyingSchedule
      ? { ...snapshot.qualifyingSchedule, blocks: scheduleBlocks ?? [] }
      : { ready: false, emptyMessage: "予選対戦表はまだ確定していません", blocks: [] },
    standings: snapshot.standings
      ? { ...snapshot.standings, blocks: standingsBlocks ?? [] }
      : { ready: false, emptyMessage: "予選結果はまだ入力されていません", label: null, blocks: [] },
    finalsAdvancement: snapshot.finalsAdvancement
      ? { ...snapshot.finalsAdvancement, groups: finalsGroups ?? [] }
      : {
          ready: false,
          emptyMessage: "決勝進出チームはまだ確定していません",
          groups: [],
        },
    finalsBracket: snapshot.finalsBracket
      ? {
          ...snapshot.finalsBracket,
          rounds: finalsRounds ?? [],
          champion,
          runnerUp,
        }
      : {
          ready: false,
          emptyMessage: "決勝トーナメントはまだ作成されていません",
          rounds: [],
          champion: null,
          runnerUp: null,
        },
    finalResults: snapshot.finalResults
      ? {
          ...snapshot.finalResults,
          placements: finalPlacements ?? [],
          champion: snapshot.finalResults.champion
            ? {
                ...snapshot.finalResults.champion,
                highlighted: applyHighlightToTeam(
                  snapshot.finalResults.champion.entryId,
                  highlightEntryId
                ),
              }
            : null,
          runnerUp: snapshot.finalResults.runnerUp
            ? {
                ...snapshot.finalResults.runnerUp,
                highlighted: applyHighlightToTeam(
                  snapshot.finalResults.runnerUp.entryId,
                  highlightEntryId
                ),
              }
            : null,
        }
      : {
          ready: false,
          emptyMessage: "最終結果はまだ確定していません",
          placements: [],
          champion: null,
          runnerUp: null,
        },
    highlightEntryId: highlightEntryId ?? null,
  };
}
