/**
 * 大会 Firestore CRUD（DOM 非依存）
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
  Timestamp,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { getFirebaseDb, isFirebaseConfigured } from "../lib/firebase-app.js";
import { ConfigUnconfiguredError, TournamentNotFoundError } from "../lib/errors.js";
import { TournamentStatus } from "../domain/constants.js";
import { assertTournamentOpenForWrite } from "../lib/tournament-status.js";
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
 * Firestore ドキュメントをアプリ用オブジェクトに変換（document.id を常に保持）
 * @param {import('firebase/firestore').DocumentSnapshot} docSnap
 */
function mapTournamentDoc(docSnap) {
  return { ...docSnap.data(), id: docSnap.id };
}

/**
 * @param {object} input - validateTournamentInput().values
 * @param {string} createdByUid
 */
export async function createTournament(input, createdByUid) {
  const db = requireDb();
  const payload = {
    name: input.name,
    eventDate: input.eventDate,
    venue: input.venue,
    entryDeadline: Timestamp.fromDate(input.entryDeadline),
    maxTeams: input.maxTeams,
    teamSize: input.teamSize,
    courtCount: input.courtCount,
    preferredBlockSize: input.preferredBlockSize,
    status: TournamentStatus.DRAFT,
    entryCount: 0,
    confirmedCount: 0,
    publicViewEnabled: true,
    participantResultEntryEnabled: false,
    createdBy: createdByUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const ref = await addDoc(collection(db, "tournaments"), payload);
  return withPublicSnapshotRebuild(ref.id, { id: ref.id, ...payload });
}

/**
 * @param {string} tournamentId
 */
export async function getTournament(tournamentId) {
  const db = requireDb();
  const snap = await getDoc(doc(db, "tournaments", tournamentId));
  if (!snap.exists()) {
    throw new TournamentNotFoundError();
  }
  return mapTournamentDoc(snap);
}

/**
 * 開催日昇順
 */
export async function listTournaments() {
  const db = requireDb();
  const q = query(collection(db, "tournaments"), orderBy("eventDate", "asc"));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => mapTournamentDoc(d));
}

/**
 * @param {string} tournamentId
 */
export async function requireOpenTournament(tournamentId) {
  const tournament = await getTournament(tournamentId);
  assertTournamentOpenForWrite(tournament);
  return tournament;
}

/**
 * @param {string} tournamentId
 * @param {string} newStatus
 */
export async function updateTournamentStatus(tournamentId, newStatus) {
  const db = requireDb();
  const ref = doc(db, "tournaments", tournamentId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    throw new TournamentNotFoundError();
  }

  await updateDoc(ref, {
    status: newStatus,
    updatedAt: serverTimestamp(),
  });

  return withPublicSnapshotRebuild(tournamentId, {
    ...mapTournamentDoc(snap),
    status: newStatus,
  });
}

/**
 * @param {string} tournamentId
 * @param {boolean} publicViewEnabled
 */
export async function updateTournamentPublicView(tournamentId, publicViewEnabled) {
  const db = requireDb();
  const ref = doc(db, "tournaments", tournamentId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    throw new TournamentNotFoundError();
  }

  await updateDoc(ref, {
    publicViewEnabled: Boolean(publicViewEnabled),
    updatedAt: serverTimestamp(),
  });

  return withPublicSnapshotRebuild(tournamentId, {
    ...mapTournamentDoc(snap),
    publicViewEnabled: Boolean(publicViewEnabled),
  });
}
