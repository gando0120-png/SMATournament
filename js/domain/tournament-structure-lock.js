/**
 * 大会設定の構造ロック（teamSize / maxTeams / preferredBlockSize）
 */

export const STRUCTURE_LOCK_FIELD_KEYS = ["maxTeams", "teamSize", "preferredBlockSize"];

/**
 * @param {object|null|undefined} tournament
 * @param {object|null|undefined} signals
 */
export function isTournamentStructureLocked(tournament, signals) {
  if (tournament?.structureLocked === true) {
    return true;
  }
  if (!signals) {
    return false;
  }
  return Boolean(
    signals.hasEntries ||
      signals.hasBlockDraw ||
      signals.hasQualifyingSchedule ||
      signals.hasFinalsAdvancement ||
      signals.hasFinalsBracket
  );
}

/**
 * @param {object|null|undefined} signals
 */
export function shouldPersistStructureLock(signals) {
  return isTournamentStructureLocked(null, signals);
}
