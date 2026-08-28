/**
 * 大会スケジュール設定（DOM / Firestore 非依存）
 *
 * 永続化先: tournaments/{id}/timeSchedule/current
 * 予定時刻は対戦表・ブラケットへ書き込まず、設定と節/ラウンド構造から都度計算する。
 */
import {
  getQualifyingRoundCountForTeamCount,
  isSupportedTeamCount,
} from "./qualifying-schedule.js";
import {
  calculateBlockDistribution,
  resolveStoredOrDerivedFinalTeamCount,
} from "./block-configuration.js";
import { bracketSizeFor, roundCountFor } from "./finals-bracket.js";
import { resolveSingleEliminationBracketSize } from "./single-elimination-bracket.js";
import { TournamentFormat } from "./tournament-format.js";

export const TIME_SCHEDULE_COLLECTION = "timeSchedule";
export const TIME_SCHEDULE_DOC_ID = "current";

export const TimeScheduleLimits = Object.freeze({
  matchDurationMinutes: { min: 1, max: 240 },
  matchIntervalMinutes: { min: 0, max: 240 },
  qualifyingToFinalsIntervalMinutes: { min: 0, max: 720 },
});

const TIME_HM_PATTERN = /^(\d{1,2}):([0-5]\d)(?::[0-5]\d)?$/;
const INTEGER_STRING_PATTERN = /^\d+$/;

