/**
 * 一発トーナメント bracket Firestore 操作（DOM 非依存）
 */
import {
  doc,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { getFirebaseDb, isFirebaseConfigured } from "../lib/firebase-app.js";
import { ConfigUnconfiguredError } from "../lib/errors.js";
import { FINALS_BRACKET_DOC_ID, EntryStatus } from "../domain/constants.js";
import { TournamentFormat } from "../domain/tournament-format.js";
import {
  buildPersistedSingleEliminationBracket,
  buildSingleEliminationBracket,
  resolveSingleEliminationBracketSize,
} from "../domain/single-elimination-bracket.js";
import { listEntries } from "./entry-service.js";
import { getFinalsBracket } from "./finals-bracket-service.js";
import { ensureFinalsByeResults } from "./finals-match-result-service.js";
import { getTournament, requireOpenTournament } from "./tournament-service.js";
import { ensureTournamentStructureLocked } from "./tournament-progress-service.js";
import { withPublicSnapshotRebuild } from "../lib/public-snapshot-hook.js";

function requireDb() {
  if (!isFirebaseConfigured()) {
    throw new ConfigUnconfiguredError();
  }
  const db = getFirebaseDb();
  if (!db) {
    throw new ConfigUnconfiguredError();
  }
  return db;
}

/**
 * @param {object[]} entries
 */
function getConfirmedEntryParticipants(entries) {
  return entries
    .filter((entry) => entry.status === EntryStatus.CONFIRMED)
    .map((entry) => ({
      entryId: entry.id,
      teamName: entry.teamName ?? null,
    }));
}

/**
 * @param {string} tournamentId
 */
export async function previewSingleEliminationBracket(tournamentId) {
  const tournament = await getTournament(tournamentId);
  if (tournament?.tournamentFormat !== TournamentFormat.SINGLE_ELIMINATION) {
    const error = new Error("Tournament is not single elimination format");
    error.code = "single-elimination-bracket/invalid-format";
    throw error;
  }

  const entries = await listEntries(tournamentId);
  const participants = getConfirmedEntryParticipants(entries);
  const sizeResult = resolveSingleEliminationBracketSize(participants.length);

  if (!sizeResult.valid) {
    return {
      canFinalize: false,
      message: sizeResult.errors[0] ?? "参加チーム数が不正です。",
      bracket: null,
      teamCount: participants.length,
      ...sizeResult,
    };
  }

  const result = buildSingleEliminationBracket({ entries: participants });
  return {
    ...sizeResult,
    teamCount: participants.length,
    canFinalize: result.canFinalize,
    message: result.message,
    bracket: result.bracket,
  };
}

/**
 * @param {string} tournamentId
 */
export async function createSingleEliminationBracket(tournamentId) {
  await requireOpenTournament(tournamentId);

  const [tournament, existing] = await Promise.all([
    getTournament(tournamentId),
    getFinalsBracket(tournamentId),
  ]);

  if (tournament?.tournamentFormat !== TournamentFormat.SINGLE_ELIMINATION) {
    const error = new Error("Tournament is not single elimination format");
    error.code = "single-elimination-bracket/invalid-format";
    throw error;
  }

  if (existing?.finalized) {
    const error = new Error("Single elimination bracket already created");
    error.code = "single-elimination-bracket/already-created";
    throw error;
  }

  const entries = await listEntries(tournamentId);
  const participants = getConfirmedEntryParticipants(entries);
  const preview = buildSingleEliminationBracket({ entries: participants });

  if (!preview.canFinalize || !preview.bracket) {
    const error = new Error(preview.message || "Cannot create single elimination bracket");
    error.code = "single-elimination-bracket/invalid-entries";
    throw error;
  }

  const payload = {
    ...buildPersistedSingleEliminationBracket(preview),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const db = requireDb();
  await setDoc(
    doc(db, "tournaments", tournamentId, "finalsBracket", FINALS_BRACKET_DOC_ID),
    payload
  );

  await ensureTournamentStructureLocked(tournamentId, tournament);
  await ensureFinalsByeResults(tournamentId);

  const bracket = await getFinalsBracket(tournamentId);
  return withPublicSnapshotRebuild(tournamentId, bracket);
}
