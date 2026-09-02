/**
 * 抽選確定後・予選開始前の決勝進出条件更新（DOM 非依存）
 *
 * blockDraw / qualifyingSchedules / blockCount は変更しない。
 */
import {
  doc,
  updateDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { getFirebaseDb, isFirebaseConfigured } from "../lib/firebase-app.js";
import { ConfigUnconfiguredError } from "../lib/errors.js";
import {
  assessFinalsAdvancementSettingsEditEligibility,
  assertFinalsAdvancementSettingsEditable,
  buildFinalsAdvancementSettingsUpdateFields,
} from "../domain/finals-advancement-settings-edit.js";
import { getTournament, requireOpenTournament } from "./tournament-service.js";
import { getBlockDraw } from "./block-draw-service.js";
import { getQualifyingMatchResults } from "./qualifying-match-result-service.js";
import { getQualifyingMatchSessions } from "./qualifying-match-session-service.js";
import { getFinalsAdvancement } from "./finals-advancement-service.js";
import { getFinalsBracket } from "./finals-bracket-service.js";
import { getConsolationBracket } from "./consolation-bracket-service.js";
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

/**
 * @param {string} tournamentId
 */
export async function loadFinalsAdvancementSettingsEditContext(tournamentId) {
  const [tournament, blockDraw, qualifyingMatchResults, qualifyingMatchSessions, finalsAdvancement, finalsBracket, consolationBracket] =
    await Promise.all([
      getTournament(tournamentId),
      getBlockDraw(tournamentId),
      getQualifyingMatchResults(tournamentId),
      getQualifyingMatchSessions(tournamentId),
      getFinalsAdvancement(tournamentId),
      getFinalsBracket(tournamentId),
      getConsolationBracket(tournamentId),
    ]);

  return {
    tournament,
    blockDraw,
    qualifyingMatchResults,
    qualifyingMatchSessions,
    finalsAdvancement,
    finalsBracket,
    consolationBracket,
  };
}

/**
 * 抽選確定後・予選開始前に進出条件だけを更新する。
 *
 * @param {string} tournamentId
 * @param {number} qualifiersPerBlock
 * @param {number} confirmedTeamCount
 * @param {number} finalTeamCount
 * @param {string|null} [wildcardComparisonMode]
 */
export async function updateFinalsAdvancementSettingsBeforeQualifyingStart(
  tournamentId,
  qualifiersPerBlock,
  confirmedTeamCount,
  finalTeamCount,
  wildcardComparisonMode = null
) {
  await requireOpenTournament(tournamentId);

  const context = await loadFinalsAdvancementSettingsEditContext(tournamentId);
  const eligibility = assessFinalsAdvancementSettingsEditEligibility(context);
  assertFinalsAdvancementSettingsEditable(eligibility);

  const built = buildFinalsAdvancementSettingsUpdateFields({
    tournament: context.tournament,
    qualifiersPerBlock,
    finalTeamCount,
    wildcardComparisonMode,
    confirmedTeamCount,
  });

  if (Object.keys(built.fields).length === 0) {
    return withPublicSnapshotRebuild(tournamentId, context.tournament);
  }

  const db = requireDb();
  const tournamentRef = doc(db, "tournaments", tournamentId);
  await updateDoc(tournamentRef, {
    ...built.fields,
    updatedAt: serverTimestamp(),
  });

  const updated = await getTournament(tournamentId);
  return withPublicSnapshotRebuild(tournamentId, updated);
}