export function emptyTimeScheduleOverrides() {
  return {
    qualifyingRounds: {},
    qualifyingMatches: {},
    finalsRounds: {},
    finalsMatches: {},
  };
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function optionalTrimmed(value) {
  if (value == null) {
    return "";
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

/**
 * @param {unknown} value
 * @returns {string|null} 正規化済み "HH:mm"。空は ""。不正は null。
 */
export function normalizeDayStartTime(value) {
  const raw = optionalTrimmed(value);
  if (!raw) {
    return "";
  }
  const match = raw.match(TIME_HM_PATTERN);
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || hours < 0 || hours > 23) {
    return null;
  }
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 59) {
    return null;
  }
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * @param {string} hm
 * @returns {number|null}
 */
export function parseHmToMinutes(hm) {
  const normalized = normalizeDayStartTime(hm);
  if (!normalized) {
    return null;
  }
  const [hours, minutes] = normalized.split(":").map((part) => Number(part));
  return hours * 60 + minutes;
}

/**
 * 保存・計算用（ゼロ埋め HH:mm。24時超は 25:10 のように表す）
 * @param {number} totalMinutes
 * @returns {string|null}
 */
export function formatMinutesToHm(totalMinutes) {
  if (!Number.isInteger(totalMinutes) || totalMinutes < 0) {
    return null;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * 画面表示用（9:00）。24時超は「翌日 1:00」
 * @param {number} totalMinutes
 * @returns {string|null}
 */
export function formatMinutesAsDisplayTime(totalMinutes) {
  if (!Number.isInteger(totalMinutes)) {
    return null;
  }
  if (totalMinutes < 0) {
    return null;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const paddedMinutes = String(minutes).padStart(2, "0");
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const displayHours = hours % 24;
    const time = `${displayHours}:${paddedMinutes}`;
    if (days === 1) {
      return `翌日 ${time}`;
    }
    return `${days}日後 ${time}`;
  }
  return `${hours}:${paddedMinutes}`;
}

/**
 * @param {unknown} raw
 * @returns {number|null|undefined} undefined=未入力, null=不正, number=整数
 */
function parseOptionalNonNegativeInt(raw) {
  if (raw == null) {
    return undefined;
  }
  if (typeof raw === "number") {
    if (!Number.isInteger(raw) || Number.isNaN(raw)) {
      return null;
    }
    return raw;
  }
  const text = optionalTrimmed(raw);
  if (!text) {
    return undefined;
  }
  if (!INTEGER_STRING_PATTERN.test(text)) {
    return null;
  }
  const num = Number(text);
  if (!Number.isInteger(num) || Number.isNaN(num)) {
    return null;
  }
  return num;
}

/**
 * @param {unknown} raw
 */
function normalizeOverrideMap(raw) {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  /** @type {Record<string, string>} */
  const next = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof key !== "string" || !key) {
      continue;
    }
    const normalized = normalizeDayStartTime(value);
    if (normalized) {
      next[key] = normalized;
    }
  }
  return next;
}

/**
 * @param {unknown} raw
 */
export function normalizeTimeScheduleOverrides(raw) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return {
    qualifyingRounds: normalizeOverrideMap(source.qualifyingRounds),
    qualifyingMatches: normalizeOverrideMap(source.qualifyingMatches),
    finalsRounds: normalizeOverrideMap(source.finalsRounds),
    finalsMatches: normalizeOverrideMap(source.finalsMatches),
  };
}

function emptySettingsValues() {
  return {
    dayStartTime: null,
    matchDurationMinutes: null,
    matchIntervalMinutes: null,
    qualifyingToFinalsIntervalMinutes: null,
  };
}

/**
 * @param {object|null|undefined} settings
 */
export function isTimeScheduleConfigured(settings) {
  if (!settings) {
    return false;
  }
  const start = parseHmToMinutes(settings.dayStartTime);
  return (
    start != null &&
    Number.isInteger(settings.matchDurationMinutes) &&
    settings.matchDurationMinutes >= TimeScheduleLimits.matchDurationMinutes.min &&
    settings.matchDurationMinutes <= TimeScheduleLimits.matchDurationMinutes.max &&
    Number.isInteger(settings.matchIntervalMinutes) &&
    settings.matchIntervalMinutes >= TimeScheduleLimits.matchIntervalMinutes.min &&
    settings.matchIntervalMinutes <= TimeScheduleLimits.matchIntervalMinutes.max &&
    Number.isInteger(settings.qualifyingToFinalsIntervalMinutes) &&
    settings.qualifyingToFinalsIntervalMinutes >=
      TimeScheduleLimits.qualifyingToFinalsIntervalMinutes.min &&
    settings.qualifyingToFinalsIntervalMinutes <=
      TimeScheduleLimits.qualifyingToFinalsIntervalMinutes.max
  );
}

function rangeError(label, limits) {
  return `${label}は${limits.min}〜${limits.max}の整数で入力してください。`;
}

/**
 * フォーム / Firestore 向けに正規化・検証。全空は未設定として成功。
 * @param {object} input
 * @param {{ requireQualifyingInterval?: boolean }} [options]
 */
export function validateTimeScheduleInput(input = {}, options = {}) {
  const errors = {};
  const requireQualifyingInterval = options.requireQualifyingInterval !== false;

  const dayStart = normalizeDayStartTime(input.dayStartTime);
  if (dayStart === null) {
    errors.dayStartTime = "開始時刻は HH:mm 形式で入力してください。";
  }

  const duration = parseOptionalNonNegativeInt(input.matchDurationMinutes);
  if (duration === null) {
    errors.matchDurationMinutes = "1試合の想定時間は整数で入力してください。";
  } else if (duration !== undefined) {
    if (duration < TimeScheduleLimits.matchDurationMinutes.min) {
      errors.matchDurationMinutes = "1試合の想定時間は1分以上で入力してください。";
    } else if (duration > TimeScheduleLimits.matchDurationMinutes.max) {
      errors.matchDurationMinutes = rangeError(
        "1試合の想定時間",
        TimeScheduleLimits.matchDurationMinutes
      );
    }
  }

  const interval = parseOptionalNonNegativeInt(input.matchIntervalMinutes);
  if (interval === null) {
    errors.matchIntervalMinutes = "試合間は整数で入力してください。";
  } else if (interval !== undefined) {
    if (
      interval < TimeScheduleLimits.matchIntervalMinutes.min ||
      interval > TimeScheduleLimits.matchIntervalMinutes.max
    ) {
      errors.matchIntervalMinutes = rangeError(
        "試合間",
        TimeScheduleLimits.matchIntervalMinutes
      );
    }
  }

  const qualifyingInterval = parseOptionalNonNegativeInt(
    input.qualifyingToFinalsIntervalMinutes
  );
  if (qualifyingInterval === null) {
    errors.qualifyingToFinalsIntervalMinutes =
      "予選終了後〜決勝開始は整数で入力してください。";
  } else if (qualifyingInterval !== undefined) {
    if (
      qualifyingInterval < TimeScheduleLimits.qualifyingToFinalsIntervalMinutes.min ||
      qualifyingInterval > TimeScheduleLimits.qualifyingToFinalsIntervalMinutes.max
    ) {
      errors.qualifyingToFinalsIntervalMinutes = rangeError(
        "予選終了後〜決勝開始",
        TimeScheduleLimits.qualifyingToFinalsIntervalMinutes
      );
    }
  }

  const anyFilled =
    Boolean(dayStart) ||
    duration !== undefined ||
    interval !== undefined ||
    qualifyingInterval !== undefined;

  if (!anyFilled) {
    return { valid: true, errors: {}, values: emptySettingsValues() };
  }

  if (!dayStart && !errors.dayStartTime) {
    errors.dayStartTime = "大会スケジュールを使う場合は開始時刻を入力してください。";
  }
  if (duration === undefined && !errors.matchDurationMinutes) {
    errors.matchDurationMinutes =
      "大会スケジュールを使う場合は1試合の想定時間を入力してください。";
  }
  if (interval === undefined && !errors.matchIntervalMinutes) {
    errors.matchIntervalMinutes = "大会スケジュールを使う場合は試合間を入力してください。";
  }
  if (
    requireQualifyingInterval &&
    qualifyingInterval === undefined &&
    !errors.qualifyingToFinalsIntervalMinutes
  ) {
    errors.qualifyingToFinalsIntervalMinutes =
      "大会スケジュールを使う場合は予選終了後〜決勝開始を入力してください。";
  }

  if (input.overrides != null) {
    if (typeof input.overrides !== "object" || Array.isArray(input.overrides)) {
      errors.timeSchedule = "開始予定の手動修正データの形式が正しくありません。";
    }
  }

  if (Object.keys(errors).length > 0) {
    return { valid: false, errors, values: null };
  }

  return {
    valid: true,
    errors: {},
    values: {
      dayStartTime: dayStart || null,
      matchDurationMinutes: duration ?? null,
      matchIntervalMinutes: interval ?? null,
      qualifyingToFinalsIntervalMinutes:
        qualifyingInterval === undefined ? 0 : qualifyingInterval,
    },
  };
}

/**
 * 永続化ドキュメント本体（timestamps は呼び出し側）
 * 未設定は null（呼び出し側で delete）
 * @param {object} values
 */
export function buildTimeScheduleDoc(values) {
  if (!isTimeScheduleConfigured({
    dayStartTime: values?.dayStartTime,
    matchDurationMinutes: values?.matchDurationMinutes,
    matchIntervalMinutes: values?.matchIntervalMinutes,
    qualifyingToFinalsIntervalMinutes: values?.qualifyingToFinalsIntervalMinutes ?? 0,
  })) {
    return null;
  }

  return {
    dayStartTime: values.dayStartTime,
    matchDurationMinutes: values.matchDurationMinutes,
    matchIntervalMinutes: values.matchIntervalMinutes,
    qualifyingToFinalsIntervalMinutes: values.qualifyingToFinalsIntervalMinutes,
    overrides: emptyTimeScheduleOverrides(),
  };
}

/**
 * Firestore ドキュメントをアプリ用に正規化
 * @param {object|null|undefined} data
 */
export function normalizeTimeScheduleDoc(data) {
  if (!data || typeof data !== "object") {
    return null;
  }
  const dayStartTime = normalizeDayStartTime(data.dayStartTime);
  const matchDurationMinutes = parseOptionalNonNegativeInt(data.matchDurationMinutes);
  const matchIntervalMinutes = parseOptionalNonNegativeInt(data.matchIntervalMinutes);
  const qualifyingToFinalsIntervalMinutes = parseOptionalNonNegativeInt(
    data.qualifyingToFinalsIntervalMinutes
  );
  const settings = {
    dayStartTime: dayStartTime || null,
    matchDurationMinutes:
      matchDurationMinutes === undefined || matchDurationMinutes === null
        ? null
        : matchDurationMinutes,
    matchIntervalMinutes:
      matchIntervalMinutes === undefined || matchIntervalMinutes === null
        ? null
        : matchIntervalMinutes,
    qualifyingToFinalsIntervalMinutes:
      qualifyingToFinalsIntervalMinutes === undefined ||
      qualifyingToFinalsIntervalMinutes === null
        ? null
        : qualifyingToFinalsIntervalMinutes,
    overrides: normalizeTimeScheduleOverrides(data.overrides),
  };
  if (!isTimeScheduleConfigured(settings)) {
    return {
      ...settings,
      configured: false,
    };
  }
  return {
    ...settings,
    configured: true,
  };
}

/**
 * @param {object|null|undefined} tournament
 */
export function tournamentHasQualifyingPhase(tournament) {
  return tournament?.tournamentFormat !== TournamentFormat.SINGLE_ELIMINATION;
}

/**
 * @param {Array<{ rounds?: unknown[] }>|null|undefined} blocks
 * @returns {number|null}
 */
function maxRoundCountFromBlocks(blocks) {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return null;
  }
  let max = 0;
  for (const block of blocks) {
    const count = Array.isArray(block?.rounds) ? block.rounds.length : 0;
    if (count > max) {
      max = count;
    }
  }
  return max > 0 ? max : null;
}

