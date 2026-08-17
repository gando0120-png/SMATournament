/**
 * 敗戦帯ラウンド進行（純関数）
 * ペアリングは pairing.js（標準隣接 / 再戦回避）に委譲する。
 * BYE は先に決定し、残りでペアリングする。
 */
import { LossBandMatchPurpose, LossBandPhase } from "./constants.js";
import {
  bracketSizeFromState,
  expectedBandCountsAtRoundStart,
  finalRoundNumber,
  rankingRoundCountFromState,
  thirdPlaceRoundNumber,
} from "./bracket.js";
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
import {
  buildByeAssignment,
  buildByeCountsFromState,
  selectByeAndPlayingEntryIds,
} from "./bye.js";
import { buildOlympicR5PlacementPlan } from "./olympic-placements.js";

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
 * @param {number} roundNumber 1..rankingRoundCount(bracketSize)
 * @param {{ rematchAvoidance?: boolean }} [options]
 */
export function buildRankingRoundPairings(state, roundNumber, options = {}) {
  const rankingRounds = rankingRoundCountFromState(state);
  if (
    !Number.isInteger(roundNumber) ||
    roundNumber < 1 ||
    roundNumber > rankingRounds
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

  const actual = getActiveBandCounts(state);
  const bracketSize = bracketSizeFromState(state);
  // BYE なし（枠ちょうど）のみ一般式で帯人数を検証
  if (state.teamCount === bracketSize) {
    const expected = expectedBandCountsAtRoundStart(bracketSize, roundNumber);
    if (expected && !bandCountsEqual(actual, expected)) {
      const error = new Error(
        `band counts mismatch at R${roundNumber} start: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`
      );
      error.code = "loss-band/band-count-mismatch";
      throw error;
    }
  }

  const rematchAvoidance =
    options.rematchAvoidance === true || state.rematchAvoidance === true;
  const history = buildOpponentHistoryFromMatchLog(state.matchLog);
  const byeCounts = buildByeCountsFromState(state);
  const matches = [];
  const byes = [];
  const byLossCount = {};
  let rematchCount = 0;

  const lossKeys = Object.keys(actual)
    .map(Number)
    .sort((a, b) => a - b);

  for (const lossCount of lossKeys) {
    const ids = listEntryIdsInBand(state, lossCount);
    const { byeEntryId, playingEntryIds } = selectByeAndPlayingEntryIds(
      ids,
      byeCounts
    );

    if (byeEntryId) {
      const bye = buildByeAssignment({
        roundNumber,
        lossCount,
        entryId: byeEntryId,
      });
      byes.push(bye);
      byeCounts.set(byeEntryId, (byeCounts.get(byeEntryId) ?? 0) + 1);
    }

    let pairs;
    if (playingEntryIds.length === 0) {
      pairs = [];
    } else if (rematchAvoidance) {
      const paired = pairEntryIdsWithRematchAvoidance(playingEntryIds, history);
      pairs = paired.pairs;
      rematchCount += paired.rematchCount;
    } else {
      pairs = pairEntryIdsDeterministic(playingEntryIds);
      rematchCount += countRematchesInPairs(pairs, history);
    }

    const bandMatches = pairs.map(([team1EntryId, team2EntryId], index) => ({
      matchId: buildLossBandMatchId(roundNumber, lossCount, index),
      roundNumber,
      lossCount,
      team1EntryId,
      team2EntryId,
      purpose: LossBandMatchPurpose.RANKING,
      isBye: false,
    }));
    byLossCount[lossCount] = bandMatches;
    matches.push(...bandMatches);
  }

  const pairedIds = matches.flatMap((m) => [m.team1EntryId, m.team2EntryId]);
  const byeIds = byes.map((b) => b.entryId);
  const covered = [...pairedIds, ...byeIds];
  const unplaced = listUnplacedEntryIds(state);
  if (covered.length !== unplaced.length) {
    const error = new Error("pairing+BYE did not cover all unplaced teams");
    error.code = "loss-band/pairing-coverage";
    throw error;
  }
  if (new Set(covered).size !== covered.length) {
    const error = new Error("pairing produced duplicate entryIds");
    error.code = "loss-band/pairing-duplicate";
    throw error;
  }

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
    byes,
    byLossCount,
    rematchCount,
    rematchAvoidance,
  };
}

