/**
 * 大会正式結果 Firestore 操作（DOM 非依存）
 */
import {
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { getFirebaseDb, isFirebaseConfigured } from "../lib/firebase-app.js";
import { ConfigUnconfiguredError, TournamentNotFoundError } from "../lib/errors.js";
import {
  TournamentStatus,
  TOURNAMENT_RESULTS_DOC_ID,
} from "../domain/constants.js";
import {
  buildPersistedTournamentResults,
  getTournamentResultParticipants,
  validateTournamentCompletion,
} from "../domain/tournament-results.js";
import { TournamentFormat } from "../domain/tournament-format.js";
import { assertTournamentOpenForWrite } from "../lib/tournament-status.js";
import { getTournament } from "./tournament-service.js";
import { withPublicSnapshotRebuild } from "../lib/public-snapshot-hook.js";
import { getFinalsAdvancement } from "./finals-advancement-service.js";
import { getFinalsBracket } from "./finals-bracket-service.js";
import { getFinalsMatchResults } from "./finals-match-result-service.js";

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
 * @param {string} tournamentId
 */
export async function getTournamentResults(tournamentId) {
  const db = requireDb();
  const snap = await getDoc(
    doc(db, "tournaments", tournamentId, "tournamentResults", TOURNAMENT_RESULTS_DOC_ID)
  );
  if (!snap.exists()) {
    return null;
  }
  return { id: snap.id, ...snap.data() };
}

/**
 * @param {string} tournamentId
 */
export async function previewTournamentResults(tournamentId) {
  const [tournament, advancement, bracket, resultsMap, existingResults] =
    await Promise.all([
      getTournament(tournamentId),
      getFinalsAdvancement(tournamentId),
      getFinalsBracket(tournamentId),
      getFinalsMatchResults(tournamentId),
      getTournamentResults(tournamentId),
    ]);

  assertTournamentOpenForWrite(tournament);

  const isSingleElim = tournament.tournamentFormat === TournamentFormat.SINGLE_ELIMINATION;

  if (!isSingleElim && !advancement?.finalized) {
    const error = new Error("Finals advancement not finalized");
    error.code = "tournament-results/no-advancement";
    throw error;
  }

  if (isSingleElim && !bracket?.finalized) {
    const error = new Error("Single elimination bracket not created");
    error.code = "tournament-results/no-bracket";
    throw error;
  }

  const participants = getTournamentResultParticipants(bracket, advancement);

  const preview = validateTournamentCompletion({
    bracket,
    resultsMap,
    qualifiers: participants,
    advancement,
    existingResults,
  });

  return {
    tournament,
    advancement,
    bracket,
    resultsMap,
    existingResults,
    ...preview,
  };
}

/**
 * @param {string} tournamentId
 */
export async function finalizeTournamentResults(tournamentId) {
  const preview = await previewTournamentResults(tournamentId);

  if (!preview.canFinalize) {
    const error = new Error(preview.message || "Cannot finalize tournament results");
    error.code = "tournament-results/incomplete";
    throw error;
  }

  const payload = {
    ...buildPersistedTournamentResults(
      preview,
      preview.tournament,
      preview.advancement,
      preview.bracket
    ),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const db = requireDb();
  const tournamentRef = doc(db, "tournaments", tournamentId);
  const resultsRef = doc(
    db,
    "tournaments",
    tournamentId,
    "tournamentResults",
    TOURNAMENT_RESULTS_DOC_ID
  );

  await runTransaction(db, async (transaction) => {
    const [tournamentSnap, resultsSnap] = await Promise.all([
      transaction.get(tournamentRef),
      transaction.get(resultsRef),
    ]);

    if (!tournamentSnap.exists()) {
      throw Object.assign(new TournamentNotFoundError(), { code: "tournament/not-found" });
    }

    const tournamentData = tournamentSnap.data();
    if (tournamentData.status !== TournamentStatus.OPEN) {
      throw Object.assign(new Error("大会は終了済みです。"), {
        code: "tournament/not-open",
      });
    }

    if (resultsSnap.exists()) {
      throw Object.assign(new Error("大会結果はすでに確定済みです。"), {
        code: "tournament-results/already-finalized",
      });
    }

    transaction.set(resultsRef, payload);
    transaction.update(tournamentRef, {
      status: TournamentStatus.CLOSED,
      closedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });

  const results = await getTournamentResults(tournamentId);
  return withPublicSnapshotRebuild(tournamentId, results);
}
