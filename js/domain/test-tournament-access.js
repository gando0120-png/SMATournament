/**
 * E2E / TEST 大会向けテストツールのアクセス判定（DOM / Firestore 非依存）
 */
import { TournamentStatus } from "./constants.js";

/**
 * @param {string|null|undefined} name
 */
export function isTestTournamentName(name) {
  if (typeof name !== "string") {
    return false;
  }
  return name.startsWith("[E2E]") || name.startsWith("[TEST]");
}

/**
 * @param {{ tournament?: object|null, canManage?: boolean }} params
 */
export function canUseTournamentTestTools({ tournament, canManage = false }) {
  if (!canManage) {
    return { allowed: false, reason: "この大会を管理する権限がありません。" };
  }

  if (!tournament) {
    return { allowed: false, reason: "大会が見つかりません。" };
  }

  if (tournament.status === TournamentStatus.CLOSED) {
    return { allowed: false, reason: "終了済みの大会ではテストツールを利用できません。" };
  }

  if (!isTestTournamentName(tournament.name)) {
    return {
      allowed: false,
      reason: "テストツールは大会名が [E2E] または [TEST] で始まる大会のみ利用できます。",
    };
  }

  return { allowed: true, reason: null };
}
