/**
 * 敗戦帯ラウンド進行（純関数）
 * ペアリングは pairing.js（標準隣接 / 再戦回避）に委譲する。
 */
import {
  EXPECTED_BAND_COUNTS_AT_ROUND_START,
  LOSS_BAND_RANKING_ROUND_COUNT,
  LossBandPhase,
  R5_PLACEMENT_SPEC,
} from "./constants.js";
import {
  bandCountsEqual,
  getActiveBandCounts,
  listEntryIdsInBand,
  listUnplacedEntryIds,
} from "./state.js";
import {
  buildOpponentHistoryFromMatchLog,
  countRematchesInPairs,
  pairEntryIdsDeterministic,
  pairEntryIdsWithRematchAvoidance,
} from "./pairing.js";

export { pairEntryIdsDeterministic } from "./pairing.js";

/**
 * @param {number} roundNumber
 * @param {number} lossCount
 * @param {number} matchIndex 0-based within band
 */
export function buildLossBandMatchId(roundNumber, lossCount, matchIndex) {
  return `lb-r${roundNumber}-l${lossCount}-m${matchIndex + 1}`;
}

/**
 * 指定ラウンド開始時のペアリングを構築
 * @param {object} state
 * @param {number} roundNumber 1..5
 * @param {{ rematchAvoidance?: boolean }} [options]
 */
export function buildRankingRoundPairings(state, roundNumber, options = {}) {
  if (
    !Number.isInteger(roundNumber) ||
    roundNumber < 1 ||
    roundNumber > LOSS_BAND_RANKING_ROUND_COUNT
  ) {
    const error = new Error(`invalid ranking roundNumber: ${roundNumber}`);
    error.code = "loss-band/invalid-round";
    throw error;
  }

  if (state.phase !== LossBandPhase.RANKING) {
    const error = new Error(`cannot pair: phase is ${state.phase}`);
    error.code = "loss-band/invalid-phase";
    throw error;
  }

  if (state.completedRankingRound !== roundNumber - 1) {
    const error = new Error(
      `expected completedRankingRound=${roundNumber - 1}, got ${state.completedRankingRound}`
    );
    error.code = "loss-band/round-out-of-order";
    throw error;
  }

  const expected = EXPECTED_BAND_COUNTS_AT_ROUND_START[roundNumber];
  const actual = getActiveBandCounts(state);
  if (!bandCountsEqual(actual, expected)) {
    const error = new Error(
      `band counts mismatch at R${roundNumber} start: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`
    );
    error.code = "loss-band/band-count-mismatch";
    throw error;
  }

  const rematchAvoidance = options.rematchAvoidance === true;
  const history = buildOpponentHistoryFromMatchLog(state.matchLog);
  const matches = [];
  const byLossCount = {};
  let rematchCount = 0;

  for (const lossCount of Object.keys(expected)
    .map(Number)
    .sort((a, b) => a - b)) {
    const ids = listEntryIdsInBand(state, lossCount);
    let pairs;
    if (rematchAvoidance) {
      const paired = pairEntryIdsWithRematchAvoidance(ids, history);
      pairs = paired.pairs;
      rematchCount += paired.rematchCount;
    } else {
      pairs = pairEntryIdsDeterministic(ids);
      rematchCount += countRematchesInPairs(pairs, history);
    }

    const bandMatches = pairs.map(([team1EntryId, team2EntryId], index) => ({
      matchId: buildLossBandMatchId(roundNumber, lossCount, index),
      roundNumber,
      lossCount,
      team1EntryId,
      team2EntryId,
      purpose: "ranking",
    }));
    byLossCount[lossCount] = bandMatches;
    matches.push(...bandMatches);
  }

  const pairedIds = matches.flatMap((m) => [m.team1EntryId, m.team2EntryId]);
  const unplaced = listUnplacedEntryIds(state);
  if (pairedIds.length !== unplaced.length) {
    const error = new Error("pairing did not cover all unplaced teams");
    error.code = "loss-band/pairing-coverage";
    throw error;
  }
  if (new Set(pairedIds).size !== pairedIds.length) {
    const error = new Error("pairing produced duplicate entryIds");
    error.code = "loss-band/pairing-duplicate";
    throw error;
  }

  // 帯またぎ禁止の確認
  for (const match of matches) {
    if (
      state.teams[match.team1EntryId].lossCount !== match.lossCount ||
      state.teams[match.team2EntryId].lossCount !== match.lossCount
    ) {
      const error = new Error("cross-band pairing detected");
      error.code = "loss-band/cross-band";
      throw error;
    }
  }

  return {
    roundNumber,
    matches,
    byLossCount,
    rematchCount,
    rematchAvoidance,
  };
}

function appendMatchLog(state, pairings, outcomes) {
  const prev = Array.isArray(state.matchLog) ? state.matchLog : [];
  const additions = outcomes.map(({ match, winnerEntryId, loserEntryId }) => ({
    matchId: match.matchId,
    roundNumber: match.roundNumber,
    lossCount: match.lossCount,
    team1EntryId: match.team1EntryId,
    team2EntryId: match.team2EntryId,
    winnerEntryId,
    loserEntryId,
    purpose: match.purpose ?? "ranking",
  }));
  return [...prev, ...additions];
}

