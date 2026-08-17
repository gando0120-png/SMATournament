/**
 * loss_band → tournamentResults/current 変換（SE の canFinalizeTournament は変更しない）
 */
import { TournamentStatus } from "../constants.js";
import { BracketKind } from "../bracket-collections.js";
import {
  PlacementType,
  TournamentFinalizeReasonCode,
  groupPlacementsByLabel,
} from "../tournament-results.js";
import { RankingMode } from "./constants.js";
import {
  LossBandTournamentStatus,
} from "./persistence.js";
import { formatLossBandPlacementLabel } from "./placements.js";
import { LossBandCompletionReasonCode } from "./completion.js";

/**
 * @param {number} placement
 * @param {boolean} isTied
 */
function resolvePlacementType(placement) {
  if (placement === 1) return PlacementType.CHAMPION;
  if (placement === 2) return PlacementType.RUNNER_UP;
  return PlacementType.ELIMINATED;
}

/**
 * @param {Map<string, string>|Record<string, string>|null|undefined} teamNameByEntryId
 * @param {string} entryId
 */
function resolveTeamName(teamNameByEntryId, entryId) {
  if (!teamNameByEntryId || !entryId) return entryId ?? "—";
  if (teamNameByEntryId instanceof Map) {
    return teamNameByEntryId.get(entryId) ?? entryId;
  }
  return teamNameByEntryId[entryId] ?? entryId;
}

/**
 * lossBandPlacements/current → tournamentResults 用 placements
 * @param {object} placementsDoc
 * @param {{
 *   teamNameByEntryId?: Map<string, string>|Record<string, string>|null,
 *   tournamentId?: string|null
 * }} [options]
 */
export function buildLossBandTournamentResults(placementsDoc, options = {}) {
  const rows = Array.isArray(placementsDoc?.placements)
    ? placementsDoc.placements
    : [];
  const teamNameByEntryId = options.teamNameByEntryId ?? null;

  const placements = rows
    .filter((row) => row?.entryId && Number.isInteger(row.placement))
    .map((row) => {
      const isTied = row.isTied === true || (row.tiedCount ?? 1) > 1;
      return {
        entryId: row.entryId,
        teamName: resolveTeamName(teamNameByEntryId, row.entryId),
        placement: row.placement,
        placementType: resolvePlacementType(row.placement),
        placementLabel: formatLossBandPlacementLabel(row.placement, isTied),
        isTied,
        tiedCount: row.tiedCount ?? (isTied ? 2 : 1),
        lossCount: row.lossCount ?? null,
        rankingMode: RankingMode.LOSS_BAND,
        bracketKind: BracketKind.MAIN,
        isBye: false,
      };
    })
    .sort((a, b) => {
      if (a.placement !== b.placement) return a.placement - b.placement;
      return String(a.entryId).localeCompare(String(b.entryId), "en");
    });

  const championRow = placements.find((p) => p.placement === 1) ?? null;
  const runnerUpRow = placements.find((p) => p.placement === 2) ?? null;

  const champion = championRow
    ? {
        entryId: championRow.entryId,
        teamName: championRow.teamName,
        placement: 1,
        placementType: PlacementType.CHAMPION,
        placementLabel: championRow.placementLabel,
      }
    : null;

  const runnerUp = runnerUpRow
    ? {
        entryId: runnerUpRow.entryId,
        teamName: runnerUpRow.teamName,
        placement: 2,
        placementType: PlacementType.RUNNER_UP,
        placementLabel: runnerUpRow.placementLabel,
      }
    : null;

  const placementGroups = groupPlacementsByLabel(placements, {
    bracketKind: BracketKind.MAIN,
  });

  return {
    rankingMode: RankingMode.LOSS_BAND,
    thirdPlaceMatch: placementsDoc?.thirdPlaceMatch === true,
    champion,
    runnerUp,
    placements,
    placementGroups,
    teamCount: placementsDoc?.teamCount ?? placements.length,
    placementCounts: placementsDoc?.placementCounts ?? null,
  };
}

/**
 * @param {string|null|undefined} status
 */
function messageForIncompleteStatus(status) {
  switch (status) {
    case LossBandTournamentStatus.ACTIVE:
      return "順位決定戦（R1〜R5）が未完了です。";
    case LossBandTournamentStatus.FINALS_PENDING:
      return "決勝が未完了です。";
    case LossBandTournamentStatus.THIRD_PLACE_PENDING:
      return "3位決定戦が未完了です。";
    case LossBandTournamentStatus.EXCHANGE_PENDING:
      return "交流戦が未完了です。";
    case null:
    case undefined:
      return "敗戦帯トーナメントが未開始です。";
    default:
      return "敗戦帯トーナメントが未完了です。";
  }
}

/**
 * @param {string|null|undefined} status
 */
