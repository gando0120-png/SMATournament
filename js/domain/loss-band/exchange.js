/**
 * 交流戦（exchange）— 最低保証実試合数・ペアリング・待機（純関数）
 * 順位 / lossCount / placements には一切影響しない。
 */
import {
  LossBandMatchPurpose,
  LOSS_BAND_TEAM_COUNT,
  LOSS_BAND_DEFAULT_GUARANTEED_MATCH_COUNT,
} from "./constants.js";
import {
  buildOpponentHistoryFromMatchLog,
  havePlayedBefore,
  normalizeOpponentHistory,
} from "./pairing.js";
import { listActiveEntryIds } from "./state.js";

export const LOSS_BAND_EXCHANGE_PAIRING_VERSION = "exchange-v1";

/**
 * 最低保証実試合数を解決する。
 * thirdPlaceMatch とは独立。未指定時は64チーム標準値5。
 * 将来: 大会設定 (bracketMatchConfig.main.guaranteedMatchCount 等) から渡せる。
 *
 * @param {{ guaranteedMatchCount?: number }|number|null|undefined} [source]
 */
export function resolveGuaranteedMatchCount(source = {}) {
  const raw =
    typeof source === "number"
      ? source
      : source?.guaranteedMatchCount;
  if (Number.isInteger(raw) && raw >= 1) {
    return raw;
  }
  return LOSS_BAND_DEFAULT_GUARANTEED_MATCH_COUNT;
}

/**
 * 実試合のみカウント（待機は含めない）
 * @param {Array<object>|null|undefined} matchLog
 * @param {string} entryId
 */
export function countPlayedMatchesForEntry(matchLog, entryId) {
  if (!Array.isArray(matchLog) || typeof entryId !== "string") {
    return 0;
  }
  let count = 0;
  for (const match of matchLog) {
    if (match?.isBye === true || match?.resolution === "bye") {
      continue;
    }
    if (
      match?.team1EntryId === entryId ||
      match?.team2EntryId === entryId
    ) {
      count += 1;
    }
  }
  return count;
}

/**
 * @param {Array<object>|null|undefined} matchLog
 * @returns {Record<string, number>}
 */
export function buildPlayedMatchCounts(matchLog) {
  /** @type {Record<string, number>} */
  const counts = {};
  if (!Array.isArray(matchLog)) {
    return counts;
  }
  for (const match of matchLog) {
    if (match?.isBye === true || match?.resolution === "bye") {
      continue;
    }
    const a = match?.team1EntryId;
    const b = match?.team2EntryId;
    if (typeof a === "string" && a) {
      counts[a] = (counts[a] ?? 0) + 1;
    }
    if (typeof b === "string" && b) {
      counts[b] = (counts[b] ?? 0) + 1;
    }
  }
  return counts;
}

/**
 * 順位確定済みかつ保証数未満のチーム
 * @param {object} state
 * @param {Array<object>|null|undefined} matchLog
 * @param {{ guaranteedMatchCount?: number }} [options]
 */
export function listExchangeEligibleEntryIds(state, matchLog, options = {}) {
  const guaranteed = resolveGuaranteedMatchCount({
    guaranteedMatchCount:
      options.guaranteedMatchCount ?? state?.guaranteedMatchCount,
  });
  const played = buildPlayedMatchCounts(matchLog);
  const eligible = [];
  for (const entryId of listActiveEntryIds(state)) {
    if (state.teams[entryId]?.finalPlacement == null) {
      continue;
    }
    if ((played[entryId] ?? 0) < guaranteed) {
      eligible.push(entryId);
    }
  }
  return eligible;
}

/**
 * 交流戦ラウンド doc 群から待機回数を導出
 * @param {Array<{ sitOutEntryId?: string|null }>|null|undefined} exchangeRounds
 * @returns {Record<string, number>}
 */
export function buildSitOutCountsFromExchangeRounds(exchangeRounds) {
  /** @type {Record<string, number>} */
  const counts = {};
  if (!Array.isArray(exchangeRounds)) {
    return counts;
  }
  for (const round of exchangeRounds) {
    const id = round?.sitOutEntryId;
    if (typeof id === "string" && id) {
      counts[id] = (counts[id] ?? 0) + 1;
    }
  }
  return counts;
}

