/**
 * 下位トーナメント bracket Firestore 操作（DOM 非依存）
 */
import {
  doc,
  getDoc,
  getDocFromServer,
  writeBatch,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { getFirebaseDb, isFirebaseConfigured } from "../lib/firebase-app.js";
import { ConfigUnconfiguredError } from "../lib/errors.js";
import { CONSOLATION_BRACKET_DOC_ID } from "../domain/constants.js";
import {
  buildConsolationBracket,
  buildPersistedConsolationBracket,
  validateConsolationByeResults,
  buildConsolationByeMatchResultPayload,
} from "../domain/consolation-bracket.js";
import { assignConsolationCourtsToBracket } from "../domain/finals-court-assignment.js";
import {
  assessConsolationEligibility,
  buildConsolationParticipants,
  mapConsolationEligibilityToErrorCode,
} from "../domain/consolation-participants.js";
import { listByeMatchesNeedingResults } from "../domain/finals-match-progress.js";
import { getByeWinnerTeam } from "../domain/finals-match-bye.js";
import { ensureFinalsTeamWithSeed } from "../domain/finals-match-result-payload.js";
import { listEntries } from "./entry-service.js";
import { getFinalsAdvancement } from "./finals-advancement-service.js";
import { getFinalsBracket } from "./finals-bracket-service.js";
import { getTournament, requireOpenTournament } from "./tournament-service.js";
import { getTournamentResults } from "./tournament-results-service.js";
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

function throwIfNotEligible(eligibility) {
  if (eligibility.eligible) {
    return;
  }

  const error = new Error("Cannot create consolation bracket");
  error.code = mapConsolationEligibilityToErrorCode(eligibility);
  error.reasonCode = eligibility.reasonCode;
  throw error;
}

/**
 * @param {string} tournamentId
 * @param {{ source?: 'default' | 'server' }} [options]
 */
export async function getConsolationBracket(tournamentId, options = {}) {
  const db = requireDb();
  const ref = doc(
    db,
    "tournaments",
    tournamentId,
    "consolationBracket",
    CONSOLATION_BRACKET_DOC_ID
  );
  const snap =
    options.source === "server" ? await getDocFromServer(ref) : await getDoc(ref);
  if (!snap.exists()) {
    return null;
  }
  return { id: snap.id, ...snap.data() };
}

/**
 * @param {string} tournamentId
 */
export async function loadConsolationBracketCreationContext(tournamentId) {
  const [
    tournament,
    entries,
    advancement,
    mainBracket,
    tournamentResults,
    consolationBracket,
  ] = await Promise.all([
    getTournament(tournamentId),
    listEntries(tournamentId),
    getFinalsAdvancement(tournamentId),
    getFinalsBracket(tournamentId, { source: "server" }),
    getTournamentResults(tournamentId),
    getConsolationBracket(tournamentId, { source: "server" }),
  ]);

  const participants = buildConsolationParticipants(entries, advancement);
  const eligibility = assessConsolationEligibility({
    tournament,
    entries,
    advancement,
    mainBracket,
    tournamentResults,
    consolationBracket,
  });

  return {
    tournament,
    entries,
    advancement,
    mainBracket,
    tournamentResults,
    consolationBracket,
    participants,
    eligibility,
  };
}

/**
 * @param {string} tournamentId
 * @param {{ random?: () => number }} [options]
 */
export async function createConsolationBracket(tournamentId, options = {}) {
  await requireOpenTournament(tournamentId);

  const context = await loadConsolationBracketCreationContext(tournamentId);
  throwIfNotEligible(context.eligibility);

  const preview = buildConsolationBracket(context.participants, {
    random: options.random,
  });

  if (!preview.valid || !preview.canFinalize || !preview.bracket) {
    const error = new Error(preview.message || "Cannot build consolation bracket");
    error.code = "consolation-bracket/invalid-participants";
    throw error;
  }

  const bracketWithCourts = assignConsolationCourtsToBracket(preview.bracket, {
    mainBracket: context.mainBracket,
    tournamentCourtCount: context.tournament?.courtCount,
  });
  const previewWithCourts = {
    ...preview,
    bracket: bracketWithCourts,
  };

  const byeValidation = validateConsolationByeResults(previewWithCourts.bracket);
  if (!byeValidation.valid) {
    const error = new Error(byeValidation.message || "Invalid consolation BYE matches");
    error.code = "consolation-bracket/invalid-bye";
    throw error;
  }

  const db = requireDb();
  const batch = writeBatch(db);

  const bracketRef = doc(
    db,
    "tournaments",
    tournamentId,
    "consolationBracket",
    CONSOLATION_BRACKET_DOC_ID
  );
  batch.set(bracketRef, {
    ...buildPersistedConsolationBracket(previewWithCourts),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  for (const match of listByeMatchesNeedingResults(previewWithCourts.bracket)) {
    const winner = getByeWinnerTeam(match.team1, match.team2);
    const byePayload = buildConsolationByeMatchResultPayload(
      match,
      ensureFinalsTeamWithSeed(winner, match.matchNumber)
    );
    batch.set(
      doc(db, "tournaments", tournamentId, "consolationMatchResults", match.matchId),
      {
        ...byePayload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }
    );
  }

  await batch.commit();

  const bracket = await getConsolationBracket(tournamentId, { source: "server" });
  return withPublicSnapshotRebuild(tournamentId, bracket);
}
