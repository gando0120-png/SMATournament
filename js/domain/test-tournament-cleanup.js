/**
 * テスト大会一括削除 — ドメイン（DOM / Firestore 非依存）
 */
import {
  isDeletableTestTournamentName,
  isLooseTestTournamentName,
  isTestTournamentName,
} from "./test-tournament-access.js";
import { isTournamentDeleted } from "./tournament-deletion.js";

export { isTestTournamentName, isLooseTestTournamentName, isDeletableTestTournamentName };

/**
 * @param {Array<{ id: string, name?: string, isDeleted?: boolean }>} tournaments
 */
export function filterCleanupCandidates(tournaments) {
  if (!Array.isArray(tournaments)) {
    return [];
  }
  return tournaments.filter(
    (tournament) =>
      tournament?.id &&
      !isTournamentDeleted(tournament) &&
      isDeletableTestTournamentName(tournament.name)
  );
}

/**
 * @param {Array<{ id: string, name?: string }>} candidates
 * @param {string[]} selectedIds
 */
export function validateCleanupSelection(candidates, selectedIds) {
  const ids = Array.isArray(selectedIds) ? selectedIds : [];
  const invalid = [];
  const byId = new Map(candidates.map((item) => [item.id, item]));

  for (const id of ids) {
    const tournament = byId.get(id);
    if (!tournament) {
      invalid.push({ id, reason: "削除候補一覧に存在しない大会です。" });
      continue;
    }
    if (!isDeletableTestTournamentName(tournament.name)) {
      invalid.push({
        id,
        name: tournament.name ?? "",
        reason: "テスト大会名条件を満たしていません。",
      });
    }
  }

  return {
    valid: invalid.length === 0 && ids.length > 0,
    invalid,
    hasNonTestTournament: invalid.length > 0,
    selectedCount: ids.length,
  };
}

/**
 * @param {object} params
 * @param {Array<{ tournamentId: string, name?: string, documentCount?: number, subcollections?: Record<string, number> }>} params.tournaments
 */
export function summarizeDryRunOutcome({ tournaments }) {
  const items = Array.isArray(tournaments) ? tournaments : [];
  const totalDocuments = items.reduce(
    (sum, item) => sum + (Number(item.documentCount) || 0),
    0
  );

  return {
    tournamentCount: items.length,
    tournamentNames: items.map((item) => item.name ?? item.tournamentId),
    tournaments: items,
    totalDocuments,
  };
}

/**
 * @param {object} params
 * @param {number} params.completedCount
 * @param {number} params.selectedCount
 * @param {number} params.deletedDocumentCount
 * @param {Array<{ tournamentId: string, name?: string, deletedDocumentCount?: number }>} params.succeeded
 * @param {Array<{ tournamentId: string, name?: string, reason?: string }>} params.failed
 */
export function summarizeCleanupExecution({
  completedCount,
  selectedCount,
  deletedDocumentCount,
  succeeded,
  failed,
}) {
  const successItems = Array.isArray(succeeded) ? succeeded : [];
  const failureItems = Array.isArray(failed) ? failed : [];

  return {
    completedCount: Number(completedCount) || 0,
    selectedCount: Number(selectedCount) || 0,
    deletedDocumentCount: Number(deletedDocumentCount) || 0,
    succeeded: successItems,
    failed: failureItems,
    allSucceeded: failureItems.length === 0 && successItems.length > 0,
    partialFailure: failureItems.length > 0 && successItems.length > 0,
  };
}
