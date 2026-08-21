/**
 * loss-band ranking 結果修正（Admin SDK callable 実装）
 * 次ラウンドが全 ready なら破棄して再生成する。
 */
import { FieldValue } from "firebase-admin/firestore";
import {
  LOSS_BAND_STATE_DOC_ID,
  LOSS_BAND_PLACEMENTS_DOC_ID,
  assessLossBandRankingResultCorrection,
  buildLossBandRoundId,
  buildValidatedLossBandMatchResult,
  isLossBandRankingRoundDoc,
  pairingsFromRoundDoc,
  planCorrectLossBandRankingResult,
} from "../vendor/domain/loss-band/index.js";
import { MatchSessionStatus } from "../vendor/domain/constants.js";
import { rebuildPublicSnapshotAdmin } from "./player-qualifying-results.js";

function tournamentRef(db, tournamentId) {
  return db.collection("tournaments").doc(tournamentId);
}

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

async function loadCollectionMap(db, tournamentId, collectionName) {
  const snap = await tournamentRef(db, tournamentId).collection(collectionName).get();
  const map = new Map();
  for (const docSnap of snap.docs) {
    map.set(docSnap.id, { id: docSnap.id, ...docSnap.data() });
  }
  return map;
}

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} tournamentId
 * @param {{
 *   matchId: string,
 *   scoreInput: object,
 *   winsRequired?: number,
 *   expectedRevision?: number|null,
 * }} input
 */
