/**
 * EmergencyExportV1 derived（DOM / Firestore 非依存）
 * 現行 domain の順位・進出・時刻・試合状態ロジックを再利用する。
 */
import { EntryStatus, MatchResultStatus, TournamentStatus } from "./constants.js";
import { isBlockDrawDraft, isBlockDrawFinalized } from "./block-draw-state.js";
import {
  applyMolkkyOutResolutions,
  buildQualifyingStandings,
  hasUnresolvedBlockMolkkyOuts,
  listUnresolvedBlockMolkkyOutGroups,
} from "./qualifying-standings.js";
import {
  buildFinalsAdvancementPreview,
  getQualifyingCompletionStatus,
} from "./finals-advancement.js";
import {
  MatchDisplayStatus,
  getMatchDisplayStatusLabel,
  resolveMatchDisplayState,
} from "./qualifying-match-session.js";
import {
  FinalsMatchDisplayStatus,
  getFinalsChampionAndRunnerUp,
  getFinalsMatchDisplayStatusLabel,
  resolveFinalsMatchDisplayStatus,
  resolveFinalsMatchTeams,
} from "./finals-match-progress.js";
import { resolveMatchCourtNumber } from "./finals-court-assignment.js";
import {
  MatchReconciliationState,
  planTeamNumberAssignments,
} from "./player-qualifying-submission.js";
import {
  buildFinalsPublicTimeSchedule,
  buildQualifyingPublicTimeSchedule,
  normalizeTimeScheduleDoc,
  resolveScheduledSlotForMatch,
} from "./time-schedule.js";
import { buildEntryTeamNameLookup, resolveLiveTeamName } from "./entry-team-name-overlay.js";
import { resolveMainRankingMode, formatLossBandTournamentStatusLabel } from "./loss-band/config.js";
import { RankingMode } from "./loss-band/constants.js";
import { pairingsFromRoundDoc } from "./loss-band/persistence.js";
import {
  EmergencyExportMatchPhase,
  EmergencyExportPhase,
  EMERGENCY_EXPORT_PHASE_LABELS_JA,
} from "./emergency-export-schema.js";

function asArray(value) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value;
  }
  if (value instanceof Map) {
    return [...value.values()];
  }
  if (typeof value === "object") {
    return Object.values(value);
  }
  return [];
}

function toIdMap(value) {
  if (!value) {
    return {};
  }
  if (value instanceof Map) {
    const object = {};
    for (const [key, nested] of value.entries()) {
      object[String(key)] = nested;
    }
    return object;
  }
  if (Array.isArray(value)) {
    const object = {};
    for (const item of value) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const id = item.matchId ?? item.roundId ?? item.entryId ?? item.id;
      if (id) {
        object[String(id)] = item;
      }
    }
    return object;
  }
  if (typeof value === "object") {
    return { ...value };
  }
  return {};
}

function asMap(value) {
  if (value instanceof Map) {
    return value;
  }
  const map = new Map();
  for (const [id, doc] of Object.entries(toIdMap(value))) {
    map.set(id, doc);
  }
  return map;
}

/**
 * @param {Array<object>} entries
 * @returns {Map<string, { entryId: string, teamName: string, displayTeamNumber: number|null, storedTeamNumber: number|null, isDummy: boolean, status: string }>}
 */
export function buildEmergencyTeamIndex(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const confirmed = list.filter((entry) => entry?.status === EntryStatus.CONFIRMED);
  const forPlan = confirmed.map((entry) => ({
    ...entry,
    id: entry.id ?? entry.entryId,
  }));
  const plan = planTeamNumberAssignments(forPlan);
  const index = new Map();
  for (const entry of list) {
    const entryId = String(entry.id ?? entry.entryId ?? "");
    if (!entryId) {
      continue;
    }
    const storedRaw = Number(entry.teamNumber);
    const storedTeamNumber = Number.isInteger(storedRaw) && storedRaw >= 1 ? storedRaw : null;
    index.set(entryId, {
      entryId,
      teamName: typeof entry.teamName === "string" && entry.teamName.trim() ? entry.teamName.trim() : "—",
      displayTeamNumber: plan.byEntryId.get(entryId) ?? storedTeamNumber,
      storedTeamNumber,
      isDummy: entry.isDummy === true,
      status: entry.status ?? null,
    });
  }
  return index;
}