/**
 * 奇数時の待機者: 待機回数少ない順 → entryId 昇順（待機経験者を試合へ回す）
 * @param {string[]} entryIds
 * @param {Record<string, number>} sitOutCounts
 */
export function pickExchangeSitOutEntryId(entryIds, sitOutCounts = {}) {
  if (!Array.isArray(entryIds) || entryIds.length === 0) {
    return null;
  }
  const sorted = [...entryIds].sort((a, b) => {
    const ca = sitOutCounts[a] ?? 0;
    const cb = sitOutCounts[b] ?? 0;
    if (ca !== cb) {
      return ca - cb;
    }
    return a.localeCompare(b, "en");
  });
  return sorted[0];
}

/**
 * @param {string[]} sortedIds
 * @returns {Array<Array<[number, number]>>}
 */
function listCanonicalOneFactorIndexPairs(n) {
  const factors = [];
  const circleSize = n - 1;
  const m = n / 2;
  for (let r = 0; r < circleSize; r += 1) {
    const pairs = [];
    pairs.push([n - 1, r % circleSize]);
    for (let k = 1; k < m; k += 1) {
      const a = (r + k) % circleSize;
      const b = (r - k + circleSize) % circleSize;
      pairs.push([a, b]);
    }
    factors.push(pairs);
  }
  return factors;
}

function canonicalizePairs(pairs) {
  return pairs
    .map(([a, b]) => (a.localeCompare(b, "en") <= 0 ? [a, b] : [b, a]))
    .sort((p, q) => {
      const c0 = p[0].localeCompare(q[0], "en");
      if (c0 !== 0) return c0;
      return p[1].localeCompare(q[1], "en");
    });
}

/**
 * コスト: 再戦 → 順位差合計 → 実試合数差合計 → pairs key
 * @param {Array<[string, string]>} pairs
 * @param {object} ctx
 */
function scoreExchangePairs(pairs, ctx) {
  const { history, placements, playedCounts } = ctx;
  let rematches = 0;
  let placeDiffSum = 0;
  let playedDiffSum = 0;
  for (const [a, b] of pairs) {
    if (havePlayedBefore(a, b, history)) {
      rematches += 1;
    }
    placeDiffSum += Math.abs((placements[a] ?? 0) - (placements[b] ?? 0));
    playedDiffSum += Math.abs((playedCounts[a] ?? 0) - (playedCounts[b] ?? 0));
  }
  const key = pairs.map(([a, b]) => `${a}:${b}`).join("|");
  return { rematches, placeDiffSum, playedDiffSum, key, pairs };
}

