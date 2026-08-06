/**
 * プレイヤー予選H2H提出・照合・正式反映（Admin SDK）
 */
import { createHash, randomBytes } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import {
  ENTRY_ACCESS_TOKENS_COLLECTION,
  QUALIFYING_RESULT_SUBMISSIONS_COLLECTION,
  QUALIFYING_MATCH_RECONCILIATIONS_COLLECTION,
  buildSubmissionDocId,
  normalizeSubmissionScores,
  resolveMatchSide,
  assertPlayerSubmissionAllowed,
  validatePlayerSubmissionScores,
  reconcileSubmissions,
  resolvePlayerMatchUiStatus,
  resolveReconciliationState,
  getPlayerMatchUiStatusLabel,
  MatchReconciliationState,
  PlayerSubmissionStatus,
  submissionScoresEqual,
} from "../vendor/domain/player-qualifying-submission.js";
import {
  buildScheduleMatchIndex,
} from "../vendor/domain/qualifying-match-result.js";
import {
  buildPublicTournamentSnapshot,
  PUBLIC_SNAPSHOT_DOC_ID,
} from "../vendor/domain/public-tournament-snapshot.js";
import { QUALIFYING_SCHEDULE_DOC_ID, FINALS_ADVANCEMENT_DOC_ID } from "../vendor/domain/constants.js";

export function hashTeamToken(token) {
  return createHash("sha256").update(String(token), "utf8").digest("hex");
}

export function generateTeamToken() {
  return randomBytes(24).toString("base64url");
}

function tournamentRef(db, tournamentId) {
  return db.collection("tournaments").doc(tournamentId);
}

async function loadTournament(db, tournamentId) {
  const snap = await tournamentRef(db, tournamentId).get();
  if (!snap.exists) {
    const error = new Error("大会が見つかりません。");
    error.code = "not-found";
    throw error;
  }
  return { id: snap.id, ...snap.data() };
}

async function loadSchedule(db, tournamentId) {
  const snap = await tournamentRef(db, tournamentId)
    .collection("qualifyingSchedules")
    .doc(QUALIFYING_SCHEDULE_DOC_ID)
    .get();
  if (!snap.exists) {
    return null;
  }
  return { id: snap.id, ...snap.data() };
}

async function hasFinalsAdvancement(db, tournamentId) {
  const snap = await tournamentRef(db, tournamentId)
    .collection("finalsAdvancement")
    .doc(FINALS_ADVANCEMENT_DOC_ID)
    .get();
  return snap.exists;
}

async function resolveEntryIdByToken(db, tournamentId, teamToken) {
  const tokenHash = hashTeamToken(teamToken);
  const snap = await tournamentRef(db, tournamentId)
    .collection(ENTRY_ACCESS_TOKENS_COLLECTION)
    .where("tokenHash", "==", tokenHash)
    .limit(1)
    .get();
  if (snap.empty) {
    const error = new Error("チーム用トークンが無効です。");
    error.code = "permission-denied";
    throw error;
  }
  const doc = snap.docs[0];
  const data = doc.data();
  if (data.revokedAt) {
    const error = new Error("チーム用トークンは無効化されています。");
    error.code = "permission-denied";
    throw error;
  }
  return { entryId: data.entryId || doc.id, tokenHash, tokenDocId: doc.id };
}

async function loadCollectionMap(db, tournamentId, collectionName) {
  const snap = await tournamentRef(db, tournamentId).collection(collectionName).get();
  const map = new Map();
  snap.docs.forEach((docSnap) => {
    map.set(docSnap.id, { id: docSnap.id, ...docSnap.data() });
  });
  return map;
}

/** Firestore Admin は undefined を拒否するため再帰除去する（null/0/false は保持） */
function removeUndefinedFields(value) {
  if (Array.isArray(value)) {
    return value.map(removeUndefinedFields).filter((item) => item !== undefined);
  }
  if (value && typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      return value;
    }
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, removeUndefinedFields(item)])
    );
  }
  return value;
}

