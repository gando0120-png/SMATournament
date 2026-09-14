/**
 * 大会スケジュール一覧 ViewModel（DOM / Firestore 非依存）
 *
 * 既存の予選対戦表・決勝ブラケット・time-schedule 解決結果から組み立てる。
 * UI では時刻を再計算しない。
 */
import { formatCombinationSheetEventDate } from "./combination-sheet.js";
import { sortBlocksByBlockId } from "./block-order.js";
import {
  buildEntryTeamNameLookup,
  overlayEntryTeamNames,
  resolveLiveTeamName,
} from "./entry-team-name-overlay.js";
import { groupBracketMatchesByRound } from "./finals-bracket-display.js";
import { resolveMatchCourtNumber } from "./finals-court-assignment.js";
import { isByeTeam, isPendingTeam } from "./finals-match-bye.js";
import { isMultiTeamBracket } from "./multi-team-bracket.js";
import { normalizeQualifyingScheduleForDisplay } from "./qualifying-schedule-persist.js";
import {
  applyFinalsScheduledTimesToRounds,
  applyQualifyingScheduledTimesToScheduleSection,
  buildFinalsPublicTimeSchedule,
  buildQualifyingPublicTimeSchedule,
  buildTournamentTimePlan,
  formatMinutesAsDisplayTime,
  normalizeTimeScheduleDoc,
  parseHmToMinutes,
} from "./time-schedule.js";
import {
  TournamentFormat,
  resolvePublicTournamentFormat,
  PublicTournamentFormat,
} from "./tournament-format.js";

export const SCHEDULE_OVERVIEW_SCHEMA_VERSION = 1;

export const ScheduleOverviewSlotKind = {
  ROUND: "round",
  MARKER: "marker",
};

export const ScheduleOverviewPhase = {
  QUALIFYING: "qualifying",
  QUALIFYING_END: "qualifying_end",
  FINALS_START: "finals_start",
  FINALS: "finals",
};

export const ScheduleOverviewTeamRowKind = {
  MATCH: "match",
  REST: "rest",
  CONDITIONAL: "conditional",
};

export const ScheduleOverviewTeamStatus = {
  UNSELECTED: "unselected",
  NOT_FOUND: "not_found",
  READY: "ready",
};

export const PENDING_OPPONENT_LABEL = "対戦相手未定";
export const BYE_TEAM_LABEL = "BYE";
export const REST_LABEL = "休み";
export const CONDITIONAL_WIN_NOTE = "勝ち上がった場合";

export const SCHEDULE_OVERVIEW_PRINT_MATCH_CAPACITY = 12;
export const SCHEDULE_OVERVIEW_PRINT_TEAM_ROW_CAPACITY = 10;

const MISSING_TEAM_NAME = "（名称未設定）";

