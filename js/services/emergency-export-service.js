/**
 * EmergencyExportV1 読み取り専用サービス（Firestore 書き込みなし）
 */
import {
  collection,
  getDocs,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-functions.js";
import { getFirebaseDb, getFirebaseFunctions, isFirebaseConfigured } from "../lib/firebase-app.js";
import { firebaseConfig } from "../firebase-config.js";
import { ConfigUnconfiguredError, TournamentNotFoundError } from "../lib/errors.js";
import { BracketKind } from "../domain/bracket-collections.js";
import { buildEmergencyExport } from "../domain/emergency-export.js";
import {
  buildEmergencyOpsExcelBytes,
  buildEmergencyOpsExcelFileName,
} from "../domain/emergency-ops-excel.js";
import { getTournament } from "./tournament-service.js";
import { listEntries } from "./entry-service.js";
import { getBlockDraw } from "./block-draw-service.js";
import { getQualifyingSchedule } from "./qualifying-schedule-service.js";
import { getQualifyingMatchResults } from "./qualifying-match-result-service.js";
import { getQualifyingMatchSessions } from "./qualifying-match-session-service.js";
import { getMolkkyOutResolutions } from "./molkky-out-resolution-service.js";
import { getFinalsAdvancement } from "./finals-advancement-service.js";
import { getFinalsBracket } from "./finals-bracket-service.js";
import { getFinalsMatchResults } from "./finals-match-result-service.js";
import { getFinalsMatchSessions } from "./finals-match-session-service.js";
import { getConsolationBracket } from "./consolation-bracket-service.js";
import { getTournamentResults } from "./tournament-results-service.js";
import { getTimeSchedule } from "./time-schedule-service.js";
import {
  getLossBandState,
  getLossBandPlacements,
  listLossBandRounds,
  getLossBandMatchResults,
  getLossBandMatchSessions,
  listLossBandExchangeRounds,
  getLossBandExchangeMatchResults,
  getLossBandExchangeMatchSessions,
} from "./loss-band-service.js";

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

function sanitizeExportFileName(fileName, tournamentId) {
  const fallback = `sma-emergency-export-${tournamentId || "tournament"}.json`;
  const raw = typeof fileName === "string" ? fileName.trim() : "";
  if (!raw) {
    return fallback;
  }
  const base = raw.replace(/^.*[/\\]/, "").replace(/[^\w.\-]+/g, "-");
  return base.toLowerCase().endsWith(".json") ? base : fallback;
}

/**
 * 運営者セッションで本番 Callable から EmergencyExportV1 を取得する。
 * Firestore への書き込みは行わない。
 * @param {string} tournamentId
 */
export async function exportEmergencyTournamentViaCallable(tournamentId) {
  const id = typeof tournamentId === "string" ? tournamentId.trim() : "";
  if (!id) {
    throw new TournamentNotFoundError();
  }

  const callable = httpsCallable(requireFunctions(), "exportEmergencyTournamentCallable");
  const result = await callable({ tournamentId: id });
  const data = result?.data ?? {};
  if (!data.export || typeof data.export !== "object") {
    const error = new Error("非常用データの生成に失敗しました。");
    error.code = "emergency-export/invalid-response";
    throw error;
  }

  return {
    fileName: sanitizeExportFileName(data.fileName, data.tournamentId ?? id),
    contentType:
      typeof data.contentType === "string" && data.contentType.trim()
        ? data.contentType
        : "application/json; charset=utf-8",
    schemaVersion: data.schemaVersion ?? data.export?.exportMeta?.schemaVersion ?? 1,
    tournamentId: data.tournamentId ?? id,
    export: data.export,
  };
}

/**
 * EmergencyExportV1 をブラウザで JSON ファイル保存する。
 * @param {{ fileName?: string, contentType?: string, export: object, tournamentId?: string }} payload
 */

/**
 * EmergencyExportV1 から緊急運営用 Excel をブラウザ保存する（書き込みなし）。
 * @param {{ export: object, tournamentId?: string, fileName?: string }} payload
 */
export function downloadEmergencyOpsExcel(payload) {
  const exportData = payload?.export;
  if (!exportData || typeof exportData !== "object") {
    const error = new Error("緊急運営用Excelの生成に失敗しました。");
    error.code = "emergency-export/invalid-response";
    throw error;
  }
  const tournamentId =
    payload.tournamentId ||
    exportData.exportMeta?.tournamentId ||
    "tournament";
  const fileName =
    typeof payload.fileName === "string" && payload.fileName.trim().toLowerCase().endsWith(".xlsx")
      ? payload.fileName.trim().replace(/^.*[/\\]/, "").replace(/[^\w.\-]+/g, "-")
      : buildEmergencyOpsExcelFileName(tournamentId, exportData.exportMeta?.exportedAt);
  const bytes = buildEmergencyOpsExcelBytes(exportData);
  const blob = new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const objectUrl = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = fileName;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
  return fileName;
}

export function downloadEmergencyExportJson(payload) {
  const exportData = payload?.export;
  if (!exportData || typeof exportData !== "object") {
    const error = new Error("非常用データの生成に失敗しました。");
    error.code = "emergency-export/invalid-response";
    throw error;
  }
  const fileName = sanitizeExportFileName(payload.fileName, payload.tournamentId);
  const json = `${JSON.stringify(exportData, null, 2)}\n`;
  const blob = new Blob([json], {
    type: payload.contentType || "application/json; charset=utf-8",
  });
  const objectUrl = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = fileName;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
  return fileName;
}

async function getCollectionMap(db, tournamentId, collectionId) {
  const snapshot = await getDocs(collection(db, "tournaments", tournamentId, collectionId));
  const map = new Map();
  snapshot.docs.forEach((docSnap) => {
    map.set(docSnap.id, { id: docSnap.id, ...docSnap.data() });
  });
  return map;
}

async function optionalGet(loader) {
  try {
    return await loader();
  } catch {
    return null;
  }
}

/**
 * 指定大会の EmergencyExportV1 を生成する。書き込みは行わない。
 * @param {string} tournamentId
 * @param {{ applicationRevision?: string|null }} [options]
 */
export async function exportEmergencyTournamentJson(tournamentId, options = {}) {
  const id = typeof tournamentId === "string" ? tournamentId.trim() : "";
  if (!id) {
    throw new TournamentNotFoundError();
  }

  const db = requireDb();
  const tournament = await getTournament(id);
  if (!tournament) {
    throw new TournamentNotFoundError();
  }

  const [
    entries,
    blockDraw,
    qualifyingSchedule,
    qualifyingMatchResults,
    qualifyingMatchSessions,
    molkkyOutResolutions,
    finalsAdvancement,
    finalsBracket,
    finalsMatchResults,
    finalsMatchSessions,
    consolationBracket,
    consolationMatchResults,
    consolationMatchSessions,
    tournamentResults,
    timeSchedule,
    lossBandState,
    lossBandRounds,
    lossBandMatchResults,
    lossBandMatchSessions,
    lossBandPlacements,
    lossBandExchangeRounds,
    lossBandExchangeMatchResults,
    lossBandExchangeMatchSessions,
    qualifyingResultSubmissions,
    qualifyingMatchReconciliations,
  ] = await Promise.all([
    listEntries(id),
    optionalGet(() => getBlockDraw(id)),
    optionalGet(() => getQualifyingSchedule(id)),
    optionalGet(() => getQualifyingMatchResults(id)),
    optionalGet(() => getQualifyingMatchSessions(id)),
    optionalGet(() => getMolkkyOutResolutions(id)),
    optionalGet(() => getFinalsAdvancement(id)),
    optionalGet(() => getFinalsBracket(id)),
    optionalGet(() => getFinalsMatchResults(id)),
    optionalGet(() => getFinalsMatchSessions(id)),
    optionalGet(() => getConsolationBracket(id)),
    optionalGet(() => getFinalsMatchResults(id, { bracketKind: BracketKind.CONSOLATION })),
    optionalGet(() => getFinalsMatchSessions(id, { bracketKind: BracketKind.CONSOLATION })),
    optionalGet(() => getTournamentResults(id)),
    optionalGet(() => getTimeSchedule(id)),
    optionalGet(() => getLossBandState(id)),
    optionalGet(() => listLossBandRounds(id)),
    optionalGet(() => getLossBandMatchResults(id)),
    optionalGet(() => getLossBandMatchSessions(id)),
    optionalGet(() => getLossBandPlacements(id)),
    optionalGet(() => listLossBandExchangeRounds(id)),
    optionalGet(() => getLossBandExchangeMatchResults(id)),
    optionalGet(() => getLossBandExchangeMatchSessions(id)),
    getCollectionMap(db, id, "qualifyingResultSubmissions"),
    getCollectionMap(db, id, "qualifyingMatchReconciliations"),
  ]);

  return buildEmergencyExport({
    tournamentId: id,
    projectId: firebaseConfig.projectId ?? null,
    applicationRevision: options.applicationRevision ?? null,
    exportedAt: new Date(),
    tournament,
    entries,
    blockDraw,
    qualifyingSchedule,
    qualifyingMatchResults,
    qualifyingMatchSessions,
    molkkyOutResolutions,
    finalsAdvancement,
    finalsBracket,
    finalsMatchResults,
    finalsMatchSessions,
    consolationBracket,
    consolationMatchResults,
    consolationMatchSessions,
    tournamentResults,
    timeSchedule,
    lossBandState,
    lossBandRounds,
    lossBandMatchResults,
    lossBandMatchSessions,
    lossBandPlacements,
    lossBandExchangeRounds,
    lossBandExchangeMatchResults,
    lossBandExchangeMatchSessions,
    qualifyingResultSubmissions,
    qualifyingMatchReconciliations,
  });
}