async function rebuildPublicSnapshotAdmin(db, tournamentId) {
  const tournament = await loadTournament(db, tournamentId);
  const [
    entriesSnap,
    blockDrawSnap,
    schedule,
    qualifyingResultsMap,
    finalsAdvancementSnap,
    finalsBracketSnap,
    finalsResultsMap,
    finalsSessionsMap,
    tournamentResultsSnap,
    consolationBracketSnap,
  ] = await Promise.all([
    tournamentRef(db, tournamentId).collection("entries").get(),
    tournamentRef(db, tournamentId).collection("blockDraw").doc("current").get(),
    loadSchedule(db, tournamentId),
    loadCollectionMap(db, tournamentId, "qualifyingMatchResults"),
    tournamentRef(db, tournamentId).collection("finalsAdvancement").doc(FINALS_ADVANCEMENT_DOC_ID).get(),
    tournamentRef(db, tournamentId).collection("finalsBracket").doc("current").get(),
    loadCollectionMap(db, tournamentId, "finalsMatchResults"),
    loadCollectionMap(db, tournamentId, "finalsMatchSessions"),
    tournamentRef(db, tournamentId).collection("tournamentResults").doc("current").get(),
    tournamentRef(db, tournamentId).collection("consolationBracket").doc("current").get(),
  ]);

  const entries = entriesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const blockDraw = blockDrawSnap.exists ? { id: blockDrawSnap.id, ...blockDrawSnap.data() } : null;
  const finalsAdvancement = finalsAdvancementSnap.exists
    ? { id: finalsAdvancementSnap.id, ...finalsAdvancementSnap.data() }
    : null;
  const finalsBracket = finalsBracketSnap.exists
    ? { id: finalsBracketSnap.id, ...finalsBracketSnap.data() }
    : null;
  const tournamentResults = tournamentResultsSnap.exists
    ? { id: tournamentResultsSnap.id, ...tournamentResultsSnap.data() }
    : null;
  const consolationBracket = consolationBracketSnap.exists
    ? { id: consolationBracketSnap.id, ...consolationBracketSnap.data() }
    : null;

  const qualifyingSessionsMap = new Map();
  const snapshot = buildPublicTournamentSnapshot({
    tournament,
    entries,
    blockDraw,
    schedule,
    qualifyingResultsMap,
    qualifyingSessionsMap,
    finalsAdvancement,
    finalsBracket,
    finalsResultsMap,
    finalsSessionsMap,
    tournamentResults,
    consolationBracket,
    consolationResultsMap: new Map(),
    consolationSessionsMap: new Map(),
  });

  await tournamentRef(db, tournamentId)
    .collection("publicSnapshot")
    .doc(PUBLIC_SNAPSHOT_DOC_ID)
    .set({
      ...removeUndefinedFields(snapshot),
      updatedAt: FieldValue.serverTimestamp(),
    });

  return snapshot;
}

function buildReconciliationPayload({
  matchId,
  scheduleMatch,
  team1Submitted,
  team2Submitted,
  state,
  conflictSnapshot = null,
  officialResultId = null,
}) {
  return {
    matchId,
    state,
    submissions: {
      team1EntryId: scheduleMatch.team1.entryId,
      team2EntryId: scheduleMatch.team2.entryId,
      team1Name: scheduleMatch.team1.teamName,
      team2Name: scheduleMatch.team2.teamName,
      team1Submitted,
      team2Submitted,
    },
    conflictSnapshot,
    officialResultId,
    updatedAt: FieldValue.serverTimestamp(),
  };
}

/**
 * 運営: 確定エントリーへチームトークンを一括発行（平文は戻り値のみ）
 */
export async function issueEntryAccessTokens(db, tournamentId, { rotate = false } = {}) {
  const tournament = await loadTournament(db, tournamentId);
  const entriesSnap = await tournamentRef(db, tournamentId).collection("entries").get();
  const confirmed = entriesSnap.docs.filter((d) => d.data().status === "confirmed");
  const issued = [];

  const batch = db.batch();
  for (const entryDoc of confirmed) {
    const entryId = entryDoc.id;
    const tokenRef = tournamentRef(db, tournamentId)
      .collection(ENTRY_ACCESS_TOKENS_COLLECTION)
      .doc(entryId);
    const existing = await tokenRef.get();
    if (existing.exists && !rotate && !existing.data().revokedAt) {
      continue;
    }
    const teamToken = generateTeamToken();
    const tokenHash = hashTeamToken(teamToken);
    batch.set(
      tokenRef,
      {
        entryId,
        tokenHash,
        createdAt: existing.exists ? existing.data().createdAt ?? FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
        rotatedAt: FieldValue.serverTimestamp(),
        revokedAt: null,
      },
      { merge: true }
    );
    issued.push({
      entryId,
      teamName: entryDoc.data().teamName || entryId,
      teamToken,
      playerResultsPath: `player-results.html?tournamentId=${encodeURIComponent(tournamentId)}&teamToken=${encodeURIComponent(teamToken)}`,
    });
  }
  if (issued.length > 0) {
    batch.update(tournamentRef(db, tournamentId), {
      updatedAt: FieldValue.serverTimestamp(),
    });
    await batch.commit();
  }

  return {
    tournamentId,
    tournamentName: tournament.name,
    issuedCount: issued.length,
    issued,
  };
}