/**
 * 予選節数。確定対戦表があれば実節数、なければブロック人数から概算。
 * @param {{
 *   schedule?: object|null,
 *   blockDraw?: object|null,
 *   tournament?: object|null,
 *   teamCount?: number|null,
 * }} [params]
 * @returns {{ count: number|null, estimated: boolean }}
 */
export function resolveQualifyingRoundCount(params = {}) {
  const { schedule = null, blockDraw = null, tournament = null, teamCount = null } = params;

  if (schedule?.finalized === true) {
    const fromSchedule = maxRoundCountFromBlocks(schedule.blocks);
    if (fromSchedule != null) {
      return { count: fromSchedule, estimated: false };
    }
  }

  if (Array.isArray(blockDraw?.blocks) && blockDraw.blocks.length > 0) {
    let max = 0;
    for (const block of blockDraw.blocks) {
      const size = Array.isArray(block?.entryIds) ? block.entryIds.length : 0;
      const rounds = getQualifyingRoundCountForTeamCount(size);
      if (rounds != null && rounds > max) {
        max = rounds;
      }
    }
    if (max > 0) {
      return { count: max, estimated: true };
    }
  }

  const resolvedTeamCount =
    Number.isInteger(teamCount) && teamCount > 0
      ? teamCount
      : Number.isInteger(tournament?.maxTeams) && tournament.maxTeams > 0
        ? tournament.maxTeams
        : null;

  if (
    tournament?.tournamentFormat === TournamentFormat.QUALIFYING_AND_FINALS &&
    Number.isInteger(tournament.blockCount) &&
    tournament.blockCount > 0 &&
    resolvedTeamCount != null
  ) {
    const distribution = calculateBlockDistribution(resolvedTeamCount, tournament.blockCount);
    const sizes = [distribution.minBlockSize, distribution.maxBlockSize].filter((size) =>
      isSupportedTeamCount(size)
    );
    let max = 0;
    for (const size of sizes) {
      const rounds = getQualifyingRoundCountForTeamCount(size);
      if (rounds != null && rounds > max) {
        max = rounds;
      }
    }
    if (max > 0) {
      return { count: max, estimated: true };
    }
  }

  const preferred = tournament?.preferredBlockSize;
  if (isSupportedTeamCount(preferred)) {
    const rounds = getQualifyingRoundCountForTeamCount(preferred);
    if (rounds != null) {
      return { count: rounds, estimated: true };
    }
  }

  return { count: null, estimated: true };
}

