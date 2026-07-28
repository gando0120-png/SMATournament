/**
 * 決勝トーナメント表 Firestore 操作（DOM 非依存）
 */
import {
  doc,
  getDoc,
  getDocFromServer,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { getFirebaseDb, isFirebaseConfigured } from "../lib/firebase-app.js";
import { ConfigUnconfiguredError } from "../lib/errors.js";
import { FINALS_ADVANCEMENT_DOC_ID, FINALS_BRACKET_DOC_ID } from "../domain/constants.js";
import {
  buildFinalsBracketFromAdvancement,
  buildPersistedFinalsBracket,
  needsFinalsBracketTeamDataRepair,
} from "../domain/finals-bracket.js";
import {
  enrichFixedBlockQualifiersForBracket,
  needsFixedBlockQualifierEnrichment,
} from "../domain/fixed-block-finals-advancement.js";
import { FinalsAdvancementMode } from "../domain/constants.js";
import { getFinalsAdvancement } from "./finals-advancement-service.js";
import { getFinalsMatchResults } from "./finals-match-result-service.js";
import { listEntries } from "./entry-service.js";
import { getBlockDraw } from "./block-draw-service.js";
import { requireOpenTournament } from "./tournament-service.js";
import { withPublicSnapshotRebuild } from "../lib/public-snapshot-hook.js";

async function resolveAdvancementForBracket(tournamentId, advancement) {
  if (
    advancement?.mode !== FinalsAdvancementMode.FIXED_BLOCK_QUALIFIERS ||
    !needsFixedBlockQualifierEnrichment(advancement.qualifiers)
  ) {
    return advancement;
  }

  const [entries, blockDraw] = await Promise.all([
    listEntries(tournamentId),
    getBlockDraw(tournamentId),
  ]);
  const qualifiers = enrichFixedBlockQualifiersForBracket(advancement.qualifiers, {
    entries,
    blockDraw,
  });

  return {
    ...advancement,
    qualifiers,
  };
}

/**
 * ブラケット生成・表示用に advancement qualifiers を補完（Firestore 更新は行わない）
 * @param {string} tournamentId
 * @param {object|null|undefined} advancement
 */
export async function resolveFinalsAdvancementForBracketBuild(tournamentId, advancement) {
  if (!advancement) {
    return null;
  }
  return resolveAdvancementForBracket(tournamentId, advancement);
}

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
 * @param {{ source?: 'default' | 'server' }} [options]
 */
export async function getFinalsBracket(tournamentId, options = {}) {
  const db = requireDb();
  const ref = doc(
    db,
    "tournaments",
    tournamentId,
    "finalsBracket",
    FINALS_BRACKET_DOC_ID
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
export async function previewFinalsBracket(tournamentId) {
  const advancement = await getFinalsAdvancement(tournamentId);
  if (!advancement) {
    const error = new Error("Finals advancement not found");
    error.code = "finals-bracket/no-advancement";
    throw error;
  }

  if (!advancement.finalized) {
    const error = new Error("Finals advancement not finalized");
    error.code = "finals-bracket/advancement-not-finalized";
    throw error;
  }

  const resolvedAdvancement = await resolveAdvancementForBracket(tournamentId, advancement);
  const bracketResult = buildFinalsBracketFromAdvancement(resolvedAdvancement);

  return {
    ...bracketResult,
    advancement: resolvedAdvancement,
  };
}

/**
 * @param {string} tournamentId
 */
export async function saveFinalsBracket(tournamentId) {
  await requireOpenTournament(tournamentId);
  const existing = await getFinalsBracket(tournamentId);
  if (existing?.finalized) {
    const needsRepair = needsFinalsBracketTeamDataRepair(existing);
    if (!needsRepair) {
      const error = new Error("Finals bracket already finalized");
      error.code = "finals-bracket/already-finalized";
      throw error;
    }

    const resultsMap = await getFinalsMatchResults(tournamentId);
    if (resultsMap.size > 0) {
      const error = new Error("Finals bracket already finalized");
      error.code = "finals-bracket/already-finalized";
      throw error;
    }
  }

  const preview = await previewFinalsBracket(tournamentId);
  if (!preview.canFinalize || !preview.bracket) {
    const error = new Error(preview.message || "Cannot finalize finals bracket");
    error.code = "finals-bracket/invalid-qualifiers";
    throw error;
  }

  const payload = {
    ...buildPersistedFinalsBracket(preview),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const db = requireDb();
  await setDoc(
    doc(db, "tournaments", tournamentId, "finalsBracket", FINALS_BRACKET_DOC_ID),
    payload
  );

  const advancementSnap = await getDoc(
    doc(db, "tournaments", tournamentId, "finalsAdvancement", FINALS_ADVANCEMENT_DOC_ID)
  );
  if (!advancementSnap.exists()) {
    const error = new Error("Finals advancement missing at save time");
    error.code = "finals-bracket/no-advancement";
    throw error;
  }

  const bracket = await getFinalsBracket(tournamentId);
  return withPublicSnapshotRebuild(tournamentId, bracket);
}
