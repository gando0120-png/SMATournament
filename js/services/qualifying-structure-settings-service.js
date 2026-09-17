/**
 * 抽選確定前の予選構成更新（DOM 非依存）
 *
 * blockDraw / qualifyingSchedules は変更しない（draft がある場合は先に削除する）。
 * 通常の大会設定更新とは別経路。
 */
import {
  doc,
  getDoc,
  deleteDoc,
  updateDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { getFirebaseDb, isFirebaseConfigured } from "../lib/firebase-app.js";
import { ConfigUnconfiguredError } from "../lib/errors.js";
import { BLOCK_DRAW_DOC_ID } from "../domain/constants.js";
import { isBlockDrawDraft, isBlockDrawFinalized } from "../domain/block-draw-state.js";
import {
  QUALIFYING_STRUCTURE_SETTINGS_DRAFT_REMAINING_CODE,
  assertQualifyingStructureSettingsEditable,
  assessQualifyingStructureSettingsEditEligibility,
  buildQualifyingStructureSettingsUpdateFields,
  qualifyingStructureChangeRequiresDraftDiscard,
} from "../domain/qualifying-structure-settings-edit.js";
import { getTournament, requireOpenTournament } from "./tournament-service.js";
import { getBlockDraw } from "./block-draw-service.js";
import { getQualifyingSchedule } from "./qualifying-schedule-service.js";
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

function blockDrawRef(tournamentId) {
  return doc(requireDb(), "tournaments", tournamentId, "blockDraw", BLOCK_DRAW_DOC_ID);
}

/**
 * @param {string} tournamentId
 */
export async function loadQualifyingStructureSettingsEditContext(tournamentId) {
  const [
    tournament,
    blockDraw,
    qualifyingSchedule,
    qualifyingMatchResults,
    qualifyingMatchSessions,
    finalsAdvancement,
    finalsBracket,
    consolationBracket,
  ] = await Promise.all([
    getTournament(tournamentId),
    getBlockDraw(tournamentId),
    getQualifyingSchedule(tournamentId),
    getQualifyingMatchResults(tournamentId),
    getQualifyingMatchSessions(tournamentId),
    getFinalsAdvancement(tournamentId),
    getFinalsBracket(tournamentId),
    getConsolationBracket(tournamentId),
  ]);

  return {
    tournament,
    blockDraw,
    qualifyingSchedule,
    qualifyingMatchResults,
    qualifyingMatchSessions,
    finalsAdvancement,
    finalsBracket,
    consolationBracket,
  };
}

/**
 * draft の blockDraw だけ削除する。finalized は削除しない。
 * @param {string} tournamentId
 */
export async function deleteBlockDrawDraftIfPresent(tournamentId) {
  const existing = await getBlockDraw(tournamentId);
  if (!existing) {
    return null;
  }
  if (isBlockDrawFinalized(existing) || !isBlockDrawDraft(existing)) {
    const error = new Error("抽選確定後はブロック数を変更できません。");
    error.code = "block-draw/not-editable";
    throw error;
  }

  await deleteDoc(blockDrawRef(tournamentId));

  const remaining = await getBlockDraw(tournamentId);
  if (remaining) {
    const error = new Error("抽選案を破棄できませんでした。");
    error.code = QUALIFYING_STRUCTURE_SETTINGS_DRAFT_REMAINING_CODE;
    throw error;
  }
  return existing;
}

/**
 * 抽選確定前に予選構成だけを更新する。
 *
 * @param {string} tournamentId
 * @param {object} params
 * @param {number} params.blockCount
 * @param {number} params.qualifiersPerBlock
 * @param {number} params.finalTeamCount
 * @param {number} params.confirmedTeamCount
 * @param {string|null} [params.wildcardComparisonMode]
 */
export async function updateQualifyingStructureSettingsBeforeDrawFinalize(
  tournamentId,
  {
    blockCount,
    qualifiersPerBlock,
    finalTeamCount,
    confirmedTeamCount,
    wildcardComparisonMode = null,
  } = {}
) {
  await requireOpenTournament(tournamentId);

  const context = await loadQualifyingStructureSettingsEditContext(tournamentId);
  const eligibility = assessQualifyingStructureSettingsEditEligibility(context);
  assertQualifyingStructureSettingsEditable(eligibility);

  const built = buildQualifyingStructureSettingsUpdateFields({
    tournament: context.tournament,
    blockCount,
    qualifiersPerBlock,
    finalTeamCount,
    wildcardComparisonMode,
    confirmedTeamCount,
  });

  if (qualifyingStructureChangeRequiresDraftDiscard(context.blockDraw)) {
    await deleteBlockDrawDraftIfPresent(tournamentId);
  }

  const remainingDraw = await getBlockDraw(tournamentId);
  if (remainingDraw) {
    const error = new Error("抽選案が残っているため大会構成を更新できません。");
    error.code = QUALIFYING_STRUCTURE_SETTINGS_DRAFT_REMAINING_CODE;
    throw error;
  }

  if (Object.keys(built.fields).length === 0) {
    return withPublicSnapshotRebuild(tournamentId, context.tournament);
  }

  const tournamentRef = doc(requireDb(), "tournaments", tournamentId);
  await updateDoc(tournamentRef, {
    ...built.fields,
    updatedAt: serverTimestamp(),
  });

  const updated = await getTournament(tournamentId);
  return withPublicSnapshotRebuild(tournamentId, updated);
}
