/**
 * Firestore 共通操作
 */
import { doc, getDoc, getDocFromServer } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { getFirebaseDb, isFirebaseConfigured } from "./firebase-app.js";
import {
  ConfigUnconfiguredError,
  OperatorNotRegisteredError,
  TournamentManageDeniedError,
  TournamentNotFoundError,
} from "./errors.js";
import {
  canManageTournament as canManageTournamentDomain,
  isOperatorEnabledRecord,
  isTournamentOwner as isTournamentOwnerDomain,
} from "../domain/tournament-access.js";

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
 * operators/{uid} ドキュメントを取得
 * @param {string} uid
 * @param {{ source?: 'default' | 'server' }} [options]
 */
export async function getOperatorRecord(uid, options = {}) {
  const db = requireDb();
  const ref = doc(db, "operators", uid);
  const path = `operators/${uid}`;
  console.info("[dashboard] operator get start", { path, source: options.source ?? "default" });
  try {
    const snap =
      options.source === "server" ? await getDocFromServer(ref) : await getDoc(ref);
    if (!snap.exists()) {
      console.info("[dashboard] operator get ok (missing)", { path });
      return null;
    }
    const data = snap.data();
    console.info("[dashboard] operator get ok", {
      path,
      enabled: data?.enabled ?? null,
      enabledType: typeof data?.enabled,
    });
    return data;
  } catch (error) {
    console.error("[dashboard] operator get failed", {
      path,
      code: error?.code ?? "(no code)",
      message: error?.message ?? String(error),
    });
    throw error;
  }
}

/**
 * operators/{uid} が存在し enabled === true か
 * @param {string} uid
 */
export async function isOperatorEnabled(uid) {
  const record = await getOperatorRecord(uid);
  return isOperatorEnabledRecord(record);
}

/**
 * @deprecated {@link isOperatorEnabled} を使用
 */
export async function isOperatorRegistered(uid) {
  return isOperatorEnabled(uid);
}

/**
 * 運営者確認。enabled !== true なら OperatorNotRegisteredError
 * @param {string} uid
 */
export async function assertOperator(uid) {
  const record = await getOperatorRecord(uid, { source: "server" });
  if (!isOperatorEnabledRecord(record)) {
    console.warn("[dashboard] operator assert failed", {
      uid,
      operatorExists: record != null,
      enabled: record?.enabled ?? null,
      enabledType: record == null ? null : typeof record.enabled,
    });
    throw new OperatorNotRegisteredError();
  }
  console.info("[dashboard] operator assert ok", { uid });
  return true;
}

/**
 * @param {object} tournament
 * @param {string} uid
 */
export function isTournamentOwner(tournament, uid) {
  return isTournamentOwnerDomain(tournament, uid);
}

/**
 * 大会の編集・結果入力・設定変更権限（運営者または所有者）
 * @param {string} tournamentId
 * @param {string} uid
 */
export async function assertCanManageTournament(tournamentId, uid) {
  const operatorRecord = await getOperatorRecord(uid);
  if (isOperatorEnabledRecord(operatorRecord)) {
    return true;
  }

  const db = requireDb();
  let snap;
  try {
    snap = await getDoc(doc(db, "tournaments", tournamentId));
  } catch (error) {
    if (error?.code === "permission-denied" || error?.code === "firestore/permission-denied") {
      throw new TournamentManageDeniedError();
    }
    throw error;
  }
  if (!snap.exists()) {
    throw new TournamentNotFoundError();
  }

  const tournament = snap.data();
  if (canManageTournamentDomain(tournament, uid, operatorRecord)) {
    return true;
  }

  throw new TournamentManageDeniedError();
}
