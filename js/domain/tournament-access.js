/**
 * 大会管理権限のドメイン判定（Firestore 非依存）
 */

/**
 * @param {object | null | undefined} tournament
 * @param {string} uid
 */
export function isTournamentOwner(tournament, uid) {
  return Boolean(tournament?.createdBy && tournament.createdBy === uid);
}

/**
 * @param {object | null | undefined} operatorRecord
 */
export function isOperatorEnabledRecord(operatorRecord) {
  return operatorRecord?.enabled === true;
}

/**
 * @param {object | null | undefined} tournament
 * @param {string} uid
 * @param {object | null | undefined} operatorRecord
 */
export function canManageTournament(tournament, uid, operatorRecord) {
  return isOperatorEnabledRecord(operatorRecord) || isTournamentOwner(tournament, uid);
}