/**
 * @param {object|null|undefined} finalsBracket
 * @returns {number|null}
 */
function finalsRoundCountFromBracket(finalsBracket) {
  if (Number.isInteger(finalsBracket?.roundCount) && finalsBracket.roundCount >= 1) {
    return finalsBracket.roundCount;
  }
  if (!Array.isArray(finalsBracket?.matches) || finalsBracket.matches.length === 0) {
    return null;
  }
  let max = 0;
  for (const match of finalsBracket.matches) {
    if (Number.isInteger(match?.roundNumber) && match.roundNumber > max) {
      max = match.roundNumber;
    }
  }
  return max > 0 ? max : null;
}

/**
 * @param {{
 *   finalsBracket?: object|null,
 *   tournament?: object|null,
 *   teamCount?: number|null,
 * }} [params]
 * @returns {{ count: number|null, estimated: boolean }}
 */
export function resolveFinalsRoundCount(params = {}) {
  const { finalsBracket = null, tournament = null, teamCount = null } = params;
  const fromBracket = finalsRoundCountFromBracket(finalsBracket);
  if (fromBracket != null) {
    return { count: fromBracket, estimated: false };
  }

  if (tournament?.tournamentFormat === TournamentFormat.SINGLE_ELIMINATION) {
    const n =
      Number.isInteger(teamCount) && teamCount >= 2
        ? teamCount
        : Number.isInteger(tournament?.maxTeams)
          ? tournament.maxTeams
          : null;
    const resolved = resolveSingleEliminationBracketSize(n);
    if (!resolved.valid || !resolved.bracketSize) {
      return { count: null, estimated: true };
    }
    const rounds = roundCountFor(resolved.bracketSize);
    return Number.isFinite(rounds) && rounds >= 1
      ? { count: rounds, estimated: true }
      : { count: null, estimated: true };
  }

  const finalTeamCount = resolveStoredOrDerivedFinalTeamCount(tournament);
  const bracketSize = bracketSizeFor(finalTeamCount);
  if (!bracketSize) {
    return { count: null, estimated: true };
  }
  const rounds = roundCountFor(bracketSize);
  return Number.isFinite(rounds) && rounds >= 1
    ? { count: rounds, estimated: true }
    : { count: null, estimated: true };
}

function slotStarts(startMinutes, count, slotDuration) {
  return Array.from({ length: count }, (_, index) => startMinutes + index * slotDuration);
}

/**
 * 節/ラウンド override をアンカーとして、後続の自動開始時刻を再計算する。
 * 存在しない roundNumber の override は無視する。
 * @param {number[]} automaticStartMinutes
 * @param {Record<string, string>|null|undefined} roundOverrides
 * @param {number} slotDurationMinutes
 * @returns {{ startMinutes: number[], manual: boolean[] }}
 */
export function resolveAnchoredRoundStartMinutes(
  automaticStartMinutes,
  roundOverrides,
  slotDurationMinutes
) {
  if (!Array.isArray(automaticStartMinutes) || automaticStartMinutes.length === 0) {
    return { startMinutes: [], manual: [] };
  }
  const overrides = normalizeOverrideMap(roundOverrides);
  const slot =
    Number.isInteger(slotDurationMinutes) && slotDurationMinutes >= 0 ? slotDurationMinutes : 0;
  /** @type {number[]} */
  const startMinutes = [];
  /** @type {boolean[]} */
  const manual = [];
  let anchorRound = 0;
  let anchorMinutes = 0;

  for (let index = 0; index < automaticStartMinutes.length; index += 1) {
    const roundNumber = index + 1;
    const overrideMinutes = parseHmToMinutes(overrides[String(roundNumber)]);
    if (overrideMinutes != null) {
      startMinutes.push(overrideMinutes);
      manual.push(true);
      anchorRound = roundNumber;
      anchorMinutes = overrideMinutes;
      continue;
    }
    if (anchorRound > 0) {
      startMinutes.push(anchorMinutes + (roundNumber - anchorRound) * slot);
      manual.push(false);
      continue;
    }
    startMinutes.push(automaticStartMinutes[index]);
    manual.push(false);
  }

  return { startMinutes, manual };
}

