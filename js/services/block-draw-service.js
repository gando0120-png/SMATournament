/**
 * ブロック抽選 Firestore 操作（DOM 非依存）
 */
import {
  doc,
  getDoc,
  runTransaction,
  updateDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { getFirebaseDb, isFirebaseConfigured } from "../lib/firebase-app.js";
import { ConfigUnconfiguredError } from "../lib/errors.js";
import {
  BLOCK_DRAW_DOC_ID,
  BlockDrawStatus,
  FINALS_ADVANCEMENT_DOC_ID,
} from "../domain/constants.js";
import { distributeEntriesToBlocks } from "../domain/block-draw.js";
import { validateBlockConfiguration, computeQualifyingAdvancementCounts } from "../domain/block-configuration.js";
import {
  distributeEntriesToFixedBlocks,
  formatBlockDrawValidationMessage,
  validateGeneratedBlockDraw,
} from "../domain/fixed-block-draw.js";
import {
  collectAllEntryIdsFromBlocks,
  detectConfirmedEntryMismatch,
  formatEntryMismatchMessage,
  recalculateDistributionFromBlocks,
  validateEditableBlockDraw,
} from "../domain/block-draw-edit.js";
import { isBlockDrawDraft, isBlockDrawFinalized } from "../domain/block-draw-state.js";
import { usesNewFixedBlockDraw } from "../domain/tournament-format.js";
import { getTournament, requireOpenTournament } from "./tournament-service.js";
import { saveQualifyingSchedule } from "./qualifying-schedule-service.js";
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
export async function getBlockDraw(tournamentId) {
  const db = requireDb();
  const snap = await getDoc(
    doc(db, "tournaments", tournamentId, "blockDraw", BLOCK_DRAW_DOC_ID)
  );
  if (!snap.exists()) {
    return null;
  }
  return { id: snap.id, ...snap.data() };
}

/**
 * @param {object} tournament
 * @param {Array<{ id: string }>} confirmedEntries
 */
function buildNewFormatBlockDraw(tournament, confirmedEntries) {
  const teamCount = confirmedEntries.length;
  const blockCount = tournament.blockCount;
  const qualifiersPerBlock = tournament.qualifiersPerBlock;

  const configValidation = validateBlockConfiguration({
    teamCount,
    blockCount,
    qualifiersPerBlock,
  });

  if (!configValidation.valid) {
    throw Object.assign(
      new Error(
        formatBlockDrawValidationMessage({
          teamCount,
          blockCount,
          qualifiersPerBlock,
          validation: configValidation,
        })
      ),
      { code: "block-draw/invalid-configuration" }
    );
  }

  const drawResult = distributeEntriesToFixedBlocks({
    entries: confirmedEntries,
    blockCount,
  });

  const drawValidation = validateGeneratedBlockDraw({
    entries: confirmedEntries,
    blocks: drawResult.blocks,
    blockCount: drawResult.blockCount,
    distribution: drawResult.distribution,
  });

  if (!drawValidation.valid) {
    throw Object.assign(new Error(drawValidation.errors[0] ?? "ブロック抽選結果が不正です。"), {
      code: "block-draw/invalid-result",
    });
  }

  return drawResult;
}

/**
 * @param {object} drawResult
 * @param {string} status
 */
function buildNewFormatPayload(drawResult, status) {
  const payload = {
    status,
    blockCount: drawResult.blockCount,
    distribution: drawResult.distribution,
    blocks: drawResult.blocks,
    updatedAt: serverTimestamp(),
  };

  if (status === BlockDrawStatus.DRAFT) {
    payload.createdAt = serverTimestamp();
  } else {
    payload.finalizedAt = serverTimestamp();
  }

  return payload;
}

/**
 * @param {string} tournamentId
 * @param {Array<{ id: string }>} confirmedEntries
 * @param {object} tournament
 */
export async function runBlockDraw(tournamentId, confirmedEntries, tournament) {
  await requireOpenTournament(tournamentId);

  if (confirmedEntries.length === 0) {
    throw Object.assign(new Error("参加承認済みのチームがありません。"), {
      code: "block-draw/no-confirmed-entries",
    });
  }

  const db = requireDb();
  const drawRef = doc(db, "tournaments", tournamentId, "blockDraw", BLOCK_DRAW_DOC_ID);

  if (usesNewFixedBlockDraw(tournament)) {
    const drawResult = buildNewFormatBlockDraw(tournament, confirmedEntries);
    const payload = buildNewFormatPayload(drawResult, BlockDrawStatus.DRAFT);

    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(drawRef);
      if (snap.exists()) {
        throw Object.assign(new Error("ブロック抽選はすでに存在します。再抽選を利用してください。"), {
          code: "block-draw/already-exists",
        });
      }
      transaction.set(drawRef, payload);
    });
  } else {
    const preferredBlockSize = tournament.preferredBlockSize;
    const drawResult = distributeEntriesToBlocks(confirmedEntries, preferredBlockSize);
    const payload = {
      preferredBlockSize: drawResult.preferredBlockSize,
      blockCount: drawResult.blockCount,
      blocks: drawResult.blocks,
      updatedAt: serverTimestamp(),
    };

    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(drawRef);
      if (snap.exists()) {
        throw Object.assign(new Error("ブロック抽選はすでに確定済みです。"), {
          code: "block-draw/already-finalized",
        });
      }
      transaction.set(drawRef, payload);
    });
  }

  const saved = await getDoc(drawRef);
  return withPublicSnapshotRebuild(tournamentId, { id: saved.id, ...saved.data() });
}