/**
 * @param {object} pairings
 * @param {Record<string, string>} results matchId → winnerEntryId
 */
function resolveMatchOutcomes(pairings, results) {
  if (!results || typeof results !== "object") {
    const error = new Error("results must be an object");
    error.code = "loss-band/invalid-results";
    throw error;
  }

  const outcomes = [];
  for (const match of pairings.matches) {
    const winnerEntryId = results[match.matchId];
    if (typeof winnerEntryId !== "string" || !winnerEntryId) {
      const error = new Error(`missing winner for ${match.matchId}`);
      error.code = "loss-band/missing-result";
      throw error;
    }
    if (
      winnerEntryId !== match.team1EntryId &&
      winnerEntryId !== match.team2EntryId
    ) {
      const error = new Error(
        `winner ${winnerEntryId} is not a participant of ${match.matchId}`
      );
      error.code = "loss-band/invalid-winner";
      throw error;
    }
    const loserEntryId =
      winnerEntryId === match.team1EntryId
        ? match.team2EntryId
        : match.team1EntryId;
    outcomes.push({
      match,
      winnerEntryId,
      loserEntryId,
    });
  }
  return outcomes;
}

function cloneTeams(teams) {
  const next = {};
  for (const [entryId, team] of Object.entries(teams)) {
    next[entryId] = { ...team };
  }
  return next;
}

/**
 * R1–R4: 勝者は lossCount 維持、敗者は +1。順位は付けない。
 * @param {object} state
 * @param {object} pairings
 * @param {Record<string, string>} results
 */
export function applyRankingRoundResults(state, pairings, results) {
  const roundNumber = pairings.roundNumber;
  if (roundNumber < 1 || roundNumber > LOSS_BAND_RANKING_ROUND_COUNT - 1) {
    const error = new Error(
      `applyRankingRoundResults is for R1–R4 only, got R${roundNumber}`
    );
    error.code = "loss-band/invalid-round";
    throw error;
  }

  if (state.completedRankingRound !== roundNumber - 1) {
    const error = new Error("round out of order");
    error.code = "loss-band/round-out-of-order";
    throw error;
  }

  const outcomes = resolveMatchOutcomes(pairings, results);
  const teams = cloneTeams(state.teams);

  for (const { match, winnerEntryId, loserEntryId } of outcomes) {
    if (teams[winnerEntryId].finalPlacement != null) {
      const error = new Error(`winner already placed: ${winnerEntryId}`);
      error.code = "loss-band/already-placed";
      throw error;
    }
    if (teams[loserEntryId].finalPlacement != null) {
      const error = new Error(`loser already placed: ${loserEntryId}`);
      error.code = "loss-band/already-placed";
      throw error;
    }
    if (teams[winnerEntryId].lossCount !== match.lossCount) {
      const error = new Error(`winner lossCount mismatch: ${winnerEntryId}`);
      error.code = "loss-band/loss-mismatch";
      throw error;
    }
    if (teams[loserEntryId].lossCount !== match.lossCount) {
      const error = new Error(`loser lossCount mismatch: ${loserEntryId}`);
      error.code = "loss-band/loss-mismatch";
      throw error;
    }
    // 勝者: lossCount 維持
    teams[loserEntryId] = {
      ...teams[loserEntryId],
      lossCount: match.lossCount + 1,
    };
  }

  return {
    ...state,
    teams,
    completedRankingRound: roundNumber,
    phase: LossBandPhase.RANKING,
    finalists: null,
    matchLog: appendMatchLog(state, pairings, outcomes),
  };
}

/**
 * R5: 帯ごとの勝敗で順位タイ確定＋0敗勝者を決勝進出。lossCount は動かさない（順位確定）。
 * @param {object} state
 * @param {object} pairings
 * @param {Record<string, string>} results
 */