function appendMatchLog(state, pairings, outcomes) {
  const prev = Array.isArray(state.matchLog) ? state.matchLog : [];
  const byeLogs = (pairings.byes ?? []).map((bye) => ({
    matchId: bye.matchId,
    roundNumber: bye.roundNumber,
    lossCount: bye.lossCount,
    team1EntryId: bye.entryId,
    team2EntryId: null,
    winnerEntryId: bye.entryId,
    loserEntryId: null,
    entryId: bye.entryId,
    purpose: bye.purpose ?? LossBandMatchPurpose.RANKING,
    isBye: true,
    resolution: "bye",
  }));
  const additions = outcomes.map(({ match, winnerEntryId, loserEntryId }) => ({
    matchId: match.matchId,
    roundNumber: match.roundNumber,
    lossCount: match.lossCount,
    team1EntryId: match.team1EntryId,
    team2EntryId: match.team2EntryId,
    winnerEntryId,
    loserEntryId,
    purpose: match.purpose ?? LossBandMatchPurpose.RANKING,
    isBye: false,
    resolution: "played",
  }));
  return [...prev, ...byeLogs, ...additions];
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

function applyByeCounts(teams, pairings) {
  for (const bye of pairings.byes ?? []) {
    const entryId = bye.entryId;
    if (!teams[entryId]) {
      const error = new Error(`BYE team missing: ${entryId}`);
      error.code = "loss-band/bye-missing";
      throw error;
    }
    teams[entryId] = {
      ...teams[entryId],
      byeCount: (teams[entryId].byeCount ?? 0) + 1,
    };
  }
}

/**
 * 途中順位決定ラウンド: 勝者は lossCount 維持、敗者は +1。BYE は帯維持。順位は付けない。
 * @param {object} state
 * @param {object} pairings
 * @param {Record<string, string>} results
 */
export function applyRankingRoundResults(state, pairings, results) {
  const rankingRounds = rankingRoundCountFromState(state);
  const roundNumber = pairings.roundNumber;
  if (roundNumber < 1 || roundNumber > rankingRounds - 1) {
    const error = new Error(
      `applyRankingRoundResults is for intermediate ranking rounds only, got R${roundNumber} (last=${rankingRounds})`
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
  applyByeCounts(teams, pairings);

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
 * 最終順位決定ラウンド: Olympic 順位。0敗維持組（winner+BYE）が決勝進出。
 * thirdPlaceMatch=true かつ 0敗敗者が2人 → 3位決定戦。
 * 0敗敗者が1人 → 3位自動確定（4位は作らない）。
 * @param {object} state
 * @param {object} pairings
 * @param {Record<string, string>} results
 * @param {{ thirdPlaceMatch?: boolean }} [options]
 */
export function applyFinalRankingRoundResults(state, pairings, results, options = {}) {
  const rankingRounds = rankingRoundCountFromState(state);
  const roundNumber = pairings.roundNumber;
  if (roundNumber !== rankingRounds) {
    const error = new Error(
      `applyFinalRankingRoundResults requires R${rankingRounds}, got ${roundNumber}`
    );
    error.code = "loss-band/invalid-round";
    throw error;
  }

  if (state.completedRankingRound !== rankingRounds - 1) {
    const error = new Error("round out of order for final ranking round");
    error.code = "loss-band/round-out-of-order";
    throw error;
  }

  if (state.phase === LossBandPhase.COMPLETE) {
    const error = new Error("cannot apply final ranking round after complete");
    error.code = "loss-band/already-complete";
    throw error;
  }

  const thirdPlaceMatchRequested =
    options.thirdPlaceMatch === true || state.thirdPlaceMatch === true;

  const outcomes = resolveMatchOutcomes(pairings, results);
  const teams = cloneTeams(state.teams);
  applyByeCounts(teams, pairings);

  /** @type {Map<number, string[]>} */
  const stayersByLoss = new Map();
  /** @type {Map<number, string[]>} */
  const losersByLoss = new Map();

  function pushMap(map, key, entryId) {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(entryId);
  }

  for (const bye of pairings.byes ?? []) {
    const entryId = bye.entryId;
    if (teams[entryId].finalPlacement != null) {
      const error = new Error(`already placed team in BYE: ${entryId}`);
      error.code = "loss-band/already-placed";
      throw error;
    }
    if (teams[entryId].lossCount !== bye.lossCount) {
      const error = new Error(`BYE lossCount mismatch: ${entryId}`);
      error.code = "loss-band/loss-mismatch";
      throw error;
    }
    pushMap(stayersByLoss, bye.lossCount, entryId);
  }

  for (const { match, winnerEntryId, loserEntryId } of outcomes) {
    if (teams[winnerEntryId].finalPlacement != null) {
      const error = new Error(`already placed team in ranking: ${winnerEntryId}`);
      error.code = "loss-band/already-placed";
      throw error;
    }
    if (teams[loserEntryId].finalPlacement != null) {
      const error = new Error(`already placed team in ranking: ${loserEntryId}`);
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
    pushMap(stayersByLoss, match.lossCount, winnerEntryId);
    pushMap(losersByLoss, match.lossCount, loserEntryId);
  }

  const plan = buildOlympicR5PlacementPlan({
    stayersByLoss,
    losersByLoss,
    thirdPlaceMatch: thirdPlaceMatchRequested,
    teamCount: state.teamCount,
  });

  if (plan.finalists.length !== 2) {
    const error = new Error(`expected 2 finalists, got ${plan.finalists.length}`);
    error.code = "loss-band/finalist-count";
    throw error;
  }

  for (const row of plan.placements) {
    teams[row.entryId] = {
      ...teams[row.entryId],
      finalPlacement: row.placement,
    };
  }

  const needsThirdPlaceMatch =
    thirdPlaceMatchRequested && plan.thirdPlaceFinalists.length === 2;

  return {
    ...state,
    teams,
    completedRankingRound: rankingRounds,
    phase: LossBandPhase.FINAL,
    finalists: plan.finalists,
    thirdPlaceFinalists: needsThirdPlaceMatch ? plan.thirdPlaceFinalists : null,
    thirdPlaceMatch: needsThirdPlaceMatch,
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
    roundNumber: finalRoundNumber(bracketSizeFromState(state)),
    matchId: "lb-final",
    team1EntryId,
    team2EntryId,
    lossCount: 0,
    purpose: LossBandMatchPurpose.FINAL,
  };
}

/**
 * 決勝結果適用 → 1位 / 2位。thirdPlaceMatch なら 3位決定戦待ちへ。
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
      purpose: LossBandMatchPurpose.FINAL,
    },
  ];

  if (state.thirdPlaceMatch === true) {
    if (
      !Array.isArray(state.thirdPlaceFinalists) ||
      state.thirdPlaceFinalists.length !== 2
    ) {
      const error = new Error("thirdPlaceFinalists required when thirdPlaceMatch");
      error.code = "loss-band/third-place-count";
      throw error;
    }
    return {
      ...state,
      teams,
      phase: LossBandPhase.THIRD_PLACE,
      finalists: state.finalists,
      thirdPlaceFinalists: [...state.thirdPlaceFinalists].sort((a, b) =>
        a.localeCompare(b, "en")
      ),
      matchLog,
    };
  }

  return {
    ...state,
    teams,
    phase: LossBandPhase.COMPLETE,
    finalists: state.finalists,
    thirdPlaceFinalists: null,
    matchLog,
  };
}

/**
 * 3位決定戦ペアリング（決定論: thirdPlaceFinalists 昇順）
 * @param {object} state
 */
export function buildThirdPlacePairing(state) {
  if (state.phase !== LossBandPhase.THIRD_PLACE) {
    const error = new Error(`cannot build third place: phase is ${state.phase}`);
    error.code = "loss-band/invalid-phase";
    throw error;
  }
  if (state.thirdPlaceMatch !== true) {
    const error = new Error("thirdPlaceMatch is not enabled");
    error.code = "loss-band/third-place-disabled";
    throw error;
  }
  if (
    !Array.isArray(state.thirdPlaceFinalists) ||
    state.thirdPlaceFinalists.length !== 2
  ) {
    const error = new Error("thirdPlaceFinalists must be exactly 2 entryIds");
    error.code = "loss-band/third-place-count";
    throw error;
  }

  const [team1EntryId, team2EntryId] = [...state.thirdPlaceFinalists].sort(
    (a, b) => a.localeCompare(b, "en")
  );

  return {
    roundNumber: thirdPlaceRoundNumber(bracketSizeFromState(state)),
    matchId: "lb-third-place",
    team1EntryId,
    team2EntryId,
    lossCount: 0,
    purpose: LossBandMatchPurpose.THIRD_PLACE,
  };
}

/**
 * 3位決定戦結果 → 3位 / 4位、大会完了
 * @param {object} state
 * @param {string} winnerEntryId
 */
export function applyThirdPlaceResult(state, winnerEntryId) {
  if (state.phase !== LossBandPhase.THIRD_PLACE) {
    const error = new Error(`cannot apply third place: phase is ${state.phase}`);
    error.code = "loss-band/invalid-phase";
    throw error;
  }

  const match = buildThirdPlacePairing(state);
  if (
    winnerEntryId !== match.team1EntryId &&
    winnerEntryId !== match.team2EntryId
  ) {
    const error = new Error(`winner is not in third place match: ${winnerEntryId}`);
    error.code = "loss-band/invalid-winner";
    throw error;
  }

  const loserEntryId =
    winnerEntryId === match.team1EntryId
      ? match.team2EntryId
      : match.team1EntryId;

  const teams = cloneTeams(state.teams);
  if (teams[winnerEntryId].finalPlacement != null) {
    const error = new Error("third-place participant already has placement");
    error.code = "loss-band/already-placed";
    throw error;
  }
  if (teams[loserEntryId].finalPlacement != null) {
    const error = new Error("third-place participant already has placement");
    error.code = "loss-band/already-placed";
    throw error;
  }

  teams[winnerEntryId] = { ...teams[winnerEntryId], finalPlacement: 3 };
  teams[loserEntryId] = { ...teams[loserEntryId], finalPlacement: 4 };

  const prevLog = Array.isArray(state.matchLog) ? state.matchLog : [];
  const matchLog = [
    ...prevLog,
    {
      matchId: match.matchId,
      roundNumber: match.roundNumber,
      lossCount: 0,
      team1EntryId: match.team1EntryId,
      team2EntryId: match.team2EntryId,
      winnerEntryId,
      loserEntryId,
      purpose: LossBandMatchPurpose.THIRD_PLACE,
    },
  ];

  return {
    ...state,
    teams,
    phase: LossBandPhase.COMPLETE,
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
