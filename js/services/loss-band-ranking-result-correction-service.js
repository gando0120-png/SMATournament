/**
 * loss-band ranking 結果修正 callable クライアント
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
 * @param {string} matchId
 * @param {object} scoreInput
 * @param {{
 *   winsRequired?: number,
 *   expectedRevision?: number|null,
 * }} [options]
 */
export async function correctLossBandRankingResult(
  tournamentId,
  matchId,
  scoreInput,
  options = {}
) {
  const callable = httpsCallable(
    requireFunctions(),
    "correctLossBandRankingResultCallable"
  );
  const result = await callable({
    tournamentId,
    matchId,
    ...scoreInput,
    winsRequired: options.winsRequired,
    expectedRevision: options.expectedRevision ?? null,
  });
  return result.data;
}
