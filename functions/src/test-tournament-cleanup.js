/**
 * テスト大会一括削除 — Cloud Functions ロジック
 */
import { FieldPath } from "firebase-admin/firestore";
import {
  assertDeletableTestTournamentName,
  normalizeTournamentIds,
} from "./test-tournament-name.js";
import { TOURNAMENT_SUBCOLLECTIONS } from "./tournament-subcollections.js";

export { normalizeTournamentIds };

const COUNT_PAGE_SIZE = 500;

/**
 * @param {import('firebase-admin/firestore').Firestore} db
 * @param {string} uid
 */
export async function assertOperatorEnabled(db, uid) {
  if (!uid) {
    throw new Error("UNAUTHENTICATED");
  }
  const snap = await db.collection("operators").doc(uid).get();
  if (!snap.exists || snap.data()?.enabled !== true) {
    throw new Error("PERMISSION_DENIED");
  }
}

/**
 * 運営者または大会作成者
 * @param {import('firebase-admin/firestore').Firestore} db
 * @param {string} uid
 * @param {string} tournamentId
 */
export async function assertCanManageTournament(db, uid, tournamentId) {
  if (!uid) {
    throw new Error("UNAUTHENTICATED");
  }
  const opSnap = await db.collection("operators").doc(uid).get();
  if (opSnap.exists && opSnap.data()?.enabled === true) {
    return;
  }
  const tSnap = await db.collection("tournaments").doc(tournamentId).get();
  if (tSnap.exists && tSnap.data()?.createdBy === uid) {
    return;
  }
  throw new Error("PERMISSION_DENIED");
}

/**
 * @param {import('firebase-admin/firestore').CollectionReference} collectionRef
 */
async function countCollectionDocuments(collectionRef) {
  let total = 0;
  let lastDoc = null;

  while (true) {
    let query = collectionRef.orderBy(FieldPath.documentId()).limit(COUNT_PAGE_SIZE);
    if (lastDoc) {
      query = query.startAfter(lastDoc.id);
    }
    const snap = await query.get();
    if (snap.empty) {
      break;
    }
    total += snap.size;
    lastDoc = snap.docs[snap.docs.length - 1];
    if (snap.size < COUNT_PAGE_SIZE) {
      break;
    }
  }

  return total;
}

/**
 * @param {import('firebase-admin/firestore').Firestore} db
 * @param {string} tournamentId
 */
export async function countTournamentDocuments(db, tournamentId) {
  const tournamentRef = db.collection("tournaments").doc(tournamentId);
  const tournamentSnap = await tournamentRef.get();
  if (!tournamentSnap.exists) {
    return null;
  }

  const name = tournamentSnap.data()?.name ?? "";
  assertDeletableTestTournamentName(name);

  const subcollections = {};
  let documentCount = 1;

  const listedCollections = await tournamentRef.listCollections();
  const collectionIds = new Set([
    ...TOURNAMENT_SUBCOLLECTIONS,
    ...listedCollections.map((col) => col.id),
  ]);

  for (const collectionId of collectionIds) {
    const count = await countCollectionDocuments(tournamentRef.collection(collectionId));
    if (count > 0) {
      subcollections[collectionId] = count;
      documentCount += count;
    }
  }

  return {
    tournamentId,
    name,
    documentCount,
    subcollections,
  };
}

/**
 * @param {import('firebase-admin/firestore').Firestore} db
 * @param {string[]} tournamentIds
 */
export async function dryRunTestTournamentCleanup(db, tournamentIds) {
  const ids = normalizeTournamentIds(tournamentIds);
  const tournaments = [];
  const invalid = [];

  for (const tournamentId of ids) {
    try {
      const outcome = await countTournamentDocuments(db, tournamentId);
      if (!outcome) {
        invalid.push({ tournamentId, reason: "大会が見つかりません。" });
        continue;
      }
      tournaments.push(outcome);
    } catch (error) {
      invalid.push({
        tournamentId,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const totalDocuments = tournaments.reduce((sum, item) => sum + item.documentCount, 0);

  return {
    tournaments,
    invalid,
    hasNonTestTournament: invalid.length > 0,
    tournamentCount: tournaments.length,
    totalDocuments,
  };
}

/**
 * @param {import('firebase-admin/firestore').Firestore} db
 * @param {string} tournamentId
 */
export async function deleteTestTournamentRecursive(db, tournamentId) {
  const tournamentRef = db.collection("tournaments").doc(tournamentId);
  const tournamentSnap = await tournamentRef.get();
  if (!tournamentSnap.exists) {
    throw new Error("大会が見つかりません。");
  }

  const name = tournamentSnap.data()?.name ?? "";
  assertDeletableTestTournamentName(name);

  const before = await countTournamentDocuments(db, tournamentId);
  const deletedDocumentCount = before?.documentCount ?? 1;

  await db.recursiveDelete(tournamentRef);

  return {
    tournamentId,
    name,
    deletedDocumentCount,
  };
}

/**
 * @param {import('firebase-admin/firestore').Firestore} db
 * @param {string[]} tournamentIds
 */
export async function executeTestTournamentCleanup(db, tournamentIds) {
  const ids = normalizeTournamentIds(tournamentIds);
  const succeeded = [];
  const failed = [];
  let deletedDocumentCount = 0;

  for (const tournamentId of ids) {
    try {
      const outcome = await deleteTestTournamentRecursive(db, tournamentId);
      succeeded.push(outcome);
      deletedDocumentCount += outcome.deletedDocumentCount;
    } catch (error) {
      failed.push({
        tournamentId,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    succeeded,
    failed,
    deletedDocumentCount,
    completedCount: succeeded.length + failed.length,
    selectedCount: ids.length,
  };
}
