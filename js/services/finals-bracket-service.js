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
  buildPersistedFinalsBracket,
  needsFinalsBracketTeamDataRepair,
} from "../domain/finals-bracket.js";
import { buildMainBracketFromAdvancement } from "../domain/finals-bracket-from-config.js";
import { assessFinalsBracketRegeneration } from "../domain/finals-bracket-regeneration.js";
import {
  enrichFixedBlockQualifiersForBracket,
  needsFixedBlockQualifierEnrichment,
} from "../domain/fixed-block-finals-advancement.js";
import { FinalsAdvancementMode } from "../domain/constants.js";
import { getFinalsAdvancement } from "./finals-advancement-service.js";
import {
  deleteByeOnlyFinalsMatchResults,
  getFinalsMatchResults,
} from "./finals-match-result-service.js";
import { getFinalsMatchSessions } from "./finals-match-session-service.js";
import { getConsolationBracket } from "./consolation-bracket-service.js";
import { listEntries } from "./entry-service.js";
import { getBlockDraw } from "./block-draw-service.js";
import { getTournament, requireOpenTournament } from "./tournament-service.js";
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
  const [advancement, tournament] = await Promise.all([
    getFinalsAdvancement(tournamentId),
    getTournament(tournamentId),
  ]);
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
  const bracketResult = buildMainBracketFromAdvancement(
    resolvedAdvancement,
    tournament
  );

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

/**
 * UI 表示用: 再生成可否をサーバー最新データで評価
 * @param {string} tournamentId
 */
export async function assessFinalsBracketRegenerationEligibility(tournamentId) {
  const tournament = await getTournament(tournamentId);
  const [bracket, resultsMap, sessionsMap, consolationBracket] = await Promise.all([
    getFinalsBracket(tournamentId, { source: "server" }),
    getFinalsMatchResults(tournamentId),
    getFinalsMatchSessions(tournamentId),
    getConsolationBracket(tournamentId, { source: "server" }),
  ]);

  return assessFinalsBracketRegeneration({
    tournament,
    bracket,
    resultsMap,
    sessionsMap,
    consolationBracket,
  });
}

/**
 * 決勝トーナメント再生成（進出者は変更しない）
 * @param {string} tournamentId
 * @param {{ random?: () => number }} [options]
 */
export async function regenerateFinalsBracket(tournamentId, options = {}) {
  const tournament = await requireOpenTournament(tournamentId);

  const [existing, resultsMap, sessionsMap, consolationBracket] = await Promise.all([
    getFinalsBracket(tournamentId, { source: "server" }),
    getFinalsMatchResults(tournamentId),
    getFinalsMatchSessions(tournamentId),
    getConsolationBracket(tournamentId, { source: "server" }),
  ]);

  const assessment = assessFinalsBracketRegeneration({
    tournament,
    bracket: existing,
    resultsMap,
    sessionsMap,
    consolationBracket,
  });

  if (!assessment.canRegenerate) {
    const error = new Error(assessment.message || "Cannot regenerate finals bracket");
    error.code = "finals-bracket/cannot-regenerate";
    error.reasonCode = assessment.reasonCode;
    throw error;
  }

  // 直前競合: 評価直後にもう一度サーバーから結果・セッションを確認
  const [latestResults, latestSessions] = await Promise.all([
    getFinalsMatchResults(tournamentId),
    getFinalsMatchSessions(tournamentId),
  ]);
  const recheck = assessFinalsBracketRegeneration({
    tournament,
    bracket: existing,
    resultsMap: latestResults,
    sessionsMap: latestSessions,
    consolationBracket,
  });
  if (!recheck.canRegenerate) {
    const error = new Error(recheck.message || "Cannot regenerate finals bracket");
    error.code = "finals-bracket/cannot-regenerate";
    error.reasonCode = recheck.reasonCode;
    throw error;
  }

  const advancement = await getFinalsAdvancement(tournamentId);
  if (!advancement?.finalized) {
    const error = new Error("Finals advancement not finalized");
    error.code = "finals-bracket/advancement-not-finalized";
    throw error;
  }

  const resolvedAdvancement = await resolveAdvancementForBracket(tournamentId, advancement);
  const preview = buildMainBracketFromAdvancement(resolvedAdvancement, tournament, {
    random: options.random ?? Math.random,
    regenerate: true,
  });

  if (!preview.canFinalize || !preview.bracket) {
    const error = new Error(preview.message || "Cannot regenerate finals bracket");
    error.code = "finals-bracket/invalid-qualifiers";
    throw error;
  }

  // BYE 自動結果のみ残っている場合は掃除（played は canRegenerate で拒否済み）
  await deleteByeOnlyFinalsMatchResults(tournamentId);

  const payload = {
    ...buildPersistedFinalsBracket(preview),
    createdAt: existing.createdAt ?? serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const db = requireDb();
  await setDoc(
    doc(db, "tournaments", tournamentId, "finalsBracket", FINALS_BRACKET_DOC_ID),
    payload
  );

  const bracket = await getFinalsBracket(tournamentId, { source: "server" });
  return withPublicSnapshotRebuild(tournamentId, {
    ...bracket,
    regeneration: {
      byeResultsCleared: recheck.byeResultCount,
      reasonCode: assessment.reasonCode,
    },
  });
}