function optionalString(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function asEntryId(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function toDisplayTime(storedHm) {
  const minutes = parseHmToMinutes(storedHm);
  if (minutes == null) {
    return null;
  }
  return formatMinutesAsDisplayTime(minutes);
}

function compareNullableCourt(left, right) {
  const leftNum = Number.isInteger(left) ? left : Number.MAX_SAFE_INTEGER;
  const rightNum = Number.isInteger(right) ? right : Number.MAX_SAFE_INTEGER;
  if (leftNum !== rightNum) {
    return leftNum - rightNum;
  }
  return 0;
}

function compareTimeThenOrder(left, right) {
  const leftMin = parseHmToMinutes(left.startTime) ?? Number.MAX_SAFE_INTEGER;
  const rightMin = parseHmToMinutes(right.startTime) ?? Number.MAX_SAFE_INTEGER;
  if (leftMin !== rightMin) {
    return leftMin - rightMin;
  }
  const phaseRank = {
    [ScheduleOverviewPhase.QUALIFYING]: 0,
    [ScheduleOverviewPhase.QUALIFYING_END]: 1,
    [ScheduleOverviewPhase.FINALS_START]: 2,
    [ScheduleOverviewPhase.FINALS]: 3,
  };
  const leftPhase = phaseRank[left.phase] ?? 50;
  const rightPhase = phaseRank[right.phase] ?? 50;
  if (leftPhase !== rightPhase) {
    return leftPhase - rightPhase;
  }
  return (left.roundNumber ?? 0) - (right.roundNumber ?? 0);
}

function resolveTeamRef(entryId, fallbackName, nameLookup) {
  const id = asEntryId(entryId);
  const live = resolveLiveTeamName(id, fallbackName, nameLookup);
  const teamName =
    typeof live === "string" && live.trim() && live !== "—"
      ? live.trim()
      : MISSING_TEAM_NAME;
  return {
    entryId: id,
    teamName,
  };
}

function formatCourtNumber(court) {
  if (!Number.isInteger(court) || court < 1) {
    return null;
  }
  return court;
}

/**
 * @param {unknown} court
 * @returns {string|null}
 */
export function formatScheduleCourtLabel(court) {
  const number = formatCourtNumber(court);
  return number == null ? null : `${number}コート`;
}

/**
 * @param {object|null|undefined} tournament
 */
export function buildScheduleOverviewTournament(tournament) {
  const name =
    optionalString(tournament?.name) || "（名称未設定）";
  const eventDate = optionalString(tournament?.eventDate);
  const venue = optionalString(tournament?.venue) || "—";
  return {
    id: typeof tournament?.id === "string" ? tournament.id : null,
    name,
    eventDate: eventDate || null,
    eventDateLabel: formatCombinationSheetEventDate(eventDate || null),
    venue,
    tournamentFormat: tournament?.tournamentFormat ?? null,
    format: resolvePublicTournamentFormat(tournament),
  };
}

function collectQualifyingTeams(schedule, nameLookup) {
  const teams = [];
  const seen = new Set();
  for (const block of schedule?.blocks ?? []) {
    const blockId = block.blockId ?? block.id ?? null;
    const blockName = block.blockName || block.name || (blockId ? `${blockId}ブロック` : "ブロック");
    for (const team of block.teams ?? []) {
      const entryId = asEntryId(team.entryId);
      if (!entryId || seen.has(entryId)) {
        continue;
      }
      seen.add(entryId);
      teams.push({
        entryId,
        teamName: resolveTeamRef(entryId, team.teamName, nameLookup).teamName,
        blockId,
        blockName,
        phase: ScheduleOverviewPhase.QUALIFYING,
      });
    }
  }
  return teams;
}

function collectBracketTeams(bracket, nameLookup, existingIds) {
  const teams = [];
  for (const match of bracket?.matches ?? []) {
    for (const side of [match.team1, match.team2]) {
      if (isByeTeam(side) || isPendingTeam(side)) {
        continue;
      }
      const entryId = asEntryId(side?.entryId);
      if (!entryId || existingIds.has(entryId)) {
        continue;
      }
      existingIds.add(entryId);
      teams.push({
        entryId,
        teamName: resolveTeamRef(entryId, side?.teamName, nameLookup).teamName,
        blockId: null,
        blockName: null,
        phase: ScheduleOverviewPhase.FINALS,
      });
    }
    for (const participant of match.participants ?? []) {
      const entryId = asEntryId(participant?.entryId);
      if (!entryId || existingIds.has(entryId)) {
        continue;
      }
      existingIds.add(entryId);
      teams.push({
        entryId,
        teamName: resolveTeamRef(entryId, participant?.teamName, nameLookup).teamName,
        blockId: null,
        blockName: null,
        phase: ScheduleOverviewPhase.FINALS,
      });
    }
  }
  return teams;
}

function sortTeams(teams) {
  return [...teams].sort((left, right) =>
    String(left.teamName).localeCompare(String(right.teamName), "ja")
  );
}

function readQualifyingMatchTeams(match, nameLookup) {
  return {
    team1: resolveTeamRef(
      match.homeEntryId ?? match.team1?.entryId,
      match.homeTeamName ?? match.team1?.teamName,
      nameLookup
    ),
    team2: resolveTeamRef(
      match.awayEntryId ?? match.team2?.entryId,
      match.awayTeamName ?? match.team2?.teamName,
      nameLookup
    ),
  };
}

function buildQualifyingSlots(schedule, nameLookup) {
  if (!schedule || schedule.finalized !== true || !Array.isArray(schedule.blocks)) {
    return [];
  }

  const blocks = sortBlocksByBlockId(schedule.blocks);
  /** @type {Map<number, object>} */
  const byRound = new Map();

  for (const block of blocks) {
    const blockId = block.blockId ?? block.id ?? null;
    const blockName = block.blockName || block.name || (blockId ? `${blockId}ブロック` : "ブロック");
    const blockTeamIds = new Set(
      (block.teams ?? []).map((team) => asEntryId(team.entryId)).filter(Boolean)
    );

    for (const round of block.rounds ?? []) {
      const roundNumber = Number(round.roundNumber);
      if (!Number.isInteger(roundNumber) || roundNumber < 1) {
        continue;
      }
      if (!byRound.has(roundNumber)) {
        byRound.set(roundNumber, {
          id: `qualifying-${roundNumber}`,
          kind: ScheduleOverviewSlotKind.ROUND,
          phase: ScheduleOverviewPhase.QUALIFYING,
          roundNumber,
          label: round.roundLabel || `第${roundNumber}節`,
          startTime: round.scheduledStartTime ?? null,
          startTimeDisplay: toDisplayTime(round.scheduledStartTime),
          groups: [],
          rests: [],
          status: "scheduled",
        });
      }
      const slot = byRound.get(roundNumber);
      if (!slot.startTime && round.scheduledStartTime) {
        slot.startTime = round.scheduledStartTime;
        slot.startTimeDisplay = toDisplayTime(round.scheduledStartTime);
      }

      const matches = [...(round.matches ?? [])]
        .map((match) => {
          const teams = readQualifyingMatchTeams(match, nameLookup);
          const court = formatCourtNumber(match.court ?? match.courtNumber);
          return {
            matchId: match.matchId ?? null,
            court,
            team1: teams.team1,
            team2: teams.team2,
            startTime: match.scheduledStartTime ?? round.scheduledStartTime ?? null,
            startTimeDisplay: toDisplayTime(
              match.scheduledStartTime ?? round.scheduledStartTime
            ),
            status: "scheduled",
          };
        })
        .sort((left, right) => compareNullableCourt(left.court, right.court));

      if (matches.length > 0) {
        slot.groups.push({
          label: blockName,
          blockId,
          matches,
        });
      }

      const playingIds = new Set();
      for (const match of matches) {
        if (match.team1.entryId) playingIds.add(match.team1.entryId);
        if (match.team2.entryId) playingIds.add(match.team2.entryId);
      }

      const byeTeams = Array.isArray(round.byes) && round.byes.length > 0
        ? round.byes
        : (block.teams ?? []).filter((team) => {
            const entryId = asEntryId(team.entryId);
            return entryId && blockTeamIds.has(entryId) && !playingIds.has(entryId);
          });

      for (const bye of byeTeams) {
        const ref = resolveTeamRef(bye.entryId, bye.teamName, nameLookup);
        if (!ref.entryId) {
          continue;
        }
        slot.rests.push({
          entryId: ref.entryId,
          teamName: ref.teamName,
          blockId,
          blockName,
        });
      }
    }
  }

  return [...byRound.values()].sort((left, right) => left.roundNumber - right.roundNumber);
}

function describeFinalsTeam(team, nameLookup) {
  if (isByeTeam(team)) {
    return {
      type: "bye",
      entryId: null,
      teamName: BYE_TEAM_LABEL,
    };
  }
  if (isPendingTeam(team) || !asEntryId(team?.entryId)) {
    return {
      type: "pending",
      entryId: asEntryId(team?.entryId),
      teamName: PENDING_OPPONENT_LABEL,
    };
  }
  const ref = resolveTeamRef(team.entryId, team.teamName, nameLookup);
  return {
    type: "team",
    entryId: ref.entryId,
    teamName: ref.teamName,
  };
}

function buildFinalsSlots(bracket, timeScheduleLookup, nameLookup) {
  if (!bracket?.finalized || isMultiTeamBracket(bracket)) {
    return [];
  }
  const grouped = groupBracketMatchesByRound(bracket);
  const stamped = applyFinalsScheduledTimesToRounds(grouped, timeScheduleLookup);
  return stamped.map((round) => {
    const matches = [...(round.matches ?? [])]
      .map((match) => {
        const court = formatCourtNumber(resolveMatchCourtNumber(match));
        return {
          matchId: match.matchId ?? null,
          court,
          team1: describeFinalsTeam(match.team1, nameLookup),
          team2: describeFinalsTeam(match.team2, nameLookup),
          startTime: match.scheduledStartTime ?? round.scheduledStartTime ?? null,
          startTimeDisplay: toDisplayTime(
            match.scheduledStartTime ?? round.scheduledStartTime
          ),
          status: "scheduled",
        };
      })
      .sort((left, right) => compareNullableCourt(left.court, right.court));

    return {
      id: `finals-${round.roundNumber}`,
      kind: ScheduleOverviewSlotKind.ROUND,
      phase: ScheduleOverviewPhase.FINALS,
      roundNumber: round.roundNumber,
      label: round.roundLabel || `第${round.roundNumber}ラウンド`,
      startTime: round.scheduledStartTime ?? null,
      startTimeDisplay: toDisplayTime(round.scheduledStartTime),
      groups: matches.length
        ? [
            {
              label: null,
              blockId: null,
              matches,
            },
          ]
        : [],
      rests: [],
      status: "scheduled",
    };
  });
}

function buildMarkerSlot(id, phase, label, storedHm) {
  if (!storedHm) {
    return null;
  }
  return {
    id,
    kind: ScheduleOverviewSlotKind.MARKER,
    phase,
    roundNumber: null,
    label,
    startTime: storedHm,
    startTimeDisplay: toDisplayTime(storedHm),
    groups: [],
    rests: [],
    status: "scheduled",
  };
}

function buildMarkerSlots(plan, hasQualifyingSlots, hasFinalsSlots) {
  if (!plan?.configured || !hasQualifyingSlots || !hasFinalsSlots) {
    return [];
  }
  const markers = [];
  const qualifyingEnd = buildMarkerSlot(
    "marker-qualifying-end",
    ScheduleOverviewPhase.QUALIFYING_END,
    "予選終了予定",
    plan.qualifyingEndTime
  );
  const finalsStart = buildMarkerSlot(
    "marker-finals-start",
    ScheduleOverviewPhase.FINALS_START,
    "決勝開始予定",
    plan.finalsStartTime
  );
  if (qualifyingEnd) markers.push(qualifyingEnd);
  if (finalsStart && finalsStart.startTime !== qualifyingEnd?.startTime) {
    markers.push(finalsStart);
  }
  return markers;
}

/**
 * @param {{
 *   tournament?: object|null,
 *   entries?: Iterable<object>|null,
 *   schedule?: object|null,
 *   blockDraw?: object|null,
 *   finalsBracket?: object|null,
 *   timeSchedule?: object|null,
 * }} [params]
 */
export function buildScheduleOverview({
  tournament = null,
  entries = null,
  schedule = null,
  blockDraw = null,
  finalsBracket = null,
  timeSchedule = null,
} = {}) {
  const nameLookup = buildEntryTeamNameLookup(entries);
  const liveSchedule = overlayEntryTeamNames(schedule, nameLookup);
  const liveBracket = overlayEntryTeamNames(finalsBracket, nameLookup);
  const displaySchedule =
    liveSchedule?.finalized === true
      ? normalizeQualifyingScheduleForDisplay(liveSchedule)
      : liveSchedule;

  const qualifyingLookup = buildQualifyingPublicTimeSchedule(timeSchedule, displaySchedule);
  const timedQualifying = applyQualifyingScheduledTimesToScheduleSection(
    displaySchedule?.finalized === true
      ? displaySchedule
      : { blocks: [], finalized: false },
    qualifyingLookup
  );
  if (displaySchedule?.finalized === true) {
    timedQualifying.finalized = true;
  }

  const qualifyingSlots = buildQualifyingSlots(timedQualifying, nameLookup);

  const finalsLookup = liveBracket?.finalized
    ? buildFinalsPublicTimeSchedule({
        settings: timeSchedule,
        tournament,
        schedule: displaySchedule,
        blockDraw,
        finalsBracket: liveBracket,
      })
    : null;
  const finalsSlots = buildFinalsSlots(liveBracket, finalsLookup, nameLookup);

  const plan = buildTournamentTimePlan({
    settings: timeSchedule,
    tournament,
    schedule: displaySchedule,
    blockDraw,
    finalsBracket: liveBracket,
  });
  const markers = buildMarkerSlots(plan, qualifyingSlots.length > 0, finalsSlots.length > 0);

  const slots = [...qualifyingSlots, ...markers, ...finalsSlots].sort(compareTimeThenOrder);

  const qualifyingTeams = collectQualifyingTeams(timedQualifying, nameLookup);
  const seen = new Set(qualifyingTeams.map((team) => team.entryId));
  const finalsTeams = collectBracketTeams(liveBracket, nameLookup, seen);
  const teams = sortTeams([...qualifyingTeams, ...finalsTeams]);

  return {
    schemaVersion: SCHEDULE_OVERVIEW_SCHEMA_VERSION,
    tournament: buildScheduleOverviewTournament(tournament),
    slots,
    teams,
    empty:
      slots.length === 0
        ? "対戦表またはトーナメントがまだ公開できる状態ではありません。"
        : null,
  };
}

function snapshotTeamRef(team) {
  if (!team || typeof team !== "object") {
    return { type: "pending", entryId: null, teamName: PENDING_OPPONENT_LABEL };
  }
  if (team.type === "bye" || team.label === "BYE") {
    return { type: "bye", entryId: null, teamName: BYE_TEAM_LABEL };
  }
  if (team.type === "pending" || !team.entryId) {
    return {
      type: "pending",
      entryId: asEntryId(team.entryId),
      teamName: PENDING_OPPONENT_LABEL,
    };
  }
  return {
    type: "team",
    entryId: asEntryId(team.entryId),
    teamName: optionalString(team.teamName) || MISSING_TEAM_NAME,
  };
}

function deriveRestsFromSnapshotBlock(block, round, nameLookup) {
  const playing = new Set();
  for (const match of round.matches ?? []) {
    const team1Id = asEntryId(match.team1?.entryId);
    const team2Id = asEntryId(match.team2?.entryId);
    if (team1Id) playing.add(team1Id);
    if (team2Id) playing.add(team2Id);
  }
  return (block.teams ?? [])
    .filter((team) => {
      const entryId = asEntryId(team.entryId);
      return entryId && !playing.has(entryId);
    })
    .map((team) => ({
      entryId: team.entryId,
      teamName: resolveTeamRef(team.entryId, team.teamName, nameLookup).teamName,
      blockId: block.blockId ?? null,
      blockName: block.blockName || "ブロック",
    }));
}

/**
 * 公開 snapshot の既存セクションから ViewModel を組み立てる（追加フィールドが無い旧 snapshot 用）。
 * 時刻は stamp 済み scheduledStartTime を使い、再計算しない。
 * @param {object|null|undefined} snapshot
 */
export function buildScheduleOverviewFromSnapshot(snapshot) {
  if (snapshot?.scheduleOverview && Array.isArray(snapshot.scheduleOverview.slots)) {
    return snapshot.scheduleOverview;
  }

  const nameLookup = buildEntryTeamNameLookup(snapshot?.registration?.items ?? []);
  const tournament = buildScheduleOverviewTournament({
    id: snapshot?.tournament?.id ?? null,
    name: snapshot?.tournament?.name,
    eventDate: snapshot?.tournament?.eventDate,
    venue: snapshot?.tournament?.venue,
    tournamentFormat: snapshot?.tournament?.tournamentFormat,
  });

  const scheduleSection = snapshot?.qualifying?.schedule;
  const blockTeams = new Map(
    (snapshot?.qualifying?.blocks?.blocks ?? []).map((block) => [
      block.blockId,
      block,
    ])
  );
  const qualifyingSlots = [];
  if (scheduleSection?.ready && Array.isArray(scheduleSection.blocks)) {
    const byRound = new Map();
    for (const block of sortBlocksByBlockId(scheduleSection.blocks)) {
      const blockMeta = blockTeams.get(block.blockId);
      const blockName = block.blockName || blockMeta?.blockName || `${block.blockId}ブロック`;
      for (const round of block.rounds ?? []) {
        const roundNumber = Number(round.roundNumber);
        if (!byRound.has(roundNumber)) {
          byRound.set(roundNumber, {
            id: `qualifying-${roundNumber}`,
            kind: ScheduleOverviewSlotKind.ROUND,
            phase: ScheduleOverviewPhase.QUALIFYING,
            roundNumber,
            label: round.roundLabel || `第${roundNumber}節`,
            startTime: round.scheduledStartTime ?? null,
            startTimeDisplay: toDisplayTime(round.scheduledStartTime),
            groups: [],
            rests: [],
            status: "scheduled",
          });
        }
        const slot = byRound.get(roundNumber);
        const matches = [...(round.matches ?? [])]
          .map((match) => ({
            matchId: match.matchId ?? null,
            court: formatCourtNumber(match.courtNumber ?? match.court),
            team1: resolveTeamRef(match.team1?.entryId, match.team1?.teamName, nameLookup),
            team2: resolveTeamRef(match.team2?.entryId, match.team2?.teamName, nameLookup),
            startTime: match.scheduledStartTime ?? round.scheduledStartTime ?? null,
            startTimeDisplay: toDisplayTime(
              match.scheduledStartTime ?? round.scheduledStartTime
            ),
            status: "scheduled",
          }))
          .sort((left, right) => compareNullableCourt(left.court, right.court));
        if (matches.length) {
          slot.groups.push({ label: blockName, blockId: block.blockId, matches });
        }
        const restSource = blockMeta
          ? deriveRestsFromSnapshotBlock(
              { ...blockMeta, blockName },
              round,
              nameLookup
            )
          : [];
        slot.rests.push(...restSource);
      }
    }
    qualifyingSlots.push(
      ...[...byRound.values()].sort((left, right) => left.roundNumber - right.roundNumber)
    );
  }

  const finalsSlots = [];
  const bracketSection = snapshot?.bracket;
  if (bracketSection?.ready && Array.isArray(bracketSection.rounds)) {
    for (const round of bracketSection.rounds) {
      const matches = [...(round.matches ?? [])]
        .filter((match) => !match.isMultiTeam)
        .map((match) => ({
          matchId: match.matchId ?? null,
          court: formatCourtNumber(match.courtNumber),
          team1: snapshotTeamRef(match.team1),
          team2: snapshotTeamRef(match.team2),
          startTime: match.scheduledStartTime ?? round.scheduledStartTime ?? null,
          startTimeDisplay: toDisplayTime(
            match.scheduledStartTime ?? round.scheduledStartTime
          ),
          status: "scheduled",
        }))
        .sort((left, right) => compareNullableCourt(left.court, right.court));
      finalsSlots.push({
        id: `finals-${round.roundNumber}`,
        kind: ScheduleOverviewSlotKind.ROUND,
        phase: ScheduleOverviewPhase.FINALS,
        roundNumber: round.roundNumber,
        label: round.roundLabel || `第${round.roundNumber}ラウンド`,
        startTime: round.scheduledStartTime ?? null,
        startTimeDisplay: toDisplayTime(round.scheduledStartTime),
        groups: matches.length ? [{ label: null, blockId: null, matches }] : [],
        rests: [],
        status: "scheduled",
      });
    }
  }

  const slots = [...qualifyingSlots, ...finalsSlots].sort(compareTimeThenOrder);
  const teams = sortTeams(
    (snapshot?.registration?.items ?? [])
      .map((item) => ({
        entryId: asEntryId(item.entryId),
        teamName: optionalString(item.teamName) || MISSING_TEAM_NAME,
        blockId: null,
        blockName: null,
        phase: null,
      }))
      .filter((team) => team.entryId)
  );

  return {
    schemaVersion: SCHEDULE_OVERVIEW_SCHEMA_VERSION,
    tournament,
    slots,
    teams,
    empty:
      slots.length === 0
        ? "対戦表またはトーナメントがまだ公開できる状態ではありません。"
        : null,
  };
}

function matchInvolvesTeam(match, teamId) {
  return match?.team1?.entryId === teamId || match?.team2?.entryId === teamId;
}

function opponentForTeam(match, teamId) {
  if (match.team1?.entryId === teamId) {
    return match.team2;
  }
  if (match.team2?.entryId === teamId) {
    return match.team1;
  }
  return null;
}

/**
 * @param {object} overview
 * @param {string|null|undefined} teamId
 */
export function buildTeamSchedule(overview, teamId) {
  const trimmed = asEntryId(teamId);
  if (!trimmed) {
    return {
      status: ScheduleOverviewTeamStatus.UNSELECTED,
      team: null,
      rows: [],
      empty: "チームを選択してください。",
    };
  }

  const team = (overview?.teams ?? []).find((item) => item.entryId === trimmed) ?? null;
  if (!team) {
    return {
      status: ScheduleOverviewTeamStatus.NOT_FOUND,
      team: null,
      rows: [],
      empty: "指定されたチームのスケジュールはありません。",
    };
  }

  const format = overview?.tournament?.format;
  const isSingleElim = format === PublicTournamentFormat.SINGLE_ELIMINATION;
  const rows = [];

  for (const slot of overview.slots ?? []) {
    if (slot.kind === ScheduleOverviewSlotKind.MARKER) {
      continue;
    }
    if (slot.phase === ScheduleOverviewPhase.QUALIFYING) {
      const playing = (slot.groups ?? [])
        .flatMap((group) => group.matches ?? [])
        .find((match) => matchInvolvesTeam(match, trimmed));
      if (playing) {
        const opponent = opponentForTeam(playing, trimmed);
        rows.push({
          kind: ScheduleOverviewTeamRowKind.MATCH,
          slotId: slot.id,
          startTime: playing.startTime ?? slot.startTime,
          startTimeDisplay: playing.startTimeDisplay ?? slot.startTimeDisplay,
          label: slot.label,
          court: playing.court,
          opponent,
          note: null,
          status: "scheduled",
        });
        continue;
      }
      const resting = (slot.rests ?? []).find((item) => item.entryId === trimmed);
      if (resting) {
        rows.push({
          kind: ScheduleOverviewTeamRowKind.REST,
          slotId: slot.id,
          startTime: slot.startTime,
          startTimeDisplay: slot.startTimeDisplay,
          label: slot.label,
          court: null,
          opponent: null,
          note: REST_LABEL,
          status: "scheduled",
        });
      }
      continue;
    }

    if (slot.phase !== ScheduleOverviewPhase.FINALS) {
      continue;
    }

    const playing = (slot.groups ?? [])
      .flatMap((group) => group.matches ?? [])
      .find((match) => matchInvolvesTeam(match, trimmed));
    if (playing) {
      const opponent = opponentForTeam(playing, trimmed);
      rows.push({
        kind: ScheduleOverviewTeamRowKind.MATCH,
        slotId: slot.id,
        startTime: playing.startTime ?? slot.startTime,
        startTimeDisplay: playing.startTimeDisplay ?? slot.startTimeDisplay,
        label: slot.label,
        court: playing.court,
        opponent,
        note: opponent?.type === "pending" ? PENDING_OPPONENT_LABEL : null,
        status: "scheduled",
      });
      continue;
    }

    if (isSingleElim) {
      rows.push({
        kind: ScheduleOverviewTeamRowKind.CONDITIONAL,
        slotId: slot.id,
        startTime: slot.startTime,
        startTimeDisplay: slot.startTimeDisplay,
        label: slot.label,
        court: null,
        opponent: {
          type: "pending",
          entryId: null,
          teamName: PENDING_OPPONENT_LABEL,
        },
        note: CONDITIONAL_WIN_NOTE,
        status: "scheduled",
      });
    }
  }

  return {
    status: ScheduleOverviewTeamStatus.READY,
    team,
    rows,
    empty: rows.length === 0 ? "このチームの試合予定はまだありません。" : null,
  };
}

function slotPrintWeight(slot) {
  if (slot?.kind === ScheduleOverviewSlotKind.MARKER) {
    return 1;
  }
  const matchCount = (slot?.groups ?? []).reduce(
    (sum, group) => sum + (group.matches?.length ?? 0),
    0
  );
  return Math.max(1, matchCount);
}

/**
 * @param {object[]} items
 * @param {(item: object) => number} weightOf
 * @param {number} capacity
 */
export function paginateWeightedItems(items, weightOf, capacity) {
  if (!Array.isArray(items) || items.length === 0) {
    return [[]];
  }
  const pages = [];
  let current = [];
  let weight = 0;
  for (const item of items) {
    const itemWeight = Math.max(1, Number(weightOf(item)) || 1);
    if (current.length > 0 && weight + itemWeight > capacity) {
      pages.push(current);
      current = [];
      weight = 0;
    }
    current.push(item);
    weight += itemWeight;
  }
  if (current.length) {
    pages.push(current);
  }
  return pages.length ? pages : [[]];
}

/**
 * @param {object} overview
 * @param {{ mode?: "all"|"team", teamId?: string|null }} [options]
 */
export function buildScheduleOverviewPrintModel(overview, options = {}) {
  const mode = options.mode === "team" ? "team" : "all";
  const tournament = overview?.tournament ?? buildScheduleOverviewTournament(null);
  if (mode === "team") {
    const teamSchedule = buildTeamSchedule(overview, options.teamId);
    const pages = paginateWeightedItems(
      teamSchedule.rows,
      () => 1,
      SCHEDULE_OVERVIEW_PRINT_TEAM_ROW_CAPACITY
    ).map((rows, index, all) => ({
      pageNumber: index + 1,
      pageCount: all.length,
      isContinuation: index > 0,
      rows,
    }));
    return {
      mode: "team",
      tournament,
      title: teamSchedule.team
        ? `${teamSchedule.team.teamName} のスケジュール`
        : "チーム別スケジュール",
      teamSchedule,
      pages,
    };
  }

  const pages = paginateWeightedItems(
    overview?.slots ?? [],
    slotPrintWeight,
    SCHEDULE_OVERVIEW_PRINT_MATCH_CAPACITY
  ).map((slots, index, all) => ({
    pageNumber: index + 1,
    pageCount: all.length,
    isContinuation: index > 0,
    slots,
  }));

  return {
    mode: "all",
    tournament,
    title: "大会スケジュール",
    pages,
  };
}

export function isSingleEliminationOverview(overview) {
  return (
    overview?.tournament?.format === PublicTournamentFormat.SINGLE_ELIMINATION ||
    overview?.tournament?.tournamentFormat === TournamentFormat.SINGLE_ELIMINATION
  );
}

export { normalizeTimeScheduleDoc };
