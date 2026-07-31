/**
 * 大会設定更新ペイロード組み立て（Firestore SDK 非依存）
 */
import {
  isFinalsMatchRulesLocked,
  normalizeFinalsMatchRules,
} from "./finals-match-format.js";
import {
  MatchFormat,
  isAggregateMatchRulesLocked,
  normalizeAggregateMatchRules,
  resolveMatchFormat,
} from "./aggregate-match-format.js";
import { STRUCTURE_LOCK_FIELD_KEYS } from "./tournament-structure-lock.js";
import { TournamentFormat } from "./tournament-format.js";
import { removeUndefinedFields } from "../lib/remove-undefined-fields.js";

/**
 * preferredBlockSize を保存対象にする大会形式か
 * @param {string|null|undefined} tournamentFormat
 */
export function usesPreferredBlockSize(tournamentFormat) {
  return (
    tournamentFormat !== TournamentFormat.SINGLE_ELIMINATION &&
    tournamentFormat !== TournamentFormat.QUALIFYING_AND_FINALS
  );
}

/**
 * 構造ロック時に入力と既存値が食い違っていないか
 * @param {object} tournament
 * @param {object} input
 * @param {boolean} structureLocked
 * @returns {string|null} エラーメッセージ
 */
export function getStructureLockConflictMessage(tournament, input, structureLocked) {
  if (!structureLocked) {
    return null;
  }
  for (const key of STRUCTURE_LOCK_FIELD_KEYS) {
    if (!(key in input) || input[key] === undefined) {
      continue;
    }
    if (input[key] !== tournament[key]) {
      return "エントリーまたは抽選開始後のため、募集チーム数・人数・ブロック基本人数は変更できません。";
    }
  }
  return null;
}

/**
 * @param {unknown} value
 * @returns {number|null}
 */
function toMillis(value) {
  if (value == null || value === "") {
    return null;
  }
  if (typeof value?.toMillis === "function") {
    return value.toMillis();
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

/**
 * @param {unknown} previous
 * @param {unknown} next
 * @param {string} key
 */
function isSameSettingsValue(previous, next, key) {
  if (key === "entryDeadline") {
    return toMillis(previous) === toMillis(next);
  }
  if (key === "finalsMatchRules" || key === "aggregateMatchRules") {
    return JSON.stringify(previous ?? null) === JSON.stringify(next ?? null);
  }
  if (key === "matchFormat") {
    return resolveMatchFormat(previous) === resolveMatchFormat(next);
  }
  return previous === next;
}

/**
 * updateDoc に渡す変更フィールドのみを組み立てる。
 * entryDeadline / updatedAt の Timestamp 化は呼び出し側で行う。
 *
 * @param {object} params
 * @param {object} params.input validateTournamentInput().values
 * @param {object} params.tournament 既存大会
 * @param {boolean} [params.structureLocked]
 * @param {boolean} [params.finalsWinsRequiredLocked]
 * @param {boolean} [params.aggregateMatchRulesLocked]
 * @param {object} [params.lockSignals] isFinalsMatchRulesLocked 用
 * @param {boolean} [params.changedFieldsOnly=true]
 */
export function buildTournamentSettingsUpdateFields({
  input,
  tournament,
  structureLocked = false,
  finalsWinsRequiredLocked = false,
  aggregateMatchRulesLocked = false,
  lockSignals = {},
  changedFieldsOnly = true,
} = {}) {
  const winsRequiredLocked =
    finalsWinsRequiredLocked === true || isFinalsMatchRulesLocked(lockSignals);
  const aggregateLocked =
    aggregateMatchRulesLocked === true || isAggregateMatchRulesLocked(lockSignals);

  const nextRules = normalizeFinalsMatchRules({
    winsRequired: input.winsRequired,
    finalsMatchRules: input.finalsMatchRules,
  });
  const nextMatchFormat = resolveMatchFormat(input.matchFormat ?? tournament?.matchFormat);
  const nextAggregate =
    nextMatchFormat === MatchFormat.MULTI_TEAM_TOTAL
      ? normalizeAggregateMatchRules(input.aggregateMatchRules || input)
      : null;

  /** @type {Record<string, unknown>} */
  const candidate = {
    name: input.name,
    eventDate: input.eventDate,
    venue: input.venue,
    courtCount: input.courtCount,
    entryDeadline: input.entryDeadline,
  };

  if (!structureLocked) {
    candidate.maxTeams = input.maxTeams;
    candidate.teamSize = input.teamSize;
    if (
      usesPreferredBlockSize(tournament?.tournamentFormat ?? input.tournamentFormat) &&
      input.preferredBlockSize != null
    ) {
      candidate.preferredBlockSize = input.preferredBlockSize;
    }
  }

  if (!winsRequiredLocked && nextMatchFormat === MatchFormat.HEAD_TO_HEAD_SETS) {
    candidate.winsRequired = nextRules.defaultWinsRequired;
    candidate.finalsMatchRules = {
      defaultWinsRequired: nextRules.defaultWinsRequired,
      roundOverrides: { ...nextRules.roundOverrides },
    };
  }

  if (!aggregateLocked) {
    // SE 以外は試合形式を永続化しない（未設定 = headToHeadSets）
    const format = tournament?.tournamentFormat ?? input.tournamentFormat;
    if (format === TournamentFormat.SINGLE_ELIMINATION) {
      candidate.matchFormat = nextMatchFormat;
      if (nextMatchFormat === MatchFormat.MULTI_TEAM_TOTAL && nextAggregate) {
        candidate.aggregateMatchRules = nextAggregate;
      }
    }
  }

  if (!changedFieldsOnly) {
    return /** @type {Record<string, unknown>} */ (removeUndefinedFields(candidate));
  }

  /** @type {Record<string, unknown>} */
  const changed = {};
  for (const [key, value] of Object.entries(candidate)) {
    if (!isSameSettingsValue(tournament?.[key], value, key)) {
      changed[key] = value;
    }
  }

  return /** @type {Record<string, unknown>} */ (removeUndefinedFields(changed));
}
