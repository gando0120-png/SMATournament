/**
 * 敗戦帯（loss_band）Firestore 操作（DOM 非依存）
 * SE の nextMatchId 進行は使わない。全試合完了時のみ次ラウンド生成。
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  serverTimestamp,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { getFirebaseDb, isFirebaseConfigured } from "../lib/firebase-app.js";
import { ConfigUnconfiguredError } from "../lib/errors.js";
import { MatchSessionStatus } from "../domain/constants.js";
import { RankingMode, resolveMainRankingMode } from "../domain/loss-band/config.js";
import {
  LOSS_BAND_STATE_DOC_ID,
  LOSS_BAND_PLACEMENTS_DOC_ID,
  buildValidatedLossBandMatchResult,
  planAfterLossBandMatchSaved,
  planLossBandInitialize,
  pairingsFromRoundDoc,
} from "../domain/loss-band/persistence.js";
import { getTournament, requireOpenTournament } from "./tournament-service.js";

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

function stateRef(db, tournamentId) {
  return doc(db, "tournaments", tournamentId, "lossBandState", LOSS_BAND_STATE_DOC_ID);
}

function roundRef(db, tournamentId, roundId) {
  return doc(db, "tournaments", tournamentId, "lossBandRounds", roundId);
}

function sessionRef(db, tournamentId, matchId) {
  return doc(db, "tournaments", tournamentId, "lossBandMatchSessions", matchId);
}

function resultRef(db, tournamentId, matchId) {
  return doc(db, "tournaments", tournamentId, "lossBandMatchResults", matchId);
}

function placementsRef(db, tournamentId) {
  return doc(
    db,
    "tournaments",
    tournamentId,
    "lossBandPlacements",
    LOSS_BAND_PLACEMENTS_DOC_ID
  );
}

function mapDoc(snap) {
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/**
 * @param {string} tournamentId
 * @param {string[]} entryIds
 * @param {{ rematchAvoidance?: boolean, allowInternalInit?: boolean }} [options]
 */
export async function initializeLossBand(tournamentId, entryIds, options = {}) {
  await requireOpenTournament(tournamentId);
  const tournament = await getTournament(tournamentId);
  const mode = resolveMainRankingMode(tournament);
  if (mode !== RankingMode.LOSS_BAND && options.allowInternalInit !== true) {
    const error = new Error("tournament rankingMode must be loss_band");
    error.code = "loss-band/ranking-mode-required";
    throw error;
  }

  const db = requireDb();
  const existing = await getDoc(stateRef(db, tournamentId));
  if (existing.exists()) {
    const error = new Error("loss-band already initialized");
    error.code = "loss-band/already-initialized";
    throw error;
  }

  const plan = planLossBandInitialize(entryIds, {
    rematchAvoidance: options.rematchAvoidance === true,
    thirdPlaceMatch: options.thirdPlaceMatch === true,
  });

  const batch = writeBatch(db);
  const now = serverTimestamp();
  batch.set(stateRef(db, tournamentId), {
    ...plan.stateDoc,
    createdAt: now,
    updatedAt: now,
  });
  batch.set(roundRef(db, tournamentId, plan.roundDoc.roundId), {
    ...plan.roundDoc,
    createdAt: now,
    updatedAt: now,
  });
  for (const { session } of plan.matchPlans) {
    batch.set(sessionRef(db, tournamentId, session.matchId), {
      ...session,
      startedAt: now,
      updatedAt: now,
    });
  }
  await batch.commit();

  return {
    state: plan.stateDoc,
    round: plan.roundDoc,
    matchCount: plan.matchPlans.length,
  };
}

/**
 * @param {string} tournamentId
 */
export async function getLossBandState(tournamentId) {
  const db = requireDb();
  return mapDoc(await getDoc(stateRef(db, tournamentId)));
}

/**
 * @param {string} tournamentId
 * @param {string|number} roundIdOrNumber
 */
export async function getLossBandRound(tournamentId, roundIdOrNumber) {
  const db = requireDb();
  let roundId;
  if (typeof roundIdOrNumber === "number") {
    if (roundIdOrNumber === 6) roundId = "final";
    else if (roundIdOrNumber === 7) roundId = "third_place";
    else roundId = `r${roundIdOrNumber}`;
  } else {
    roundId = String(roundIdOrNumber);
  }
  return mapDoc(await getDoc(roundRef(db, tournamentId, roundId)));
}

/**
 * @param {string} tournamentId
 */
export async function getLossBandPlacements(tournamentId) {
  const db = requireDb();
  return mapDoc(await getDoc(placementsRef(db, tournamentId)));
}

/**
 * @param {string} tournamentId
 */
export async function getLossBandMatchResults(tournamentId) {
  const db = requireDb();
  const snapshot = await getDocs(
    collection(db, "tournaments", tournamentId, "lossBandMatchResults")
  );
  const map = new Map();
  snapshot.forEach((snap) => {
    map.set(snap.id, { id: snap.id, ...snap.data() });
  });
  return map;
}

/**
 * @param {string} tournamentId
 * @param {string|number} roundIdOrNumber
 */