/**
 * @param {string} tournamentId
 * @param {Array<{ id: string }>} confirmedEntries
 * @param {object} tournament
 */
export async function redrawBlockDrawDraft(tournamentId, confirmedEntries, tournament) {
  await requireOpenTournament(tournamentId);

  if (!usesNewFixedBlockDraw(tournament)) {
    throw Object.assign(new Error("再抽選は新形式大会のみ利用できます。"), {
      code: "block-draw/not-editable",
    });
  }

  if (confirmedEntries.length === 0) {
    throw Object.assign(new Error("参加承認済みのチームがありません。"), {
      code: "block-draw/no-confirmed-entries",
    });
  }

  const drawResult = buildNewFormatBlockDraw(tournament, confirmedEntries);
  const db = requireDb();
  const drawRef = doc(db, "tournaments", tournamentId, "blockDraw", BLOCK_DRAW_DOC_ID);

  await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(drawRef);
    if (!snap.exists() || snap.data().status !== BlockDrawStatus.DRAFT) {
      throw Object.assign(new Error("再抽選できる draft が存在しません。"), {
        code: "block-draw/not-draft",
      });
    }

    transaction.update(drawRef, {
      blocks: drawResult.blocks,
      distribution: drawResult.distribution,
      updatedAt: serverTimestamp(),
    });
  });

  const saved = await getDoc(drawRef);
  return withPublicSnapshotRebuild(tournamentId, { id: saved.id, ...saved.data() });
}

/**
 * @param {string} tournamentId
 * @param {Array<{ id: string, entryIds: string[] }>} blocks
 * @param {object} tournament
 * @param {Array<{ id: string }>} confirmedEntries
 */
export async function updateBlockDrawDraftBlocks(
  tournamentId,
  blocks,
  tournament,
  confirmedEntries
) {
  await requireOpenTournament(tournamentId);

  const confirmedEntryIds = confirmedEntries.map((entry) => entry.id);
  const validation = validateEditableBlockDraw({
    confirmedEntryIds,
    blocks,
    expectedBlockCount: tournament.blockCount,
  });

  if (!validation.valid) {
    throw Object.assign(new Error(validation.errors[0] ?? "配置が不正です。"), {
      code: "block-draw/invalid-edit",
      validation,
    });
  }

  const db = requireDb();
  const drawRef = doc(db, "tournaments", tournamentId, "blockDraw", BLOCK_DRAW_DOC_ID);
  const existing = await getBlockDraw(tournamentId);

  if (!isBlockDrawDraft(existing)) {
    throw Object.assign(new Error("編集できる draft が存在しません。"), {
      code: "block-draw/not-editable",
    });
  }

  const distribution = recalculateDistributionFromBlocks(blocks, existing.distribution || {});

  await updateDoc(drawRef, {
    blocks,
    distribution,
    updatedAt: serverTimestamp(),
  });

  const saved = await getDoc(drawRef);
  return withPublicSnapshotRebuild(tournamentId, { id: saved.id, ...saved.data() });
}

/**
 * @param {string} tournamentId
 * @param {object} tournament
 * @param {Array<{ id: string, teamName?: string }>} confirmedEntries
 * @param {{ skipImbalanceConfirm?: boolean }} [options]
 */
