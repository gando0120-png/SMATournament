/**
 * エントリー Firestore 操作（DOM 非依存）
 */
import {
  addDoc,
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
import { assertEntryOpenForCreate } from "../lib/entry-open.js";
import { getTournament, requireOpenTournament } from "./tournament-service.js";
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
 * @param {object} input - validateEntryInput().values
 */
export async function createEntry(tournamentId, input) {
  const tournament = await getTournament(tournamentId);
  assertEntryOpenForCreate(tournament);

  const db = requireDb();
  const payload = {
    teamName: input.teamName,
    representativeName: input.representativeName,
    status: EntryStatus.PENDING,
    createdAt: serverTimestamp(),
  };

  if (input.member2) {
    payload.member2 = input.member2;
  }
  if (input.member3) {
    payload.member3 = input.member3;
  }
  if (input.email) {
    payload.email = input.email;
  }
  if (input.comment) {
    payload.comment = input.comment;
  }

  const ref = await addDoc(collection(db, "tournaments", tournamentId, "entries"), payload);
  return { id: ref.id, ...payload };
}

/**
 * @param {string} tournamentId
 */
export async function listEntries(tournamentId) {
  const db = requireDb();
  const q = query(
    collection(db, "tournaments", tournamentId, "entries"),
    orderBy("createdAt", "desc")
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
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