function compareExchangeScores(a, b) {
  if (a.rematches !== b.rematches) return a.rematches - b.rematches;
  if (a.placeDiffSum !== b.placeDiffSum) return a.placeDiffSum - b.placeDiffSum;
  if (a.playedDiffSum !== b.playedDiffSum) {
    return a.playedDiffSum - b.playedDiffSum;
  }
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/**
 * 偶数チームの交流戦ペアリング（決定論）
 * @param {string[]} entryIds
 * @param {{
 *   opponentHistory?: Map|object,
 *   placements?: Record<string, number>,
 *   playedCounts?: Record<string, number>
 * }} [options]
 */
export function pairExchangeEntryIds(entryIds, options = {}) {
  const sorted = [...entryIds].sort((a, b) => a.localeCompare(b, "en"));
  if (sorted.length % 2 !== 0) {
    const error = new Error(`exchange pool must be even, got ${sorted.length}`);
    error.code = "loss-band/exchange-odd-pool";
    throw error;
  }
  if (sorted.length === 0) {
    return { pairs: [], rematchCount: 0 };
  }

  const history = normalizeOpponentHistory(options.opponentHistory);
  const placements = options.placements || {};
  const playedCounts = options.playedCounts || {};
  const ctx = { history, placements, playedCounts };

  const factors = listCanonicalOneFactorIndexPairs(sorted.length);
  let best = null;
  for (const factor of factors) {
    const pairs = canonicalizePairs(
      factor.map(([i, j]) => [sorted[i], sorted[j]])
    );
    const scored = scoreExchangePairs(pairs, ctx);
    if (!best || compareExchangeScores(scored, best) < 0) {
      best = scored;
    }
  }

  return {
    pairs: best.pairs,
    rematchCount: best.rematches,
    placeDiffSum: best.placeDiffSum,
    playedDiffSum: best.playedDiffSum,
  };
}

/**
 * @param {number} exchangeRoundNumber 1-based
 * @param {number} matchIndex 0-based
 */
export function buildExchangeMatchId(exchangeRoundNumber, matchIndex) {
  return `lb-ex-r${exchangeRoundNumber}-m${matchIndex + 1}`;
}

/**
 * 1交流戦ラウンドのペアリング計画
 * @param {object} params
 */
export function planExchangeRound(params) {
  const {
    state,
    matchLog,
    exchangeRoundNumber,
    priorExchangeRounds = [],
    guaranteedMatchCount,
  } = params;

  if (state?.phase !== "complete") {
    const error = new Error("exchange requires completed rankings");
    error.code = "loss-band/exchange-rankings-incomplete";
    throw error;
  }

  const guaranteed = resolveGuaranteedMatchCount({
    guaranteedMatchCount:
      guaranteedMatchCount ?? state?.guaranteedMatchCount,
  });
  const eligible = listExchangeEligibleEntryIds(state, matchLog, {
    guaranteedMatchCount: guaranteed,
  });

  if (eligible.length === 0) {
    return {
      needed: false,
      eligible: [],
      sitOutEntryId: null,
      pairs: [],
      matches: [],
      rematchCount: 0,
      guaranteedMatchCount: guaranteed,
    };
  }

  if (eligible.length === 1) {
    // 未達が1人だけのときは、保証達成済みチームから決定論で相手を選ぶ
    // （未達側の保証達成のため。達成済み側は追加1試合を許容）
    const lone = eligible[0];
    /** @type {Record<string, number>} */
    const placements = {};
    for (const entryId of listActiveEntryIds(state)) {
      const p = state.teams[entryId]?.finalPlacement;
      if (p != null) {
        placements[entryId] = p;
      }
    }
    const playedCounts = buildPlayedMatchCounts(matchLog);
    const history = buildOpponentHistoryFromMatchLog(matchLog);
    const candidates = listActiveEntryIds(state).filter(
      (id) => id !== lone && state.teams[id]?.finalPlacement != null
    );
    if (candidates.length === 0) {
      const error = new Error("no partner available for singleton exchange");
      error.code = "loss-band/exchange-no-partner";
      throw error;
    }
    candidates.sort((a, b) => {
      const scoreA = scoreExchangePairs([[lone, a]], {
        history,
        placements,
        playedCounts,
      });
      const scoreB = scoreExchangePairs([[lone, b]], {
        history,
        placements,
        playedCounts,
      });
      return compareExchangeScores(scoreA, scoreB);
    });
    const partner = candidates[0];
    const [team1EntryId, team2EntryId] =
      lone.localeCompare(partner, "en") <= 0
        ? [lone, partner]
        : [partner, lone];
    const match = {
      matchId: buildExchangeMatchId(exchangeRoundNumber, 0),
      exchangeRoundNumber,
      team1EntryId,
      team2EntryId,
      purpose: LossBandMatchPurpose.EXCHANGE,
      matchPurpose: LossBandMatchPurpose.EXCHANGE,
    };
    return {
      needed: true,
      stalledSingleton: false,
      singletonFiller: true,
      eligible,
      sitOutEntryId: null,
      pairs: [[team1EntryId, team2EntryId]],
      matches: [match],
      rematchCount: havePlayedBefore(lone, partner, history) ? 1 : 0,
      guaranteedMatchCount: guaranteed,
      exchangeRoundNumber,
      pairingVersion: LOSS_BAND_EXCHANGE_PAIRING_VERSION,
    };
  }

  const sitOutCounts = buildSitOutCountsFromExchangeRounds(priorExchangeRounds);
  let sitOutEntryId = null;
  let pool = [...eligible];
  if (pool.length % 2 === 1) {
    sitOutEntryId = pickExchangeSitOutEntryId(pool, sitOutCounts);
    pool = pool.filter((id) => id !== sitOutEntryId);
  }

  /** @type {Record<string, number>} */
  const placements = {};
  for (const entryId of listActiveEntryIds(state)) {
    const p = state.teams[entryId]?.finalPlacement;
    if (p != null) {
      placements[entryId] = p;
    }
  }
  const playedCounts = buildPlayedMatchCounts(matchLog);
  const history = buildOpponentHistoryFromMatchLog(matchLog);

  const paired = pairExchangeEntryIds(pool, {
    opponentHistory: history,
    placements,
    playedCounts,
  });

  const matches = paired.pairs.map(([team1EntryId, team2EntryId], index) => ({
    matchId: buildExchangeMatchId(exchangeRoundNumber, index),
    exchangeRoundNumber,
    team1EntryId,
    team2EntryId,
    purpose: LossBandMatchPurpose.EXCHANGE,
    matchPurpose: LossBandMatchPurpose.EXCHANGE,
  }));

  return {
    needed: true,
    stalledSingleton: false,
    eligible,
    sitOutEntryId,
    pairs: paired.pairs,
    matches,
    rematchCount: paired.rematchCount,
    guaranteedMatchCount: guaranteed,
    exchangeRoundNumber,
    pairingVersion: LOSS_BAND_EXCHANGE_PAIRING_VERSION,
  };
}

/**
 * 交流戦結果を matchLog に追記（順位は変えない）
 * @param {object} state
 * @param {object} exchangePlan planExchangeRound
 * @param {Record<string, string>} results matchId → winnerEntryId
 */
export function appendExchangeResultsToMatchLog(state, exchangePlan, results) {
  const prev = Array.isArray(state.matchLog) ? state.matchLog : [];
  const additions = [];
  for (const match of exchangePlan.matches) {
    const winnerEntryId = results[match.matchId];
    if (
      winnerEntryId !== match.team1EntryId &&
      winnerEntryId !== match.team2EntryId
    ) {
      const error = new Error(`invalid exchange winner for ${match.matchId}`);
      error.code = "loss-band/invalid-winner";
      throw error;
    }
    const loserEntryId =
      winnerEntryId === match.team1EntryId
        ? match.team2EntryId
        : match.team1EntryId;
    additions.push({
      matchId: match.matchId,
      roundNumber: match.exchangeRoundNumber,
      lossCount: null,
      team1EntryId: match.team1EntryId,
      team2EntryId: match.team2EntryId,
      winnerEntryId,
      loserEntryId,
      purpose: LossBandMatchPurpose.EXCHANGE,
    });
  }
  return {
    ...state,
    matchLog: [...prev, ...additions],
    // teams / placements 不変
    teams: state.teams,
  };
}

/**
 * @param {object} state
 * @param {Array<object>} matchLog
 * @param {{ exchangeMatches?: boolean, guaranteedMatchCount?: number }} [options]
 */
export function allTeamsMeetGuaranteedMatches(state, matchLog, options = {}) {
  if (options.exchangeMatches !== true) {
    return true;
  }
  const eligible = listExchangeEligibleEntryIds(state, matchLog, options);
  return eligible.length === 0;
}

/**
 * 健全性: 全チームが保証数以上、人数整合
 * @param {object} state
 * @param {Array<object>} matchLog
 * @param {{ guaranteedMatchCount?: number }} [options]
 */
export function validateGuaranteedMatchCounts(state, matchLog, options = {}) {
  const errors = [];
  const guaranteed = resolveGuaranteedMatchCount({
    guaranteedMatchCount:
      options.guaranteedMatchCount ?? state?.guaranteedMatchCount,
  });
  const played = buildPlayedMatchCounts(matchLog);
  const ids = listActiveEntryIds(state);
  if (ids.length !== (state.teamCount ?? ids.length)) {
    errors.push(`team count ${ids.length}`);
  }
  for (const entryId of ids) {
    if (state.teams[entryId]?.finalPlacement == null) {
      errors.push(`unplaced ${entryId}`);
      continue;
    }
    const count = played[entryId] ?? 0;
    if (count < guaranteed) {
      errors.push(`${entryId} played=${count} < ${guaranteed}`);
    }
  }
  return { valid: errors.length === 0, errors, guaranteedMatchCount: guaranteed };
}