export function applyFinalRankingRoundResults(state, pairings, results) {
  const roundNumber = pairings.roundNumber;
  if (roundNumber !== LOSS_BAND_RANKING_ROUND_COUNT) {
    const error = new Error(
      `applyFinalRankingRoundResults requires R${LOSS_BAND_RANKING_ROUND_COUNT}, got R${roundNumber}`
    );
    error.code = "loss-band/invalid-round";
    throw error;
  }

  if (state.completedRankingRound !== LOSS_BAND_RANKING_ROUND_COUNT - 1) {
    const error = new Error("round out of order for R5");
    error.code = "loss-band/round-out-of-order";
    throw error;
  }

  const outcomes = resolveMatchOutcomes(pairings, results);
  const teams = cloneTeams(state.teams);

  const winnersByLoss = new Map();
  const losersByLoss = new Map();

  for (const { match, winnerEntryId, loserEntryId } of outcomes) {
    if (teams[winnerEntryId].lossCount !== match.lossCount) {
      const error = new Error(`winner lossCount mismatch: ${winnerEntryId}`);
      error.code = "loss-band/loss-mismatch";
      throw error;
    }
    if (teams[loserEntryId].lossCount !== match.lossCount) {
      const error = new Error(`loser lossCount mismatch: ${loserEntryId}`);
      error.code = "loss-band/loss-mismatch";
      throw error;
    }
    if (!winnersByLoss.has(match.lossCount)) {
      winnersByLoss.set(match.lossCount, []);
      losersByLoss.set(match.lossCount, []);
    }
    winnersByLoss.get(match.lossCount).push(winnerEntryId);
    losersByLoss.get(match.lossCount).push(loserEntryId);
  }

  const finalists = [];

  for (const spec of R5_PLACEMENT_SPEC) {
    const pool =
      spec.outcome === "winner"
        ? winnersByLoss.get(spec.lossCount) ?? []
        : losersByLoss.get(spec.lossCount) ?? [];
    const sorted = [...pool].sort((a, b) => a.localeCompare(b, "en"));
    if (sorted.length !== spec.count) {
      const error = new Error(
        `R5 placement pool size mismatch loss=${spec.lossCount} outcome=${spec.outcome}: got ${sorted.length}, expected ${spec.count}`
      );
      error.code = "loss-band/r5-placement-count";
      throw error;
    }

    if (spec.placement == null) {
      // 0敗勝者 → 決勝
      finalists.push(...sorted);
      continue;
    }

    for (const entryId of sorted) {
      teams[entryId] = {
        ...teams[entryId],
        finalPlacement: spec.placement,
      };
    }
  }

  finalists.sort((a, b) => a.localeCompare(b, "en"));
  if (finalists.length !== 2) {
    const error = new Error(`expected 2 finalists, got ${finalists.length}`);
    error.code = "loss-band/finalist-count";
    throw error;
  }

  return {
    ...state,
    teams,
    completedRankingRound: LOSS_BAND_RANKING_ROUND_COUNT,
    phase: LossBandPhase.FINAL,
    finalists,
    matchLog: appendMatchLog(state, pairings, outcomes),
  };
}

/**
 * 決勝ペアリング（決定論: finalists 昇順で team1/team2）
 * @param {object} state
 */
export function buildFinalPairing(state) {
  if (state.phase !== LossBandPhase.FINAL) {
    const error = new Error(`cannot build final: phase is ${state.phase}`);
    error.code = "loss-band/invalid-phase";
    throw error;
  }
  if (!Array.isArray(state.finalists) || state.finalists.length !== 2) {
    const error = new Error("finalists must be exactly 2 entryIds");
    error.code = "loss-band/finalist-count";
    throw error;
  }

  const [team1EntryId, team2EntryId] = [...state.finalists].sort((a, b) =>
    a.localeCompare(b, "en")
  );

  return {
    roundNumber: LOSS_BAND_RANKING_ROUND_COUNT + 1,
    matchId: "lb-final",
    team1EntryId,
    team2EntryId,
    purpose: "final",
  };
}

/**
 * 決勝結果適用 → 1位 / 2位確定、大会完了
 * @param {object} state
 * @param {string} winnerEntryId
 */
export function applyFinalResult(state, winnerEntryId) {
  if (state.phase !== LossBandPhase.FINAL) {
    const error = new Error(`cannot apply final: phase is ${state.phase}`);
    error.code = "loss-band/invalid-phase";
    throw error;
  }

  const final = buildFinalPairing(state);
  if (
    winnerEntryId !== final.team1EntryId &&
    winnerEntryId !== final.team2EntryId
  ) {
    const error = new Error(`winner is not a finalist: ${winnerEntryId}`);
    error.code = "loss-band/invalid-winner";
    throw error;
  }

  const loserEntryId =
    winnerEntryId === final.team1EntryId
      ? final.team2EntryId
      : final.team1EntryId;

  const teams = cloneTeams(state.teams);
  if (teams[winnerEntryId].finalPlacement != null) {
    const error = new Error("finalist already has placement");
    error.code = "loss-band/already-placed";
    throw error;
  }
  if (teams[loserEntryId].finalPlacement != null) {
    const error = new Error("finalist already has placement");
    error.code = "loss-band/already-placed";
    throw error;
  }

  teams[winnerEntryId] = { ...teams[winnerEntryId], finalPlacement: 1 };
  teams[loserEntryId] = { ...teams[loserEntryId], finalPlacement: 2 };

  const prevLog = Array.isArray(state.matchLog) ? state.matchLog : [];
  const matchLog = [
    ...prevLog,
    {
      matchId: final.matchId,
      roundNumber: final.roundNumber,
      lossCount: 0,
      team1EntryId: final.team1EntryId,
      team2EntryId: final.team2EntryId,
      winnerEntryId,
      loserEntryId,
      purpose: "final",
    },
  ];

  return {
    ...state,
    teams,
    phase: LossBandPhase.COMPLETE,
    finalists: state.finalists,
    matchLog,
  };
}

/**
 * テスト用: team1 を常に勝者とする結果マップ（決定論）
 * @param {object} pairings
 * @returns {Record<string, string>}
 */
export function buildDeterministicTeam1WinsResults(pairings) {
  const results = {};
  for (const match of pairings.matches) {
    results[match.matchId] = match.team1EntryId;
  }
  return results;
}
