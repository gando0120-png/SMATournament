/**
 * 決勝トーナメント表 Firestore 操作（DOM 非依存）
 */
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { getFirebaseDb, isFirebaseConfigured } from "../lib/firebase-app.js";
import { ConfigUnconfiguredError } from "../lib/errors.js";
import { FINALS_ADVANCEMENT_DOC_ID, FINALS_BRACKET_DOC_ID } from "../domain/constants.js";
import {
  buildFinalsBracketFromAdvancement,
  buildPersistedFinalsBracket,
} from "../domain/finals-bracket.js";
import { getFinalsAdvancement } from "./finals-advancement-service.js";
import { requireOpenTournament } from "./tournament-service.js";
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
export async function getFinalsBracket(tournamentId) {
  const db = requireDb();
  const snap = await getDoc(
    doc(db, "tournaments", tournamentId, "finalsBracket", FINALS_BRACKET_DOC_ID)
  );
  if (!snap.exists()) {
    return null;
  }
  return { id: snap.id, ...snap.data() };
}

/**
 * @param {string} tournamentId
 */
export async function previewFinalsBracket(tournamentId) {
  const advancement = await getFinalsAdvancement(tournamentId);
  if (!advancement) {
    const error = new Error("Finals advancement not found");
    error.code = "finals-bracket/no-advancement";
    throw error;
  }

  if (!advancement.finalized) {
    const error = new Error("Finals advancement not finalized");
    error.code = "finals-bracket/advancement-not-finalized";
    throw error;
  }

  return buildFinalsBracketFromAdvancement(advancement);
}

/**
 * @param {string} tournamentId
 */
export async function saveFinalsBracket(tournamentId) {
  await requireOpenTournament(tournamentId);
  const existing = await getFinalsBracket(tournamentId);
  if (existing?.finalized) {
    const error = new Error("Finals bracket already finalized");
    error.code = "finals-bracket/already-finalized";
    throw error;
  }

  const preview = await previewFinalsBracket(tournamentId);
  if (!preview.canFinalize || !preview.bracket) {
    const error = new Error(preview.message || "Cannot finalize finals bracket");
    error.code = "finals-bracket/invalid-qualifiers";
    throw error;
  }

  const payload = {
    ...buildPersistedFinalsBracket(preview),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const db = requireDb();
  await setDoc(
    doc(db, "tournaments", tournamentId, "finalsBracket", FINALS_BRACKET_DOC_ID),
    payload
  );

  const advancementSnap = await getDoc(
    doc(db, "tournaments", tournamentId, "finalsAdvancement", FINALS_ADVANCEMENT_DOC_ID)
  );
  if (!advancementSnap.exists()) {
    const error = new Error("Finals advancement missing at save time");
    error.code = "finals-bracket/no-advancement";
    throw error;
  }

  const bracket = await getFinalsBracket(tournamentId);
  return withPublicSnapshotRebuild(tournamentId, bracket);
}
