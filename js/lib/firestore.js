/**
 * Firestore 共通操作
 */
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { getFirebaseDb, isFirebaseConfigured } from "./firebase-app.js";
import { ConfigUnconfiguredError, OperatorNotRegisteredError } from "./errors.js";

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
 * operators/{uid} が存在するか確認
 */
export async function isOperatorRegistered(uid) {
  const db = requireDb();
  const snap = await getDoc(doc(db, "operators", uid));
  return snap.exists();
}

/**
 * 運営者確認。未登録なら OperatorNotRegisteredError
 */
export async function assertOperator(uid) {
  const registered = await isOperatorRegistered(uid);
  if (!registered) {
    throw new OperatorNotRegisteredError();
  }
  return true;
}

