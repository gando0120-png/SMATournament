/**
 * 大会 Firestore CRUD（DOM 非依存）
 */
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  query,
  orderBy,
  updateDoc,
  serverTimestamp,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { getFirebaseDb, isFirebaseConfigured } from "../lib/firebase-app.js";
import { ConfigUnconfiguredError, TournamentNotFoundError, TournamentDeletedError, TournamentStructureLockedError } from "../lib/errors.js";
import { TournamentStatus } from "../domain/constants.js";
import { isTournamentDeleted, filterActiveTournaments } from "../domain/tournament-deletion.js";
import { isTournamentStructureLocked, STRUCTURE_LOCK_FIELD_KEYS } from "../domain/tournament-structure-lock.js";
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
    status: TournamentStatus.DRAFT,
    entryCount: 0,
    confirmedCount: 0,
    publicViewEnabled: true,
    participantResultEntryEnabled: false,
    createdBy: createdByUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (input.tournamentFormat === "single_elimination") {
    payload.tournamentFormat = "single_elimination";
  } else if (input.tournamentFormat === "qualifying_and_finals") {
    payload.tournamentFormat = "qualifying_and_finals";
    payload.blockCount = input.blockCount;
    payload.qualifiersPerBlock = input.qualifiersPerBlock;
  } else if (input.preferredBlockSize != null) {
    payload.preferredBlockSize = input.preferredBlockSize;
  }

  const ref = await addDoc(collection(db, "tournaments"), payload);
  return withPublicSnapshotRebuild(ref.id, { id: ref.id, ...payload });
}

/**
 * @param {string} tournamentId
 * @param {{ source?: 'default' | 'server' }} [options]
 */
export async function getTournament(tournamentId, options = {}) {
  const db = requireDb();
  const ref = doc(db, "tournaments", tournamentId);
  const snap =
    options.source === "server" ? await getDocFromServer(ref) : await getDoc(ref);
  if (!snap.exists()) {
    throw new TournamentNotFoundError();
  }
  const tournament = mapTournamentDoc(snap);
  if (isTournamentDeleted(tournament) && options.rejectDeleted) {
    throw new TournamentDeletedError();
  }
  return tournament;
}

/**
 * 開催日昇順（論理削除済みを除外）
 */
export async function listTournaments() {
  const db = requireDb();
  const q = query(collection(db, "tournaments"), orderBy("eventDate", "asc"));
  const snapshot = await getDocs(q);
  return filterActiveTournaments(snapshot.docs.map((d) => mapTournamentDoc(d)));
}

/**
 * @param {string} tournamentId
 * @param {object} input validateTournamentInput().values
 * @param {{ structureLocked?: boolean }} [options]
 */
export async function updateTournamentSettings(tournamentId, input, options = {}) {
  const tournament = await getTournament(tournamentId);
  if (isTournamentDeleted(tournament)) {
    throw new TournamentDeletedError();
  }

  const locked = options.structureLocked === true;
  if (locked) {
    for (const key of STRUCTURE_LOCK_FIELD_KEYS) {
      if (input[key] !== tournament[key]) {
        throw new TournamentStructureLockedError(
          "エントリーまたは抽選開始後のため、募集チーム数・人数・ブロック基本人数は変更できません。"
        );
      }
    }
  }

  const db = requireDb();
  const ref = doc(db, "tournaments", tournamentId);
  const payload = {
    name: input.name,
    eventDate: input.eventDate,
    venue: input.venue,
    entryDeadline: Timestamp.fromDate(input.entryDeadline),
    courtCount: input.courtCount,
    updatedAt: serverTimestamp(),
  };

  if (!locked) {
    payload.maxTeams = input.maxTeams;
    payload.teamSize = input.teamSize;
    payload.preferredBlockSize = input.preferredBlockSize;
  }

  await updateDoc(ref, payload);
  const updated = {
    ...tournament,
    ...payload,
    entryDeadline: Timestamp.fromDate(input.entryDeadline),
  };
  return withPublicSnapshotRebuild(tournamentId, updated);
}

/**
 * @param {string} tournamentId
 * @param {string} deletedByUid
 */
export async function softDeleteTournament(tournamentId, deletedByUid) {
  const tournament = await getTournament(tournamentId);
  if (isTournamentDeleted(tournament)) {
    throw new TournamentDeletedError();
  }

  const db = requireDb();
  const ref = doc(db, "tournaments", tournamentId);
  await updateDoc(ref, {
    isDeleted: true,
    deletedAt: serverTimestamp(),
    deletedBy: deletedByUid,
    updatedAt: serverTimestamp(),
  });

  return withPublicSnapshotRebuild(tournamentId, {
    ...tournament,
    isDeleted: true,
    deletedBy: deletedByUid,
  });
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
