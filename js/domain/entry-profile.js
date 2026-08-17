/**
 * 運営によるエントリー表示情報の編集（バリデーション）
 */
import { validateEntryInput } from "./validators.js";
import {
  getAdditionalMemberFieldKeys,
  normalizeTeamSize,
} from "./entry-members.js";

/**
 * 運営編集用入力の正規化・検証。
 * validateEntryInput を再利用し、保存用フィールド集合を明示する。
 *
 * @param {object} input
 * @param {number|string|null|undefined} teamSize
 * @returns {{
 *   valid: boolean,
 *   errors: Record<string, string>,
 *   values: {
 *     teamName: string,
 *     representativeName: string,
 *     email: string,
 *     comment: string,
 *     [memberKey: string]: string,
 *   }|null
 * }}
 */
export function validateEntryProfileInput(input, teamSize) {
  const result = validateEntryInput(input ?? {}, teamSize);
  if (!result.valid) {
    return result;
  }

  const normalizedTeamSize = normalizeTeamSize(teamSize);
  const values = {
    teamName: result.values.teamName,
    representativeName: result.values.representativeName,
    email: result.values.email,
    comment:
      typeof result.values.comment === "string" ? result.values.comment : "",
  };

  for (const fieldKey of getAdditionalMemberFieldKeys(normalizedTeamSize)) {
    values[fieldKey] = result.values[fieldKey];
  }

  return { valid: true, errors: {}, values };
}

/**
 * プロフィール更新で変更してよいフィールド（ドキュメントID・状態・内部値は含まない）
 */
export const ENTRY_PROFILE_EDITABLE_KEYS = [
  "teamName",
  "representativeName",
  "email",
  "member2",
  "member3",
  "member4",
  "comment",
];
