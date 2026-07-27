import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  assertOperatorEnabled,
  dryRunTestTournamentCleanup,
  deleteTestTournamentRecursive,
  normalizeTournamentIds,
} from "./src/test-tournament-cleanup.js";

initializeApp();

function mapCallableError(error) {
  if (error instanceof HttpsError) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (message === "UNAUTHENTICATED") {
    return new HttpsError("unauthenticated", "ログインが必要です。");
  }
  if (message === "PERMISSION_DENIED") {
    return new HttpsError("permission-denied", "運営者権限がありません。");
  }
  if (message.startsWith("テスト大会名条件を満たしていません")) {
    return new HttpsError("failed-precondition", message);
  }
  if (message === "大会が見つかりません。") {
    return new HttpsError("not-found", message);
  }
  return new HttpsError("internal", message);
}

function requireAuth(request) {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "ログインが必要です。");
  }
  return request.auth.uid;
}

export const dryRunTestTournamentCleanupCallable = onCall(
  { region: "asia-northeast1" },
  async (request) => {
    const uid = requireAuth(request);
    const db = getFirestore();

    try {
      await assertOperatorEnabled(db, uid);
      const tournamentIds = normalizeTournamentIds(request.data?.tournamentIds);
      if (tournamentIds.length === 0) {
        throw new HttpsError("invalid-argument", "削除対象の大会 ID を指定してください。");
      }
      return await dryRunTestTournamentCleanup(db, tournamentIds);
    } catch (error) {
      throw mapCallableError(error);
    }
  }
);

export const deleteTestTournamentCallable = onCall(
  { region: "asia-northeast1" },
  async (request) => {
    const uid = requireAuth(request);
    const db = getFirestore();

    try {
      await assertOperatorEnabled(db, uid);
      const tournamentId =
        typeof request.data?.tournamentId === "string" ? request.data.tournamentId.trim() : "";
      if (!tournamentId) {
        throw new HttpsError("invalid-argument", "削除対象の大会 ID を指定してください。");
      }
      return await deleteTestTournamentRecursive(db, tournamentId);
    } catch (error) {
      throw mapCallableError(error);
    }
  }
);
