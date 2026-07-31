/**
 * 決勝進出 Firestore 操作（DOM 非依存）
 */
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { getFirebaseDb, isFirebaseConfigured } from "../lib/firebase-app.js";
import { ConfigUnconfiguredError } from "../lib/errors.js";
import { DEFAULT_FINAL_TEAM_COUNT, FINALS_ADVANCEMENT_DOC_ID } from "../domain/constants.js";
import {
  buildFinalsAdvancementPreview,
  buildPersistedFinalsAdvancement,
} from "../domain/finals-advancement.js";
import { getQualifyingSchedule } from "./qualifying-schedule-service.js";
import { getQualifyingMatchResults } from "./qualifying-match-result-service.js";
import { getBlockDraw } from "./block-draw-service.js";
import { getTournament, requireOpenTournament } from "./tournament-service.js";
import { getMolkkyOutResolutions } from "./molkky-out-resolution-service.js";
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
 * @param {string} tournamentId
 */
export async function getFinalsAdvancement(tournamentId) {
  const db = requireDb();
  const snap = await getDoc(
    doc(db, "tournaments", tournamentId, "finalsAdvancement", FINALS_ADVANCEMENT_DOC_ID)
  );
  if (!snap.exists()) {
    return null;
  }
  return { id: snap.id, ...snap.data() };
}

/**
 * @param {string} tournamentId
 * @param {object|null} [tournament]
 * @param {number} [finalTeamCount]
 */
export async function previewFinalsAdvancement(
  tournamentId,
  tournament = null,
  finalTeamCount = DEFAULT_FINAL_TEAM_COUNT
) {
  const resolvedTournament = tournament ?? (await getTournament(tournamentId));
  const [schedule, blockDraw, resultsMap, molkkyOutResolutions] = await Promise.all([
    getQualifyingSchedule(tournamentId),
    getBlockDraw(tournamentId),
    getQualifyingMatchResults(tournamentId),
    getMolkkyOutResolutions(tournamentId),
  ]);

  if (!schedule?.finalized) {
    const error = new Error("Finalized qualifying schedule not found");
    error.code = "finals-advancement/no-schedule";
    throw error;
  }

  return buildFinalsAdvancementPreview(schedule, resultsMap, {
    tournament: resolvedTournament,
    blockDraw,
    finalTeamCount,
    molkkyOutResolutions,
  });
}

/**
 * @param {string} tournamentId
 * @param {object|null} [tournament]
 * @param {number} [finalTeamCount]
 */
export async function saveFinalsAdvancement(
  tournamentId,
  tournament = null,
  finalTeamCount = DEFAULT_FINAL_TEAM_COUNT
) {
  await requireOpenTournament(tournamentId);

  const existing = await getFinalsAdvancement(tournamentId);
  if (existing?.finalized) {
    const error = new Error("Finals advancement already finalized");
    error.code = "finals-advancement/already-finalized";
    throw error;
  }

  const resolvedTournament = tournament ?? (await getTournament(tournamentId));
  const preview = await previewFinalsAdvancement(
    tournamentId,
    resolvedTournament,
    finalTeamCount
  );

  if (!preview.canFinalize) {
    const error = new Error(preview.message || "Cannot finalize finals advancement");
    error.code = "finals-advancement/incomplete";
    throw error;
  }

  const payload = {
    ...buildPersistedFinalsAdvancement(preview, { tournament: resolvedTournament }),
    finalizedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const db = requireDb();
  await setDoc(
    doc(db, "tournaments", tournamentId, "finalsAdvancement", FINALS_ADVANCEMENT_DOC_ID),
    payload
  );

  const saved = await getFinalsAdvancement(tournamentId);
  return withPublicSnapshotRebuild(tournamentId, saved);
}
