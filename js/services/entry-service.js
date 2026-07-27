/**
 * エントリー Firestore 操作（DOM 非依存）
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  orderBy,
  updateDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { getFirebaseDb, isFirebaseConfigured } from "../lib/firebase-app.js";
import { ConfigUnconfiguredError, EntryNotFoundError } from "../lib/errors.js";
import { EntryStatus } from "../domain/constants.js";
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
 * 一般参加者向けエントリー CREATE（後方互換ラッパー）
 * @deprecated {@link createPublicEntry} を使用
 */
export { createPublicEntry as createEntry } from "./public-entry-service.js";

/**
 * @param {string} tournamentId
 */
export async function listEntries(tournamentId) {
  const path = `tournaments/${tournamentId}/entries`;
  console.log("[entry-admin] entries query start", path);

  const db = requireDb();
  const q = query(
    collection(db, "tournaments", tournamentId, "entries"),
    orderBy("createdAt", "desc")
  );

  try {
    const snapshot = await getDocs(q);
    console.log("[entry-admin] entries query ok", path, snapshot.size);
    return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (error) {
    console.error("[entry-admin] entries query failed", path, error?.code ?? "(no code)", error);
    throw error;
  }
}

/**
 * @param {string} tournamentId
 * @param {string} entryId
 */
export async function confirmEntry(tournamentId, entryId) {
  await requireOpenTournament(tournamentId);
  const db = requireDb();
  const ref = doc(db, "tournaments", tournamentId, "entries", entryId);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    throw new EntryNotFoundError();
  }

  const data = snap.data();
  if (data.status !== EntryStatus.PENDING) {
    const error = new Error("Entry is not pending");
    error.code = "entry/not-pending";
    throw error;
  }

  await updateDoc(ref, {
    status: EntryStatus.CONFIRMED,
    updatedAt: serverTimestamp(),
  });

  return withPublicSnapshotRebuild(tournamentId, {
    id: snap.id,
    ...data,
    status: EntryStatus.CONFIRMED,
  });
}
