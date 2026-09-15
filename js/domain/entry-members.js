/**
 * エントリーメンバー人数（teamSize）に関するドメイン処理
 */

export const MAX_TEAM_SIZE = 4;

/** 代表者を除く追加メンバーフィールド（member2 = 2人目 …） */
export const ADDITIONAL_MEMBER_FIELD_KEYS = ["member2", "member3", "member4"];

/**
 * @param {number|string|null|undefined} teamSize
 */
export function normalizeTeamSize(teamSize) {
  const n = Number(teamSize);
  if (!Number.isInteger(n) || n < 1) {
    return 1;
  }
  if (n > MAX_TEAM_SIZE) {
    return MAX_TEAM_SIZE;
  }
  return n;
}

/**
 * 大会ドキュメントから teamSize を安全に解決（旧フィールド名にも対応）
 * @param {object|null|undefined} tournament
 */
export function resolveTeamSizeFromTournament(tournament) {
  const raw = tournament?.teamSize ?? tournament?.teamMemberCount ?? 1;
  return normalizeTeamSize(raw);
}

/**
 * @param {unknown} value
 * @returns {number|null}
 */
export function parseValidTeamSize(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > MAX_TEAM_SIZE) {
    return null;
  }
  return n;
}

/**
 * 大会の最少〜最大人数。min/max が揃って valid ならそれを使い、
 * 欠け・不正なら既存 teamSize を min=max として扱う。
 * @param {object|number|string|null|undefined} tournamentOrSize
 * @returns {{ min: number, max: number, isRange: boolean }}
 */
export function resolveTeamSizeRange(tournamentOrSize) {
  if (
    tournamentOrSize &&
    typeof tournamentOrSize === "object" &&
    Number.isInteger(tournamentOrSize.min) &&
    Number.isInteger(tournamentOrSize.max)
  ) {
    const min = normalizeTeamSize(tournamentOrSize.min);
    const max = normalizeTeamSize(tournamentOrSize.max);
    const lo = Math.min(min, max);
    const hi = Math.max(min, max);
    return { min: lo, max: hi, isRange: lo !== hi };
  }

  const fallback = resolveTeamSizeFromTournament(
    tournamentOrSize && typeof tournamentOrSize === "object" ? tournamentOrSize : { teamSize: tournamentOrSize }
  );
  const min = parseValidTeamSize(tournamentOrSize?.minTeamSize);
  const max = parseValidTeamSize(tournamentOrSize?.maxTeamSize);
  if (min != null && max != null && min <= max) {
    return { min, max, isRange: min !== max };
  }
  return { min: fallback, max: fallback, isRange: false };
}

/**
 * validateEntryInput 等に渡す引数を range に正規化
 * @param {object|number|string|null|undefined} teamSizeOrRange
 */
export function coerceTeamSizeRange(teamSizeOrRange) {
  return resolveTeamSizeRange(teamSizeOrRange);
}

/**
 * @param {object|null|undefined} tournament
 */
export function hasStoredTeamSizeRange(tournament) {
  return (
    parseValidTeamSize(tournament?.minTeamSize) != null &&
    parseValidTeamSize(tournament?.maxTeamSize) != null
  );
}

/**
 * @param {object|number|string|null|undefined} tournamentOrRange
 * @param {{ prefix?: boolean }} [options]
 */
export function formatTeamSizeRangeLabel(tournamentOrRange, options = {}) {
  const range = resolveTeamSizeRange(tournamentOrRange);
  const body =
    range.min === range.max ? `${range.min}人` : `${range.min}〜${range.max}人`;
  return options.prefix === false ? body : `1チーム ${body}`;
}

/**
 * @param {object|null|undefined} entry
 */
export function countEntryMembers(entry) {
  return collectEntryMemberNames(entry).length;
}

/**
 * @param {object|null|undefined} entry
 * @param {{ min: number, max: number }} range
 */
export function resolveEntrySelectedTeamSize(entry, range) {
  const count = countEntryMembers(entry);
  if (count >= range.min && count <= range.max) {
    return count;
  }
  return range.min;
}

/**
 * 運営編集で空になった追加メンバーを削除対象にする
 * @param {object} input
 * @param {{ min?: number, max: number }} range
 * @param {object} [existing]
 * @returns {{ set: Record<string, string>, deleteKeys: string[] }}
 */
export function buildEntryMemberUpdateFields(input, range, existing = {}) {
  const set = {};
  const deleteKeys = [];
  const maxSize = range?.max ?? resolveTeamSizeFromTournament(range);
  for (const key of getAdditionalMemberFieldKeys(maxSize)) {
    const value = typeof input?.[key] === "string" ? input[key].trim() : "";
    if (value) {
      set[key] = value;
    } else if (existing && Object.prototype.hasOwnProperty.call(existing, key) && existing[key] != null) {
      deleteKeys.push(key);
    }
  }
  return { set, deleteKeys };
}

/**
 * 大会設定に応じた追加メンバー入力フィールドキー
 * @param {number|string|null|undefined} teamSize
 */
export function getAdditionalMemberFieldKeys(teamSize) {
  const size = normalizeTeamSize(teamSize);
  return ADDITIONAL_MEMBER_FIELD_KEYS.slice(0, Math.max(0, size - 1));
}

/**
 * @param {string} fieldKey
 */
export function getMemberFieldLabel(fieldKey) {
  const num = fieldKey.replace("member", "");
  return `メンバー${num}`;
}

/**
 * エントリードキュメントから表示用メンバー名配列（代表者含む）
 * @param {object|null|undefined} entry
 */
export function collectEntryMemberNames(entry) {
  if (!entry) {
    return [];
  }

  const names = [];
  const representative =
    typeof entry.representativeName === "string" ? entry.representativeName.trim() : "";
  if (representative) {
    names.push(representative);
  }

  for (const key of ADDITIONAL_MEMBER_FIELD_KEYS) {
    const value = entry[key];
    if (typeof value === "string" && value.trim()) {
      names.push(value.trim());
    }
  }

  return names;
}

/**
 * @param {object|null|undefined} entry
 * @param {string} [separator]
 */
export function formatEntryMembersDisplay(entry, separator = " / ") {
  return collectEntryMemberNames(entry).join(separator);
}

/**
 * 管理画面向けメール表示（未登録の既存データは「未登録」）
 * @param {object|null|undefined} entry
 */
export function formatEntryEmailDisplay(entry) {
  const email = typeof entry?.email === "string" ? entry.email.trim() : "";
  return email || "未登録";
}

/**
 * @param {object} input
 * @param {number|string|null|undefined} teamSize
 */
export function readAdditionalMembersFromInput(input, teamSize) {
  const result = {};
  for (const key of getAdditionalMemberFieldKeys(teamSize)) {
    result[key] = typeof input[key] === "string" ? input[key].trim() : "";
  }
  return result;
}

/**
 * Firestore 保存用の追加メンバーフィールド
 * @param {object} input
 * @param {number|string|null|undefined} teamSize
 */
export function buildEntryMemberFirestorePayload(input, teamSize) {
  const payload = {};
  const members = readAdditionalMembersFromInput(input, teamSize);
  for (const [key, value] of Object.entries(members)) {
    if (value) {
      payload[key] = value;
    }
  }
  return payload;
}
