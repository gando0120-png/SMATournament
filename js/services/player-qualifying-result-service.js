/**
 * プレイヤー予選結果 — Callable 経由
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
 */
export async function listPlayerTeamChoices(tournamentId) {
  const callable = httpsCallable(requireFunctions(), "listPlayerTeamChoicesCallable");
  const result = await callable({ tournamentId });
  return result.data;
}

/**
 * @param {string} tournamentId
 * @param {{ teamNumber?: string|number, teamToken?: string }} identity
 */
export async function listMyQualifyingMatches(tournamentId, identity) {
  const callable = httpsCallable(requireFunctions(), "listMyQualifyingMatchesCallable");
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
 *   matchId: string,
 *   set1OwnScore: unknown,
 *   set2OwnScore: unknown,
 *   clientRequestId?: string|null,
 * }} payload
 */
export async function submitPlayerQualifyingResult(tournamentId, payload) {
  const callable = httpsCallable(requireFunctions(), "submitPlayerQualifyingResultCallable");
  const result = await callable({
    tournamentId,
    teamNumber: payload.teamNumber,
    teamToken: payload.teamToken,
    matchId: payload.matchId,
    set1OwnScore: payload.set1OwnScore,
    set2OwnScore: payload.set2OwnScore,
    clientRequestId: payload.clientRequestId ?? null,
  });
  return result.data;
}

/**
 * @deprecated チーム別URL運用は終了。後方互換のため残す。
 * @param {string} tournamentId
 * @param {{ rotate?: boolean }} [options]
 */
export async function issueEntryAccessTokens(tournamentId, options = {}) {
  const callable = httpsCallable(requireFunctions(), "issueEntryAccessTokensCallable");
  const result = await callable({
    tournamentId,
    rotate: options.rotate === true,
  });
  return result.data;
}

/**
 * @param {string} tournamentId
 */
export async function listMatchReconciliations(tournamentId) {
  const callable = httpsCallable(requireFunctions(), "listMatchReconciliationsCallable");
  const result = await callable({ tournamentId });
  return result.data;
}

/**
 * @param {string} tournamentId
 * @param {string} matchId
 */
export async function markReconciliationOperatorResolved(tournamentId, matchId) {
  const callable = httpsCallable(requireFunctions(), "markReconciliationOperatorResolvedCallable");
  const result = await callable({ tournamentId, matchId });
  return result.data;
}