/**
 * 予選第1節〜第N節の開始分。UI で計算式を再実装しないこと。
 * @param {object|null|undefined} settings
 * @param {number} roundCount
 * @returns {number[]|null}
 */
export function computeQualifyingRoundStartMinutes(settings, roundCount) {
  if (!isTimeScheduleConfigured(settings)) {
    return null;
  }
  if (!Number.isInteger(roundCount) || roundCount < 1) {
    return null;
  }
  const dayStartMinutes = parseHmToMinutes(settings.dayStartTime);
  if (dayStartMinutes == null) {
    return null;
  }
  const slotDuration = settings.matchDurationMinutes + settings.matchIntervalMinutes;
  return slotStarts(dayStartMinutes, roundCount, slotDuration);
}

/**
 * 確定済み（または表示中）の block.rounds[] から、節ごとの開始予定時刻を解決する。
 * 節 override があればアンカーとして後続を再計算する。
 * @param {object|null|undefined} settings
 * @param {object|null|undefined} schedule
 * @returns {{
 *   rounds: Record<string, { startTime: string, startTimeDisplay: string, manual: boolean }>,
 *   matchOverrides: Record<string, string>,
 * }|null}
 */
export function buildQualifyingPublicTimeSchedule(settings, schedule) {
  const normalized =
    settings?.configured === true ? settings : normalizeTimeScheduleDoc(settings);
  if (!normalized?.configured) {
    return null;
  }
  const roundCount = maxRoundCountFromBlocks(schedule?.blocks);
  const automatic = computeQualifyingRoundStartMinutes(normalized, roundCount);
  if (!automatic) {
    return null;
  }
  const slotDuration = normalized.matchDurationMinutes + normalized.matchIntervalMinutes;
  const overrides = normalizeTimeScheduleOverrides(normalized.overrides);
  const { startMinutes, manual } = resolveAnchoredRoundStartMinutes(
    automatic,
    overrides.qualifyingRounds,
    slotDuration
  );
  /** @type {Record<string, { startTime: string, startTimeDisplay: string, manual: boolean }>} */
  const rounds = {};
  startMinutes.forEach((minutes, index) => {
    rounds[String(index + 1)] = {
      startTime: formatMinutesToHm(minutes),
      startTimeDisplay: formatMinutesAsDisplayTime(minutes),
      manual: manual[index] === true,
    };
  });
  return { rounds, matchOverrides: overrides.qualifyingMatches };
}

/**
 * @param {number} roundNumber
 * @param {string|null|undefined} startTimeDisplay
 */
export function formatQualifyingRoundTitle(roundNumber, startTimeDisplay) {
  return formatScheduledRoundHeading(`第${roundNumber}節`, startTimeDisplay);
}

/**
 * @param {string|null|undefined} startTimeDisplay
 */
export function formatQualifyingMatchScheduledLabel(startTimeDisplay) {
  if (!startTimeDisplay) {
    return "";
  }
  return `${startTimeDisplay}予定`;
}

/**
 * @param {boolean} manual
 */
export function formatManualScheduledMarker(manual) {
  return manual ? "（手動）" : "";
}

function resolveMatchScheduledSlot(roundSlot, matchId, matchOverrides) {
  const overrideMinutes = matchId
    ? parseHmToMinutes(matchOverrides?.[String(matchId)])
    : null;
  if (overrideMinutes != null) {
    return {
      startTime: formatMinutesToHm(overrideMinutes),
      startTimeDisplay: formatMinutesAsDisplayTime(overrideMinutes),
      matchManual: true,
    };
  }
  return {
    startTime: roundSlot?.startTime ?? null,
    startTimeDisplay: roundSlot?.startTimeDisplay ?? null,
    matchManual: false,
  };
}

/**
 * @param {{ rounds?: Record<string, object>, matchOverrides?: Record<string, string> }|null|undefined} timeSchedule
 * @param {number|string} roundNumber
 * @param {string|null|undefined} matchId
 */
export function resolveScheduledSlotForMatch(timeSchedule, roundNumber, matchId) {
  const slot = timeSchedule?.rounds?.[String(roundNumber)] ?? null;
  return resolveMatchScheduledSlot(slot, matchId, timeSchedule?.matchOverrides ?? {});
}

/**
 * 公開 snapshot 用。manual / matchOverrides は載せない。
 * @param {{ rounds?: Record<string, { startTime?: string, startTimeDisplay?: string }> }|null|undefined} lookup
 */
export function toPublicTimeScheduleLookup(lookup) {
  if (!lookup?.rounds || typeof lookup.rounds !== "object") {
    return null;
  }
  /** @type {Record<string, { startTime: string, startTimeDisplay?: string }>} */
  const rounds = {};
  for (const [key, slot] of Object.entries(lookup.rounds)) {
    if (!slot?.startTime) {
      continue;
    }
    rounds[key] = {
      startTime: slot.startTime,
      ...(slot.startTimeDisplay ? { startTimeDisplay: slot.startTimeDisplay } : {}),
    };
  }
  return Object.keys(rounds).length > 0 ? { rounds } : null;
}

