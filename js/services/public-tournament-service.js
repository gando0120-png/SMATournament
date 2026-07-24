/**
 * 公開大会ページ向け Firestore 読み取り（publicSnapshot のみ）
 */
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { getFirebaseDb, isFirebaseConfigured } from "../lib/firebase-app.js";
import { ConfigUnconfiguredError } from "../lib/errors.js";
import { PUBLIC_SNAPSHOT_DOC_ID } from "../domain/public-tournament-snapshot.js";

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
export async function loadPublicSnapshot(tournamentId) {
  const db = requireDb();
  const snap = await getDoc(
    doc(db, "tournaments", tournamentId, "publicSnapshot", PUBLIC_SNAPSHOT_DOC_ID)
  );

  if (!snap.exists()) {
    const error = new Error("Public snapshot not ready");
    error.code = "tournament/public-snapshot-not-ready";
    throw error;
  }

  return snap.data();
}