/**
 * プレイヤー: 自チームの予選試合一覧
 */
export async function listMyQualifyingMatches(db, tournamentId, teamToken) {
  const tournament = await loadTournament(db, tournamentId);
  const { entryId } = await resolveEntryIdByToken(db, tournamentId, teamToken);
  const schedule = await loadSchedule(db, tournamentId);
  const locked = await hasFinalsAdvancement(db, tournamentId);
  const gate = assertPlayerSubmissionAllowed(tournament, {
    hasFinalsAdvancement: locked,
    scheduleFinalized: Boolean(schedule?.finalized),
  });

  const entrySnap = await tournamentRef(db, tournamentId).collection("entries").doc(entryId).get();
  const teamName = entrySnap.exists ? entrySnap.data().teamName || entryId : entryId;

  if (!schedule?.finalized) {
    return {
      tournamentId,
      tournamentName: tournament.name,
      entryId,
      teamName,
      participantResultEntryEnabled: tournament.participantResultEntryEnabled === true,
      submissionAllowed: gate.allowed,
      submissionMessage: gate.message,
      matches: [],
    };
  }

  const matchIndex = buildScheduleMatchIndex(schedule);
  const myMatches = [];
  for (const scheduleMatch of matchIndex.values()) {
    const side = resolveMatchSide(scheduleMatch, entryId);
    if (!side) {
      continue;
    }
    myMatches.push(scheduleMatch);
  }

  const [resultsMap, submissionsSnap, reconciliationsMap] = await Promise.all([
    loadCollectionMap(db, tournamentId, "qualifyingMatchResults"),
    tournamentRef(db, tournamentId).collection(QUALIFYING_RESULT_SUBMISSIONS_COLLECTION).get(),
    loadCollectionMap(db, tournamentId, QUALIFYING_MATCH_RECONCILIATIONS_COLLECTION),
  ]);

  const submissionsByMatch = new Map();
  for (const docSnap of submissionsSnap.docs) {
    const data = { id: docSnap.id, ...docSnap.data() };
    if (!submissionsByMatch.has(data.matchId)) {
      submissionsByMatch.set(data.matchId, []);
    }
    submissionsByMatch.get(data.matchId).push(data);
  }

  const matches = myMatches.map((scheduleMatch) => {
    const side = resolveMatchSide(scheduleMatch, entryId);
    const opponent =
      side === "team1"
        ? scheduleMatch.team2
        : scheduleMatch.team1;
    const subs = submissionsByMatch.get(scheduleMatch.matchId) || [];
    const mySubmission = subs.find((s) => s.entryId === entryId) || null;
    const opponentSubmission = subs.find((s) => s.entryId === opponent.entryId) || null;
    const officialResult = resultsMap.get(scheduleMatch.matchId) || null;
    const reconciliation = reconciliationsMap.get(scheduleMatch.matchId) || null;
    const uiStatus = resolvePlayerMatchUiStatus({
      mySubmission,
      opponentSubmission,
      officialResult,
      reconciliation,
      locked,
    });
    const canSubmit =
      gate.allowed &&
      !locked &&
      !officialResult &&
      reconciliation?.state !== MatchReconciliationState.MATCHED &&
      reconciliation?.state !== MatchReconciliationState.OPERATOR_LOCKED;

    return {
      matchId: scheduleMatch.matchId,
      blockId: scheduleMatch.blockId,
      roundNumber: scheduleMatch.roundNumber,
      courtNumber: scheduleMatch.courtNumber,
      side,
      team1: scheduleMatch.team1,
      team2: scheduleMatch.team2,
      opponent,
      uiStatus,
      uiStatusLabel: getPlayerMatchUiStatusLabel(uiStatus),
      canSubmit,
      mySubmission: mySubmission
        ? {
            ...normalizeSubmissionScores(mySubmission),
            submittedAt: mySubmission.submittedAt ?? null,
            status: mySubmission.status,
          }
        : null,
      officialResult: officialResult
        ? {
            team1Stats: officialResult.team1Stats,
            team2Stats: officialResult.team2Stats,
            sets: officialResult.sets,
          }
        : null,
    };
  });

  return {
    tournamentId,
    tournamentName: tournament.name,
    entryId,
    teamName,
    participantResultEntryEnabled: tournament.participantResultEntryEnabled === true,
    submissionAllowed: gate.allowed,
    submissionMessage: gate.message,
    matches,
  };
}

