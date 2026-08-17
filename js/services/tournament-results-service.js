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
  EntryStatus,
} from "../domain/constants.js";
import {
  buildPersistedTournamentResults,
  getTournamentResultParticipants,
  validateTournamentCompletion,
} from "../domain/tournament-results.js";
import {
  RankingMode,
  resolveMainRankingMode,
  canFinalizeLossBandTournament,
  buildPersistedLossBandTournamentResults,
} from "../domain/loss-band/index.js";
import { TournamentFormat } from "../domain/tournament-format.js";
import { assertTournamentOpenForWrite } from "../lib/tournament-status.js";
import { getTournament } from "./tournament-service.js";
import { listEntries } from "./entry-service.js";
import { withPublicSnapshotRebuild } from "../lib/public-snapshot-hook.js";
import { getFinalsAdvancement } from "./finals-advancement-service.js";
import { getFinalsBracket } from "./finals-bracket-service.js";
import { getFinalsMatchResults } from "./finals-match-result-service.js";
import { getConsolationBracket } from "./consolation-bracket-service.js";
import { BracketKind } from "../domain/bracket-collections.js";
import {
  getLossBandState,
  getLossBandPlacements,
} from "./loss-band-service.js";

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
 * @param {object} tournament
 * @param {object|null} existingResults
 */
async function previewLossBandTournamentResults(tournament, existingResults) {
  const [lossBandState, placementsDoc, entries] = await Promise.all([
    getLossBandState(tournament.id),
    getLossBandPlacements(tournament.id),
    listEntries(tournament.id),
  ]);

  const teamNameByEntryId = new Map(
    (entries ?? [])
      .filter((entry) => entry.status !== EntryStatus.CANCELLED)
      .map((entry) => [entry.id ?? entry.entryId, entry.teamName ?? entry.id])
  );

  const preview = canFinalizeLossBandTournament({
    tournament,
    lossBandState,
    placementsDoc,
    existingResults,
    teamNameByEntryId,
  });

  return {
    tournament,
    advancement: null,
    bracket: null,
    resultsMap: new Map(),
    existingResults,
    consolationBracket: null,
    consolationResultsMap: new Map(),
    lossBandState,
    placementsDoc,
    ...preview,
  };
}

/**
 * @param {string} tournamentId
 */
export async function previewTournamentResults(tournamentId) {
  const tournament = await getTournament(tournamentId);
  assertTournamentOpenForWrite(tournament);

  const existingResults = await getTournamentResults(tournamentId);

  if (resolveMainRankingMode(tournament) === RankingMode.LOSS_BAND) {
    return previewLossBandTournamentResults(tournament, existingResults);
  }

  const [advancement, bracket, resultsMap, consolationBracket, consolationResultsMap] =
    await Promise.all([
      getFinalsAdvancement(tournamentId),
      getFinalsBracket(tournamentId),
      getFinalsMatchResults(tournamentId),
      getConsolationBracket(tournamentId),
      getFinalsMatchResults(tournamentId, { bracketKind: BracketKind.CONSOLATION }),
    ]);

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
    tournament,
    bracket,
    resultsMap,
    qualifiers: participants,
    advancement,
    existingResults,
    consolationBracket,
    consolationResultsMap,
  });

  return {
    tournament,
    advancement,
    bracket,
    resultsMap,
    existingResults,
    consolationBracket,
    consolationResultsMap,
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

  const isLossBand = preview.rankingMode === RankingMode.LOSS_BAND;
  const payload = {
    ...(isLossBand
      ? buildPersistedLossBandTournamentResults(preview, preview.tournament)
      : buildPersistedTournamentResults(
          preview,
          preview.tournament,
          preview.advancement,
          preview.bracket
        )),
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
