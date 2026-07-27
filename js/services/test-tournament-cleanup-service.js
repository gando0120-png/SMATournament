/**
 * テスト大会一括削除 — Cloud Functions 呼び出し
 */
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-functions.js";
import { getFirebaseFunctions, isFirebaseConfigured } from "../lib/firebase-app.js";
import { ConfigUnconfiguredError } from "../lib/errors.js";
import {
  filterCleanupCandidates,
  validateCleanupSelection,
} from "../domain/test-tournament-cleanup.js";
import { listTournaments } from "./tournament-service.js";

function requireFunctions() {
  if (!isFirebaseConfigured()) {
    throw new ConfigUnconfiguredError();
  }
  const functions = getFirebaseFunctions();
  if (!functions) {
    throw new ConfigUnconfiguredError();
  }
  return functions;
}

/**
 * @returns {Promise<Array<object>>}
 */
export async function loadTestTournamentCleanupCandidates() {
  const tournaments = await listTournaments();
  return filterCleanupCandidates(tournaments);
}

/**
 * @param {string[]} tournamentIds
 */
export async function dryRunTestTournamentCleanup(tournamentIds, candidates) {
  const validation = validateCleanupSelection(candidates, tournamentIds);
  if (validation.hasNonTestTournament) {
    return {
      ...validation,
      tournaments: [],
      totalDocuments: 0,
      blocked: true,
    };
  }

  const functions = requireFunctions();
  const callable = httpsCallable(functions, "dryRunTestTournamentCleanupCallable");
  const result = await callable({ tournamentIds });
  const data = result.data ?? {};

  return {
    ...validation,
    blocked: Boolean(data.hasNonTestTournament),
    tournaments: data.tournaments ?? [],
    invalid: data.invalid ?? [],
    tournamentCount: data.tournamentCount ?? 0,
    totalDocuments: data.totalDocuments ?? 0,
  };
}

/**
 * @param {string} tournamentId
 */
export async function deleteTestTournament(tournamentId) {
  const functions = requireFunctions();
  const callable = httpsCallable(functions, "deleteTestTournamentCallable");
  const result = await callable({ tournamentId });
  return result.data ?? {};
}

/**
 * @param {string[]} tournamentIds
 * @param {Array<{ id: string, name?: string }>} candidates
 * @param {(progress: object) => void} [onProgress]
 */
export async function executeTestTournamentCleanup(tournamentIds, candidates, onProgress) {
  const validation = validateCleanupSelection(candidates, tournamentIds);
  if (!validation.valid || validation.hasNonTestTournament) {
    throw new Error("選択された大会に削除不可の項目が含まれています。");
  }

  const succeeded = [];
  const failed = [];
  let deletedDocumentCount = 0;

  for (let index = 0; index < tournamentIds.length; index += 1) {
    const tournamentId = tournamentIds[index];
    const tournament = candidates.find((item) => item.id === tournamentId);
    const name = tournament?.name ?? tournamentId;

    onProgress?.({
      phase: "running",
      currentName: name,
      completedCount: index,
      selectedCount: tournamentIds.length,
      deletedDocumentCount,
      succeeded: [...succeeded],
      failed: [...failed],
    });

    try {
      const outcome = await deleteTestTournament(tournamentId);
      succeeded.push(outcome);
      deletedDocumentCount += Number(outcome.deletedDocumentCount) || 0;
    } catch (error) {
      failed.push({
        tournamentId,
        name,
        reason: error?.message ?? String(error),
      });
    }
  }

  const summary = {
    completedCount: succeeded.length + failed.length,
    selectedCount: tournamentIds.length,
    deletedDocumentCount,
    succeeded,
    failed,
  };

  onProgress?.({
    phase: failed.length > 0 ? "partial-failure" : "completed",
    currentName: null,
    ...summary,
  });

  return summary;
}
