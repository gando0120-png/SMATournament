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
