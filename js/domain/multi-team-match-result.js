/**
 * 複数チーム・2セット合計の結果検証・順位
 */
import {
  AGGREGATE_SCORE_MAX,
  AGGREGATE_SCORE_MIN,
  AGGREGATE_SET_COUNT,
  MatchFormat,
} from "./aggregate-match-format.js";

/**
 * @param {unknown} value
 * @returns {{ valid: boolean, value?: number, message?: string }}
 */
export function validateAggregateSetScore(value) {
  if (value === "" || value == null) {
    return { valid: false, message: "セット得点を入力してください。" };
  }
  const parsed = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isInteger(parsed) || parsed < AGGREGATE_SCORE_MIN || parsed > AGGREGATE_SCORE_MAX) {
    return {
      valid: false,
      message: `セット得点は${AGGREGATE_SCORE_MIN}〜${AGGREGATE_SCORE_MAX}の整数で入力してください。`,
    };
  }
  return { valid: true, value: parsed };
}

/**
 * @param {Record<string, unknown>|null|undefined} scores
 * @param {string[]} participantEntryIds
 * @returns {{ valid: boolean, scores?: Record<string, number[]>, totals?: Record<string, number>, message?: string }}
 */
export function normalizeAndValidateMultiTeamScores(scores, participantEntryIds) {
  const ids = [...new Set(participantEntryIds.filter((id) => typeof id === "string" && id))];
  if (ids.length < 2) {
    return { valid: false, message: "参加チームが不足しています。" };
  }

  if (!scores || typeof scores !== "object" || Array.isArray(scores)) {
    return { valid: false, message: "スコアが不正です。" };
  }

  const scoreKeys = Object.keys(scores);
  for (const key of scoreKeys) {
    if (!ids.includes(key)) {
      return { valid: false, message: "参加していないチームのスコアが含まれています。" };
    }
  }
  for (const id of ids) {
    if (!(id in scores)) {
      return { valid: false, message: "すべての参加チームのスコアを入力してください。" };
    }
  }

  /** @type {Record<string, number[]>} */
  const normalized = {};
  /** @type {Record<string, number>} */
  const totals = {};

  for (const id of ids) {
    const row = scores[id];
    if (!Array.isArray(row) || row.length !== AGGREGATE_SET_COUNT) {
      return { valid: false, message: `各チームは${AGGREGATE_SET_COUNT}セット分の得点が必要です。` };
    }
    const sets = [];
    for (const cell of row) {
      const parsed = validateAggregateSetScore(cell);
      if (!parsed.valid) {
        return { valid: false, message: parsed.message };
      }
      sets.push(parsed.value);
    }
    normalized[id] = sets;
    totals[id] = sets[0] + sets[1];
  }

  return { valid: true, scores: normalized, totals };
}

/**
 * 合計降順の暫定順位。同点は同順位帯として並べる（安定ソートで entryId 順）。
 * @param {string[]} participantEntryIds
 * @param {Record<string, number>} totals
 * @returns {string[]}
 */
export function rankByTotalScoreDesc(participantEntryIds, totals) {
  return [...participantEntryIds].sort((a, b) => {
    const diff = (totals[b] ?? 0) - (totals[a] ?? 0);
    if (diff !== 0) return diff;
    return a.localeCompare(b);
  });
}

/**
 * 勝ち抜け境界で同点か（qualifiersCount 位と次位が同点）
 * @param {string[]} rankedIds
 * @param {Record<string, number>} totals
 * @param {number} qualifiersCount
 */
export function hasBoundaryTie(rankedIds, totals, qualifiersCount) {
  if (!Number.isInteger(qualifiersCount) || qualifiersCount < 1) {
    return false;
  }
  if (rankedIds.length <= qualifiersCount) {
    return false;
  }
  const cutTotal = totals[rankedIds[qualifiersCount - 1]] ?? 0;
  const nextTotal = totals[rankedIds[qualifiersCount]] ?? 0;
  return cutTotal === nextTotal;
}

/**
 * @param {object} params
 * @param {string[]} params.participantEntryIds
 * @param {Record<string, unknown>} params.scores
 * @param {number} params.qualifiersCount
 * @param {string[]|null|undefined} [params.manualRankingEntryIds]
 */
