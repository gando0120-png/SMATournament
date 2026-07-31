/**
 * モルックアウト解消 Firestore 操作（DOM 非依存）
 */
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { getFirebaseDb, isFirebaseConfigured } from "../lib/firebase-app.js";
import { ConfigUnconfiguredError } from "../lib/errors.js";
import {
  FINALS_ADVANCEMENT_DOC_ID,
  MOLKKY_OUT_RESOLUTIONS_DOC_ID,
} from "../domain/constants.js";
import {
  mergeMolkkyOutResolution,
  normalizeMolkkyOutResolutions,
} from "../domain/molkky-out-resolution.js";
import { requireOpenTournament } from "./tournament-service.js";

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
async function isFinalsAdvancementFinalized(tournamentId) {
  const db = requireDb();
  const snap = await getDoc(
    doc(db, "tournaments", tournamentId, "finalsAdvancement", FINALS_ADVANCEMENT_DOC_ID)
  );
  return snap.exists() && snap.data()?.finalized === true;
}

/**
 * @param {string} tournamentId
 */
export async function getMolkkyOutResolutions(tournamentId) {
  const db = requireDb();
  const snap = await getDoc(
    doc(db, "tournaments", tournamentId, "molkkyOutResolutions", MOLKKY_OUT_RESOLUTIONS_DOC_ID)
  );
  if (!snap.exists()) {
    return null;
  }
  return { id: snap.id, ...snap.data() };
}

/**
 * @param {string} tournamentId
 * @param {object} resolutions - { blockGroups, wildcardGroups }
 */
export async function saveMolkkyOutResolutions(tournamentId, resolutions) {
  await requireOpenTournament(tournamentId);

  const advancementFinalized = await isFinalsAdvancementFinalized(tournamentId);
  if (advancementFinalized) {
    const error = new Error("Finals advancement already finalized");
    error.code = "molkky-out/advancement-finalized";
    throw error;
  }

  const normalized = normalizeMolkkyOutResolutions(resolutions);
  if (!normalized.valid) {
    const error = new Error(normalized.message || "Invalid molkky-out resolutions");
    error.code = "molkky-out/invalid";
    throw error;
  }

  const db = requireDb();
  await setDoc(
    doc(db, "tournaments", tournamentId, "molkkyOutResolutions", MOLKKY_OUT_RESOLUTIONS_DOC_ID),
    {
      ...normalized.data,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  return getMolkkyOutResolutions(tournamentId);
}

/**
 * @param {string} tournamentId
 * @param {{ blockGroup?: object, wildcardGroup?: object }} patch
 */
export async function upsertMolkkyOutResolution(tournamentId, patch) {
  const existing = await getMolkkyOutResolutions(tournamentId);
  const merged = mergeMolkkyOutResolution(existing, patch);
  if (!merged.valid) {
    const error = new Error(merged.message || "Invalid molkky-out resolution");
    error.code = "molkky-out/invalid";
    throw error;
  }
  return saveMolkkyOutResolutions(tournamentId, merged.data);
}
