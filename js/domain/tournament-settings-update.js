/**
 * 大会設定更新ペイロード組み立て（Firestore SDK 非依存）
 */
import {
  isFinalsMatchRulesLocked,
  normalizeFinalsMatchRules,
} from "./finals-match-format.js";
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
 * updateDoc に渡すプレーン更新フィールドを組み立てる。
 * entryDeadline / updatedAt など Timestamp 化は呼び出し側で行う。
 *
 * @param {object} params
 * @param {object} params.input validateTournamentInput().values
 * @param {object} params.tournament 既存大会
 * @param {boolean} [params.structureLocked]
 * @param {boolean} [params.finalsWinsRequiredLocked]
 * @param {object} [params.lockSignals] isFinalsMatchRulesLocked 用
 */
export function buildTournamentSettingsUpdateFields({
  input,
  tournament,
  structureLocked = false,
  finalsWinsRequiredLocked = false,
  lockSignals = {},
} = {}) {
  const winsRequiredLocked =
    finalsWinsRequiredLocked === true || isFinalsMatchRulesLocked(lockSignals);

  const nextRules = normalizeFinalsMatchRules({
    winsRequired: input.winsRequired,
    finalsMatchRules: input.finalsMatchRules,
  });

  /** @type {Record<string, unknown>} */
  const fields = {
    name: input.name,
    eventDate: input.eventDate,
    venue: input.venue,
    courtCount: input.courtCount,
  };

  if (!structureLocked) {
    fields.maxTeams = input.maxTeams;
    fields.teamSize = input.teamSize;
    if (
      usesPreferredBlockSize(tournament?.tournamentFormat ?? input.tournamentFormat) &&
      input.preferredBlockSize != null
    ) {
      fields.preferredBlockSize = input.preferredBlockSize;
    }
  }

  if (!winsRequiredLocked) {
    fields.winsRequired = nextRules.defaultWinsRequired;
    fields.finalsMatchRules = {
      defaultWinsRequired: nextRules.defaultWinsRequired,
      roundOverrides: { ...nextRules.roundOverrides },
    };
  }

  return /** @type {Record<string, unknown>} */ (removeUndefinedFields(fields));
}