/**
 * 公開 view の予選 schedule セクションへ、解決済み予定時刻を付与する。
 * @param {object|null|undefined} scheduleSection
 * @param {{
 *   rounds?: Record<string, { startTime?: string, startTimeDisplay?: string, manual?: boolean }>,
 *   matchOverrides?: Record<string, string>,
 * }|null|undefined} timeSchedule
 * @param {{ includeManual?: boolean }} [options]
 */
export function applyQualifyingScheduledTimesToScheduleSection(
  scheduleSection,
  timeSchedule,
  options = {}
) {
  if (!scheduleSection || !Array.isArray(scheduleSection.blocks)) {
    return scheduleSection;
  }
  const includeManual = options.includeManual === true;
  const roundsMap = timeSchedule?.rounds ?? null;
  const matchOverrides = timeSchedule?.matchOverrides ?? {};
  return {
    ...scheduleSection,
    blocks: scheduleSection.blocks.map((block) => ({
      ...block,
      rounds: (block.rounds ?? []).map((round) => {
        const slot = roundsMap?.[String(round.roundNumber)] ?? null;
        const startTime = slot?.startTime ?? null;
        const display = slot?.startTimeDisplay ?? null;
        const roundManual = slot?.manual === true;
        return {
          ...round,
          scheduledStartTime: startTime,
          roundHeading: formatQualifyingRoundTitle(round.roundNumber, display),
          ...(includeManual ? { scheduledStartManual: roundManual } : {}),
          matches: (round.matches ?? []).map((match) => {
            const resolved = resolveMatchScheduledSlot(slot, match.matchId, matchOverrides);
            const matchLabel = formatQualifyingMatchScheduledLabel(resolved.startTimeDisplay) || null;
            return {
              ...match,
              scheduledStartTime: resolved.startTime,
              scheduledStartLabel: matchLabel,
              ...(includeManual ? { scheduledStartManual: resolved.matchManual } : {}),
            };
          }),
        };
      }),
    })),
  };
}

/**
 * @param {{
 *   settings?: object|null,
 *   tournament?: object|null,
 *   schedule?: object|null,
 *   blockDraw?: object|null,
 *   finalsBracket?: object|null,
 *   teamCount?: number|null,
 * }} [params]
 */
export function buildTournamentTimePlan(params = {}) {
  const settings = params.settings;
  if (!isTimeScheduleConfigured(settings)) {
    return { configured: false };
  }

  const hasQualifying = tournamentHasQualifyingPhase(params.tournament);
  const slotDuration = settings.matchDurationMinutes + settings.matchIntervalMinutes;
  const dayStartMinutes = parseHmToMinutes(settings.dayStartTime);
  if (dayStartMinutes == null) {
    return { configured: false };
  }

  const finalsResolved = resolveFinalsRoundCount({
    finalsBracket: params.finalsBracket,
    tournament: params.tournament,
    teamCount: params.teamCount,
  });
  if (!Number.isInteger(finalsResolved.count) || finalsResolved.count < 1) {
    return { configured: false };
  }

  /** @type {number|null} */
  let qualifyingRoundCount = null;
  let qualifyingEstimated = false;
  /** @type {number[]} */
  let qualifyingRoundStartMinutes = [];
  /** @type {number|null} */
  let qualifyingEndMinutes = null;
  let finalsStartMinutes = dayStartMinutes;

  if (hasQualifying) {
    const qualifyingResolved = resolveQualifyingRoundCount({
      schedule: params.schedule,
      blockDraw: params.blockDraw,
      tournament: params.tournament,
      teamCount: params.teamCount,
    });
    if (!Number.isInteger(qualifyingResolved.count) || qualifyingResolved.count < 1) {
      return { configured: false };
    }
    qualifyingRoundCount = qualifyingResolved.count;
    qualifyingEstimated = qualifyingResolved.estimated;
    const automaticQualifying =
      computeQualifyingRoundStartMinutes(settings, qualifyingRoundCount) ?? [];
    const qualifyingAnchored = resolveAnchoredRoundStartMinutes(
      automaticQualifying,
      settings.overrides?.qualifyingRounds,
      slotDuration
    );
    qualifyingRoundStartMinutes = qualifyingAnchored.startMinutes;
    qualifyingEndMinutes =
      qualifyingRoundStartMinutes[qualifyingRoundCount - 1] + settings.matchDurationMinutes;
    finalsStartMinutes = qualifyingEndMinutes + settings.qualifyingToFinalsIntervalMinutes;
  }

  const automaticFinals = slotStarts(
    finalsStartMinutes,
    finalsResolved.count,
    slotDuration
  );
  const finalsAnchored = resolveAnchoredRoundStartMinutes(
    automaticFinals,
    settings.overrides?.finalsRounds,
    slotDuration
  );
  const finalsRoundStartMinutes = finalsAnchored.startMinutes;
  const tournamentEndMinutes =
    finalsRoundStartMinutes[finalsResolved.count - 1] + settings.matchDurationMinutes;

  // 設定値から節/ラウンド数を推定している部分が1つでもあれば概算
  const estimated = hasQualifying
    ? qualifyingEstimated || finalsResolved.estimated
    : finalsResolved.estimated;

  return {
    configured: true,
    estimated,
    hasQualifying,
    slotDurationMinutes: slotDuration,
    dayStartMinutes,
    qualifyingRoundCount,
    qualifyingRoundStartMinutes,
    qualifyingRoundStartTimes: qualifyingRoundStartMinutes.map((value) => formatMinutesToHm(value)),
    qualifyingEndMinutes,
    qualifyingEndTime: qualifyingEndMinutes != null ? formatMinutesToHm(qualifyingEndMinutes) : null,
    finalsStartMinutes,
    finalsStartTime: formatMinutesToHm(finalsStartMinutes),
    finalsRoundCount: finalsResolved.count,
    finalsRoundStartMinutes,
    finalsRoundStartTimes: finalsRoundStartMinutes.map((value) => formatMinutesToHm(value)),
    tournamentEndMinutes,
    tournamentEndTime: formatMinutesToHm(tournamentEndMinutes),
    durationMinutes: tournamentEndMinutes - dayStartMinutes,
  };
}

