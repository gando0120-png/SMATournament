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
import { MatchSessionStatus, EntryStatus } from "../domain/constants.js";
import {
  resolveMainRankingMode,
  normalizeLossBandSideOptions,
} from "../domain/loss-band/config.js";
import {
  LOSS_BAND_MIN_TEAM_COUNT,
  LOSS_BAND_MAX_TEAM_COUNT,
  RankingMode,
} from "../domain/loss-band/constants.js";
import {
  LOSS_BAND_STATE_DOC_ID,
  LOSS_BAND_PLACEMENTS_DOC_ID,
  buildValidatedLossBandMatchResult,
  buildLossBandByeResultDoc,
  buildLossBandMatchSessionDoc,
  validateLossBandMatchSessionStructure,
  planAfterLossBandMatchSaved,
  planAfterExchangeMatchSaved,
  planLossBandInitialize,
  pairingsFromRoundDoc,
  rebuildDomainStateFromCompletedRounds,
  winnersMapFromResults,
} from "../domain/loss-band/persistence.js";
import { appendExchangeResultsToMatchLog } from "../domain/loss-band/exchange.js";
import {
  resolveAndValidateLossBandSize,
  rankingRoundCountFromState,
} from "../domain/loss-band/bracket.js";
import { listEntries } from "./entry-service.js";
import { getTournament, requireOpenTournament } from "./tournament-service.js";
import { ensureTournamentStructureLocked } from "./tournament-progress-service.js";
import { withPublicSnapshotRebuild } from "../lib/public-snapshot-hook.js";

/**
 * 公開スナップショット再生成タイミング:
 * - 初期化時
 * - 試合結果保存ごと（決勝ブラケットと同様に進行追従）
 * ラウンド確定・R5・final・third・交流戦完了・placements も試合保存に含まれる。
 * 大会結果確定時は tournament-results-service 側で再生成する。
 */
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

function exchangeRoundRef(db, tournamentId, roundId) {
  return doc(db, "tournaments", tournamentId, "lossBandExchangeRounds", roundId);
}

function exchangeSessionRef(db, tournamentId, matchId) {
  return doc(
    db,
    "tournaments",
    tournamentId,
    "lossBandExchangeMatchSessions",
    matchId
  );
}

function exchangeResultRef(db, tournamentId, matchId) {
  return doc(
    db,
    "tournaments",
    tournamentId,
    "lossBandExchangeMatchResults",
    matchId
  );
}

