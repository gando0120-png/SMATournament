/**
 * 大会進行状況（構造ロック判定用）
 */
import { doc, getDoc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { getFirebaseDb, isFirebaseConfigured } from "../lib/firebase-app.js";
import { ConfigUnconfiguredError } from "../lib/errors.js";
import { shouldPersistStructureLock } from "../domain/tournament-structure-lock.js";
import { isMaterialBracket } from "../domain/finals-match-format.js";
import { listEntries } from "./entry-service.js";
import { getBlockDraw } from "./block-draw-service.js";
import { getQualifyingSchedule } from "./qualifying-schedule-service.js";
import { getFinalsAdvancement } from "./finals-advancement-service.js";
import { getFinalsBracket } from "./finals-bracket-service.js";
import { getConsolationBracket } from "./consolation-bracket-service.js";
import { getFinalsMatchResults } from "./finals-match-result-service.js";
import { BracketKind } from "../domain/bracket-collections.js";

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
export async function getTournamentProgressSignals(tournamentId) {
  const [
    entries,
    blockDraw,
    qualifyingSchedule,
    finalsAdvancement,
    finalsBracket,
    consolationBracket,
    finalsResults,
    consolationResults,
  ] = await Promise.all([
    listEntries(tournamentId),
    getBlockDraw(tournamentId),
    getQualifyingSchedule(tournamentId),
    getFinalsAdvancement(tournamentId),
    getFinalsBracket(tournamentId),
    getConsolationBracket(tournamentId),
    getFinalsMatchResults(tournamentId, { bracketKind: BracketKind.MAIN }),
    getFinalsMatchResults(tournamentId, { bracketKind: BracketKind.CONSOLATION }),
  ]);

  const hasMaterialFinalsBracket = isMaterialBracket(finalsBracket);
  const hasMaterialConsolationBracket = isMaterialBracket(consolationBracket);

  return {
    hasEntries: entries.length > 0,
    hasBlockDraw: blockDraw != null,
    hasQualifyingSchedule: qualifyingSchedule != null,
    hasFinalsAdvancement: finalsAdvancement != null,
    // 互換: 空ブラケットドキュメントは「未生成」扱い
    hasFinalsBracket: hasMaterialFinalsBracket,
    hasConsolationBracket: hasMaterialConsolationBracket,
    hasMaterialFinalsBracket,
    hasMaterialConsolationBracket,
    hasFinalsMatchResults: finalsResults.size > 0,
    hasConsolationMatchResults: consolationResults.size > 0,
  };
}

/**
 * エントリー等が存在するのに structureLocked 未設定なら、運営者操作でフラグを立てる
 * @param {string} tournamentId
 * @param {object|null|undefined} tournament
 * @param {object|null|undefined} [signals]
 */
export async function ensureTournamentStructureLocked(tournamentId, tournament, signals) {
  if (tournament?.structureLocked === true) {
    return tournament;
  }

  const progress = signals ?? (await getTournamentProgressSignals(tournamentId));
  if (!shouldPersistStructureLock(progress)) {
    return tournament;
  }

  const db = requireDb();
  const ref = doc(db, "tournaments", tournamentId);
  await updateDoc(ref, {
    structureLocked: true,
    updatedAt: serverTimestamp(),
  });

  return { ...tournament, structureLocked: true };
}
