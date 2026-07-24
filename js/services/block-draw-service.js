/**
 * ブロック抽選 Firestore 操作（DOM 非依存）
 */
import {
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { getFirebaseDb, isFirebaseConfigured } from "../lib/firebase-app.js";
import { ConfigUnconfiguredError } from "../lib/errors.js";
import {
  BLOCK_DRAW_DOC_ID,
  BlockDrawStatus,
} from "../domain/constants.js";
import { distributeEntriesToBlocks } from "../domain/block-draw.js";
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
 * @param {string} tournamentId
 */
export async function getBlockDraw(tournamentId) {
  const db = requireDb();
  const snap = await getDoc(
    doc(db, "tournaments", tournamentId, "blockDraw", BLOCK_DRAW_DOC_ID)
  );
  if (!snap.exists()) {
    return null;
  }
  return { id: snap.id, ...snap.data() };
}

/**
 * @param {string} tournamentId
 * @param {Array<{ id: string }>} confirmedEntries
 * @param {number} preferredBlockSize
 */
export async function runBlockDraw(tournamentId, confirmedEntries, preferredBlockSize) {
  await requireOpenTournament(tournamentId);
  const db = requireDb();
  const drawRef = doc(db, "tournaments", tournamentId, "blockDraw", BLOCK_DRAW_DOC_ID);
  const drawResult = distributeEntriesToBlocks(confirmedEntries, preferredBlockSize);
  const payload = {
    status: BlockDrawStatus.FINALIZED,
    preferredBlockSize: drawResult.preferredBlockSize,
    blockCount: drawResult.blockCount,
    blocks: drawResult.blocks,
    finalizedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(drawRef);
    if (snap.exists()) {
      throw Object.assign(new Error("ブロック抽選はすでに確定済みです。"), {
        code: "block-draw/already-finalized",
      });
    }
    transaction.set(drawRef, payload);
  });

  const saved = await getDoc(drawRef);
  return withPublicSnapshotRebuild(tournamentId, { id: saved.id, ...saved.data() });
}
