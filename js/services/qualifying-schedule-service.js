/**
 * 予選対戦表 Firestore 操作（DOM 非依存）
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
  EntryStatus,
  QUALIFYING_SCHEDULE_DOC_ID,
} from "../domain/constants.js";
import { buildQualifyingScheduleFromBlockDraw } from "../domain/qualifying-schedule.js";
import {
  buildPersistedQualifyingSchedule,
  validateQualifyingScheduleForSave,
} from "../domain/qualifying-schedule-persist.js";
import { listEntries } from "./entry-service.js";
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
export async function getQualifyingSchedule(tournamentId) {
  const db = requireDb();
  const snap = await getDoc(
    doc(db, "tournaments", tournamentId, "qualifyingSchedules", QUALIFYING_SCHEDULE_DOC_ID)
  );
  if (!snap.exists()) {
    return null;
  }
  return { id: snap.id, ...snap.data() };
}

/**
 * 最新の blockDraw/current から対戦表を生成して確定保存する
 * @param {string} tournamentId
 */
export async function saveQualifyingSchedule(tournamentId) {
  await requireOpenTournament(tournamentId);

  const entries = await listEntries(tournamentId);
  const confirmedEntries = entries.filter(
    (entry) => entry.status === EntryStatus.CONFIRMED
  );

  const db = requireDb();
  const blockDrawRef = doc(
    db,
    "tournaments",
    tournamentId,
    "blockDraw",
    BLOCK_DRAW_DOC_ID
  );
  const scheduleRef = doc(
    db,
    "tournaments",
    tournamentId,
    "qualifyingSchedules",
    QUALIFYING_SCHEDULE_DOC_ID
  );

  await runTransaction(db, async (transaction) => {
    const [blockDrawSnap, scheduleSnap] = await Promise.all([
      transaction.get(blockDrawRef),
      transaction.get(scheduleRef),
    ]);

    if (!blockDrawSnap.exists()) {
      throw Object.assign(new Error("ブロック抽選が存在しません。"), {
        code: "qualifying-schedule/no-block-draw",
      });
    }

    const blockDraw = { id: blockDrawSnap.id, ...blockDrawSnap.data() };
    if (blockDraw.status !== BlockDrawStatus.FINALIZED) {
      throw Object.assign(new Error("ブロック抽選が確定していません。"), {
        code: "qualifying-schedule/block-draw-not-finalized",
      });
    }

    if (scheduleSnap.exists()) {
      throw Object.assign(new Error("予選対戦表はすでに確定済みです。"), {
        code: "qualifying-schedule/already-finalized",
      });
    }

    const previewSchedule = buildQualifyingScheduleFromBlockDraw(
      blockDraw,
      confirmedEntries
    );
    const validation = validateQualifyingScheduleForSave(previewSchedule, blockDraw);
    if (!validation.valid) {
      throw Object.assign(new Error(validation.message || "対戦表を確定できません。"), {
        code: "qualifying-schedule/invalid",
      });
    }

    const scheduleData = buildPersistedQualifyingSchedule(previewSchedule, blockDraw);
    transaction.set(scheduleRef, {
      ...scheduleData,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });

  const schedule = await getQualifyingSchedule(tournamentId);
  return withPublicSnapshotRebuild(tournamentId, schedule);
}