/**
 * @param {number} totalMinutes
 */
export function formatTimeScheduleDuration(totalMinutes) {
  if (!Number.isInteger(totalMinutes) || totalMinutes < 0) {
    return null;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0 && minutes > 0) {
    return `約${hours}時間${minutes}分`;
  }
  if (hours > 0) {
    return `約${hours}時間`;
  }
  return `約${minutes}分`;
}

/**
 * @param {object} plan
 */
export function formatTimeScheduleRange(plan) {
  if (!plan?.configured) {
    return null;
  }
  const start = formatMinutesAsDisplayTime(plan.dayStartMinutes);
  const end = formatMinutesAsDisplayTime(plan.tournamentEndMinutes);
  if (!start || !end) {
    return null;
  }
  return `${start} ～ ${end}`;
}

/**
 * ダッシュボード概要用。計算不能なら visible: false。
 * @param {Parameters<typeof buildTournamentTimePlan>[0]} params
 */
export function resolveTournamentTimeScheduleSummary(params = {}) {
  const plan = buildTournamentTimePlan(params);
  if (!plan.configured) {
    return { visible: false, plan: null };
  }
  const rangeText = formatTimeScheduleRange(plan);
  const durationText = formatTimeScheduleDuration(plan.durationMinutes);
  if (!rangeText || !durationText) {
    return { visible: false, plan };
  }
  return {
    visible: true,
    plan,
    label: plan.estimated ? "大会予定時間（概算）" : "大会予定時間",
    rangeText,
    durationText: `所要時間：${durationText}`,
  };
}

/**
 * @param {string|null|undefined} roundLabel
 * @param {string|null|undefined} startTimeDisplay
 */
export function formatScheduledRoundHeading(roundLabel, startTimeDisplay) {
  const label = String(roundLabel ?? "").trim();
  if (!startTimeDisplay) {
    return label;
  }
  if (!label) {
    return `${startTimeDisplay}開始予定`;
  }
  return `${label}　${startTimeDisplay}開始予定`;
}

/**
 * 確定済み決勝ブラケットのラウンド開始予定時刻。
 * ブラケット構造が無い場合は null（設定値からの推定ラウンドでは表示しない）。
 * ラウンド override はアンカーとして後続へ適用する。
 * @param {{
 *   settings?: object|null,
 *   tournament?: object|null,
 *   schedule?: object|null,
 *   blockDraw?: object|null,
 *   finalsBracket?: object|null,
 *   teamCount?: number|null,
 * }} [params]
 * @returns {{
 *   rounds: Record<string, { startTime: string, startTimeDisplay: string, manual: boolean }>,
 *   matchOverrides: Record<string, string>,
 * }|null}
 */
export function buildFinalsPublicTimeSchedule(params = {}) {
  const settings =
    params.settings?.configured === true
      ? params.settings
      : normalizeTimeScheduleDoc(params.settings);
  if (!settings?.configured) {
    return null;
  }
  const fromBracket = finalsRoundCountFromBracket(params.finalsBracket);
  if (!Number.isInteger(fromBracket) || fromBracket < 1) {
    return null;
  }

  const plan = buildTournamentTimePlan({
    settings,
    tournament: params.tournament,
    schedule: params.schedule,
    blockDraw: params.blockDraw,
    finalsBracket: params.finalsBracket,
    teamCount: params.teamCount,
  });
  if (!plan.configured || !Array.isArray(plan.finalsRoundStartMinutes)) {
    return null;
  }

  const overrides = normalizeTimeScheduleOverrides(settings.overrides);
  /** @type {Record<string, { startTime: string, startTimeDisplay: string, manual: boolean }>} */
  const rounds = {};
  plan.finalsRoundStartMinutes.forEach((minutes, index) => {
    const roundNumber = String(index + 1);
    rounds[roundNumber] = {
      startTime: formatMinutesToHm(minutes),
      startTimeDisplay: formatMinutesAsDisplayTime(minutes),
      manual: parseHmToMinutes(overrides.finalsRounds[roundNumber]) != null,
    };
  });
  return Object.keys(rounds).length > 0
    ? { rounds, matchOverrides: overrides.finalsMatches }
    : null;
}

