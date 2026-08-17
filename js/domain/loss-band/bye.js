/**
 * loss-band BYE 割当（純関数・乱数なし）
 * BYE は実試合ではない。played / opponentHistory / lossCount に含めない。
 */
import { LossBandMatchPurpose } from "./constants.js";

/**
 * @param {string} roundNumber
 * @param {number} lossCount
 */
export function buildLossBandByeMatchId(roundNumber, lossCount) {
  return `lb-r${roundNumber}-l${lossCount}-bye`;
}

/**
 * 過去 BYE 回数少 → entryId 昇順
 * @param {string[]} entryIds
 * @param {Map<string, number>|Record<string, number>|null|undefined} byeCounts
 */
export function pickByeEntryId(entryIds, byeCounts = null) {
  if (!Array.isArray(entryIds) || entryIds.length === 0) {
    const error = new Error("pickByeEntryId requires non-empty entryIds");
    error.code = "loss-band/bye-empty";
    throw error;
  }
  const getCount = (id) => {
    if (!byeCounts) return 0;
    if (byeCounts instanceof Map) return byeCounts.get(id) ?? 0;
    return byeCounts[id] ?? 0;
  };
  const sorted = [...entryIds].sort((a, b) => {
    const diff = getCount(a) - getCount(b);
    if (diff !== 0) return diff;
    return a.localeCompare(b, "en");
  });
  return sorted[0];
}

/**
 * 帯から BYE（奇数時1）を決め、残り entryId を返す
 * @param {string[]} entryIds
 * @param {Map<string, number>|Record<string, number>|null|undefined} byeCounts
 * @returns {{ byeEntryId: string|null, playingEntryIds: string[] }}
 */
export function selectByeAndPlayingEntryIds(entryIds, byeCounts = null) {
  const sorted = [...entryIds].sort((a, b) => a.localeCompare(b, "en"));
  if (sorted.length === 0) {
    return { byeEntryId: null, playingEntryIds: [] };
  }
  if (sorted.length % 2 === 0) {
    return { byeEntryId: null, playingEntryIds: sorted };
  }
  const byeEntryId = pickByeEntryId(sorted, byeCounts);
  return {
    byeEntryId,
    playingEntryIds: sorted.filter((id) => id !== byeEntryId),
  };
}

/**
 * @param {{
 *   roundNumber: number,
 *   lossCount: number,
 *   entryId: string,
 *   purpose?: string
 * }} params
 */
export function buildByeAssignment(params) {
  const {
    roundNumber,
    lossCount,
    entryId,
    purpose = LossBandMatchPurpose.RANKING,
  } = params;
  return {
    matchId: buildLossBandByeMatchId(roundNumber, lossCount),
    roundNumber,
    lossCount,
    entryId,
    team1EntryId: entryId,
    team2EntryId: null,
    purpose,
    isBye: true,
    resolution: "bye",
  };
}

/**
 * matchLog / result が BYE か
 * @param {object|null|undefined} record
 */
export function isLossBandByeRecord(record) {
  if (!record || typeof record !== "object") return false;
  if (record.isBye === true) return true;
  if (record.resolution === "bye") return true;
  if (record.purpose === LossBandMatchPurpose.RANKING && record.team2EntryId == null) {
    return record.winnerEntryId != null || record.entryId != null;
  }
  return false;
}

/**
 * @param {object} state
 * @returns {Map<string, number>}
 */
export function buildByeCountsFromState(state) {
  const map = new Map();
  for (const [entryId, team] of Object.entries(state?.teams ?? {})) {
    map.set(entryId, Number.isInteger(team?.byeCount) ? team.byeCount : 0);
  }
  return map;
}

/**
 * matchLog から BYE 回数を再集計
 * @param {Array<object>|null|undefined} matchLog
 */
export function buildByeCountsFromMatchLog(matchLog) {
  const map = new Map();
  if (!Array.isArray(matchLog)) return map;
  for (const record of matchLog) {
    if (!isLossBandByeRecord(record)) continue;
    const entryId = record.entryId ?? record.team1EntryId ?? record.winnerEntryId;
    if (typeof entryId !== "string" || !entryId) continue;
    map.set(entryId, (map.get(entryId) ?? 0) + 1);
  }
  return map;
}