/**
 * プレイヤー: 提出 → 照合 → 正式反映
 */
export async function submitPlayerQualifyingResult(
  db,
  tournamentId,
  {
    teamToken,
    matchId,
    scores,
    clientRequestId = null,
  }
) {
  const tournament = await loadTournament(db, tournamentId);
  const { entryId, tokenHash } = await resolveEntryIdByToken(db, tournamentId, teamToken);
  const locked = await hasFinalsAdvancement(db, tournamentId);
  const schedule = await loadSchedule(db, tournamentId);
  const gate = assertPlayerSubmissionAllowed(tournament, {
    hasFinalsAdvancement: locked,
    scheduleFinalized: Boolean(schedule?.finalized),
  });
  if (!gate.allowed) {
    const error = new Error(gate.message);
    error.code = gate.code;
    throw error;
  }

  const scheduleMatch = buildScheduleMatchIndex(schedule).get(matchId);
  if (!scheduleMatch) {
    const error = new Error("試合が見つかりません。");
    error.code = "invalid-argument";
    throw error;
  }

  const side = resolveMatchSide(scheduleMatch, entryId);
  if (!side) {
    const error = new Error("この試合の提出権限がありません。");
    error.code = "permission-denied";
    throw error;
  }

  const validation = validatePlayerSubmissionScores(scores);
  if (!validation.valid) {
    const error = new Error(validation.message);
    error.code = "invalid-argument";
    throw error;
  }

  const normalizedScores = normalizeSubmissionScores(scores);
  const submissionId = buildSubmissionDocId(matchId, entryId);
  const opponentEntryId =
    side === "team1" ? scheduleMatch.team2.entryId : scheduleMatch.team1.entryId;
  const opponentSubmissionId = buildSubmissionDocId(matchId, opponentEntryId);

  const resultRef = tournamentRef(db, tournamentId)
    .collection("qualifyingMatchResults")
    .doc(matchId);
  const submissionRef = tournamentRef(db, tournamentId)
    .collection(QUALIFYING_RESULT_SUBMISSIONS_COLLECTION)
    .doc(submissionId);
  const opponentRef = tournamentRef(db, tournamentId)
    .collection(QUALIFYING_RESULT_SUBMISSIONS_COLLECTION)
    .doc(opponentSubmissionId);
  const reconciliationRef = tournamentRef(db, tournamentId)
    .collection(QUALIFYING_MATCH_RECONCILIATIONS_COLLECTION)
    .doc(matchId);
  const sessionRef = tournamentRef(db, tournamentId)
    .collection("qualifyingMatchSessions")
    .doc(matchId);
  const advancementRef = tournamentRef(db, tournamentId)
    .collection("finalsAdvancement")
    .doc(FINALS_ADVANCEMENT_DOC_ID);

  let response = null;

  await db.runTransaction(async (tx) => {
    const [
      resultSnap,
      submissionSnap,
      opponentSnap,
      advancementSnap,
      sessionSnap,
      reconciliationSnap,
    ] = await Promise.all([
      tx.get(resultRef),
      tx.get(submissionRef),
      tx.get(opponentRef),
      tx.get(advancementRef),
      tx.get(sessionRef),
      tx.get(reconciliationRef),
    ]);

    if (advancementSnap.exists) {
      const error = new Error("決勝進出確定後はプレイヤーから結果を送信できません。");
      error.code = "player-submission/advancement-locked";
      throw error;
    }

    if (resultSnap.exists) {
      const error = new Error("正式結果が既に存在します。再送信はできません。");
      error.code = "player-submission/already-official";
      throw error;
    }

    const reconState = reconciliationSnap.exists ? reconciliationSnap.data().state : null;
    if (
      reconState === MatchReconciliationState.MATCHED ||
      reconState === MatchReconciliationState.OPERATOR_LOCKED
    ) {
      const error = new Error("この試合は既に確定済みです。再送信はできません。");
      error.code = "player-submission/already-official";
      throw error;
    }

    if (
      submissionSnap.exists &&
      clientRequestId &&
      submissionSnap.data().clientRequestId === clientRequestId
    ) {
      response = {
        state: MatchReconciliationState.AWAITING_OPPONENT,
        message: "同じ内容は既に受け付け済みです。",
        idempotent: true,
      };
      return;
    }

    if (submissionSnap.exists && submissionSnap.data().status === PlayerSubmissionStatus.MATCHED) {
      const error = new Error("この試合は既に確定済みです。再送信はできません。");
      error.code = "player-submission/already-official";
      throw error;
    }

    const submissionData = {
      matchId,
      entryId,
      side,
      ...normalizedScores,
      status: PlayerSubmissionStatus.PENDING,
      submittedAt: FieldValue.serverTimestamp(),
      clientRequestId: clientRequestId || null,
      tokenHashPrefix: String(tokenHash).slice(0, 8),
      updatedAt: FieldValue.serverTimestamp(),
    };
    tx.set(submissionRef, submissionData, { merge: true });

    const opponentData = opponentSnap.exists ? opponentSnap.data() : null;
    const team1Submitted = side === "team1" ? true : Boolean(opponentData);
    const team2Submitted = side === "team2" ? true : Boolean(opponentData);

    if (!opponentData) {
      const state = MatchReconciliationState.AWAITING_OPPONENT;
      tx.set(
        reconciliationRef,
        buildReconciliationPayload({
          matchId,
          scheduleMatch,
          team1Submitted,
          team2Submitted,
          state,
        }),
        { merge: true }
      );
      response = {
        state,
        message: "提出を受け付けました。相手チームの提出を待っています。",
        uiStatusLabel: getPlayerMatchUiStatusLabel("awaiting_opponent"),
      };
      return;
    }

    const mine = { ...normalizedScores, entryId, side };
    const theirs = {
      ...normalizeSubmissionScores(opponentData),
      entryId: opponentData.entryId,
      side: opponentData.side,
    };
    const reconciled = reconcileSubmissions({
      submissionA: mine,
      submissionB: theirs,
      scheduleMatch,
      officialExists: false,
    });

    if (!reconciled.ok) {
      tx.set(
        submissionRef,
        { status: PlayerSubmissionStatus.CONFLICT, updatedAt: FieldValue.serverTimestamp() },
        { merge: true }
      );
      tx.set(
        opponentRef,
        { status: PlayerSubmissionStatus.CONFLICT, updatedAt: FieldValue.serverTimestamp() },
        { merge: true }
      );
      tx.set(
        reconciliationRef,
        buildReconciliationPayload({
          matchId,
          scheduleMatch,
          team1Submitted: true,
          team2Submitted: true,
          state: MatchReconciliationState.CONFLICT,
          conflictSnapshot: reconciled.conflictSnapshot,
        }),
        { merge: true }
      );
      response = {
        state: MatchReconciliationState.CONFLICT,
        message: reconciled.message,
        uiStatusLabel: getPlayerMatchUiStatusLabel("conflict"),
        conflictSnapshot: reconciled.conflictSnapshot,
      };
      return;
    }

    const payload = {
      ...reconciled.officialPayload,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    tx.set(resultRef, payload);
    tx.set(
      submissionRef,
      { status: PlayerSubmissionStatus.MATCHED, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    tx.set(
      opponentRef,
      { status: PlayerSubmissionStatus.MATCHED, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    tx.set(
      reconciliationRef,
      buildReconciliationPayload({
        matchId,
        scheduleMatch,
        team1Submitted: true,
        team2Submitted: true,
        state: MatchReconciliationState.MATCHED,
        officialResultId: matchId,
      }),
      { merge: true }
    );

    if (sessionSnap.exists && sessionSnap.data().status === "playing") {
      tx.update(sessionRef, {
        status: "finished",
        finishedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    response = {
      state: MatchReconciliationState.MATCHED,
      message: "両チームの提出が一致したため、正式結果として確定しました。",
      uiStatusLabel: getPlayerMatchUiStatusLabel("official"),
      officialResult: {
        team1Stats: payload.team1Stats,
        team2Stats: payload.team2Stats,
      },
      rebuildSnapshot: true,
    };
  });

  if (response?.rebuildSnapshot) {
    try {
      await rebuildPublicSnapshotAdmin(db, tournamentId);
      response.snapshotRebuilt = true;
    } catch (error) {
      response.snapshotRebuilt = false;
      response.snapshotError = error?.message || String(error);
    }
  }

  return {
    tournamentId,
    matchId,
    entryId,
    ...response,
  };
}

/**
 * 運営が結果を保存したあと、提出状態を operator_locked / matched に寄せる
 */
export async function markReconciliationOperatorResolved(db, tournamentId, matchId) {
  const schedule = await loadSchedule(db, tournamentId);
  const scheduleMatch = buildScheduleMatchIndex(schedule || {}).get(matchId);
  if (!scheduleMatch) {
    return null;
  }
  const resultSnap = await tournamentRef(db, tournamentId)
    .collection("qualifyingMatchResults")
    .doc(matchId)
    .get();
  if (!resultSnap.exists) {
    return null;
  }

  const reconRef = tournamentRef(db, tournamentId)
    .collection(QUALIFYING_MATCH_RECONCILIATIONS_COLLECTION)
    .doc(matchId);
  await reconRef.set(
    buildReconciliationPayload({
      matchId,
      scheduleMatch,
      team1Submitted: true,
      team2Submitted: true,
      state: MatchReconciliationState.OPERATOR_LOCKED,
      officialResultId: matchId,
    }),
    { merge: true }
  );
  return { matchId, state: MatchReconciliationState.OPERATOR_LOCKED };
}

/**
 * 運営向け: 試合ごとの提出状況一覧
 */
export async function listMatchReconciliations(db, tournamentId) {
  const schedule = await loadSchedule(db, tournamentId);
  if (!schedule?.finalized) {
    return { matches: [] };
  }
  const matchIndex = buildScheduleMatchIndex(schedule);
  const [resultsMap, reconciliationsMap, submissionsSnap] = await Promise.all([
    loadCollectionMap(db, tournamentId, "qualifyingMatchResults"),
    loadCollectionMap(db, tournamentId, QUALIFYING_MATCH_RECONCILIATIONS_COLLECTION),
    tournamentRef(db, tournamentId).collection(QUALIFYING_RESULT_SUBMISSIONS_COLLECTION).get(),
  ]);

  const submissionsByMatch = new Map();
  for (const docSnap of submissionsSnap.docs) {
    const data = { id: docSnap.id, ...docSnap.data() };
    if (!submissionsByMatch.has(data.matchId)) {
      submissionsByMatch.set(data.matchId, []);
    }
    submissionsByMatch.get(data.matchId).push(data);
  }

  const matches = [];
  for (const scheduleMatch of matchIndex.values()) {
    const subs = submissionsByMatch.get(scheduleMatch.matchId) || [];
    const team1Sub = subs.find((s) => s.entryId === scheduleMatch.team1.entryId);
    const team2Sub = subs.find((s) => s.entryId === scheduleMatch.team2.entryId);
    const officialExists = resultsMap.has(scheduleMatch.matchId);
    const stored = reconciliationsMap.get(scheduleMatch.matchId);
    const scoresMatch =
      team1Sub && team2Sub ? submissionScoresEqual(team1Sub, team2Sub) : null;
    const state =
      stored?.state ||
      resolveReconciliationState({
        team1EntryId: scheduleMatch.team1.entryId,
        team2EntryId: scheduleMatch.team2.entryId,
        team1Submitted: Boolean(team1Sub),
        team2Submitted: Boolean(team2Sub),
        officialExists,
        scoresMatch,
      });

    matches.push({
      matchId: scheduleMatch.matchId,
      team1: scheduleMatch.team1,
      team2: scheduleMatch.team2,
      state,
      team1Submitted: Boolean(team1Sub),
      team2Submitted: Boolean(team2Sub),
      team1Scores: team1Sub ? normalizeSubmissionScores(team1Sub) : null,
      team2Scores: team2Sub ? normalizeSubmissionScores(team2Sub) : null,
      conflictSnapshot: stored?.conflictSnapshot || null,
      officialExists,
    });
  }

  return { matches };
}

export { rebuildPublicSnapshotAdmin, Timestamp };
