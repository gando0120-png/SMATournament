/**
 * 公開大会スナップショット（DOM / Firestore 非依存）
 */
import { buildPublicTournamentView, isHighlightedEntry } from "./public-tournament-view.js";
import { hasCreatedConsolationBracket } from "./consolation-bracket.js";
import {
  formatFinalsMatchRulesSummaryLines,
  normalizeFinalsMatchRules,
} from "./finals-match-format.js";

export const PUBLIC_SNAPSHOT_DOC_ID = "current";
export const PUBLIC_SNAPSHOT_SCHEMA_VERSION = 2;

/** スナップショットに含めてはいけないフィールド名 */
export const FORBIDDEN_SNAPSHOT_FIELDS = [
  "createdBy",
  "email",
  "comment",
  "privateMemo",
  "operatorUid",
  "isDummy",
  "dummyBatchId",
  "dummyIndex",
  "session",
  "sessionsMap",
  "qualifyingSessionsMap",
  "finalsSessionsMap",
  "consolationSessionsMap",
  "participantResultEntryEnabled",
  "publicViewEnabled",
  "token",
  "testSimulation",
  "simulationSeed",
  "debug",
];

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

export function findForbiddenSnapshotFields(snapshot) {
  const found = [];
  collectForbiddenFields(snapshot, "", found);
  return found;
}

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

function serializeFinalsMatchResults(resultsMap) {
  return [...resultsMap.values()].map((result) => {
    if (result.matchFormat === "multiTeamTotal") {
      return {
        matchId: result.matchId,
        roundNumber: result.roundNumber ?? null,
        matchNumber: result.matchNumber ?? null,
        matchFormat: "multiTeamTotal",
        status: result.status ?? null,
        resolution: result.resolution ?? null,
        participantEntryIds: result.participantEntryIds ?? [],
        scores: result.scores ?? null,
        totals: result.totals ?? null,
        rankingEntryIds: result.rankingEntryIds ?? null,
        qualifierEntryIds: result.qualifierEntryIds ?? null,
        tieResolution: result.tieResolution ?? null,
        setCount: result.setCount ?? 2,
        qualifiersCount: result.qualifiersCount ?? null,
      };
    }
    return {
      matchId: result.matchId,
      roundNumber: result.roundNumber ?? null,
      matchNumber: result.matchNumber ?? null,
      matchFormat: result.matchFormat ?? "headToHeadSets",
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
    };
  });
}

export function buildPublicTournamentSnapshot(params) {
  const view = buildPublicTournamentView({
    ...params,
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
      progressStatusLabel: view.tournament.progressStatusLabel,
      tournamentFormat: view.tournament.tournamentFormat,
      formatLabel: view.tournament.formatLabel,
      showFormatLabel: view.tournament.showFormatLabel,
      winsRequired: view.tournament.winsRequired ?? null,
      winsRequiredLabel: view.tournament.winsRequiredLabel ?? null,
      winsRequiredSummaryLines: view.tournament.winsRequiredSummaryLines ?? null,
      finalsMatchRules: view.tournament.finalsMatchRules ?? null,
      matchFormat: view.tournament.matchFormat ?? null,
      matchFormatLabel: view.tournament.matchFormatLabel ?? null,
      aggregateMatchRules: view.tournament.aggregateMatchRules ?? null,
      bracketMatchConfig: params.tournament?.bracketMatchConfig ?? null,
      maxTeams: view.tournament.maxTeams,
      teamSize: params.tournament?.teamSize ?? null,
      courtCount: view.tournament.courtCount,
      entryDeadline: serializeDeadline(params.tournament?.entryDeadline),
      entryCount: view.tournament.entryCount,
      confirmedCount: view.tournament.confirmedCount,
      blockCount: view.tournament.blockCount ?? null,
      qualifiersPerBlock: view.tournament.qualifiersPerBlock ?? null,
      finalQualifierCount: view.tournament.finalQualifierCount ?? null,
      teamCount: view.tournament.teamCount ?? null,
      bracketSize: view.tournament.bracketSize ?? null,
      byeCount: view.tournament.byeCount ?? null,
      isDeleted: params.tournament?.isDeleted === true,
    },
    registration: stripHighlightFields(view.sections.registration),
    qualifying: stripHighlightFields(view.sections.qualifying),
    advancement: stripHighlightFields(view.sections.advancement),
    bracket: stripHighlightFields(view.sections.bracket),
    results: stripHighlightFields(view.sections.results),
    qualifyingResults: serializeQualifyingResults(params.qualifyingResultsMap ?? new Map()),
    finalsMatchResults: serializeFinalsMatchResults(params.finalsResultsMap ?? new Map()),
  };

  if (hasCreatedConsolationBracket(params.consolationBracket)) {
    snapshot.consolationBracket = stripHighlightFields(view.sections.consolationBracket);
    snapshot.consolationMatchResults = serializeFinalsMatchResults(
      params.consolationResultsMap ?? new Map()
    );
  }

  return snapshot;
}

