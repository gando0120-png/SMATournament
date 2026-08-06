/**
 * プレイヤー予選結果 — Callable クライアント
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
 * @param {string} teamToken
 */
export async function listMyQualifyingMatches(tournamentId, teamToken) {
  const callable = httpsCallable(requireFunctions(), "listMyQualifyingMatchesCallable");
  const result = await callable({ tournamentId, teamToken });
  return result.data;
}

/**
 * @param {string} tournamentId
 * @param {object} payload
 */
export async function submitPlayerQualifyingResult(tournamentId, payload) {
  const callable = httpsCallable(requireFunctions(), "submitPlayerQualifyingResultCallable");
  const result = await callable({
    tournamentId,
    teamToken: payload.teamToken,
    matchId: payload.matchId,
    set1Team1Score: payload.set1Team1Score,
    set1Team2Score: payload.set1Team2Score,
    set2Team1Score: payload.set2Team1Score,
    set2Team2Score: payload.set2Team2Score,
    clientRequestId: payload.clientRequestId ?? null,
  });
  return result.data;
}

/**
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
  const callable = httpsCallable(
    requireFunctions(),
    "markReconciliationOperatorResolvedCallable"
  );
  const result = await callable({ tournamentId, matchId });
  return result.data;
}