function mapDoc(snap) {
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/**
 * @param {string} tournamentId
 * @param {string[]} entryIds
 * @param {{
 *   rematchAvoidance?: boolean,
 *   thirdPlaceMatch?: boolean,
 *   exchangeMatches?: boolean,
 *   guaranteedMatchCount?: number,
 *   teamNameByEntryId?: Record<string, string>,
 *   allowInternalInit?: boolean
 * }} [options]
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

  const size = resolveAndValidateLossBandSize(
    entryIds.length,
    options.bracketSize
  );
  if (!size.valid) {
    const error = new Error(size.error);
    error.code = size.code || "loss-band/team-count";
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
    exchangeMatches: options.exchangeMatches === true,
    guaranteedMatchCount: options.guaranteedMatchCount,
    bracketSize: size.bracketSize,
  });

  const teamNameByEntryId = options.teamNameByEntryId || {};
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
  for (const { match, matchNumber, session } of plan.matchPlans) {
    const namedSession = buildLossBandMatchSessionDoc(
      match,
      matchNumber,
      {
        entryId: match.team1EntryId,
        teamName: teamNameByEntryId[match.team1EntryId] || match.team1EntryId,
      },
      {
        entryId: match.team2EntryId,
        teamName: teamNameByEntryId[match.team2EntryId] || match.team2EntryId,
      }
    );
    batch.set(sessionRef(db, tournamentId, namedSession.matchId), {
      ...namedSession,
      startedAt: now,
      updatedAt: now,
    });
    void session;
  }
  await batch.commit();
  await ensureTournamentStructureLocked(tournamentId, tournament);

  return withPublicSnapshotRebuild(tournamentId, {
    state: plan.stateDoc,
    round: plan.roundDoc,
    matchCount: plan.matchPlans.length,
  });
}

/**
 * 大会設定と確定エントリーから R1 を初期化
 * @param {string} tournamentId
 */
export async function createLossBandFromTournament(tournamentId) {
  await requireOpenTournament(tournamentId);
  const tournament = await getTournament(tournamentId);
  const mode = resolveMainRankingMode(tournament);
  if (mode !== RankingMode.LOSS_BAND) {
    const error = new Error("tournament rankingMode must be loss_band");
    error.code = "loss-band/ranking-mode-required";
    throw error;
  }

  const entries = await listEntries(tournamentId);
  const confirmed = entries.filter((e) => e.status === EntryStatus.CONFIRMED);
  const main = tournament.bracketMatchConfig?.main || {};
  const opts = normalizeLossBandSideOptions(main, {
    teamCount: confirmed.length,
    bracketSize: main.bracketSize,
  });
  const size = resolveAndValidateLossBandSize(
    confirmed.length,
    opts.bracketSize
  );
  if (!size.valid) {
    const error = new Error(
      `順位決定方式は確定${LOSS_BAND_MIN_TEAM_COUNT}〜${LOSS_BAND_MAX_TEAM_COUNT}チームが必要です（現在${confirmed.length}）。`
    );
    error.code = "loss-band/team-count";
    throw error;
  }

  const teamNameByEntryId = Object.fromEntries(
    confirmed.map((e) => [e.id, e.teamName || e.id])
  );

  return initializeLossBand(
    tournamentId,
    confirmed.map((e) => e.id),
    {
      ...opts,
      bracketSize: size.bracketSize,
      guaranteedMatchCount: opts.guaranteedMatchCount,
      teamNameByEntryId,
    }
  );
}

/**
 * @param {string} tournamentId
 */
export async function getLossBandMatchSessions(tournamentId) {
  const db = requireDb();
  const snapshot = await getDocs(
    collection(db, "tournaments", tournamentId, "lossBandMatchSessions")
  );
  const map = new Map();
  snapshot.forEach((snap) => {
    map.set(snap.id, { id: snap.id, ...snap.data() });
  });
  return map;
}

/**
 * @param {string} tournamentId
 */
export async function listLossBandRounds(tournamentId) {
  const db = requireDb();
  const snapshot = await getDocs(
    collection(db, "tournaments", tournamentId, "lossBandRounds")
  );
  const list = [];
  snapshot.forEach((snap) => list.push({ id: snap.id, ...snap.data() }));
  list.sort((a, b) => {
    const an = a.roundNumber ?? 0;
    const bn = b.roundNumber ?? 0;
    return an - bn;
  });
  return list;
}

/**
 * @param {string} tournamentId
 */
export async function getLossBandExchangeMatchSessions(tournamentId) {
  const db = requireDb();
  const snapshot = await getDocs(
    collection(db, "tournaments", tournamentId, "lossBandExchangeMatchSessions")
  );
  const map = new Map();
  snapshot.forEach((snap) => {
    map.set(snap.id, { id: snap.id, ...snap.data() });
  });
  return map;
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

  if (state.status === "exchange_pending") {
    return saveLossBandExchangeMatchResult(
      tournamentId,
      matchId,
      scoreInput,
      options
    );
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
  if (sessionSnap.exists()) {
    const structure = validateLossBandMatchSessionStructure(session);
    if (!structure.valid) {
      const error = new Error(
        structure.message ||
          "試合データが不完全です。大会データを確認してください。"
      );
      error.code = "loss-band/incomplete-session";
      error.missing = structure.missing;
      throw error;
    }
  }
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
  const rankingRounds = rankingRoundCountFromState(state, state.entryIds);
  for (let r = 1; r <= rankingRounds; r += 1) {
    if (roundId === `r${r}`) break;
    const prevRound = await getLossBandRound(tournamentId, r);
    const prevResults = await getLossBandRoundResults(tournamentId, r);
    if (prevRound && prevResults.length === (prevRound.matchIds || []).length) {
      priorCompletedRounds.push({ roundDoc: prevRound, results: prevResults });
    }
  }
  if (roundId === "final" || roundId === "third_place") {
    // ranking rounds already added; include final when applying third place
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

    if (plan.roundComplete) {
      const completedPairings = pairingsFromRoundDoc(plan.nextRoundDoc);
      for (const bye of completedPairings.byes ?? []) {
        tx.set(resultRef(db, tournamentId, bye.matchId), {
          ...buildLossBandByeResultDoc(bye),
          createdAt: now,
          updatedAt: now,
        });
      }
    }

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

    if (plan.exchangeRoundPlan) {
      const ex = plan.exchangeRoundPlan;
      tx.set(exchangeRoundRef(db, tournamentId, ex.roundDoc.roundId), {
        ...ex.roundDoc,
        createdAt: now,
        updatedAt: now,
      });
      for (const { session: nextSession } of ex.matchPlans) {
        tx.set(exchangeSessionRef(db, tournamentId, nextSession.matchId), {
          ...nextSession,
          startedAt: now,
          updatedAt: now,
        });
      }
    }
  });

  return withPublicSnapshotRebuild(tournamentId, {
    result: built.data,
    roundComplete: plan.roundComplete,
    nextRound: plan.nextRoundPlan?.roundDoc ?? null,
    exchangeRound: plan.exchangeRoundPlan?.roundDoc ?? null,
    state: plan.nextStateDoc,
    placements: plan.placementsDoc,
    completion: plan.completion,
  });
}

/**
 * @param {string} tournamentId
 * @param {string} roundId
 */
export async function getLossBandExchangeRound(tournamentId, roundId) {
  const db = requireDb();
  return mapDoc(await getDoc(exchangeRoundRef(db, tournamentId, roundId)));
}

/**
 * @param {string} tournamentId
 */
export async function listLossBandExchangeRounds(tournamentId) {
  const db = requireDb();
  const snapshot = await getDocs(
    collection(db, "tournaments", tournamentId, "lossBandExchangeRounds")
  );
  const list = [];
  snapshot.forEach((snap) => list.push({ id: snap.id, ...snap.data() }));
  list.sort(
    (a, b) => (a.exchangeRoundNumber ?? 0) - (b.exchangeRoundNumber ?? 0)
  );
  return list;
}

/**
 * @param {string} tournamentId
 * @param {string} roundId
 */
async function getLossBandExchangeRoundResults(tournamentId, roundId) {
  const round = await getLossBandExchangeRound(tournamentId, roundId);
  if (!round) return [];
  const db = requireDb();
  const snapshot = await getDocs(
    collection(db, "tournaments", tournamentId, "lossBandExchangeMatchResults")
  );
  const byId = new Map();
  snapshot.forEach((snap) => byId.set(snap.id, { id: snap.id, ...snap.data() }));
  return (round.matchIds || []).map((id) => byId.get(id)).filter(Boolean);
}

/**
 * @param {string} tournamentId
 */
export async function getLossBandExchangeMatchResults(tournamentId) {
  const db = requireDb();
  const snapshot = await getDocs(
    collection(db, "tournaments", tournamentId, "lossBandExchangeMatchResults")
  );
  const map = new Map();
  snapshot.forEach((snap) => {
    map.set(snap.id, { id: snap.id, ...snap.data() });
  });
  return map;
}

/**
 * 交流戦結果保存
 * @param {string} tournamentId
 * @param {string} matchId
 * @param {object} scoreInput
 * @param {{ winsRequired?: number }} [options]
 */
export async function saveLossBandExchangeMatchResult(
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
  if (state.status !== "exchange_pending") {
    const error = new Error("exchange not pending");
    error.code = "loss-band/exchange-not-pending";
    throw error;
  }

  const roundId = state.currentRoundId;
  const round = await getLossBandExchangeRound(tournamentId, roundId);
  if (!round) {
    const error = new Error(`exchange round ${roundId} missing`);
    error.code = "loss-band/round-missing";
    throw error;
  }

  const pair = (round.pairs || []).find((p) => p.matchId === matchId);
  if (!pair) {
    const error = new Error(`match ${matchId} not in exchange round`);
    error.code = "loss-band/match-not-in-round";
    throw error;
  }

  const matchNumber = (round.matchIds || []).indexOf(matchId) + 1;
  const sessionSnap = await getDoc(exchangeSessionRef(db, tournamentId, matchId));
  const session = mapDoc(sessionSnap);
  const match = {
    matchId,
    exchangeRoundNumber: round.exchangeRoundNumber,
    roundNumber: round.exchangeRoundNumber,
    lossCount: 0,
    team1EntryId: pair.team1EntryId,
    team2EntryId: pair.team2EntryId,
    purpose: LossBandMatchPurpose.EXCHANGE,
  };
  const team1 = session?.team1 || {
    entryId: pair.team1EntryId,
    teamName: pair.team1EntryId,
    seed: 1,
  };
  const team2 = session?.team2 || {
    entryId: pair.team2EntryId,
    teamName: pair.team2EntryId,
    seed: 2,
  };

  const built = buildValidatedLossBandMatchResult({
    match,
    matchNumber: matchNumber > 0 ? matchNumber : 1,
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

  // rebuild ranking domain state
  const priorCompletedRounds = [];
  const rankingRounds = rankingRoundCountFromState(state, state.entryIds);
  for (let r = 1; r <= rankingRounds; r += 1) {
    const prevRound = await getLossBandRound(tournamentId, r);
    const prevResults = await getLossBandRoundResults(tournamentId, r);
    if (prevRound && prevResults.length === (prevRound.matchIds || []).length) {
      priorCompletedRounds.push({ roundDoc: prevRound, results: prevResults });
    }
  }
  const finalRound = await getLossBandRound(tournamentId, "final");
  const finalResults = await getLossBandRoundResults(tournamentId, "final");
  if (finalRound && finalResults.length > 0) {
    priorCompletedRounds.push({ roundDoc: finalRound, results: finalResults });
  }
  if (state.thirdPlaceMatch) {
    const thirdRound = await getLossBandRound(tournamentId, "third_place");
    const thirdResults = await getLossBandRoundResults(
      tournamentId,
      "third_place"
    );
    if (thirdRound && thirdResults.length > 0) {
      priorCompletedRounds.push({
        roundDoc: thirdRound,
        results: thirdResults,
      });
    }
  }

  let domainState = rebuildDomainStateFromCompletedRounds(
    state.entryIds,
    priorCompletedRounds,
    {
      thirdPlaceMatch: state.thirdPlaceMatch === true,
      rematchAvoidance: state.rematchAvoidance === true,
    }
  );

  const allExchangeRounds = await listLossBandExchangeRounds(tournamentId);
  const priorExchangeRounds = [];
  for (const exRound of allExchangeRounds) {
    if (exRound.roundId === round.roundId) {
      break;
    }
    const exResults = await getLossBandExchangeRoundResults(
      tournamentId,
      exRound.roundId
    );
    if (exResults.length === (exRound.matchIds || []).length) {
      priorExchangeRounds.push(exRound);
      const winners = winnersMapFromResults(exResults);
      domainState = appendExchangeResultsToMatchLog(
        domainState,
        {
          matches: (exRound.pairs || []).map((p) => ({
            matchId: p.matchId,
            exchangeRoundNumber: exRound.exchangeRoundNumber,
            team1EntryId: p.team1EntryId,
            team2EntryId: p.team2EntryId,
            purpose: LossBandMatchPurpose.EXCHANGE,
          })),
        },
        winners
      );
    }
  }

  const priorResults = await getLossBandExchangeRoundResults(
    tournamentId,
    round.roundId
  );

  const plan = planAfterExchangeMatchSaved({
    stateDoc: state,
    exchangeRoundDoc: round,
    priorCompletedResults: priorResults,
    newResult: built.data,
    domainStateBeforeExchangeAppend: domainState,
    priorExchangeRounds,
  });

  await runTransaction(db, async (tx) => {
    const resultSnap = await tx.get(exchangeResultRef(db, tournamentId, matchId));
    if (resultSnap.exists()) {
      const error = new Error("result already exists");
      error.code = "loss-band/result-exists";
      throw error;
    }
    const now = serverTimestamp();
    tx.set(exchangeResultRef(db, tournamentId, matchId), {
      ...built.data,
      createdAt: now,
      updatedAt: now,
    });
    if (sessionSnap.exists()) {
      tx.update(exchangeSessionRef(db, tournamentId, matchId), {
        status: MatchSessionStatus.FINISHED,
        finishedAt: now,
        updatedAt: now,
      });
    }
    tx.set(
      exchangeRoundRef(db, tournamentId, plan.nextRoundDoc.roundId),
      { ...plan.nextRoundDoc, updatedAt: now },
      { merge: true }
    );
    tx.set(
      stateRef(db, tournamentId),
      { ...plan.nextStateDoc, updatedAt: now },
      { merge: true }
    );
    if (plan.nextExchangePlan) {
      const next = plan.nextExchangePlan;
      tx.set(exchangeRoundRef(db, tournamentId, next.roundDoc.roundId), {
        ...next.roundDoc,
        createdAt: now,
        updatedAt: now,
      });
      for (const { session: nextSession } of next.matchPlans) {
        tx.set(exchangeSessionRef(db, tournamentId, nextSession.matchId), {
          ...nextSession,
          startedAt: now,
          updatedAt: now,
        });
      }
    }
  });

  return withPublicSnapshotRebuild(tournamentId, {
    result: built.data,
    roundComplete: plan.roundComplete,
    nextExchangeRound: plan.nextExchangePlan?.roundDoc ?? null,
    state: plan.nextStateDoc,
    tournamentComplete: plan.tournamentComplete === true,
    domainState: plan.domainState,
  });
}