export async function getLossBandRoundResults(tournamentId, roundIdOrNumber) {
  const round = await getLossBandRound(tournamentId, roundIdOrNumber);
  if (!round) return [];
  const all = await getLossBandMatchResults(tournamentId);
  return (round.matchIds || [])
    .map((id) => all.get(id))
    .filter(Boolean);
}

/**
 * 得点入力を保存。ラウンド全試合完了時のみ次ラウンドを生成する。
 * @param {string} tournamentId
 * @param {string} matchId
 * @param {object} scoreInput
 * @param {{ winsRequired?: number }} [options]
 */
export async function saveLossBandMatchResult(
  tournamentId,
  matchId,
  scoreInput,
  options = {}
) {
  await requireOpenTournament(tournamentId);
  const db = requireDb();

  const state = await getLossBandState(tournamentId);
  if (!state) {
    const error = new Error("loss-band not initialized");
    error.code = "loss-band/not-initialized";
    throw error;
  }

  if (state.status === "completed") {
    const error = new Error("loss-band already completed");
    error.code = "loss-band/already-complete";
    throw error;
  }

  const roundNumber = state.currentRound;
  const roundId = state.currentRoundId || `r${roundNumber}`;
  const round = await getLossBandRound(tournamentId, roundId);
  if (!round) {
    const error = new Error(`round ${roundId} missing`);
    error.code = "loss-band/round-missing";
    throw error;
  }

  const pairings = pairingsFromRoundDoc(round);
  const match = pairings.matches.find((m) => m.matchId === matchId);
  if (!match) {
    const error = new Error(`match ${matchId} not in current round`);
    error.code = "loss-band/match-not-in-round";
    throw error;
  }

  const matchNumber =
    (round.matchIds || []).indexOf(matchId) >= 0
      ? (round.matchIds || []).indexOf(matchId) + 1
      : 1;

  const sessionSnap = await getDoc(sessionRef(db, tournamentId, matchId));
  const session = mapDoc(sessionSnap);
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
    scoreInput,
    winsRequired: options.winsRequired ?? 2,
  });
  if (!built.valid) {
    const error = new Error(built.message || "invalid match result");
    error.code = "loss-band/invalid-result";
    throw error;
  }

  const priorResults = await getLossBandRoundResults(tournamentId, roundId);
  const priorCompletedRounds = [];
  for (let r = 1; r <= 5; r += 1) {
    if (roundId === `r${r}`) break;
    const prevRound = await getLossBandRound(tournamentId, r);
    const prevResults = await getLossBandRoundResults(tournamentId, r);
    if (prevRound && prevResults.length === (prevRound.matchIds || []).length) {
      priorCompletedRounds.push({ roundDoc: prevRound, results: prevResults });
    }
  }
  if (roundId === "final" || roundId === "third_place") {
    // r1-r5 already added; include final when applying third place
    if (roundId === "third_place") {
      const finalRound = await getLossBandRound(tournamentId, "final");
      const finalResults = await getLossBandRoundResults(tournamentId, "final");
      if (finalRound && finalResults.length > 0) {
        priorCompletedRounds.push({
          roundDoc: finalRound,
          results: finalResults,
        });
      }
    }
  }

  const plan = planAfterLossBandMatchSaved({
    stateDoc: state,
    roundDoc: round,
    priorCompletedResults: priorResults,
    priorCompletedRounds,
    newResult: built.data,
    rematchAvoidance: state.rematchAvoidance === true,
  });

  await runTransaction(db, async (tx) => {
    const resultSnap = await tx.get(resultRef(db, tournamentId, matchId));
    if (resultSnap.exists()) {
      const error = new Error("result already exists");
      error.code = "loss-band/result-exists";
      throw error;
    }

    const now = serverTimestamp();
    tx.set(resultRef(db, tournamentId, matchId), {
      ...built.data,
      createdAt: now,
      updatedAt: now,
    });

    if (sessionSnap.exists()) {
      tx.update(sessionRef(db, tournamentId, matchId), {
        status: MatchSessionStatus.FINISHED,
        finishedAt: now,
        updatedAt: now,
      });
    }

    tx.set(
      roundRef(db, tournamentId, plan.nextRoundDoc.roundId),
      {
        ...plan.nextRoundDoc,
        updatedAt: now,
      },
      { merge: true }
    );

    tx.set(
      stateRef(db, tournamentId),
      {
        ...plan.nextStateDoc,
        updatedAt: now,
      },
      { merge: true }
    );

    if (plan.nextRoundPlan) {
      const next = plan.nextRoundPlan;
      tx.set(roundRef(db, tournamentId, next.roundDoc.roundId), {
        ...next.roundDoc,
        createdAt: now,
        updatedAt: now,
      });
      for (const { session: nextSession } of next.matchPlans) {
        tx.set(sessionRef(db, tournamentId, nextSession.matchId), {
          ...nextSession,
          startedAt: now,
          updatedAt: now,
        });
      }
    }

    if (plan.placementsDoc) {
      tx.set(placementsRef(db, tournamentId), {
        ...plan.placementsDoc,
        createdAt: now,
        updatedAt: now,
      });
    }
  });

  return {
    result: built.data,
    roundComplete: plan.roundComplete,
    nextRound: plan.nextRoundPlan?.roundDoc ?? null,
    state: plan.nextStateDoc,
    placements: plan.placementsDoc,
    completion: plan.completion,
  };
}
