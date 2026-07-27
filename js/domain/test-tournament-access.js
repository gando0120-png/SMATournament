/**
 * E2E / TEST 大会向けテストツールのアクセス判定（DOM / Firestore 非依存）
 */
import { TournamentStatus } from "./constants.js";

/**
 * 厳密なテスト大会名判定（先頭一致・trim・大文字小文字無視）
 * @param {string|null|undefined} name
 */
export function isTestTournamentName(name) {
  const normalized = String(name ?? "").trim().toUpperCase();
  if (!normalized) {
    return false;
  }

  return (
    normalized.startsWith("[E2E]") ||
    normalized.startsWith("[TEST]") ||
    normalized === "E2E" ||
    normalized.startsWith("E2E ") ||
    normalized === "TEST" ||
    normalized.startsWith("TEST ")
  );
}

/**
 * E2E大会 / TEST大会 など、空白なし接続の曖昧パターン（厳密判定に含まれないもの）
 * @param {string|null|undefined} name
 */
export function isLooseTestTournamentName(name) {
  if (isTestTournamentName(name)) {
    return false;
  }
  const normalized = String(name ?? "").trim().toUpperCase();
  if (!normalized) {
    return false;
  }
  return /^E2E[^\s\[]/.test(normalized) || /^TEST[^\s\[]/.test(normalized);
}

/**
 * 一括削除候補として許可する大会名
 * @param {string|null|undefined} name
 */
export function isDeletableTestTournamentName(name) {
  return isTestTournamentName(name) || isLooseTestTournamentName(name);
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
      reason:
        "テストツールは大会名が [E2E] / [TEST] / E2E / TEST で始まる大会のみ利用できます。",
    };
  }

  return { allowed: true, reason: null };
}