function applyHighlightToTeam(entryId, highlightEntryId) {
  return isHighlightedEntry(entryId, highlightEntryId);
}

function applyHighlightToTeamLine(teamLine, highlightEntryId) {
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
}

function applyHighlightsToNormalizedSnapshot(snapshot, highlightEntryId) {
  const registrationItems = (snapshot.registration?.items ?? []).map((team) => ({
    ...team,
    highlighted: applyHighlightToTeam(team.entryId, highlightEntryId),
  }));

  const qualifying = snapshot.qualifying ?? {
    visible: false,
    ready: false,
    blocks: { visible: false, ready: false, blocks: [] },
    schedule: { visible: false, ready: false, blocks: [] },
    standings: { visible: false, ready: false, blocks: [] },
  };

  const mapTeams = (teams = []) =>
    teams.map((team) => ({
      ...team,
      highlighted: applyHighlightToTeam(team.entryId, highlightEntryId),
    }));

  const blocks = qualifying.blocks
    ? {
        ...qualifying.blocks,
        blocks: (qualifying.blocks.blocks ?? []).map((block) => ({
          ...block,
          teams: mapTeams(block.teams),
        })),
      }
    : { visible: false, ready: false, emptyMessage: null, blocks: [] };

  const schedule = qualifying.schedule
    ? {
        ...qualifying.schedule,
        blocks: (qualifying.schedule.blocks ?? []).map((block) => ({
          ...block,
          rounds: (block.rounds ?? []).map((round) => ({
            ...round,
            matches: (round.matches ?? []).map((match) => ({
              ...match,
              team1: applyHighlightToTeamLine(match.team1, highlightEntryId),
              team2: applyHighlightToTeamLine(match.team2, highlightEntryId),
            })),
          })),
        })),
      }
    : { visible: false, ready: false, emptyMessage: null, blocks: [] };

  const standings = qualifying.standings
    ? {
        ...qualifying.standings,
        blocks: (qualifying.standings.blocks ?? []).map((block) => ({
          ...block,
          rows: (block.rows ?? []).map((row) => ({
            ...row,
            highlighted: applyHighlightToTeam(row.entryId, highlightEntryId),
          })),
        })),
      }
    : { visible: false, ready: false, emptyMessage: null, label: null, blocks: [] };

  const advancement = snapshot.advancement
    ? {
        ...snapshot.advancement,
        groups: (snapshot.advancement.groups ?? []).map((group) => ({
          ...group,
          teams: mapTeams(group.teams),
        })),
      }
    : {
        visible: false,
        ready: false,
        emptyMessage: null,
        finalized: false,
        usesWildcards: false,
        groups: [],
      };

  const bracket = snapshot.bracket
    ? {
        ...snapshot.bracket,
        rounds: (snapshot.bracket.rounds ?? []).map((round) => ({
          ...round,
          matches: (round.matches ?? []).map((match) => ({
            ...match,
            team1: applyHighlightToTeamLine(match.team1, highlightEntryId),
            team2: applyHighlightToTeamLine(match.team2, highlightEntryId),
          })),
        })),
        champion: snapshot.bracket.champion
          ? {
              ...snapshot.bracket.champion,
              highlighted: applyHighlightToTeam(
                snapshot.bracket.champion.entryId,
                highlightEntryId
              ),
            }
          : null,
        runnerUp: snapshot.bracket.runnerUp
          ? {
              ...snapshot.bracket.runnerUp,
              highlighted: applyHighlightToTeam(
                snapshot.bracket.runnerUp.entryId,
                highlightEntryId
              ),
            }
          : null,
      }
    : {
        visible: true,
        ready: false,
        emptyMessage: "決勝トーナメントはまだ作成されていません",
        title: "決勝トーナメント",
        showSeed: true,
        rounds: [],
        champion: null,
        runnerUp: null,
      };

  const mapHighlightedTeam = (team) =>
    team
      ? {
          ...team,
          highlighted: applyHighlightToTeam(team.entryId, highlightEntryId),
        }
      : null;

  const results = snapshot.results
    ? {
        ...snapshot.results,
        placements: (snapshot.results.placements ?? []).map((placement) => ({
          ...placement,
          highlighted: applyHighlightToTeam(placement.entryId, highlightEntryId),
        })),
        champion: mapHighlightedTeam(snapshot.results.champion),
        runnerUp: mapHighlightedTeam(snapshot.results.runnerUp),
        consolation: snapshot.results.consolation
          ? {
              ...snapshot.results.consolation,
              champion: mapHighlightedTeam(snapshot.results.consolation.champion),
              runnerUp: mapHighlightedTeam(snapshot.results.consolation.runnerUp),
              placements: (snapshot.results.consolation.placements ?? []).map((placement) => ({
                ...placement,
                highlighted: applyHighlightToTeam(placement.entryId, highlightEntryId),
              })),
              placementGroups: (snapshot.results.consolation.placementGroups ?? []).map(
                (group) => ({
                  ...group,
                  items: (group.items ?? []).map((item) => ({
                    ...item,
                    highlighted: applyHighlightToTeam(item.entryId, highlightEntryId),
                  })),
                })
              ),
            }
          : {
              visible: false,
              ready: false,
              status: "absent",
              placements: [],
              placementGroups: [],
              champion: null,
              runnerUp: null,
            },
      }
    : {
        visible: true,
        ready: false,
        emptyMessage: "最終結果はまだ確定していません",
        placements: [],
        placementGroups: [],
        champion: null,
        runnerUp: null,
        consolation: {
          visible: false,
          ready: false,
          status: "absent",
          placements: [],
          placementGroups: [],
          champion: null,
          runnerUp: null,
        },
      };

  const consolationBracket = snapshot.consolationBracket
    ? {
        ...snapshot.consolationBracket,
        rounds: (snapshot.consolationBracket.rounds ?? []).map((round) => ({
          ...round,
          matches: (round.matches ?? []).map((match) => ({
            ...match,
            team1: applyHighlightToTeamLine(match.team1, highlightEntryId),
            team2: applyHighlightToTeamLine(match.team2, highlightEntryId),
          })),
        })),
        champion: snapshot.consolationBracket.champion
          ? {
              ...snapshot.consolationBracket.champion,
              highlighted: applyHighlightToTeam(
                snapshot.consolationBracket.champion.entryId,
                highlightEntryId
              ),
            }
          : null,
        runnerUp: snapshot.consolationBracket.runnerUp
          ? {
              ...snapshot.consolationBracket.runnerUp,
              highlighted: applyHighlightToTeam(
                snapshot.consolationBracket.runnerUp.entryId,
                highlightEntryId
              ),
            }
          : null,
      }
    : {
        visible: false,
        ready: false,
        emptyMessage: null,
        title: "下位トーナメント",
        showSeed: false,
        rounds: [],
        champion: null,
        runnerUp: null,
        teamCount: null,
        bracketSize: null,
        byeCount: null,
        placementMode: null,
      };

  const registration = { ...snapshot.registration, items: registrationItems };
  const sections = {
    registration,
    qualifying: { ...qualifying, blocks, schedule, standings },
    advancement,
    bracket,
    consolationBracket,
    results,
  };

  return {
    tournament: {
      ...snapshot.tournament,
      publicViewEnabled: true,
      participantResultEntryEnabled: false,
    },
    sections,
    entries: registration,
    blocks,
    schedule,
    standings,
    finalsAdvancement: advancement,
    finalsBracket: bracket,
    consolationBracket,
    finalResults: results,
    highlightEntryId: highlightEntryId ?? null,
  };
}