export function validateMultiTeamMatchResultInput({
  participantEntryIds,
  scores,
  qualifiersCount,
  manualRankingEntryIds = null,
} = {}) {
  const scoreResult = normalizeAndValidateMultiTeamScores(scores, participantEntryIds);
  if (!scoreResult.valid) {
    return { valid: false, message: scoreResult.message, values: null };
  }

  const { scores: normalizedScores, totals } = scoreResult;
  const ids = [...participantEntryIds];
  const autoRanked = rankByTotalScoreDesc(ids, totals);
  const boundaryTie = hasBoundaryTie(autoRanked, totals, qualifiersCount);

  let rankingEntryIds = autoRanked;
  let tieResolution = null;

  if (boundaryTie) {
    if (!Array.isArray(manualRankingEntryIds) || manualRankingEntryIds.length !== ids.length) {
      return {
        valid: false,
        needsManualTieBreak: true,
        message: "勝ち抜け境界で同点です。順位を手動で確定してください。",
        values: {
          scores: normalizedScores,
          totals,
          autoRankingEntryIds: autoRanked,
        },
      };
    }
    const manual = [...manualRankingEntryIds];
    if (new Set(manual).size !== manual.length) {
      return { valid: false, message: "手動順位に重複があります。" };
    }
    for (const id of manual) {
      if (!ids.includes(id)) {
        return { valid: false, message: "手動順位に参加外のチームがあります。" };
      }
    }
    for (const id of ids) {
      if (!manual.includes(id)) {
        return { valid: false, message: "手動順位にすべての参加チームを含めてください。" };
      }
    }
    rankingEntryIds = manual;
    tieResolution = { manualRankingEntryIds: manual };
  }

  const qualifierEntryIds = rankingEntryIds.slice(0, qualifiersCount);
  if (qualifierEntryIds.length !== qualifiersCount) {
    return {
      valid: false,
      message: `勝ち抜けは${qualifiersCount}チーム必要です。`,
    };
  }

  return {
    valid: true,
    needsManualTieBreak: false,
    message: null,
    values: {
      matchFormat: MatchFormat.MULTI_TEAM_TOTAL,
      scores: normalizedScores,
      totals,
      rankingEntryIds,
      qualifierEntryIds,
      tieResolution,
      setCount: AGGREGATE_SET_COUNT,
      qualifiersCount,
    },
  };
}

/**
 * @param {object} params
 */
export function buildMultiTeamMatchResultPayload({
  match,
  validated,
}) {
  return {
    matchId: match.matchId,
    roundNumber: match.roundNumber,
    matchNumber: match.matchNumber,
    matchFormat: MatchFormat.MULTI_TEAM_TOTAL,
    status: "finished",
    resolution: "played",
    participantEntryIds: [...(match.participantEntryIds || [])],
    scores: validated.scores,
    totals: validated.totals,
    rankingEntryIds: validated.rankingEntryIds,
    qualifierEntryIds: validated.qualifierEntryIds,
    tieResolution: validated.tieResolution,
    setCount: AGGREGATE_SET_COUNT,
    qualifiersCount: validated.qualifiersCount ?? match.qualifiersCount,
  };
}

/**
 * @param {object} match
 * @param {object[]} participants
 */
export function buildMultiTeamAutoAdvanceResult(match, participants) {
  const ids = participants.map((p) => p.entryId).filter(Boolean);
  /** @type {Record<string, number[]>} */
  const scores = {};
  /** @type {Record<string, number>} */
  const totals = {};
  for (const id of ids) {
    scores[id] = [0, 0];
    totals[id] = 0;
  }
  return {
    matchId: match.matchId,
    roundNumber: match.roundNumber,
    matchNumber: match.matchNumber,
    matchFormat: MatchFormat.MULTI_TEAM_TOTAL,
    status: "finished",
    resolution: "auto_advance",
    participantEntryIds: ids,
    scores,
    totals,
    rankingEntryIds: ids,
    qualifierEntryIds: ids,
    tieResolution: null,
    setCount: AGGREGATE_SET_COUNT,
    qualifiersCount: ids.length,
  };
}
