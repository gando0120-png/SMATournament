/**
 * 一般参加者向けエントリー（Firestore 操作の明示化・診断ログ）
 *
 * エントリーページが行う Firestore 操作:
 * 1. GET  tournaments/{tournamentId}           … ページ表示時・送信前（受付可否確認）
 * 2. CREATE tournaments/{tournamentId}/entries/* … 送信時のみ
 *
 * 行わない操作:
 * - entries の list/query/get
 * - その他サブコレクション
 */
import {
  addDoc,
  collection,
  getDocFromServer,
  doc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { getFirebaseDb, isFirebaseConfigured } from "../lib/firebase-app.js";
import { ConfigUnconfiguredError, TournamentNotFoundError } from "../lib/errors.js";
import { EntryStatus } from "../domain/constants.js";
import {
  buildEntryMemberFirestorePayload,
  normalizeTeamSize,
} from "../domain/entry-members.js";
import { assertEntryOpenForCreate } from "../lib/entry-open.js";
import {
  logEntryFirestoreFailure,
  logEntryFirestoreSuccess,
} from "../lib/entry-firestore-log.js";

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

function tournamentPath(tournamentId) {
  return `tournaments/${tournamentId}`;
}

function entriesCollectionPath(tournamentId) {
  return `tournaments/${tournamentId}/entries`;
}

function mapTournamentDoc(docSnap) {
  return { ...docSnap.data(), id: docSnap.id };
}

/**
 * 送信ペイロードのフィールド名と型のみ（個人情報は伏せる）
 * @param {object} payload
 */
function describeEntryPayloadShape(payload) {
  const shape = {};
  for (const [key, value] of Object.entries(payload)) {
    if (key === "createdAt") {
      shape.createdAt = "serverTimestamp";
    } else if (value === undefined) {
      shape[key] = "undefined（送信不可）";
    } else if (typeof value === "string") {
      shape[key] = value.length > 0 ? "string" : "string（空）";
    } else {
      shape[key] = typeof value;
    }
  }
  return shape;
}

/**
 * 大会本体 GET（未認証可: Rules の isEntryOpen または canManageTournament）
 * @param {string} tournamentId
 */
export async function loadTournamentForPublicEntry(tournamentId) {
  const path = tournamentPath(tournamentId);
  const db = requireDb();
  const ref = doc(db, "tournaments", tournamentId);

  try {
    const snap = await getDocFromServer(ref);
    if (!snap.exists()) {
      throw new TournamentNotFoundError();
    }
    const tournament = mapTournamentDoc(snap);
    logEntryFirestoreSuccess("tournament get", path, {
      status: tournament.status,
      entryDeadline: tournament.entryDeadline ?? null,
      teamSize: tournament.teamSize ?? null,
    });
    return tournament;
  } catch (error) {
    logEntryFirestoreFailure("tournament get", path, error);
    throw error;
  }
}

/**
 * エントリー CREATE（未認証可: validPublicEntryCreate && isEntryOpen）
 * @param {string} tournamentId
 * @param {object} input validateEntryInput().values
 * @param {object} [options]
 * @param {object} [options.tournament] 既に取得済みなら再 GET しない
 */
export async function createPublicEntry(tournamentId, input, options = {}) {
  const tournament =
    options.tournament ?? (await loadTournamentForPublicEntry(tournamentId));
  assertEntryOpenForCreate(tournament);

  const teamSize = normalizeTeamSize(tournament.teamSize);
  const collectionPath = entriesCollectionPath(tournamentId);
  const db = requireDb();

  const payload = {
    teamName: input.teamName,
    representativeName: input.representativeName,
    email: input.email,
    status: EntryStatus.PENDING,
    createdAt: serverTimestamp(),
    ...buildEntryMemberFirestorePayload(input, teamSize),
  };
  if (input.comment) {
    payload.comment = input.comment;
  }

  const payloadShape = describeEntryPayloadShape(payload);
  console.info("[entry] entry create attempt", collectionPath, {
    teamSize,
    payloadShape,
    hasUndefinedField: Object.values(payload).some((value) => value === undefined),
  });

  try {
    const ref = await addDoc(collection(db, "tournaments", tournamentId, "entries"), payload);
    logEntryFirestoreSuccess("entry create", `${collectionPath}/${ref.id}`);
    return { id: ref.id, ...payload };
  } catch (error) {
    logEntryFirestoreFailure("entry create", collectionPath, error);
    throw error;
  }
}
