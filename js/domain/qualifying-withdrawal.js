/**
 * 対戦表確定後の参加辞退。
 * 永続的な変更はエントリーの confirmed → cancelled だけ。
 * ブロック配置と予選対戦表は書き換えず、無効試合は辞退エントリーから導出する。
 */
import { EntryStatus, TournamentStatus } from "./constants.js";
import { ENTRY_CANCEL_NOT_CONFIRMED_MESSAGE } from "./entry-cancellation.js";

export const QUALIFYING_WITHDRAWAL_VOID_LABEL = "参加辞退により中止";

export const QUALIFYING_WITHDRAWAL_STARTED_MESSAGE =
  "予選または決勝の実施データがあるため、参加辞退できません。";

/**
 * @param {Array<{ id?: string, entryId?: string, status?: string }>|null|undefined} entries
 */
export function collectCancelledEntryIds(entries) {
  const ids = new Set();
  for (const entry of entries || []) {
    const id = entry?.id || entry?.entryId;
    if (entry?.status === EntryStatus.CANCELLED && id) {
      ids.add(String(id));
    }
  }
  return ids;
}

/**
 * @param {object|null|undefined} match
 * @param {Set<string>|null|undefined} cancelledEntryIds
 */
export function isQualifyingMatchVoid(match, cancelledEntryIds) {
  if (!cancelledEntryIds || cancelledEntryIds.size === 0 || !match) {
    return false;
  }
  const team1 = String(match.team1?.entryId || match.homeEntryId || "");
  const team2 = String(match.team2?.entryId || match.awayEntryId || "");
  return (
    (team1 !== "" && cancelledEntryIds.has(team1)) ||
    (team2 !== "" && cancelledEntryIds.has(team2))
  );
}

/**
 * 対戦表は変更しない。新しい配列を返す。
 * @param {object|null|undefined} schedule
 * @param {string} entryId
 */
export function listQualifyingMatchesForEntry(schedule, entryId) {
  const target = String(entryId || "");
  const matches = [];
  for (const block of schedule?.blocks || []) {
    for (const round of block.rounds || []) {
      for (const match of round.matches || []) {
        const team1 = String(match.team1?.entryId || "");
        const team2 = String(match.team2?.entryId || "");
        if (team1 !== target && team2 !== target) {
          continue;
        }
        matches.push({
          matchId: match.matchId,
          blockId: block.blockId ?? null,
          blockName: block.blockName ?? null,
          roundNumber: round.roundNumber ?? match.roundNumber ?? null,
          courtNumber: match.courtNumber ?? null,
          team1Name: match.team1?.teamName ?? "—",
          team2Name: match.team2?.teamName ?? "—",
        });
      }
    }
  }
  return matches;
}

/**
 * @param {object|null|undefined} blockDraw
 * @param {string} entryId
 */
export function findBlockPlacement(blockDraw, entryId) {
  const target = String(entryId || "");
  for (const block of blockDraw?.blocks || []) {
    if ((block.entryIds || []).map(String).includes(target)) {
      return block;
    }
  }
  return null;
}

/**
 * @param {Record<string, boolean>|null|undefined} blockers
 */
export function hasWithdrawalBlocker(blockers) {
  return Object.values(blockers || {}).some((value) => value === true);
}

/**
 * @param {{
 *   entry?: object|null,
 *   tournament?: object|null,
 *   blockDraw?: object|null,
 *   schedule?: object|null,
 *   blockers?: Record<string, boolean>,
 * }} input
 */
export function evaluatePostScheduleWithdrawal({
  entry = null,
  tournament = null,
  blockDraw = null,
  schedule = null,
  blockers = {},
} = {}) {
  if (entry?.status === EntryStatus.CANCELLED) {
    return {
      allowed: false,
      alreadyApplied: true,
      code: "entry/already-cancelled",
      message: "このチームはすでに参加辞退済みです。",
      blockId: null,
      blockName: null,
      voidMatches: [],
    };
  }

  if (entry?.status !== EntryStatus.CONFIRMED) {
    return {
      allowed: false,
      alreadyApplied: false,
      code: "entry/not-confirmed",
      message: ENTRY_CANCEL_NOT_CONFIRMED_MESSAGE,
      blockId: null,
      blockName: null,
      voidMatches: [],
    };
  }

  if (tournament?.status !== TournamentStatus.OPEN) {
    return {
      allowed: false,
      alreadyApplied: false,
      code: "tournament/not-open",
      message: "大会が受付中でないため、参加辞退できません。",
      blockId: null,
      blockName: null,
      voidMatches: [],
    };
  }

  if (blockDraw?.status !== "finalized" || schedule?.finalized !== true) {
    return {
      allowed: false,
      alreadyApplied: false,
      code: "entry/withdrawal-not-ready",
      message: "ブロック確定と予選対戦表の確定後に、この操作が使えます。",
      blockId: null,
      blockName: null,
      voidMatches: [],
    };
  }

  const block = findBlockPlacement(blockDraw, entry.id);
  if (!block) {
    return {
      allowed: false,
      alreadyApplied: false,
      code: "entry/withdrawal-not-placed",
      message: "このチームはブロック配置に含まれていません。",
      blockId: null,
      blockName: null,
      voidMatches: [],
    };
  }

  if (hasWithdrawalBlocker(blockers)) {
    return {
      allowed: false,
      alreadyApplied: false,
      code: "entry/withdrawal-started",
      message: QUALIFYING_WITHDRAWAL_STARTED_MESSAGE,
      blockId: block.id ?? block.blockId ?? null,
      blockName: block.name ?? block.blockName ?? null,
      voidMatches: [],
    };
  }

  return {
    allowed: true,
    alreadyApplied: false,
    code: null,
    message: null,
    blockId: block.id ?? block.blockId ?? null,
    blockName: block.name ?? block.blockName ?? null,
    voidMatches: listQualifyingMatchesForEntry(schedule, entry.id),
  };
}

/**
 * 確認ダイアログ用。配置や対戦表の変更は述べない。
 * @param {{ teamName?: string, blockName?: string|null, voidMatches?: object[] }} preview
 */
export function formatPostScheduleWithdrawalConfirm(preview) {
  const lines = [
    `「${preview.teamName || "このチーム"}」を参加辞退にします。`,
    `所属ブロック: ${preview.blockName || "—"}`,
    "無効になる試合:",
  ];
  const matches = preview.voidMatches || [];
  if (matches.length === 0) {
    lines.push("（対象試合はありません）");
  } else {
    for (const match of matches) {
      lines.push(
        `第${match.roundNumber}節 ${match.courtNumber}コート ${match.team1Name} - ${match.team2Name}`
      );
    }
  }
  lines.push("他チーム同士の試合、節、コート、試合ID、ブロック配置は変わりません。");
  lines.push(`公開対戦表では「${QUALIFYING_WITHDRAWAL_VOID_LABEL}」と表示します。`);
  return lines.join("\n");
}