export async function finalizeBlockDraw(tournamentId, tournament, confirmedEntries, options = {}) {
  await requireOpenTournament(tournamentId);

  const existing = await getBlockDraw(tournamentId);
  if (!isBlockDrawDraft(existing)) {
    throw Object.assign(new Error("確定できる draft が存在しません。"), {
      code: "block-draw/not-editable",
    });
  }

  const confirmedEntryIds = confirmedEntries.map((entry) => entry.id);
  const draftEntryIds = collectAllEntryIdsFromBlocks(existing.blocks);
  const mismatch = detectConfirmedEntryMismatch(draftEntryIds, confirmedEntries);

  if (!mismatch.matches) {
    const entryLookup = new Map(confirmedEntries.map((entry) => [entry.id, entry]));
    for (const entryId of mismatch.removedIds) {
      if (!entryLookup.has(entryId)) {
        entryLookup.set(entryId, { teamName: entryId });
      }
    }
    throw Object.assign(new Error(formatEntryMismatchMessage(mismatch, entryLookup)), {
      code: "block-draw/entry-mismatch",
      mismatch,
    });
  }

  const validation = validateEditableBlockDraw({
    confirmedEntryIds,
    blocks: existing.blocks,
    expectedBlockCount: tournament.blockCount,
  });

  if (!validation.valid) {
    throw Object.assign(new Error(validation.errors[0] ?? "配置が不正です。"), {
      code: "block-draw/invalid-edit",
      validation,
    });
  }

  if (!options.skipImbalanceConfirm && validation.warnings.length > 0) {
    throw Object.assign(new Error("人数差の確認が必要です。"), {
      code: "block-draw/warnings-pending",
      validation,
    });
  }

  const distribution = recalculateDistributionFromBlocks(existing.blocks, existing.distribution || {});
  const db = requireDb();
  const drawRef = doc(db, "tournaments", tournamentId, "blockDraw", BLOCK_DRAW_DOC_ID);

  await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(drawRef);
    if (!snap.exists() || snap.data().status !== BlockDrawStatus.DRAFT) {
      throw Object.assign(new Error("確定できる draft が存在しません。"), {
        code: "block-draw/not-editable",
      });
    }

    transaction.update(drawRef, {
      status: BlockDrawStatus.FINALIZED,
      blocks: existing.blocks,
      distribution,
      finalizedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });

  let schedule = null;
  try {
    schedule = await saveQualifyingSchedule(tournamentId);
  } catch (error) {
    if (error.code !== "qualifying-schedule/already-finalized") {
      throw error;
    }
    schedule = null;
  }

  const saved = await getBlockDraw(tournamentId);
  return withPublicSnapshotRebuild(tournamentId, { blockDraw: saved, schedule });
}

/**
 * @param {string} tournamentId
 * @param {number} newBlockCount
 * @param {number} confirmedTeamCount
 */
export async function changeBlockCountDiscardingDraft(
  tournamentId,
  newBlockCount,
  confirmedTeamCount,
  qualifiersPerBlock,
  finalTeamCount = null
) {
  await requireOpenTournament(tournamentId);

  const tournament = await getTournament(tournamentId);
  const blockDraw = await getBlockDraw(tournamentId);

  if (blockDraw && !isBlockDrawDraft(blockDraw)) {
    throw Object.assign(new Error("ブロック抽選確定後はブロック数を変更できません。"), {
      code: "block-draw/not-editable",
    });
  }

  const resolvedFinalTeamCount =
    finalTeamCount ??
    tournament.finalTeamCount ??
    newBlockCount * qualifiersPerBlock;

  const configValidation = validateBlockConfiguration({
    teamCount: confirmedTeamCount,
    blockCount: newBlockCount,
    qualifiersPerBlock,
  });

  if (!configValidation.valid) {
    throw Object.assign(new Error(configValidation.errors[0] ?? "ブロック設定が不正です。"), {
      code: "block-draw/invalid-configuration",
    });
  }

  const advancement = computeQualifyingAdvancementCounts({
    blockCount: newBlockCount,
    qualifiersPerBlock,
    finalTeamCount: resolvedFinalTeamCount,
    teamCount: Math.max(confirmedTeamCount, tournament.maxTeams ?? 0),
  });
  if (!advancement.valid) {
    throw Object.assign(new Error(advancement.errors[0] ?? "決勝枠の設定が不正です。"), {
      code: "block-draw/invalid-configuration",
    });
  }

  const db = requireDb();
  const tournamentRef = doc(db, "tournaments", tournamentId);
  const drawRef = doc(db, "tournaments", tournamentId, "blockDraw", BLOCK_DRAW_DOC_ID);

  await runTransaction(db, async (transaction) => {
    const drawSnap = await transaction.get(drawRef);
    if (drawSnap.exists() && drawSnap.data().status !== BlockDrawStatus.DRAFT) {
      throw Object.assign(new Error("ブロック抽選確定後はブロック数を変更できません。"), {
        code: "block-draw/not-editable",
      });
    }

    if (drawSnap.exists()) {
      transaction.delete(drawRef);
    }

    transaction.update(tournamentRef, {
      blockCount: newBlockCount,
      qualifiersPerBlock,
      finalTeamCount: resolvedFinalTeamCount,
      updatedAt: serverTimestamp(),
    });
  });

  const updated = await getTournament(tournamentId);
  return withPublicSnapshotRebuild(tournamentId, updated);
}

