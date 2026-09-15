/**
 * プレイヤー決勝勝利報告 — Callable 経由
 */
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-functions.js";
import { getFirebaseFunctions, isFirebaseConfigured } from "../lib/firebase-app.js";
import { ConfigUnconfiguredError } from "../lib/errors.js";

function requireFunctions() {
  if (!isFirebaseConfigured()) {
    throw new ConfigUnconfiguredError();
  }
  const functions = getFirebaseFunctions();
  if (!functions) {
    throw new ConfigUnconfiguredError();
  }
  return functions;
}

/**
 * @param {string} tournamentId
 * @param {{ teamNumber?: string|number, teamToken?: string }} identity
 */
export async function listMyCurrentFinalsMatch(tournamentId, identity) {
  const callable = httpsCallable(requireFunctions(), "listMyCurrentFinalsMatchCallable");
  const payload =
    typeof identity === "string"
      ? { tournamentId, teamToken: identity }
      : {
          tournamentId,
          teamNumber: identity?.teamNumber,
          teamToken: identity?.teamToken,
        };
  const result = await callable(payload);
  return result.data;
}

/**
 * @param {string} tournamentId
 * @param {{
 *   teamNumber?: string|number,
 *   teamToken?: string,
 *   matchId?: string|null,
 * }} payload
 */
export async function reportMyFinalsWin(tournamentId, payload) {
  const callable = httpsCallable(requireFunctions(), "reportMyFinalsWinCallable");
  const result = await callable({
    tournamentId,
    teamNumber: payload.teamNumber,
    teamToken: payload.teamToken,
    matchId: payload.matchId ?? null,
  });
  return result.data;
}
