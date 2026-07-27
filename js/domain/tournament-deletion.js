/**
 * 大会論理削除（DOM / Firestore 非依存）
 */

/**
 * @param {object|null|undefined} tournament
 */
export function isTournamentDeleted(tournament) {
  return tournament?.isDeleted === true;
}

/**
 * @param {object|null|undefined} tournament
 */
export function filterActiveTournaments(tournaments) {
  if (!Array.isArray(tournaments)) {
    return [];
  }
  return tournaments.filter((tournament) => !isTournamentDeleted(tournament));
}
