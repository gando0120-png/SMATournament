/**
 * 大会 Firestore CRUD（DOM 非依存）
 */
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  query,
  orderBy,
  updateDoc,
  serverTimestamp,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { getFirebaseDb, isFirebaseConfigured } from "../lib/firebase-app.js";
import { ConfigUnconfiguredError, TournamentNotFoundError, TournamentDeletedError, TournamentStructureLockedError } from "../lib/errors.js";
import { TournamentStatus } from "../domain/constants.js";
import { isTournamentDeleted, filterActiveTournaments } from "../domain/tournament-deletion.js";
import {
  isFinalsMatchRulesLocked,
  normalizeFinalsMatchRules,
  resolveFinalsWinsRequired,
} from "../domain/finals-match-format.js";
import {
  MatchFormat,
  isAggregateMatchRulesLocked,
  normalizeAggregateMatchRules,
  resolveMatchFormat,
} from "../domain/aggregate-match-format.js";
import {
  buildTournamentSettingsUpdateFields,
  getStructureLockConflictMessage,
} from "../domain/tournament-settings-update.js";
import { assertTournamentOpenForWrite } from "../lib/tournament-status.js";
import { withPublicSnapshotRebuild } from "../lib/public-snapshot-hook.js";
import { removeUndefinedFields } from "../lib/remove-undefined-fields.js";

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
 * Firestore ドキュメントをアプリ用オブジェクトに変換（document.id を常に保持）
 * @param {import('firebase/firestore').DocumentSnapshot} docSnap
 */
function mapTournamentDoc(docSnap) {
  return { ...docSnap.data(), id: docSnap.id };
}

/**
 * @param {object} input - validateTournamentInput().values
 * @param {string} createdByUid
 */