function isAdminFinalsMatchContext(item) {
  return Boolean(item && typeof item === "object" && item.match && ("teams" in item || "displayStatus" in item));
}

/**
 * 決勝（管理 display rounds / 公開 bracket.rounds）へ解決済み予定時刻を付与する。
 * @param {object[]|null|undefined} rounds
 * @param {{
 *   rounds?: Record<string, { startTime?: string, startTimeDisplay?: string, manual?: boolean }>,
 *   matchOverrides?: Record<string, string>,
 * }|null|undefined} timeSchedule
 * @param {{ includeManual?: boolean }} [options]
 */
export function applyFinalsScheduledTimesToRounds(rounds, timeSchedule, options = {}) {
  if (!Array.isArray(rounds)) {
    return rounds;
  }
  const includeManual = options.includeManual === true;
  const roundsMap = timeSchedule?.rounds ?? null;
  const matchOverrides = timeSchedule?.matchOverrides ?? {};
  return rounds.map((round) => {
    const slot = roundsMap?.[String(round.roundNumber)] ?? null;
    const display = slot?.startTimeDisplay ?? null;
    const startTime = slot?.startTime ?? null;
    const roundLabel = round.roundLabel || "";
    const roundManual = slot?.manual === true;
    return {
      ...round,
      scheduledStartTime: startTime,
      roundHeading: formatScheduledRoundHeading(roundLabel, display),
      ...(includeManual ? { scheduledStartManual: roundManual } : {}),
      matches: (round.matches ?? []).map((item) => {
        const matchId = isAdminFinalsMatchContext(item) ? item.match?.matchId : item?.matchId;
        const resolved = resolveMatchScheduledSlot(slot, matchId, matchOverrides);
        const matchLabel = formatQualifyingMatchScheduledLabel(resolved.startTimeDisplay) || null;
        const stamped = {
          scheduledStartTime: resolved.startTime,
          scheduledStartLabel: matchLabel,
          ...(includeManual ? { scheduledStartManual: resolved.matchManual } : {}),
        };
        if (isAdminFinalsMatchContext(item)) {
          return {
            ...item,
            ...stamped,
            match: {
              ...item.match,
              ...stamped,
            },
          };
        }
        return {
          ...item,
          ...stamped,
        };
      }),
    };
  });
}

/**
 * @param {object|null|undefined} section
 * @param {{
 *   rounds?: Record<string, { startTime?: string, startTimeDisplay?: string, manual?: boolean }>,
 *   matchOverrides?: Record<string, string>,
 * }|null|undefined} timeSchedule
 */
export function applyFinalsScheduledTimesToBracketSection(section, timeSchedule) {
  if (!section || !Array.isArray(section.rounds)) {
    return section;
  }
  return {
    ...section,
    timeSchedule: toPublicTimeScheduleLookup(timeSchedule),
    rounds: applyFinalsScheduledTimesToRounds(section.rounds, timeSchedule),
  };
}

export const TimeScheduleOverrideBuckets = Object.freeze({
  QUALIFYING_ROUNDS: "qualifyingRounds",
  QUALIFYING_MATCHES: "qualifyingMatches",
  FINALS_ROUNDS: "finalsRounds",
  FINALS_MATCHES: "finalsMatches",
});

/**
 * @param {unknown} overrides
 * @param {string} bucket
 * @param {string|number} key
 * @param {unknown} hm
 */
export function setTimeScheduleOverride(overrides, bucket, key, hm) {
  const normalized = normalizeTimeScheduleOverrides(overrides);
  if (!Object.hasOwn(normalized, bucket)) {
    return { valid: false, error: "不正な上書き先です。", overrides: normalized };
  }
  const time = normalizeDayStartTime(hm);
  if (!time) {
    return {
      valid: false,
      error: "開始予定時刻は HH:mm 形式で入力してください。",
      overrides: normalized,
    };
  }
  return {
    valid: true,
    value: time,
    overrides: {
      ...normalized,
      [bucket]: {
        ...normalized[bucket],
        [String(key)]: time,
      },
    },
  };
}

/**
 * @param {unknown} overrides
 * @param {string} bucket
 * @param {string|number} key
 */
export function clearTimeScheduleOverride(overrides, bucket, key) {
  const normalized = normalizeTimeScheduleOverrides(overrides);
  if (!Object.hasOwn(normalized, bucket)) {
    return normalized;
  }
  const nextMap = { ...normalized[bucket] };
  delete nextMap[String(key)];
  return {
    ...normalized,
    [bucket]: nextMap,
  };
}
