import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  assertOperatorEnabled,
  assertCanManageTournament,
  dryRunTestTournamentCleanup,
  deleteTestTournamentRecursive,
  normalizeTournamentIds,
} from "./src/test-tournament-cleanup.js";
import {
  issueEntryAccessTokens,
  listMyQualifyingMatches,
  submitPlayerQualifyingResult,
  listMatchReconciliations,
  markReconciliationOperatorResolved,
  rebuildPublicSnapshotAdmin,
} from "./src/player-qualifying-results.js";

initializeApp();

function mapCallableError(error) {
  if (error instanceof HttpsError) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  const code = error?.code;
  if (message === "UNAUTHENTICATED" || code === "unauthenticated") {
    return new HttpsError("unauthenticated", "ログインが必要です。");
  }
  if (message === "PERMISSION_DENIED" || code === "permission-denied") {
    return new HttpsError("permission-denied", message === "PERMISSION_DENIED" ? "運営者権限がありません。" : message);
  }
  if (code === "not-found" || message === "大会が見つかりません。") {
    return new HttpsError("not-found", message);
  }
  if (
    code === "invalid-argument" ||
    code === "player-submission/disabled" ||
    code === "player-submission/tournament-closed" ||
    code === "player-submission/advancement-locked" ||
    code === "player-submission/no-schedule" ||
    code === "player-submission/already-official" ||
    code === "player-submission/conflict" ||
    code === "failed-precondition"
  ) {
    return new HttpsError("failed-precondition", message);
  }
  if (message.startsWith("テスト大会名条件を満たしていません")) {
    return new HttpsError("failed-precondition", message);
  }
  return new HttpsError("internal", message);
}

function requireAuth(request) {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "ログインが必要です。");
  }
  return request.auth.uid;
}

function requireTournamentId(data) {
  const tournamentId = typeof data?.tournamentId === "string" ? data.tournamentId.trim() : "";
  if (!tournamentId) {
    throw new HttpsError("invalid-argument", "tournamentId を指定してください。");
  }
  return tournamentId;
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

/** プレイヤー（未認証可）: 自チーム試合一覧 */
export const listMyQualifyingMatchesCallable = onCall(
  { region: "asia-northeast1", invoker: "public" },
  async (request) => {
    const db = getFirestore();
    try {
      const tournamentId = requireTournamentId(request.data);
      const teamToken = typeof request.data?.teamToken === "string" ? request.data.teamToken.trim() : "";
      if (!teamToken) {
        throw new HttpsError("invalid-argument", "teamToken を指定してください。");
      }
      return await listMyQualifyingMatches(db, tournamentId, teamToken);
    } catch (error) {
      throw mapCallableError(error);
    }
  }
);

/** プレイヤー（未認証可）: 結果提出 */
export const submitPlayerQualifyingResultCallable = onCall(
  { region: "asia-northeast1", invoker: "public" },
  async (request) => {
    const db = getFirestore();
    try {
      const tournamentId = requireTournamentId(request.data);
      const teamToken = typeof request.data?.teamToken === "string" ? request.data.teamToken.trim() : "";
      const matchId = typeof request.data?.matchId === "string" ? request.data.matchId.trim() : "";
      if (!teamToken || !matchId) {
        throw new HttpsError("invalid-argument", "teamToken と matchId を指定してください。");
      }
      return await submitPlayerQualifyingResult(db, tournamentId, {
        teamToken,
        matchId,
        scores: {
          set1Team1Score: request.data?.set1Team1Score,
          set1Team2Score: request.data?.set1Team2Score,
          set2Team1Score: request.data?.set2Team1Score,
          set2Team2Score: request.data?.set2Team2Score,
        },
        clientRequestId:
          typeof request.data?.clientRequestId === "string"
            ? request.data.clientRequestId.trim()
            : null,
      });
    } catch (error) {
      throw mapCallableError(error);
    }
  }
);

/** 運営: チームトークン発行 */
export const issueEntryAccessTokensCallable = onCall(
  { region: "asia-northeast1" },
  async (request) => {
    const uid = requireAuth(request);
    const db = getFirestore();
    try {
      const tournamentId = requireTournamentId(request.data);
      await assertCanManageTournament(db, uid, tournamentId);
      return await issueEntryAccessTokens(db, tournamentId, {
        rotate: request.data?.rotate === true,
      });
    } catch (error) {
      throw mapCallableError(error);
    }
  }
);

/** 運営: 提出状況一覧 */
export const listMatchReconciliationsCallable = onCall(
  { region: "asia-northeast1" },
  async (request) => {
    const uid = requireAuth(request);
    const db = getFirestore();
    try {
      const tournamentId = requireTournamentId(request.data);
      await assertCanManageTournament(db, uid, tournamentId);
      return await listMatchReconciliations(db, tournamentId);
    } catch (error) {
      throw mapCallableError(error);
    }
  }
);

/** 運営: 結果修正後の提出状態更新 */
export const markReconciliationOperatorResolvedCallable = onCall(
  { region: "asia-northeast1" },
  async (request) => {
    const uid = requireAuth(request);
    const db = getFirestore();
    try {
      const tournamentId = requireTournamentId(request.data);
      await assertCanManageTournament(db, uid, tournamentId);
      const matchId = typeof request.data?.matchId === "string" ? request.data.matchId.trim() : "";
      if (!matchId) {
        throw new HttpsError("invalid-argument", "matchId を指定してください。");
      }
      return await markReconciliationOperatorResolved(db, tournamentId, matchId);
    } catch (error) {
      throw mapCallableError(error);
    }
  }
);

/** 運営: 公開スナップショット再構築 */
export const rebuildPublicSnapshotCallable = onCall(
  { region: "asia-northeast1" },
  async (request) => {
    const uid = requireAuth(request);
    const db = getFirestore();
    try {
      const tournamentId = requireTournamentId(request.data);
      await assertCanManageTournament(db, uid, tournamentId);
      await rebuildPublicSnapshotAdmin(db, tournamentId);
      return { ok: true, tournamentId };
    } catch (error) {
      throw mapCallableError(error);
    }
  }
);
