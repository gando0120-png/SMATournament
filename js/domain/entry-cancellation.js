/**
 * 運営による参加辞退（confirmed → cancelled）。抽選前のみ。
 * エントリー記録は削除しない。
 */
import { EntryStatus, TournamentStatus } from "./constants.js";

export const ENTRY_CANCEL_AFTER_DRAW_MESSAGE =
  "抽選後の参加辞退は、この画面から処理できません。";

export const ENTRY_CANCEL_NOT_CONFIRMED_MESSAGE =
  "参加確定のチームのみ参加辞退できます。";

/**
 * 正式な抽選・予選組合せが存在する（draft 含む）。
 * 既存の構造ロックと同様、blockDraw/current または qualifyingSchedules/current
 * があれば抽選後とみなす。draft にも entryIds が入るため、自動再配置なしでは外せない。
 *
 * @param {{ blockDraw?: object|null, qualifyingSchedule?: object|null }} [input]
 */
export function hasFormalDrawOrQualifyingSchedule({
  blockDraw = null,
  qualifyingSchedule = null,
} = {}) {
  return Boolean(blockDraw) || Boolean(qualifyingSchedule);
}

/**
 * @param {object[]|null|undefined} entries
 */
export function filterConfirmedEntries(entries) {
  return (entries ?? []).filter((entry) => entry?.status === EntryStatus.CONFIRMED);
}

/**
 * @param {object[]|null|undefined} entries
 */
export function countConfirmedEntries(entries) {
  return filterConfirmedEntries(entries).length;
}

/**
 * @param {{
 *   entry?: object|null,
 *   tournament?: object|null,
 *   blockDraw?: object|null,
 *   qualifyingSchedule?: object|null,
 * }} [input]
 * @returns {{ allowed: boolean, code?: string, message?: string }}
 */
export function evaluateEntryCancellation({
  entry = null,
  tournament = null,
  blockDraw = null,
  qualifyingSchedule = null,
} = {}) {
  if (entry?.status !== EntryStatus.CONFIRMED) {
    return {
      allowed: false,
      code: "entry/not-confirmed",
      message: ENTRY_CANCEL_NOT_CONFIRMED_MESSAGE,
    };
  }

  if (tournament?.status !== TournamentStatus.OPEN) {
    return {
      allowed: false,
      code: "tournament/not-open",
      message: "大会は終了済みのため、変更できません。",
    };
  }

  if (hasFormalDrawOrQualifyingSchedule({ blockDraw, qualifyingSchedule })) {
    return {
      allowed: false,
      code: "entry/cancel-after-draw",
      message: ENTRY_CANCEL_AFTER_DRAW_MESSAGE,
    };
  }

  return { allowed: true };
}

/**
 * @param {Parameters<typeof evaluateEntryCancellation>[0]} input
 */
export function assertEntryCancellationAllowed(input) {
  const result = evaluateEntryCancellation(input);
  if (!result.allowed) {
    const error = new Error(result.message);
    error.code = result.code;
    throw error;
  }
  return result;
}