function buildViewFromLegacySnapshot(snapshot, highlightEntryId) {
  const teams = (snapshot.teams ?? []).map((team) => ({
    entryId: team.entryId,
    teamName: team.teamName,
    members: team.members ?? [],
    status: null,
    highlighted: applyHighlightToTeam(team.entryId, highlightEntryId),
  }));

  const registration = {
    visible: true,
    ready: teams.length > 0,
    emptyMessage: "参加チームはまだ登録されていません",
    items: teams,
  };

  const legacyBlocks = snapshot.blocks
    ? { visible: true, ...snapshot.blocks }
    : { visible: true, ready: false, emptyMessage: "ブロック分けはまだ確定していません", blocks: [] };

  const legacySchedule = snapshot.qualifyingSchedule
    ? { visible: true, ...snapshot.qualifyingSchedule }
    : { visible: true, ready: false, emptyMessage: "予選対戦表はまだ確定していません", blocks: [] };

  const legacyStandings = snapshot.standings
    ? { visible: true, ...snapshot.standings }
    : {
        visible: true,
        ready: false,
        emptyMessage: "予選結果はまだ入力されていません",
        label: null,
        blocks: [],
      };

  const legacyAdvancement = snapshot.finalsAdvancement
    ? { visible: true, ...snapshot.finalsAdvancement }
    : {
        visible: true,
        ready: false,
        emptyMessage: "決勝進出チームはまだ確定していません",
        finalized: false,
        usesWildcards: false,
        groups: [],
      };

  const legacyBracket = snapshot.finalsBracket
    ? {
        visible: true,
        title: "決勝トーナメント",
        showSeed: true,
        ...snapshot.finalsBracket,
      }
    : {
        visible: true,
        ready: false,
        emptyMessage: "決勝トーナメントはまだ作成されていません",
        title: "決勝トーナメント",
        showSeed: true,
        rounds: [],
        champion: null,
        runnerUp: null,
      };

  const legacyResults = snapshot.finalResults
    ? { visible: true, placementGroups: [], ...snapshot.finalResults }
    : {
        visible: true,
        ready: false,
        emptyMessage: "最終結果はまだ確定していません",
        placements: [],
        placementGroups: [],
        champion: null,
        runnerUp: null,
      };

  const sections = {
    registration,
    qualifying: {
      visible: true,
      ready: legacyBlocks.ready || legacySchedule.ready || legacyStandings.ready,
      blocks: legacyBlocks,
      schedule: legacySchedule,
      standings: legacyStandings,
    },
    advancement: legacyAdvancement,
    bracket: legacyBracket,
    results: legacyResults,
  };

  const matchRules = normalizeFinalsMatchRules(snapshot.tournament);
  const winsRequiredSummaryLines =
    snapshot.tournament?.winsRequiredSummaryLines ??
    formatFinalsMatchRulesSummaryLines(snapshot.tournament);
  return {
    tournament: {
      ...snapshot.tournament,
      tournamentFormat: snapshot.tournament?.tournamentFormat ?? "legacy",
      formatLabel: snapshot.tournament?.formatLabel ?? "予選＋決勝（従来形式）",
      showFormatLabel: true,
      winsRequired: matchRules.defaultWinsRequired,
      winsRequiredLabel:
        snapshot.tournament?.winsRequiredLabel ?? winsRequiredSummaryLines.join(" / "),
      winsRequiredSummaryLines,
      finalsMatchRules: snapshot.tournament?.finalsMatchRules ?? matchRules,
      progressStatusLabel:
        snapshot.tournament?.progressStatusLabel ?? snapshot.tournament?.statusLabel,
      publicViewEnabled: true,
      participantResultEntryEnabled: false,
    },
    sections,
    entries: registration,
    blocks: legacyBlocks,
    schedule: legacySchedule,
    standings: legacyStandings,
    finalsAdvancement: legacyAdvancement,
    finalsBracket: legacyBracket,
    finalResults: legacyResults,
    highlightEntryId: highlightEntryId ?? null,
  };
}

export function buildPublicTournamentViewFromSnapshot(snapshot, highlightEntryId = null) {
  if (!snapshot) {
    return null;
  }

  if ((snapshot.schemaVersion ?? 1) >= 2 && snapshot.registration) {
    return applyHighlightsToNormalizedSnapshot(snapshot, highlightEntryId);
  }

  return buildViewFromLegacySnapshot(snapshot, highlightEntryId);
}
