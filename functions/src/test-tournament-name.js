/**
 * テスト大会名判定（functions 側。クライアント domain と同一ロジック）
 * @param {unknown} name
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
 * @param {unknown} name
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
 * @param {unknown} name
 */
export function isDeletableTestTournamentName(name) {
  return isTestTournamentName(name) || isLooseTestTournamentName(name);
}

/**
 * @param {unknown} name
 */
export function assertDeletableTestTournamentName(name) {
  if (!isDeletableTestTournamentName(name)) {
    const label = typeof name === "string" ? name : "(名称不明)";
    throw new Error(`テスト大会名条件を満たしていません: ${label}`);
  }
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
export function normalizeTournamentIds(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const unique = new Set();
  for (const item of value) {
    if (typeof item === "string" && item.trim()) {
      unique.add(item.trim());
    }
  }
  return [...unique];
}