export async function createTournament(input, createdByUid) {
  const db = requireDb();
  const payload = {
    name: input.name,
    eventDate: input.eventDate,
    venue: input.venue,
    entryDeadline: Timestamp.fromDate(input.entryDeadline),
    maxTeams: input.maxTeams,
    teamSize: input.teamSize,
    courtCount: input.courtCount,
    winsRequired: resolveFinalsWinsRequired(
      input.finalsMatchRules?.defaultWinsRequired ?? input.winsRequired
    ),
    finalsMatchRules: normalizeFinalsMatchRules({
      winsRequired: input.winsRequired,
      finalsMatchRules: input.finalsMatchRules,
    }),
    status: TournamentStatus.DRAFT,
    entryCount: 0,
    confirmedCount: 0,
    publicViewEnabled: true,
    participantResultEntryEnabled: false,
    createdBy: createdByUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (input.tournamentFormat === "single_elimination") {
    payload.tournamentFormat = "single_elimination";
    const matchFormat = resolveMatchFormat(input.matchFormat);
    payload.matchFormat = matchFormat;
    if (matchFormat === MatchFormat.MULTI_TEAM_TOTAL) {
      payload.aggregateMatchRules = normalizeAggregateMatchRules(
        input.aggregateMatchRules || input
      );
    }
  } else if (input.tournamentFormat === "qualifying_and_finals") {
    payload.tournamentFormat = "qualifying_and_finals";
    payload.blockCount = input.blockCount;
    payload.qualifiersPerBlock = input.qualifiersPerBlock;
    payload.matchFormat = MatchFormat.HEAD_TO_HEAD_SETS;
  } else if (input.preferredBlockSize != null) {
    payload.preferredBlockSize = input.preferredBlockSize;
  }

  const ref = await addDoc(collection(db, "tournaments"), payload);
  return withPublicSnapshotRebuild(ref.id, { id: ref.id, ...payload });
}

/**
 * @param {string} tournamentId
 * @param {{ source?: 'default' | 'server' }} [options]
 */
export async function getTournament(tournamentId, options = {}) {
  const db = requireDb();
  const ref = doc(db, "tournaments", tournamentId);
  const snap =
    options.source === "server" ? await getDocFromServer(ref) : await getDoc(ref);
  if (!snap.exists()) {
    throw new TournamentNotFoundError();
  }
  const tournament = mapTournamentDoc(snap);
  if (isTournamentDeleted(tournament) && options.rejectDeleted) {
    throw new TournamentDeletedError();
  }
  return tournament;
}

/**
 * 開催日昇順（論理削除済みを除外）
 */
export async function listTournaments() {
  const db = requireDb();
  const q = query(collection(db, "tournaments"), orderBy("eventDate", "asc"));
  const snapshot = await getDocs(q);
  return filterActiveTournaments(snapshot.docs.map((d) => mapTournamentDoc(d)));
}

/**
 * @param {string} tournamentId
 * @param {object} input validateTournamentInput().values
 * @param {{ structureLocked?: boolean, finalsWinsRequiredLocked?: boolean }} [options]
 */
export async function updateTournamentSettings(tournamentId, input, options = {}) {
  const tournament = await getTournament(tournamentId);
  if (isTournamentDeleted(tournament)) {
    throw new TournamentDeletedError();
  }

  const locked = options.structureLocked === true;
  const structureConflict = getStructureLockConflictMessage(tournament, input, locked);
  if (structureConflict) {
    throw new TournamentStructureLockedError(structureConflict);
  }

  const lockSignals = {
    hasFinalsBracket: options.hasFinalsBracket,
    hasConsolationBracket: options.hasConsolationBracket,
    hasMaterialFinalsBracket: options.hasMaterialFinalsBracket,
    hasMaterialConsolationBracket: options.hasMaterialConsolationBracket,
    hasFinalsMatchResults: options.hasFinalsMatchResults,
    hasConsolationMatchResults: options.hasConsolationMatchResults,
  };
  const winsRequiredLocked =
    options.finalsWinsRequiredLocked === true || isFinalsMatchRulesLocked(lockSignals);
  const aggregateLocked =
    options.aggregateMatchRulesLocked === true || isAggregateMatchRulesLocked(lockSignals);
  const nextRules = normalizeFinalsMatchRules({
    winsRequired: input.winsRequired,
    finalsMatchRules: input.finalsMatchRules,
  });
  const currentRules = normalizeFinalsMatchRules(tournament);
  const rulesChanged =
    nextRules.defaultWinsRequired !== currentRules.defaultWinsRequired ||
    JSON.stringify(nextRules.roundOverrides) !== JSON.stringify(currentRules.roundOverrides);
  if (winsRequiredLocked && rulesChanged) {
    throw new TournamentStructureLockedError(
      "トーナメント表作成後は、トーナメント勝利条件を変更できません。"
    );
  }

  const nextMatchFormat = resolveMatchFormat(input.matchFormat ?? tournament.matchFormat);
  const currentMatchFormat = resolveMatchFormat(tournament.matchFormat);
  const nextAggregate =
    nextMatchFormat === MatchFormat.MULTI_TEAM_TOTAL
      ? normalizeAggregateMatchRules(input.aggregateMatchRules || input)
      : null;
  const currentAggregate =
    currentMatchFormat === MatchFormat.MULTI_TEAM_TOTAL
      ? normalizeAggregateMatchRules(tournament.aggregateMatchRules || {})
      : null;
  const aggregateChanged =
    nextMatchFormat !== currentMatchFormat ||
    JSON.stringify(nextAggregate) !== JSON.stringify(currentAggregate);
  if (aggregateLocked && aggregateChanged) {
    throw new TournamentStructureLockedError(
      "トーナメント表作成後は、試合形式・複数チーム試合の設定を変更できません。"
    );
  }

  const db = requireDb();
  const ref = doc(db, "tournaments", tournamentId);
  const fields = buildTournamentSettingsUpdateFields({
    input,
    tournament,
    structureLocked: locked,
    finalsWinsRequiredLocked: winsRequiredLocked,
    aggregateMatchRulesLocked: aggregateLocked,
    lockSignals,
    changedFieldsOnly: true,
  });

  /** @type {Record<string, unknown>} */
  const payload = {
    ...fields,
    updatedAt: serverTimestamp(),
  };
  if (Object.prototype.hasOwnProperty.call(fields, "entryDeadline")) {
    payload.entryDeadline = Timestamp.fromDate(input.entryDeadline);
  }

  const safePayload = removeUndefinedFields(payload);
  console.info("[tournament-edit] update payload", {
    tournamentId,
    keys: Object.keys(safePayload),
    winsRequired: safePayload.winsRequired,
    finalsMatchRules: safePayload.finalsMatchRules,
  });

  try {
    await updateDoc(ref, safePayload);
  } catch (error) {
    console.error("[tournament-edit] update failed", {
      code: error?.code,
      message: error?.message,
      name: error?.name,
      stack: error?.stack,
      payload: {
        keys: Object.keys(safePayload),
        winsRequired: safePayload.winsRequired,
        finalsMatchRules: safePayload.finalsMatchRules,
      },
      tournamentId,
    });
    throw error;
  }

  const updated = {
    ...tournament,
    ...safePayload,
    ...(Object.prototype.hasOwnProperty.call(fields, "entryDeadline")
      ? { entryDeadline: Timestamp.fromDate(input.entryDeadline) }
      : {}),
  };
  return withPublicSnapshotRebuild(tournamentId, updated);
}

/**
 * @param {string} tournamentId
 * @param {string} deletedByUid
 */
export async function softDeleteTournament(tournamentId, deletedByUid) {
  const tournament = await getTournament(tournamentId);
  if (isTournamentDeleted(tournament)) {
    throw new TournamentDeletedError();
  }

  const db = requireDb();
  const ref = doc(db, "tournaments", tournamentId);
  await updateDoc(ref, {
    isDeleted: true,
    deletedAt: serverTimestamp(),
    deletedBy: deletedByUid,
    updatedAt: serverTimestamp(),
  });

  return withPublicSnapshotRebuild(tournamentId, {
    ...tournament,
    isDeleted: true,
    deletedBy: deletedByUid,
  });
}

/**
 * @param {string} tournamentId
 */
export async function requireOpenTournament(tournamentId) {
  const tournament = await getTournament(tournamentId);
  assertTournamentOpenForWrite(tournament);
  return tournament;
}

/**
 * @param {string} tournamentId
 * @param {string} newStatus
 */
export async function updateTournamentStatus(tournamentId, newStatus) {
  const db = requireDb();
  const ref = doc(db, "tournaments", tournamentId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    throw new TournamentNotFoundError();
  }

  await updateDoc(ref, {
    status: newStatus,
    updatedAt: serverTimestamp(),
  });

  return withPublicSnapshotRebuild(tournamentId, {
    ...mapTournamentDoc(snap),
    status: newStatus,
  });
}

/**
 * @param {string} tournamentId
 * @param {boolean} publicViewEnabled
 */
export async function updateTournamentPublicView(tournamentId, publicViewEnabled) {
  const db = requireDb();
  const ref = doc(db, "tournaments", tournamentId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    throw new TournamentNotFoundError();
  }

  await updateDoc(ref, {
    publicViewEnabled: Boolean(publicViewEnabled),
    updatedAt: serverTimestamp(),
  });

  return withPublicSnapshotRebuild(tournamentId, {
    ...mapTournamentDoc(snap),
    publicViewEnabled: Boolean(publicViewEnabled),
  });
}
