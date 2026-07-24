/**
 * 大会ステータス検証（DOM 非依存）
 */
import { TournamentStatus } from "../domain/constants.js";

/**
 * @param {object|null|undefined} tournament
 */
export function isTournamentOpen(tournament) {
  return tournament?.status === TournamentStatus.OPEN;
}

/**
 * @param {object|null|undefined} tournament
 */
export function isTournamentClosed(tournament) {
  return tournament?.status === TournamentStatus.CLOSED;
}

/**
 * @param {object|null|undefined} tournament
 */
export function assertTournamentOpenForWrite(tournament) {
  if (!isTournamentOpen(tournament)) {
    const error = new Error("大会は終了済みのため、変更できません。");
    error.code = "tournament/not-open";
    throw error;
  }
  return tournament;
}
