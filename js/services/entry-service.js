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
  deleteField,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { getFirebaseDb, isFirebaseConfigured } from "../lib/firebase-app.js";
import { ConfigUnconfiguredError, EntryNotFoundError, TournamentDeletedError } from "../lib/errors.js";
import { EntryStatus } from "../domain/constants.js";
import { validateEntryProfileInput } from "../domain/entry-profile.js";
import {
  getAdditionalMemberFieldKeys,
  resolveTeamSizeFromTournament,
} from "../domain/entry-members.js";
import { isTournamentDeleted } from "../domain/tournament-deletion.js";
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

/**
 * 運営によるエントリー表示情報の更新（teamNumber / status / entryId は変更しない）
 * @param {string} tournamentId
 * @param {string} entryId
 * @param {object} input
 * @param {{ teamSize?: number|string|null }} [options]
 */
export async function updateEntryProfile(tournamentId, entryId, input, options = {}) {
  const tournament = await getTournament(tournamentId);
  if (isTournamentDeleted(tournament)) {
    throw new TournamentDeletedError();
  }

  const teamSize =
    options.teamSize != null
      ? options.teamSize
      : resolveTeamSizeFromTournament(tournament);
  const validation = validateEntryProfileInput(input, teamSize);
  if (!validation.valid) {
    const error = new Error("Invalid entry profile");
    error.code = "entry/invalid-profile";
    error.validationErrors = validation.errors;
    throw error;
  }

  const db = requireDb();
  const ref = doc(db, "tournaments", tournamentId, "entries", entryId);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    throw new EntryNotFoundError();
  }

  const existing = snap.data();
  const values = validation.values;
  const payload = {
    teamName: values.teamName,
    representativeName: values.representativeName,
    email: values.email,
    updatedAt: serverTimestamp(),
  };

  for (const fieldKey of getAdditionalMemberFieldKeys(teamSize)) {
    payload[fieldKey] = values[fieldKey];
  }

  if (values.comment) {
    payload.comment = values.comment;
  } else if ("comment" in existing) {
    payload.comment = deleteField();
  }

  await updateDoc(ref, payload);

  const updated = {
    id: snap.id,
    ...existing,
    teamName: values.teamName,
    representativeName: values.representativeName,
    email: values.email,
  };
  for (const fieldKey of getAdditionalMemberFieldKeys(teamSize)) {
    updated[fieldKey] = values[fieldKey];
  }
  if (values.comment) {
    updated.comment = values.comment;
  } else {
    delete updated.comment;
  }

  // 対戦表・bracket 等の非正規化 teamName は Rules 上クライアント更新不可のため、
  // entry を正とし、公開スナップショット再生成＋各画面の表示時 overlay で反映する。
  return withPublicSnapshotRebuild(tournamentId, updated);
}
