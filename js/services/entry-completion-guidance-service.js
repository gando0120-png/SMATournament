/**
 * エントリー完了案内の Firestore CRUD（大会本体とは独立）
 */
import {
  doc,
  getDoc,
  getDocFromServer,
  setDoc,
  deleteDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { getFirebaseDb, isFirebaseConfigured } from "../lib/firebase-app.js";
import { ConfigUnconfiguredError } from "../lib/errors.js";
import {
  ENTRY_COMPLETION_GUIDANCE_COLLECTION,
  ENTRY_COMPLETION_GUIDANCE_DOC_ID,
  buildEntryCompletionGuidanceDoc,
} from "../domain/entry-completion-guidance.js";

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
function guidanceRef(tournamentId) {
  return doc(
    requireDb(),
    "tournaments",
    tournamentId,
    ENTRY_COMPLETION_GUIDANCE_COLLECTION,
    ENTRY_COMPLETION_GUIDANCE_DOC_ID
  );
}

/**
 * @param {string} tournamentId
 * @param {{ source?: 'default' | 'server' }} [options]
 * @returns {Promise<{
 *   entryCompletionMessage: string,
 *   entryCompletionLinkUrl: string,
 *   entryCompletionLinkLabel: string,
 * } | null>}
 */
export async function getEntryCompletionGuidance(tournamentId, options = {}) {
  const ref = guidanceRef(tournamentId);
  const snap =
    options.source === "server" ? await getDocFromServer(ref) : await getDoc(ref);
  if (!snap.exists()) {
    return null;
  }
  const data = snap.data() || {};
  return {
    entryCompletionMessage:
      typeof data.entryCompletionMessage === "string" ? data.entryCompletionMessage : "",
    entryCompletionLinkUrl:
      typeof data.entryCompletionLinkUrl === "string" ? data.entryCompletionLinkUrl : "",
    entryCompletionLinkLabel:
      typeof data.entryCompletionLinkLabel === "string"
        ? data.entryCompletionLinkLabel
        : "",
  };
}

/**
 * @param {string} tournamentId
 * @param {{
 *   entryCompletionMessage?: string,
 *   entryCompletionLinkUrl?: string,
 *   entryCompletionLinkLabel?: string,
 * }} values
 */
export async function saveEntryCompletionGuidance(tournamentId, values) {
  const body = buildEntryCompletionGuidanceDoc(values);
  const ref = guidanceRef(tournamentId);
  if (!body) {
    try {
      await deleteDoc(ref);
    } catch {
      // 未作成なら無視
    }
    return null;
  }
  await setDoc(
    ref,
    {
      ...body,
      updatedAt: serverTimestamp(),
    },
    { merge: false }
  );
  return body;
}