function teamRef(entryId, teamIndex, fallbackName = null) {
  if (!entryId) {
    return {
      entryId: null,
      teamName: fallbackName || "—",
      displayTeamNumber: null,
    };
  }
  const found = teamIndex.get(String(entryId));
  if (!found) {
    return {
      entryId: String(entryId),
      teamName: fallbackName || "—",
      displayTeamNumber: null,
    };
  }
  return {
    entryId: found.entryId,
    teamName: fallbackName && fallbackName !== "—" ? fallbackName : found.teamName,
    displayTeamNumber: found.displayTeamNumber,
  };
}

function overlayQualifyingPipelineStatus(baseStatus, matchId, officialExists, reconciliations) {
  if (officialExists || baseStatus === MatchDisplayStatus.FINISHED) {
    return { status: MatchDisplayStatus.FINISHED, pipelineStatus: null };
  }
  const recon = reconciliations.get(matchId);
  const state = recon?.state ?? null;
  if (state === MatchReconciliationState.CONFLICT) {
    return { status: "conflict", pipelineStatus: MatchReconciliationState.CONFLICT };
  }
  if (state === MatchReconciliationState.AWAITING_OPPONENT) {
    return {
      status: "awaiting_opponent",
      pipelineStatus: MatchReconciliationState.AWAITING_OPPONENT,
    };
  }
  if (state === MatchReconciliationState.MATCHED) {
    return { status: baseStatus, pipelineStatus: MatchReconciliationState.MATCHED };
  }
  return { status: baseStatus, pipelineStatus: state };
}

function statusLabelJa(status) {
  switch (status) {
    case MatchDisplayStatus.NOT_STARTED:
    case "notStarted":
      return getMatchDisplayStatusLabel(MatchDisplayStatus.NOT_STARTED);
    case MatchDisplayStatus.PLAYING:
      return getMatchDisplayStatusLabel(MatchDisplayStatus.PLAYING);
    case MatchDisplayStatus.FINISHED:
      return getMatchDisplayStatusLabel(MatchDisplayStatus.FINISHED);
    case "awaiting_opponent":
      return "提出待ち（相手）";
    case "conflict":
      return "提出競合";
    case FinalsMatchDisplayStatus.READY:
      return getFinalsMatchDisplayStatusLabel(FinalsMatchDisplayStatus.READY);
    case FinalsMatchDisplayStatus.WAITING_OPPONENT:
      return getFinalsMatchDisplayStatusLabel(FinalsMatchDisplayStatus.WAITING_OPPONENT);
    case FinalsMatchDisplayStatus.BYE:
      return getFinalsMatchDisplayStatusLabel(FinalsMatchDisplayStatus.BYE);
    default:
      return status ?? "—";
  }
}

function isOpenMatchStatus(status) {
  return (
    status !== MatchDisplayStatus.FINISHED &&
    status !== FinalsMatchDisplayStatus.FINISHED &&
    status !== FinalsMatchDisplayStatus.BYE &&
    status !== "finished" &&
    status !== "bye"
  );
}

function collectQualifyingMatches(schedule) {
  const matches = [];
  for (const block of schedule?.blocks || []) {
    for (const round of block.rounds || []) {
      for (const match of round.matches || []) {
        matches.push({
          match,
          blockId: block.blockId ?? null,
          blockName: block.blockName ?? null,
          roundNumber: round.roundNumber ?? match.roundNumber ?? null,
        });
      }
    }
  }
  return matches;
}

