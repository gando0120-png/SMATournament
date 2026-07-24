/**
 * 公開エントリー受付可否（DOM 非依存）
 */
import { TournamentStatus } from "../domain/constants.js";

/**
 * @param {object|null|undefined} tournament
 * @param {number} [nowMs]
 */
export function isEntryOpenForTournament(tournament, nowMs = Date.now()) {
  if (!tournament || tournament.status !== TournamentStatus.OPEN) {
    return false;
  }

  const deadline = tournament.entryDeadline;
  if (!deadline) {
    return true;
  }

  const deadlineMs =
    typeof deadline.toDate === "function"
      ? deadline.toDate().getTime()
      : new Date(deadline).getTime();

  if (Number.isNaN(deadlineMs)) {
    return true;
  }

  return nowMs < deadlineMs;
}

/**
 * @param {object|null|undefined} tournament
 */
export function getEntryClosedMessage(tournament) {
  if (!tournament) {
    return "大会が見つかりません。";
  }

  if (tournament.status === TournamentStatus.DRAFT) {
    return "現在、エントリー受付開始前です。";
  }

  if (tournament.status === TournamentStatus.CLOSED) {
    return "この大会は終了しました。エントリーは受け付けていません。";
  }

  if (tournament.status !== TournamentStatus.OPEN) {
    return "現在、エントリーを受け付けていません。";
  }

  if (!isEntryOpenForTournament(tournament)) {
    return "エントリー締切を過ぎています。";
  }

  return "エントリーを受け付けていません。";
}

/**
 * @param {object|null|undefined} tournament
 */
export function assertEntryOpenForCreate(tournament) {
  if (!isEntryOpenForTournament(tournament)) {
    const error = new Error(getEntryClosedMessage(tournament));
    error.code = "entry/not-open";
    throw error;
  }
  return tournament;
}
