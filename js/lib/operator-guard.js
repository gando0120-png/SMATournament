/**
 * 運営者専用ページの認証ガード
 */
import { isFirebaseConfigured } from "./firebase-app.js";
import { watchAuthState } from "./auth.js";
import { assertOperator } from "./firestore.js";
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