function buildScheduledTimeLookup(input) {
  const settings = normalizeTimeScheduleDoc(input.timeSchedule);
  const lookup = new Map();
  const rows = [];
  const teamCount = (input.entries || []).filter((e) => e.status === EntryStatus.CONFIRMED).length;

  const qualifyingLookup = buildQualifyingPublicTimeSchedule(settings, input.qualifyingSchedule);
  if (qualifyingLookup) {
    for (const item of collectQualifyingMatches(input.qualifyingSchedule)) {
      const resolved = resolveScheduledSlotForMatch(
        qualifyingLookup,
        item.roundNumber,
        item.match.matchId
      );
      if (resolved?.startTime && item.match.matchId) {
        const isOverride = resolved.matchManual === true;
        lookup.set(item.match.matchId, {
          startTime: resolved.startTime,
          isOverride,
          phase: EmergencyExportMatchPhase.QUALIFYING,
          roundNumber: item.roundNumber,
        });
        rows.push({
          matchId: item.match.matchId,
          phase: EmergencyExportMatchPhase.QUALIFYING,
          roundNumber: item.roundNumber,
          startTime: resolved.startTime,
          isOverride,
        });
      }
    }
  }

  const finalsLookup = buildFinalsPublicTimeSchedule({
    settings,
    tournament: input.tournament,
    schedule: input.qualifyingSchedule,
    blockDraw: input.blockDraw,
    finalsBracket: input.finalsBracket,
    teamCount,
  });
  if (finalsLookup) {
    for (const match of input.finalsBracket?.matches || []) {
      const resolved = resolveScheduledSlotForMatch(
        finalsLookup,
        match.roundNumber,
        match.matchId
      );
      if (resolved?.startTime && match.matchId) {
        const isOverride = resolved.matchManual === true;
        lookup.set(match.matchId, {
          startTime: resolved.startTime,
          isOverride,
          phase: EmergencyExportMatchPhase.FINALS,
          roundNumber: match.roundNumber,
        });
        rows.push({
          matchId: match.matchId,
          phase: EmergencyExportMatchPhase.FINALS,
          roundNumber: match.roundNumber,
          startTime: resolved.startTime,
          isOverride,
        });
      }
    }
  }

  return { lookup, rows };
}

function qualifierEntryIdsFromAdvancement(advancement) {
  return (advancement?.qualifiers || [])
    .map((item) => item?.entryId)
    .filter(Boolean)
    .map(String);
}

function expandQualifier(qualifier, teamIndex) {
  const ref = teamRef(qualifier?.entryId, teamIndex, qualifier?.teamName);
  return {
    ...ref,
    blockId: qualifier?.blockId ?? null,
    blockName: qualifier?.blockName ?? null,
    blockRank: qualifier?.blockRank ?? null,
    source: qualifier?.source ?? null,
    seed: qualifier?.seed ?? null,
  };
}

function buildQualifyingStandingsDerived(schedule, resultsMap, molkkyOutResolutions, teamIndex) {
  const base = buildQualifyingStandings(schedule, resultsMap);
  if (!base) {
    return null;
  }
  const resolved = applyMolkkyOutResolutions(base, molkkyOutResolutions);
  return {
    finalized: resolved.finalized === true,
    blocks: (resolved.blocks || []).map((block) => ({
      blockId: block.blockId,
      blockName: block.blockName,
      teamCount: block.teamCount ?? null,
      standings: (block.standings || []).map((row) => {
        const ref = teamRef(row.entryId, teamIndex, row.teamName);
        return {
          entryId: ref.entryId,
          teamName: ref.teamName,
          displayTeamNumber: ref.displayTeamNumber,
          symbol: row.symbol ?? "",
          rank: row.rank ?? null,
          setWins: row.setWins ?? 0,
          setDraws: row.setDraws ?? 0,
          setLosses: row.setLosses ?? 0,
          totalScore: row.totalScore ?? 0,
          playedMatches: row.playedMatches ?? 0,
          remainingMatches: row.remainingMatches ?? 0,
          tied: row.tied === true,
          needsMolkkyOut: row.needsMolkkyOut === true,
          molkkyOutApplied: row.needsMolkkyOut !== true && row.tied === true,
        };
      }),
    })),
  };
}

