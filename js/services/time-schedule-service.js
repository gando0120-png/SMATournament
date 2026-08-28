/**
 * 大会スケジュール設定 Firestore 操作（大会本体とは独立）
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
import { withPublicSnapshotRebuild } from "../lib/public-snapshot-hook.js";
import {
  TIME_SCHEDULE_COLLECTION,
  TIME_SCHEDULE_DOC_ID,
  buildTimeScheduleDoc,
  normalizeTimeScheduleDoc,
  normalizeTimeScheduleOverrides,
} from "../domain/time-schedule.js";

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
function timeScheduleRef(tournamentId) {
  return doc(
    requireDb(),
    "tournaments",
    tournamentId,
    TIME_SCHEDULE_COLLECTION,
    TIME_SCHEDULE_DOC_ID
  );
}

/**
 * @param {string} tournamentId
 * @param {{ source?: 'default' | 'server' }} [options]
 */
export async function getTimeSchedule(tournamentId, options = {}) {
  const ref = timeScheduleRef(tournamentId);
  const snap =
    options.source === "server" ? await getDocFromServer(ref) : await getDoc(ref);
  if (!snap.exists()) {
    return null;
  }
  return normalizeTimeScheduleDoc(snap.data() || {});
}

/**
 * @param {string} tournamentId
 * @param {object} values validateTimeScheduleInput().values
 */
export async function saveTimeSchedule(tournamentId, values) {
  const body = buildTimeScheduleDoc(values);
  const ref = timeScheduleRef(tournamentId);
  if (!body) {
    try {
      await deleteDoc(ref);
    } catch {
      // 未作成なら無視
    }
    return null;
  }

  const existing = await getTimeSchedule(tournamentId);
  const overrides = normalizeTimeScheduleOverrides(existing?.overrides);
  const payload = {
    dayStartTime: body.dayStartTime,
    matchDurationMinutes: body.matchDurationMinutes,
    matchIntervalMinutes: body.matchIntervalMinutes,
    qualifyingToFinalsIntervalMinutes: body.qualifyingToFinalsIntervalMinutes,
    overrides,
    updatedAt: serverTimestamp(),
  };
  await setDoc(ref, payload, { merge: false });
  return {
    ...payload,
    overrides,
    configured: true,
    updatedAt: existing?.updatedAt ?? null,
  };
}

/**
 * override のみ更新。設定本体は維持する。
 * @param {string} tournamentId
 * @param {object} overrides
 */
export async function saveTimeScheduleOverrides(tournamentId, overrides) {
  const existing = await getTimeSchedule(tournamentId);
  if (!existing?.configured) {
    const error = new Error("大会スケジュールが未設定のため、開始予定は変更できません。");
    error.code = "time-schedule-unconfigured";
    throw error;
  }
  const normalizedOverrides = normalizeTimeScheduleOverrides(overrides);
  const payload = {
    dayStartTime: existing.dayStartTime,
    matchDurationMinutes: existing.matchDurationMinutes,
    matchIntervalMinutes: existing.matchIntervalMinutes,
    qualifyingToFinalsIntervalMinutes: existing.qualifyingToFinalsIntervalMinutes,
    overrides: normalizedOverrides,
    updatedAt: serverTimestamp(),
  };
  await setDoc(timeScheduleRef(tournamentId), payload, { merge: false });
  return withPublicSnapshotRebuild(tournamentId, {
    ...payload,
    overrides: normalizedOverrides,
    configured: true,
    updatedAt: existing.updatedAt ?? null,
  });
}
