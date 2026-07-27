/**
 * 運営者専用ページの認証ガード
 */
import { isFirebaseConfigured } from "./firebase-app.js";
import { watchAuthState } from "./auth.js";
import { assertCanManageTournament, assertOperator } from "./firestore.js";
import { ErrorCodes, classifyError } from "./errors.js";

export function redirectToIndex() {
  window.location.replace("index.html");
}

/**
 * @param {object} handlers
 * @param {() => void} handlers.onConfigRequired
 * @param {(user: import('firebase/auth').User) => void} handlers.onReady
 * @param {(user: import('firebase/auth').User) => void} [handlers.onOperatorDenied]
 * @returns {() => void} unsubscribe
 */
export function initOperatorGuard({ onConfigRequired, onReady, onOperatorDenied }) {
  if (!isFirebaseConfigured()) {
    onConfigRequired?.();
    return () => {};
  }

  return watchAuthState(async (user) => {
    console.info("[dashboard] auth state", user?.uid ?? "(none)");
    if (!user) {
      redirectToIndex();
      return;
    }

    try {
      await assertOperator(user.uid);
      onReady(user);
    } catch (error) {
      const { code } = classifyError(error);
      if (code === ErrorCodes.OPERATOR_NOT_REGISTERED) {
        onOperatorDenied?.(user);
        return;
      }
      redirectToIndex();
    }
  });
}

/**
 * 大会管理ページ用ガード（運営者 enabled または createdBy 所有者）
 * @param {object} handlers
 * @param {string} handlers.tournamentId
 * @param {() => void} handlers.onConfigRequired
 * @param {(user: import('firebase/auth').User) => void} handlers.onReady
 * @param {(user: import('firebase/auth').User) => void} [handlers.onAccessDenied]
 * @returns {() => void} unsubscribe
 */
export function initTournamentManageGuard({
  tournamentId,
  onConfigRequired,
  onReady,
  onAccessDenied,
}) {
  if (!isFirebaseConfigured()) {
    onConfigRequired?.();
    return () => {};
  }

  return watchAuthState(async (user) => {
    console.log("[entry-admin] guard start", tournamentId);

    if (!user) {
      console.warn("[entry-admin] guard failed: unauthenticated");
      redirectToIndex();
      return;
    }

    console.log("[entry-admin] auth ok", user.uid);

    try {
      await assertCanManageTournament(tournamentId, user.uid);
      console.log("[entry-admin] guard ok", tournamentId);
      onReady(user);
    } catch (error) {
      console.error(
        "[entry-admin] guard failed",
        tournamentId,
        error?.code ?? "(no code)",
        error
      );
      const { code } = classifyError(error);
      if (
        code === ErrorCodes.OPERATOR_NOT_REGISTERED ||
        code === ErrorCodes.TOURNAMENT_MANAGE_DENIED ||
        code === ErrorCodes.TOURNAMENT_NOT_FOUND ||
        code === ErrorCodes.PERMISSION_DENIED
      ) {
        onAccessDenied?.(user);
        return;
      }
      redirectToIndex();
    }
  });
}