export async function correctLossBandRankingResult(db, tournamentId, input) {
  const matchId = typeof input?.matchId === "string" ? input.matchId.trim() : "";
  if (!matchId) {
    const error = new Error("matchId を指定してください。");
    error.code = "invalid-argument";
    throw error;
  }

  const tournamentSnap = await tournamentRef(db, tournamentId).get();
  if (!tournamentSnap.exists) {
    const error = new Error("大会が見つかりません。");
    error.code = "not-found";
    throw error;
  }
  const tournament = { id: tournamentSnap.id, ...tournamentSnap.data() };

  const [
    stateSnap,
    placementsSnap,
    tournamentResultsSnap,
    roundsSnap,
    sessionsMap,
    resultsMap,
  ] = await Promise.all([
    tournamentRef(db, tournamentId).collection("lossBandState").doc(LOSS_BAND_STATE_DOC_ID).get(),
    tournamentRef(db, tournamentId)
      .collection("lossBandPlacements")
      .doc(LOSS_BAND_PLACEMENTS_DOC_ID)
      .get(),
    tournamentRef(db, tournamentId).collection("tournamentResults").doc("current").get(),
    tournamentRef(db, tournamentId).collection("lossBandRounds").get(),
    loadCollectionMap(db, tournamentId, "lossBandMatchSessions"),
    loadCollectionMap(db, tournamentId, "lossBandMatchResults"),
  ]);

  if (!stateSnap.exists) {
    const error = new Error("敗戦帯が初期化されていません。");
    error.code = "loss-band/not-initialized";
    throw error;
  }
  const stateDoc = { id: stateSnap.id, ...stateSnap.data() };

  /** @type {Map<string, object>} */
  const roundsById = new Map();
  for (const docSnap of roundsSnap.docs) {
    roundsById.set(docSnap.id, { id: docSnap.id, ...docSnap.data() });
  }

  let targetRoundDoc = null;
  for (const round of roundsById.values()) {
    if (!isLossBandRankingRoundDoc(round)) continue;
    if ((round.matchIds || []).includes(matchId)) {
      targetRoundDoc = round;
      break;
    }
  }
  if (!targetRoundDoc) {
    const error = new Error("対象試合が順位決定ラウンドに見つかりません。");
    error.code = "loss-band/match-not-in-round";
    throw error;
  }

  const existingResult = resultsMap.get(matchId) || null;
  const nextRoundId = buildLossBandRoundId(targetRoundDoc.roundNumber + 1);
  const nextRoundDoc = roundsById.get(nextRoundId) || null;

  const expectedRevision =
    input.expectedRevision == null || input.expectedRevision === ""
      ? null
      : Number(input.expectedRevision);

  const precheck = assessLossBandRankingResultCorrection({
    tournamentStatus: tournament.status,
    hasTournamentResults: tournamentResultsSnap.exists,
    hasPlacements: placementsSnap.exists,
    stateDoc,
    targetRoundDoc,
    matchId,
    existingResult,
    nextRoundDoc,
    nextRoundSessionsMap: sessionsMap,
    nextRoundResultsMap: resultsMap,
    expectedRevision: Number.isInteger(expectedRevision) ? expectedRevision : null,
  });
  if (!precheck.ok) {
    const error = new Error(precheck.message);
    error.code = precheck.code || "failed-precondition";
    throw error;
  }

  const pairings = pairingsFromRoundDoc(targetRoundDoc);
  const match = pairings.matches.find((m) => m.matchId === matchId);
  if (!match) {
    const error = new Error("対象試合がラウンドに存在しません。");
    error.code = "loss-band/match-not-in-round";
    throw error;
  }

  const session = sessionsMap.get(matchId) || null;
  const matchNumber =
    (targetRoundDoc.matchIds || []).indexOf(matchId) >= 0
      ? (targetRoundDoc.matchIds || []).indexOf(matchId) + 1
      : 1;
  const team1 = session?.team1 || {
    entryId: match.team1EntryId,
    teamName: match.team1EntryId,
    seed: matchNumber * 2 - 1,
  };
  const team2 = session?.team2 || {
    entryId: match.team2EntryId,
    teamName: match.team2EntryId,
    seed: matchNumber * 2,
  };

  const built = buildValidatedLossBandMatchResult({
    match,
    matchNumber,
    team1,
    team2,
    scoreInput: input.scoreInput,
    winsRequired: input.winsRequired ?? 2,
  });
  if (!built.valid) {
    const error = new Error(built.message || "invalid match result");
    error.code = "loss-band/invalid-result";
    throw error;
  }

  const priorCompletedRounds = [];
  for (let r = 1; r < targetRoundDoc.roundNumber; r += 1) {
    const prev = roundsById.get(buildLossBandRoundId(r));
    if (!prev || !isLossBandRankingRoundDoc(prev)) continue;
    const prevResults = (prev.matchIds || [])
      .map((id) => resultsMap.get(id))
      .filter(Boolean);
    // BYE results are optional for rebuild; include if present
    for (const bye of prev.byes || []) {
      const byeResult = resultsMap.get(bye.matchId);
      if (byeResult) prevResults.push(byeResult);
    }
    priorCompletedRounds.push({ roundDoc: prev, results: prevResults });
  }

  const targetRoundOtherResults = (targetRoundDoc.matchIds || [])
    .filter((id) => id !== matchId)
    .map((id) => resultsMap.get(id))
    .filter(Boolean);
  for (const bye of targetRoundDoc.byes || []) {
    const byeResult = resultsMap.get(bye.matchId);
    if (byeResult) targetRoundOtherResults.push(byeResult);
  }

  const plan = planCorrectLossBandRankingResult({
    stateDoc,
    targetRoundDoc,
    matchId,
    existingResult,
    correctedResult: built.data,
    priorCompletedRounds,
    targetRoundOtherResults,
    nextRoundDoc,
    nextRoundSessionsMap: sessionsMap,
    nextRoundResultsMap: resultsMap,
    hasPlacements: placementsSnap.exists,
    hasTournamentResults: tournamentResultsSnap.exists,
    tournamentStatus: tournament.status,
    expectedRevision: Number.isInteger(expectedRevision) ? expectedRevision : null,
    rematchAvoidance: stateDoc.rematchAvoidance === true,
  });

  await db.runTransaction(async (tx) => {
    const freshStateSnap = await tx.get(
      tournamentRef(db, tournamentId).collection("lossBandState").doc(LOSS_BAND_STATE_DOC_ID)
    );
    const freshPlacementsSnap = await tx.get(
      tournamentRef(db, tournamentId)
        .collection("lossBandPlacements")
        .doc(LOSS_BAND_PLACEMENTS_DOC_ID)
    );
    const freshTournamentResultsSnap = await tx.get(
      tournamentRef(db, tournamentId).collection("tournamentResults").doc("current")
    );
    const freshTournamentSnap = await tx.get(tournamentRef(db, tournamentId));
    const freshResultSnap = await tx.get(
      tournamentRef(db, tournamentId).collection("lossBandMatchResults").doc(matchId)
    );
    const freshTargetRoundSnap = await tx.get(
      tournamentRef(db, tournamentId).collection("lossBandRounds").doc(targetRoundDoc.roundId)
    );
    const freshNextRoundSnap = nextRoundDoc
      ? await tx.get(
          tournamentRef(db, tournamentId).collection("lossBandRounds").doc(nextRoundDoc.roundId)
        )
      : null;

    /** @type {Map<string, object>} */
    const freshSessions = new Map();
    /** @type {Map<string, object>} */
    const freshResults = new Map();
    if (nextRoundDoc) {
      for (const sid of nextRoundDoc.matchIds || []) {
        const s = await tx.get(
          tournamentRef(db, tournamentId).collection("lossBandMatchSessions").doc(sid)
        );
        if (s.exists) freshSessions.set(sid, { id: s.id, ...s.data() });
      }
      const nextResultIds = [
        ...(nextRoundDoc.matchIds || []),
        ...(nextRoundDoc.byeMatchIds || []),
        ...((nextRoundDoc.byes || []).map((b) => b.matchId).filter(Boolean)),
      ];
      for (const rid of [...new Set(nextResultIds)]) {
        const r = await tx.get(
          tournamentRef(db, tournamentId).collection("lossBandMatchResults").doc(rid)
        );
        if (r.exists) freshResults.set(rid, { id: r.id, ...r.data() });
      }
    }

    if (!freshStateSnap.exists || !freshTargetRoundSnap.exists || !freshResultSnap.exists) {
      const error = new Error("修正対象データが見つかりません。");
      error.code = "not-found";
      throw error;
    }

    const freshState = { id: freshStateSnap.id, ...freshStateSnap.data() };
    const freshTargetRound = {
      id: freshTargetRoundSnap.id,
      ...freshTargetRoundSnap.data(),
    };
    const freshExisting = { id: freshResultSnap.id, ...freshResultSnap.data() };
    const freshNext = freshNextRoundSnap?.exists
      ? { id: freshNextRoundSnap.id, ...freshNextRoundSnap.data() }
      : null;

    const locked = assessLossBandRankingResultCorrection({
      tournamentStatus: freshTournamentSnap.data()?.status,
      hasTournamentResults: freshTournamentResultsSnap.exists,
      hasPlacements: freshPlacementsSnap.exists,
      stateDoc: freshState,
      targetRoundDoc: freshTargetRound,
      matchId,
      existingResult: freshExisting,
      nextRoundDoc: freshNext,
      nextRoundSessionsMap: freshSessions,
      nextRoundResultsMap: freshResults,
      expectedRevision: Number.isInteger(expectedRevision) ? expectedRevision : null,
    });
    if (!locked.ok) {
      const error = new Error(locked.message);
      error.code = locked.code || "failed-precondition";
      throw error;
    }

    // 二重実行: revision が既に進んでいる場合は上で拒否。
    // discard 対象に started session が混入していないことを再確認。
    for (const [, sessionDoc] of freshSessions) {
      if (
        sessionDoc.status === MatchSessionStatus.PLAYING ||
        sessionDoc.status === MatchSessionStatus.FINISHED
      ) {
        const error = new Error(locked.message || "次のラウンドが開始されているため修正できません");
        error.code = "loss-band/next-round-started";
        throw error;
      }
    }

    const now = FieldValue.serverTimestamp();
    const resultPayload = removeUndefinedFields({
      ...plan.correctedResult,
      createdAt: freshExisting.createdAt ?? now,
      updatedAt: now,
      correctedAt: now,
    });
    tx.set(
      tournamentRef(db, tournamentId).collection("lossBandMatchResults").doc(matchId),
      resultPayload,
      { merge: true }
    );

    if (plan.discardNext) {
      tx.delete(
        tournamentRef(db, tournamentId)
          .collection("lossBandRounds")
          .doc(plan.discardNext.roundId)
      );
      for (const sid of plan.discardNext.sessionMatchIds) {
        tx.delete(
          tournamentRef(db, tournamentId).collection("lossBandMatchSessions").doc(sid)
        );
      }
      for (const rid of plan.discardNext.resultMatchIds) {
        // ロック通過後でも孤児 result があれば削除（開始済みは上で拒否済み）
        if (rid === matchId) continue;
        tx.delete(
          tournamentRef(db, tournamentId).collection("lossBandMatchResults").doc(rid)
        );
      }
    }

    if (plan.nextRoundPlan) {
      const next = plan.nextRoundPlan;
      tx.set(
        tournamentRef(db, tournamentId).collection("lossBandRounds").doc(next.roundDoc.roundId),
        removeUndefinedFields({
          ...next.roundDoc,
          createdAt: now,
          updatedAt: now,
        })
      );
      for (const { session: nextSession } of next.matchPlans) {
        tx.set(
          tournamentRef(db, tournamentId)
            .collection("lossBandMatchSessions")
            .doc(nextSession.matchId),
          removeUndefinedFields({
            ...nextSession,
            updatedAt: now,
          })
        );
      }
    }

    tx.set(
      tournamentRef(db, tournamentId).collection("lossBandState").doc(LOSS_BAND_STATE_DOC_ID),
      removeUndefinedFields({
        ...plan.nextStateDoc,
        updatedAt: now,
      }),
      { merge: true }
    );
  });

  let snapshotRebuilt = false;
  let snapshotError = null;
  try {
    await rebuildPublicSnapshotAdmin(db, tournamentId);
    snapshotRebuilt = true;
  } catch (error) {
    snapshotRebuilt = false;
    snapshotError = error?.message || String(error);
  }

  return {
    ok: true,
    tournamentId,
    matchId,
    revision: plan.nextRevision,
    discardedNextRoundId: plan.discardNext?.roundId ?? null,
    nextRoundId: plan.nextRoundPlan?.roundDoc?.roundId ?? null,
    nextRoundMatchCount: plan.nextRoundPlan?.matchPlans?.length ?? 0,
    estimatedOps: plan.estimatedOps,
    snapshotRebuilt,
    snapshotError,
  };
}
