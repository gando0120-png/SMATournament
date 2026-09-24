/**
 * EmergencyExportV1 — 運営者向け読み取り専用エクスポート
 */
import { buildEmergencyExport } from "../vendor/domain/emergency-export.js";
import { assertOperatorEnabled } from "./test-tournament-cleanup.js";

const SINGLETON_DOCS = Object.freeze({
  blockDraw: "current",
  qualifyingSchedules: "current",
  molkkyOutResolutions: "current",
  finalsAdvancement: "current",
  finalsBracket: "current",
  consolationBracket: "current",
  lossBandState: "current",
  lossBandPlacements: "current",
  tournamentResults: "current",
  timeSchedule: "current",
});

function tournamentRef(db, tournamentId) {
  return db.collection("tournaments").doc(tournamentId);
}

async function getSingleton(db, tournamentId, collectionId, docId) {
  const snap = await tournamentRef(db, tournamentId).collection(collectionId).doc(docId).get();
  if (!snap.exists) {
    return null;
  }
  return { id: snap.id, ...snap.data() };
}

async function getCollectionMap(db, tournamentId, collectionId) {
  const snap = await tournamentRef(db, tournamentId).collection(collectionId).get();
  const map = new Map();
  snap.forEach((docSnap) => {
    map.set(docSnap.id, { id: docSnap.id, ...docSnap.data() });
  });
  return map;
}

async function getCollectionList(db, tournamentId, collectionId) {
  const map = await getCollectionMap(db, tournamentId, collectionId);
  return [...map.values()];
}

/**
 * 指定大会の進行データを読み取る。書き込みは行わない。
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} tournamentId
 */
export async function loadEmergencyExportInput(db, tournamentId) {
  const snap = await tournamentRef(db, tournamentId).get();
  if (!snap.exists) {
    const error = new Error("大会が見つかりません。");
    error.code = "not-found";
    throw error;
  }

  const [
    entriesSnap,
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
    lossBandState,
    lossBandRounds,
    lossBandMatchResults,
    lossBandMatchSessions,
    lossBandPlacements,
    lossBandExchangeRounds,
    lossBandExchangeMatchResults,
    lossBandExchangeMatchSessions,
    tournamentResults,
    timeSchedule,
    qualifyingResultSubmissions,
    qualifyingMatchReconciliations,
  ] = await Promise.all([
    tournamentRef(db, tournamentId).collection("entries").get(),
    getSingleton(db, tournamentId, "blockDraw", SINGLETON_DOCS.blockDraw),
    getSingleton(db, tournamentId, "qualifyingSchedules", SINGLETON_DOCS.qualifyingSchedules),
    getCollectionMap(db, tournamentId, "qualifyingMatchResults"),
    getCollectionMap(db, tournamentId, "qualifyingMatchSessions"),
    getSingleton(db, tournamentId, "molkkyOutResolutions", SINGLETON_DOCS.molkkyOutResolutions),
    getSingleton(db, tournamentId, "finalsAdvancement", SINGLETON_DOCS.finalsAdvancement),
    getSingleton(db, tournamentId, "finalsBracket", SINGLETON_DOCS.finalsBracket),
    getCollectionMap(db, tournamentId, "finalsMatchResults"),
    getCollectionMap(db, tournamentId, "finalsMatchSessions"),
    getSingleton(db, tournamentId, "consolationBracket", SINGLETON_DOCS.consolationBracket),
    getCollectionMap(db, tournamentId, "consolationMatchResults"),
    getCollectionMap(db, tournamentId, "consolationMatchSessions"),
    getSingleton(db, tournamentId, "lossBandState", SINGLETON_DOCS.lossBandState),
    getCollectionList(db, tournamentId, "lossBandRounds"),
    getCollectionMap(db, tournamentId, "lossBandMatchResults"),
    getCollectionMap(db, tournamentId, "lossBandMatchSessions"),
    getSingleton(db, tournamentId, "lossBandPlacements", SINGLETON_DOCS.lossBandPlacements),
    getCollectionList(db, tournamentId, "lossBandExchangeRounds"),
    getCollectionMap(db, tournamentId, "lossBandExchangeMatchResults"),
    getCollectionMap(db, tournamentId, "lossBandExchangeMatchSessions"),
    getSingleton(db, tournamentId, "tournamentResults", SINGLETON_DOCS.tournamentResults),
    getSingleton(db, tournamentId, "timeSchedule", SINGLETON_DOCS.timeSchedule),
    getCollectionMap(db, tournamentId, "qualifyingResultSubmissions"),
    getCollectionMap(db, tournamentId, "qualifyingMatchReconciliations"),
  ]);

  const entries = [];
  entriesSnap.forEach((docSnap) => {
    entries.push({ id: docSnap.id, ...docSnap.data() });
  });

  return {
    tournamentId,
    tournament: { id: snap.id, ...snap.data() },
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
    lossBandState,
    lossBandRounds,
    lossBandMatchResults,
    lossBandMatchSessions,
    lossBandPlacements,
    lossBandExchangeRounds,
    lossBandExchangeMatchResults,
    lossBandExchangeMatchSessions,
    tournamentResults,
    timeSchedule,
    qualifyingResultSubmissions,
    qualifyingMatchReconciliations,
  };
}

function buildFileName(tournamentId, exportedAt) {
  const stamp = String(exportedAt || "").replace(/[:.]/g, "-");
  return `sma-emergency-export-${tournamentId}-${stamp}.json`;
}

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {{ tournamentId: string, uid: string, projectId?: string, applicationRevision?: string|null }} params
 */
export async function exportEmergencyTournament(db, params) {
  const tournamentId = typeof params?.tournamentId === "string" ? params.tournamentId.trim() : "";
  if (!tournamentId) {
    const error = new Error("tournamentId を指定してください。");
    error.code = "invalid-argument";
    throw error;
  }

  await assertOperatorEnabled(db, params.uid);

  const loaded = await loadEmergencyExportInput(db, tournamentId);
  const exported = buildEmergencyExport({
    ...loaded,
    projectId: params.projectId ?? process.env.GCLOUD_PROJECT ?? process.env.GCP_PROJECT ?? null,
    applicationRevision: params.applicationRevision ?? process.env.K_REVISION ?? null,
    exportedAt: new Date(),
  });

  return {
    fileName: buildFileName(tournamentId, exported.exportMeta.exportedAt),
    contentType: "application/json; charset=utf-8",
    schemaVersion: exported.exportMeta.schemaVersion,
    tournamentId,
    export: exported,
  };
}