function reasonCodeForIncompleteStatus(status) {
  switch (status) {
    case LossBandTournamentStatus.ACTIVE:
      return LossBandCompletionReasonCode.R5_INCOMPLETE;
    case LossBandTournamentStatus.FINALS_PENDING:
      return LossBandCompletionReasonCode.FINAL_INCOMPLETE;
    case LossBandTournamentStatus.THIRD_PLACE_PENDING:
      return LossBandCompletionReasonCode.THIRD_PLACE_INCOMPLETE;
    case LossBandTournamentStatus.EXCHANGE_PENDING:
      return LossBandCompletionReasonCode.EXCHANGE_INCOMPLETE;
    default:
      return LossBandCompletionReasonCode.WRONG_PHASE;
  }
}

/**
 * loss_band 専用の大会結果確定可否（既存 canFinalizeTournament は呼ばない）
 * @param {{
 *   tournament?: object|null,
 *   lossBandState?: object|null,
 *   placementsDoc?: object|null,
 *   existingResults?: object|null,
 *   teamNameByEntryId?: Map<string, string>|Record<string, string>|null
 * }} params
 */
export function canFinalizeLossBandTournament({
  tournament = null,
  lossBandState = null,
  placementsDoc = null,
  existingResults = null,
  teamNameByEntryId = null,
} = {}) {
  if (
    existingResults?.finalized ||
    tournament?.status === TournamentStatus.CLOSED
  ) {
    return {
      canFinalize: false,
      message: "大会はすでに終了しています。",
      reasonCode: TournamentFinalizeReasonCode.ALREADY_FINALIZED,
      rankingMode: RankingMode.LOSS_BAND,
      lossBandReady: false,
      lossBandStatus: lossBandState?.status ?? null,
    };
  }

  const status = lossBandState?.status ?? null;
  const hasPlacements =
    Array.isArray(placementsDoc?.placements) &&
    placementsDoc.placements.length > 0;

  const lossBandReady =
    status === LossBandTournamentStatus.COMPLETED && hasPlacements;

  if (!lossBandReady) {
    const message = !hasPlacements && status === LossBandTournamentStatus.COMPLETED
      ? "最終順位が未生成です。"
      : messageForIncompleteStatus(status);
    return {
      canFinalize: false,
      message,
      reasonCode: !hasPlacements && status === LossBandTournamentStatus.COMPLETED
        ? LossBandCompletionReasonCode.PLACEMENTS_INVALID
        : reasonCodeForIncompleteStatus(status),
      rankingMode: RankingMode.LOSS_BAND,
      lossBandReady: false,
      lossBandStatus: status,
      champion: null,
      runnerUp: null,
      placements: [],
      placementGroups: [],
    };
  }

  const built = buildLossBandTournamentResults(placementsDoc, {
    teamNameByEntryId,
    tournamentId: tournament?.id ?? null,
  });

  if (!built.champion || !built.runnerUp || built.placements.length === 0) {
    return {
      canFinalize: false,
      message: "最終順位データが不正です。",
      reasonCode: LossBandCompletionReasonCode.PLACEMENTS_INVALID,
      rankingMode: RankingMode.LOSS_BAND,
      lossBandReady: true,
      lossBandStatus: status,
      ...built,
    };
  }

  return {
    canFinalize: true,
    message: null,
    reasonCode: null,
    rankingMode: RankingMode.LOSS_BAND,
    lossBandReady: true,
    lossBandStatus: status,
    thirdPlaceMatch: built.thirdPlaceMatch,
    champion: built.champion,
    runnerUp: built.runnerUp,
    placements: built.placements,
    placementGroups: built.placementGroups,
    teamCount: built.teamCount,
    placementCounts: built.placementCounts,
    completedMatchCount: built.placements.length,
    expectedMatchCount: built.placements.length,
    hasConsolation: false,
    consolationRequired: false,
    consolationComplete: null,
    consolationStatus: null,
    consolationChampion: null,
    consolationRunnerUp: null,
    consolationPlacements: [],
  };
}

/**
 * @param {object} preview canFinalizeLossBandTournament の成功結果
 * @param {object} tournament
 */
export function buildPersistedLossBandTournamentResults(preview, tournament) {
  return {
    finalized: true,
    tournamentId: tournament.id,
    tournamentName: tournament.name ?? "",
    tournamentStatus: "closed",
    rankingMode: RankingMode.LOSS_BAND,
    thirdPlaceMatch: preview.thirdPlaceMatch === true,
    champion: preview.champion,
    runnerUp: preview.runnerUp,
    placements: preview.placements,
    qualifierCount: preview.teamCount ?? preview.placements?.length ?? 0,
    bracketSize: preview.teamCount ?? preview.placements?.length ?? 0,
    completedMatchCount: preview.completedMatchCount ?? preview.placements?.length ?? 0,
    expectedMatchCount: preview.expectedMatchCount ?? preview.placements?.length ?? 0,
  };
}