function resolvePhase({
  tournament,
  blockDraw,
  schedule,
  completion,
  unresolvedMolkky,
  finalsAdvancement,
  finalsBracket,
  consolationBracket,
  consolationRemaining,
  finalsRemaining,
  lossBandState,
  tournamentResults,
}) {
  if (tournamentResults || tournament?.status === TournamentStatus.CLOSED) {
    return EmergencyExportPhase.COMPLETED;
  }
  if (resolveMainRankingMode(tournament) === RankingMode.LOSS_BAND && lossBandState) {
    if (lossBandState.status === "completed") {
      return EmergencyExportPhase.COMPLETED;
    }
    return EmergencyExportPhase.LOSS_BAND_IN_PROGRESS;
  }
  if (consolationBracket && consolationRemaining > 0) {
    return EmergencyExportPhase.CONSOLATION_IN_PROGRESS;
  }
  if (finalsBracket && finalsRemaining > 0) {
    return EmergencyExportPhase.FINALS_IN_PROGRESS;
  }
  if (finalsAdvancement?.finalized) {
    if (!finalsBracket) {
      return EmergencyExportPhase.AWAITING_ADVANCEMENT;
    }
    return EmergencyExportPhase.FINALS_IN_PROGRESS;
  }
  if (schedule?.finalized) {
    if (completion?.complete && unresolvedMolkky) {
      return EmergencyExportPhase.AWAITING_MOLKKY_OUT;
    }
    if (completion?.complete) {
      return EmergencyExportPhase.AWAITING_ADVANCEMENT;
    }
    if ((completion?.finishedMatches ?? 0) > 0 || (completion?.remainingMatches ?? 0) < (completion?.totalMatches ?? 0)) {
      if ((completion?.finishedMatches ?? 0) > 0) {
        return EmergencyExportPhase.QUALIFYING_IN_PROGRESS;
      }
    }
    return (completion?.finishedMatches ?? 0) > 0
      ? EmergencyExportPhase.QUALIFYING_IN_PROGRESS
      : EmergencyExportPhase.QUALIFYING_SCHEDULED;
  }
  if (isBlockDrawDraft(blockDraw)) {
    return EmergencyExportPhase.BLOCK_DRAW_DRAFT;
  }
  if (isBlockDrawFinalized(blockDraw)) {
    return EmergencyExportPhase.QUALIFYING_SCHEDULED;
  }
  return EmergencyExportPhase.REGISTRATION;
}

/**
 * @param {object} input
 * @param {object} source
 */
