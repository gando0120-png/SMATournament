/**
 * 一発トーナメント bracket Firestore 操作（DOM 非依存）
 */
import {
  doc,
  writeBatch,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { getFirebaseDb, isFirebaseConfigured } from "../lib/firebase-app.js";
import { ConfigUnconfiguredError } from "../lib/errors.js";
import { FINALS_BRACKET_DOC_ID, EntryStatus } from "../domain/constants.js";
import { TournamentFormat } from "../domain/tournament-format.js";
import {
  assessSingleEliminationBracketCreation,
  buildPersistedSingleEliminationBracket,
  buildSingleEliminationBracket,
  resolveSingleEliminationBracketSize,
  validateSingleEliminationByeResults,
} from "../domain/single-elimination-bracket.js";
import {
  buildMultiTeamBracket,
  buildPersistedMultiTeamBracket,
} from "../domain/multi-team-bracket.js";
import { isMultiTeamTotalFormat } from "../domain/aggregate-match-format.js";
import { buildByeMatchResultPayload, listByeMatchesNeedingResults } from "../domain/finals-match-progress.js";
import { getByeWinnerTeam } from "../domain/finals-match-bye.js";
import { ensureFinalsTeamWithSeed } from "../domain/finals-match-result-payload.js";
import { listEntries } from "./entry-service.js";
import { getFinalsBracket } from "./finals-bracket-service.js";
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
 * @param {object} tournament
 * @param {object[]} participants
 */
function buildPreviewForTournament(tournament, participants) {
  if (isMultiTeamTotalFormat(tournament)) {
    return buildMultiTeamBracket({
      entries: participants,
      aggregateMatchRules: tournament.aggregateMatchRules,
    });
  }

  const sizeResult = resolveSingleEliminationBracketSize(participants.length);
  if (!sizeResult.valid) {
    return {
      canFinalize: false,
      message: sizeResult.errors[0] ?? "参加チーム数が不正です。",
      bracket: null,
      ...sizeResult,
    };
  }

  const result = buildSingleEliminationBracket({ entries: participants });
  return {
    ...sizeResult,
    ...result,
  };
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
  const result = buildPreviewForTournament(tournament, participants);

  return {
    teamCount: participants.length,
    canFinalize: result.canFinalize,
    message: result.message,
    bracket: result.bracket,
    bracketSize: result.bracketSize,
    byeCount: result.byeCount,
    errors: result.errors,
  };
}

/**
 * @param {string} tournamentId
 */
export async function createSingleEliminationBracket(tournamentId) {
  await requireOpenTournament(tournamentId);

  const [tournament, existing] = await Promise.all([
    getTournament(tournamentId),
    getFinalsBracket(tournamentId, { source: "server" }),
  ]);

  if (tournament?.tournamentFormat !== TournamentFormat.SINGLE_ELIMINATION) {
    const error = new Error("Tournament is not single elimination format");
    error.code = "single-elimination-bracket/invalid-format";
    throw error;
  }

  const creationState = assessSingleEliminationBracketCreation(existing);
  if (!creationState.canCreate) {
    const error = new Error(creationState.message ?? "Single elimination bracket already created");
    error.code = creationState.code ?? "single-elimination-bracket/already-created";
    throw error;
  }

  const entries = await listEntries(tournamentId);
  const participants = getConfirmedEntryParticipants(entries);
  const multi = isMultiTeamTotalFormat(tournament);
  const preview = buildPreviewForTournament(tournament, participants);

  if (!preview.canFinalize || !preview.bracket) {
    const error = new Error(preview.message || "Cannot create single elimination bracket");
    error.code = "single-elimination-bracket/invalid-entries";
    throw error;
  }

  if (!multi) {
    const byeValidation = validateSingleEliminationByeResults(preview.bracket);
    if (!byeValidation.valid) {
      const error = new Error(byeValidation.message || "Cannot create single elimination bracket");
      error.code = "single-elimination-bracket/invalid-entries";
      throw error;
    }
  }

  const persisted = multi
    ? buildPersistedMultiTeamBracket(preview)
    : buildPersistedSingleEliminationBracket(preview);

  const payload = {
    ...persisted,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const db = requireDb();
  const batch = writeBatch(db);
  const bracketRef = doc(
    db,
    "tournaments",
    tournamentId,
    "finalsBracket",
    FINALS_BRACKET_DOC_ID
  );
  batch.set(bracketRef, payload);

  if (!multi) {
    for (const match of listByeMatchesNeedingResults(preview.bracket)) {
      const winner = getByeWinnerTeam(match.team1, match.team2);
      const byePayload = buildByeMatchResultPayload(
        match,
        ensureFinalsTeamWithSeed(winner, match.matchNumber)
      );
      batch.set(
        doc(db, "tournaments", tournamentId, "finalsMatchResults", match.matchId),
        {
          ...byePayload,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }
      );
    }
  }

  await batch.commit();

  await ensureTournamentStructureLocked(tournamentId, tournament);

  const bracket = await getFinalsBracket(tournamentId, { source: "server" });
  return withPublicSnapshotRebuild(tournamentId, bracket);
}