/**
 * @param {string} tournamentId
 * @param {number} qualifiersPerBlock
 * @param {number} confirmedTeamCount
 * @param {number} blockCount
 * @param {number|null} [finalTeamCount]
 */
export async function updateQualifiersPerBlockSetting(
  tournamentId,
  qualifiersPerBlock,
  confirmedTeamCount,
  blockCount,
  finalTeamCount = null
) {
  await requireOpenTournament(tournamentId);

  const tournament = await getTournament(tournamentId);
  const blockDraw = await getBlockDraw(tournamentId);
  if (isBlockDrawFinalized(blockDraw)) {
    throw Object.assign(new Error("ブロック抽選確定後は通過数を変更できません。"), {
      code: "block-draw/not-editable",
    });
  }

  const resolvedFinalTeamCount =
    finalTeamCount ??
    tournament.finalTeamCount ??
    blockCount * qualifiersPerBlock;

  const configValidation = validateBlockConfiguration({
    teamCount: confirmedTeamCount,
    blockCount,
    qualifiersPerBlock,
  });

  if (!configValidation.valid) {
    throw Object.assign(new Error(configValidation.errors[0] ?? "ブロック設定が不正です。"), {
      code: "block-draw/invalid-configuration",
    });
  }

  const advancement = computeQualifyingAdvancementCounts({
    blockCount,
    qualifiersPerBlock,
    finalTeamCount: resolvedFinalTeamCount,
    teamCount: Math.max(confirmedTeamCount, tournament.maxTeams ?? 0),
  });
  if (!advancement.valid) {
    throw Object.assign(new Error(advancement.errors[0] ?? "決勝枠の設定が不正です。"), {
      code: "block-draw/invalid-configuration",
    });
  }

  const db = requireDb();
  const tournamentRef = doc(db, "tournaments", tournamentId);
  await updateDoc(tournamentRef, {
    qualifiersPerBlock,
    finalTeamCount: resolvedFinalTeamCount,
    updatedAt: serverTimestamp(),
  });

  const updated = await getTournament(tournamentId);
  return withPublicSnapshotRebuild(tournamentId, updated);
}

/**
 * ブロック確定後でも、決勝進出確定前なら決勝枠のみ変更可
 * @param {string} tournamentId
 * @param {number} finalTeamCount
 * @param {number} confirmedTeamCount
 */
export async function updateFinalTeamCountSetting(
  tournamentId,
  finalTeamCount,
  confirmedTeamCount
) {
  await requireOpenTournament(tournamentId);

  const tournament = await getTournament(tournamentId);
  const db = requireDb();
  const advancementSnap = await getDoc(
    doc(db, "tournaments", tournamentId, "finalsAdvancement", FINALS_ADVANCEMENT_DOC_ID)
  );
  if (advancementSnap.exists()) {
    throw Object.assign(new Error("決勝進出確定後は決勝トーナメント枠数を変更できません。"), {
      code: "block-draw/not-editable",
    });
  }

  const blockCount = tournament.blockCount;
  const qualifiersPerBlock = tournament.qualifiersPerBlock;
  const advancement = computeQualifyingAdvancementCounts({
    blockCount,
    qualifiersPerBlock,
    finalTeamCount,
    teamCount: Math.max(confirmedTeamCount, tournament.maxTeams ?? 0),
  });
  if (!advancement.valid) {
    throw Object.assign(new Error(advancement.errors[0] ?? "決勝枠の設定が不正です。"), {
      code: "block-draw/invalid-configuration",
    });
  }

  const tournamentRef = doc(db, "tournaments", tournamentId);
  await updateDoc(tournamentRef, {
    finalTeamCount,
    updatedAt: serverTimestamp(),
  });

  const updated = await getTournament(tournamentId);
  return withPublicSnapshotRebuild(tournamentId, updated);
}

export { isBlockDrawDraft, isBlockDrawFinalized };