export function buildEmergencyExportDerived(input, source) {
  const entries = Array.isArray(input.entries) ? input.entries : [];
  const teamIndex = buildEmergencyTeamIndex(entries);
  const nameLookup = buildEntryTeamNameLookup(entries);
  const resultsMap = asMap(input.qualifyingMatchResults);
  const sessionsMap = asMap(input.qualifyingMatchSessions);
  const reconciliations = asMap(input.qualifyingMatchReconciliations);
  const schedule = input.qualifyingSchedule ?? null;
  const completion = getQualifyingCompletionStatus(schedule, resultsMap);
  const qualifyingStandings = buildQualifyingStandingsDerived(
    schedule,
    resultsMap,
    input.molkkyOutResolutions,
    teamIndex
  );
  const unresolvedMolkky = hasUnresolvedBlockMolkkyOuts(qualifyingStandings);
  const { lookup: scheduledLookup, rows: scheduledTimes } = buildScheduledTimeLookup(input);

  const confirmedEntries = entries
    .filter((entry) => entry?.status === EntryStatus.CONFIRMED)
    .map((entry) => {
      const entryId = String(entry.id ?? entry.entryId);
      const found = teamIndex.get(entryId);
      return {
        entryId,
        teamName: found?.teamName ?? entry.teamName ?? "—",
        displayTeamNumber: found?.displayTeamNumber ?? null,
        storedTeamNumber: found?.storedTeamNumber ?? null,
        isDummy: entry.isDummy === true,
      };
    })
    .sort((a, b) => (a.displayTeamNumber ?? 9999) - (b.displayTeamNumber ?? 9999));

  const matchDisplayStates = [];
  const remainingMatches = [];

  function pushRemaining(state) {
    if (!isOpenMatchStatus(state.status)) {
      return;
    }
    remainingMatches.push({
      matchId: state.matchId,
      phase: state.phase,
      blockId: state.blockId ?? null,
      roundNumber: state.roundNumber ?? null,
      matchNumber: state.matchNumber ?? null,
      courtNumber: state.courtNumber ?? null,
      scheduledTime: state.scheduledTime ?? null,
      status: state.status,
      team1: state.team1,
      team2: state.team2,
      noteJa: state.noteJa ?? null,
    });
  }

  for (const item of collectQualifyingMatches(schedule)) {
    const match = item.match;
    const matchId = match.matchId;
    if (!matchId) {
      continue;
    }
    const result = resultsMap.get(matchId) ?? null;
    const session = sessionsMap.get(matchId) ?? null;
    const display = resolveMatchDisplayState(session, result);
    const officialExists = result?.status === MatchResultStatus.FINISHED;
    const overlay = overlayQualifyingPipelineStatus(
      display.status,
      matchId,
      officialExists,
      reconciliations
    );
    const liveName1 = resolveLiveTeamName(
      match.team1?.entryId,
      match.team1?.teamName,
      nameLookup
    );
    const liveName2 = resolveLiveTeamName(
      match.team2?.entryId,
      match.team2?.teamName,
      nameLookup
    );
    const team1 = teamRef(match.team1?.entryId, teamIndex, liveName1 || match.team1?.teamName);
    const team2 = teamRef(match.team2?.entryId, teamIndex, liveName2 || match.team2?.teamName);
    const scheduled = scheduledLookup.get(matchId);
    let noteJa = null;
    if (overlay.status === "conflict") {
      noteJa = "両チームの提出が不一致です。紙で裁定してください。";
    } else if (overlay.status === "awaiting_opponent") {
      noteJa = "片側のみ提出済みです。相手チームの得点を確認してください。";
    } else if (overlay.status === MatchDisplayStatus.PLAYING) {
      noteJa = "試合中です。";
    }
    const state = {
      matchId,
      phase: EmergencyExportMatchPhase.QUALIFYING,
      status: overlay.status,
      statusLabelJa: statusLabelJa(overlay.status),
      playerPipelineStatus: overlay.pipelineStatus,
      blockId: item.blockId,
      roundNumber: item.roundNumber,
      matchNumber: match.matchNumber ?? null,
      courtNumber: match.courtNumber ?? null,
      scheduledTime: scheduled?.startTime ?? null,
      team1,
      team2,
      noteJa,
    };
    matchDisplayStates.push(state);
    pushRemaining(state);
  }

  function addBracketMatches(bracket, results, sessions, phase) {
    if (!bracket || !Array.isArray(bracket.matches)) {
      return { remaining: 0, finished: 0, ready: [] };
    }
    const rMap = asMap(results);
    const sMap = asMap(sessions);
    let remaining = 0;
    let finished = 0;
    const ready = [];
    for (const match of bracket.matches) {
      const matchId = match.matchId;
      if (!matchId) {
        continue;
      }
      const status = resolveFinalsMatchDisplayStatus({
        match,
        bracket,
        resultsMap: rMap,
        sessionsMap: sMap,
      });
      const teams = resolveFinalsMatchTeams({ match, bracket, resultsMap: rMap });
      const team1 = teamRef(
        teams.team1?.entryId ?? match.team1?.entryId,
        teamIndex,
        teams.team1?.teamName ?? match.team1?.teamName
      );
      const team2 = teamRef(
        teams.team2?.entryId ?? match.team2?.entryId,
        teamIndex,
        teams.team2?.teamName ?? match.team2?.teamName
      );
      const scheduled = scheduledLookup.get(matchId);
      const courtNumber = resolveMatchCourtNumber(match);
      const state = {
        matchId,
        phase,
        status,
        statusLabelJa: statusLabelJa(status),
        playerPipelineStatus: null,
        blockId: null,
        roundNumber: match.roundNumber ?? null,
        matchNumber: match.matchNumber ?? null,
        courtNumber,
        scheduledTime: scheduled?.startTime ?? null,
        team1,
        team2,
        noteJa: status === FinalsMatchDisplayStatus.READY ? "開始可能です。" : null,
      };
      matchDisplayStates.push(state);
      if (status === FinalsMatchDisplayStatus.FINISHED || status === FinalsMatchDisplayStatus.BYE) {
        finished += 1;
      } else {
        remaining += 1;
        pushRemaining(state);
        if (status === FinalsMatchDisplayStatus.READY) {
          ready.push(state);
        }
      }
    }
    return { remaining, finished, ready };
  }

  const finalsProgress = addBracketMatches(
    input.finalsBracket,
    input.finalsMatchResults,
    input.finalsMatchSessions,
    EmergencyExportMatchPhase.FINALS
  );
  const consolationProgress = addBracketMatches(
    input.consolationBracket,
    input.consolationMatchResults,
    input.consolationMatchSessions,
    EmergencyExportMatchPhase.CONSOLATION
  );

  function addLossBandMatches(roundDocs, results, sessions, phase) {
    const rMap = asMap(results);
    const sMap = asMap(sessions);
    const ready = [];
    for (const roundDoc of asArray(roundDocs)) {
      if (!roundDoc || typeof roundDoc !== "object") {
        continue;
      }
      let pairings;
      try {
        pairings = pairingsFromRoundDoc(roundDoc);
      } catch {
        continue;
      }
      for (const match of pairings.matches || []) {
        const matchId = match.matchId;
        if (!matchId) {
          continue;
        }
        const result = rMap.get(matchId);
        const session = sMap.get(matchId);
        const display = resolveMatchDisplayState(session, result);
        const status = display.status;
        const state = {
          matchId,
          phase,
          status,
          statusLabelJa: statusLabelJa(status),
          playerPipelineStatus: null,
          blockId: null,
          roundNumber: match.roundNumber ?? roundDoc.roundNumber ?? null,
          matchNumber: null,
          courtNumber: null,
          scheduledTime: null,
          team1: teamRef(match.team1EntryId, teamIndex),
          team2: teamRef(match.team2EntryId, teamIndex),
          noteJa: null,
        };
        matchDisplayStates.push(state);
        if (status === MatchDisplayStatus.NOT_STARTED) {
          ready.push(state);
        }
        pushRemaining(state);
      }
    }
    return ready;
  }

  const lossBandReady = addLossBandMatches(
    input.lossBandRounds,
    input.lossBandMatchResults,
    input.lossBandMatchSessions,
    EmergencyExportMatchPhase.LOSS_BAND
  );
  addLossBandMatches(
    input.lossBandExchangeRounds,
    input.lossBandExchangeMatchResults,
    input.lossBandExchangeMatchSessions,
    EmergencyExportMatchPhase.LOSS_BAND_EXCHANGE
  );

  const phase = resolvePhase({
    tournament: input.tournament,
    blockDraw: input.blockDraw,
    schedule,
    completion,
    unresolvedMolkky,
    finalsAdvancement: input.finalsAdvancement,
    finalsBracket: input.finalsBracket,
    consolationBracket: input.consolationBracket,
    consolationRemaining: consolationProgress.remaining,
    finalsRemaining: finalsProgress.remaining,
    lossBandState: input.lossBandState,
    tournamentResults: input.tournamentResults,
  });

  const nextActionsJa = [];
  if (unresolvedMolkky && completion.complete) {
    const groups = listUnresolvedBlockMolkkyOutGroups(qualifyingStandings);
    for (const group of groups.slice(0, 3)) {
      nextActionsJa.push(
        `${group.blockName || group.blockId}の同点（${(group.entryIds || []).length}チーム）をモルックアウトで確定する`
      );
    }
  }
  for (const match of remainingMatches.filter((item) => item.status === "conflict").slice(0, 3)) {
    nextActionsJa.push(
      `${match.matchId} の提出競合を裁定する（${match.team1?.teamName} vs ${match.team2?.teamName}）`
    );
  }
  for (const match of remainingMatches.slice(0, 5)) {
    if (match.status === "conflict") {
      continue;
    }
    const court = match.courtNumber ? `コート${match.courtNumber}` : "";
    const time = match.scheduledTime ? `${match.scheduledTime} ` : "";
    nextActionsJa.push(
      `${time}${court} ${match.matchId} ${match.team1?.teamName ?? "—"} vs ${match.team2?.teamName ?? "—"}`.trim()
    );
    if (nextActionsJa.length >= 8) {
      break;
    }
  }
  if (nextActionsJa.length === 0) {
    if (phase === EmergencyExportPhase.AWAITING_ADVANCEMENT) {
      nextActionsJa.push("予選は完了しています。決勝進出者を確定してください。");
    } else if (phase === EmergencyExportPhase.COMPLETED) {
      nextActionsJa.push("大会は終了しています。結果を確認してください。");
    } else if (phase === EmergencyExportPhase.REGISTRATION) {
      nextActionsJa.push("確定参加者を確認し、抽選またはトーナメントを開始してください。");
    }
  }

  const finishedQualifying = completion.finishedMatches ?? 0;
  const totalQualifying = completion.totalMatches ?? 0;
  const summaryJa = (() => {
    const label = EMERGENCY_EXPORT_PHASE_LABELS_JA[phase] ?? phase;
    if (totalQualifying > 0) {
      return `${label}。予選 ${finishedQualifying}/${totalQualifying} 試合終了、残り ${completion.remainingMatches ?? 0}。進出は${input.finalsAdvancement?.finalized ? "確定済み" : "未確定"}。`;
    }
    return `${label}。`;
  })();

  let finalsAdvancementStatus;
  if (input.finalsAdvancement?.finalized) {
    finalsAdvancementStatus = {
      finalized: true,
      canFinalize: false,
      mode: input.finalsAdvancement.mode ?? null,
      qualifiers: (input.finalsAdvancement.qualifiers || []).map((item) =>
        expandQualifier(item, teamIndex)
      ),
      projectedQualifiers: null,
      blockers: [],
    };
  } else {
    let preview = null;
    let canFinalize = false;
    const blockers = [];
    try {
      preview = buildFinalsAdvancementPreview(schedule, resultsMap, {
        tournament: input.tournament,
        blockDraw: input.blockDraw,
        molkkyOutResolutions: input.molkkyOutResolutions,
      });
      canFinalize = preview?.canFinalize === true;
      if (!completion.complete) {
        blockers.push("qualifying_incomplete");
      }
      if (unresolvedMolkky) {
        blockers.push("unresolved_block_molkky_out");
      }
      if (preview?.selection?.needsMolkkyOut) {
        blockers.push("unresolved_wildcard_molkky_out");
      }
      if (preview?.selection?.valid === false && preview?.selection?.message) {
        blockers.push("selection_invalid");
      }
    } catch {
      preview = null;
      if (!schedule?.finalized) {
        blockers.push("no_schedule");
      }
    }
    finalsAdvancementStatus = {
      finalized: false,
      canFinalize,
      mode: preview?.mode ?? null,
      qualifiers: null,
      projectedQualifiers: (preview?.selection?.qualifiers || preview?.selection?.partialQualifiers || []).map(
        (item) => expandQualifier(item, teamIndex)
      ),
      blockers,
      messageJa: preview?.message ?? null,
    };
  }

  const finalsPlacement = input.finalsBracket
    ? getFinalsChampionAndRunnerUp(input.finalsBracket, asMap(input.finalsMatchResults))
    : null;
  const consolationPlacement = input.consolationBracket
    ? getFinalsChampionAndRunnerUp(input.consolationBracket, asMap(input.consolationMatchResults))
    : null;

  const currentFinalsRound = (input.finalsBracket?.matches || []).reduce((current, match) => {
    const state = matchDisplayStates.find(
      (item) => item.matchId === match.matchId && item.phase === EmergencyExportMatchPhase.FINALS
    );
    if (state && isOpenMatchStatus(state.status)) {
      const round = match.roundNumber ?? current;
      return current == null ? round : Math.min(current, round);
    }
    return current;
  }, null);

  const bracketStatus = {
    finals: input.finalsBracket
      ? {
          present: true,
          currentRound: currentFinalsRound,
          finishedMatchCount: finalsProgress.finished,
          remainingMatchCount: finalsProgress.remaining,
          nextReadyMatches: finalsProgress.ready.map((item) => item.matchId),
          champion: finalsPlacement?.complete
            ? teamRef(finalsPlacement.champion?.entryId, teamIndex, finalsPlacement.champion?.teamName)
            : null,
          runnerUp: finalsPlacement?.complete
            ? teamRef(finalsPlacement.runnerUp?.entryId, teamIndex, finalsPlacement.runnerUp?.teamName)
            : null,
        }
      : { present: false },
    consolation: input.consolationBracket
      ? {
          present: true,
          finishedMatchCount: consolationProgress.finished,
          remainingMatchCount: consolationProgress.remaining,
          nextReadyMatches: consolationProgress.ready.map((item) => item.matchId),
          champion: consolationPlacement?.complete
            ? teamRef(
                consolationPlacement.champion?.entryId,
                teamIndex,
                consolationPlacement.champion?.teamName
              )
            : null,
        }
      : { present: false },
    lossBand: input.lossBandState
      ? {
          present: true,
          status: input.lossBandState.status ?? null,
          statusLabelJa: formatLossBandTournamentStatusLabel(input.lossBandState.status),
          currentRound: input.lossBandState.currentRound ?? null,
          completedRankingRound: input.lossBandState.completedRankingRound ?? null,
          nextReadyMatches: lossBandReady.map((item) => item.matchId),
          placements: input.lossBandPlacements?.placements ?? null,
        }
      : { present: false },
  };

  return {
    situation: {
      phase,
      phaseLabelJa: EMERGENCY_EXPORT_PHASE_LABELS_JA[phase] ?? phase,
      summaryJa,
      nextActionsJa,
      qualifying: {
        totalMatches: totalQualifying,
        finishedMatches: finishedQualifying,
        remainingMatches: completion.remainingMatches ?? 0,
        complete: completion.complete === true,
      },
    },
    confirmedEntries,
    qualifyingStandings,
    matchDisplayStates,
    remainingMatches,
    finalsAdvancementStatus,
    bracketStatus,
    scheduledTimes,
  };
}

export { qualifierEntryIdsFromAdvancement };
