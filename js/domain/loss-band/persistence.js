/**
 * loss-band Firestore ドキュメント形状・ラウンド進行オーケストレーション（純関数）
 * H2H 得点検証は finals-match-result を再利用する。
 */
import {
  FinalsMatchResolution,
  MatchResultStatus,
  MatchSessionStatus,
} from "../constants.js";
import { buildPlayedFinalsMatchResultPayload } from "../finals-match-result-payload.js";
import { validateFinalsMatchResultInput } from "../finals-match-result.js";
import {
  LossBandMatchPurpose,
  RankingMode,
} from "./constants.js";
import {
  rankingRoundCount,
  rankingRoundCountFromState,
  resolveAndValidateLossBandSize,
  resolveLossBandBracketSize,
} from "./bracket.js";
import {
  applyFinalRankingRoundResults,
  applyFinalResult,
  applyRankingRoundResults,
  applyThirdPlaceResult,
  buildFinalPairing,
  buildRankingRoundPairings,
  buildThirdPlacePairing,
} from "./progression.js";
import { buildPlacementRecords, validateCompletePlacements } from "./placements.js";
import { evaluateLossBandRankingCompletion } from "./completion.js";
import {
  appendExchangeResultsToMatchLog,
  buildPlayedMatchCounts,
  listExchangeEligibleEntryIds,
  planExchangeRound,
  resolveGuaranteedMatchCount,
  validateGuaranteedMatchCounts,
  LOSS_BAND_EXCHANGE_PAIRING_VERSION,
} from "./exchange.js";
import { createInitialLossBandState } from "./state.js";

function rankingRoundsFromStateDoc(stateDoc, entryIds) {
  if (stateDoc?.bracketSize) {
    return rankingRoundCount(stateDoc.bracketSize);
  }
  const n = entryIds?.length ?? stateDoc?.teamCount ?? stateDoc?.entryIds?.length;
  const resolved = resolveLossBandBracketSize(n);
  if (resolved == null) {
    return rankingRoundCount(64);
  }
  return rankingRoundCount(resolved);
}

export const LOSS_BAND_STATE_DOC_ID = "current";
export const LOSS_BAND_PLACEMENTS_DOC_ID = "current";
export const LOSS_BAND_STATE_VERSION = 1;
export const LOSS_BAND_PLACEMENTS_VERSION = 1;
export const LOSS_BAND_PAIRING_VERSION = "rematch-avoidance-v1";

export const LossBandTournamentStatus = Object.freeze({
  /** R1–R5 進行中 */
  ACTIVE: "active",
  /** R5 完了・決勝待ち */
  FINALS_PENDING: "finals_pending",
  /** 決勝完了・3位決定戦待ち */
  THIRD_PLACE_PENDING: "third_place_pending",
  /** 順位確定済み・交流戦進行中 */
  EXCHANGE_PENDING: "exchange_pending",
  /** 全順位確定（＋交流戦完了または交流戦なし） */
  COMPLETED: "completed",
});

export const LossBandRoundStatus = Object.freeze({
  OPEN: "open",
  COMPLETE: "complete",
});

/**
 * @param {number} roundNumber
 */
export function buildLossBandRoundId(roundNumber) {
  return `r${roundNumber}`;
}

/**
 * @param {string[]} entryIds
 * @param {{
 *   rematchAvoidance?: boolean,
 *   thirdPlaceMatch?: boolean,
 *   exchangeMatches?: boolean,
 *   guaranteedMatchCount?: number,
 *   bracketSize?: 32|64|128
 * }} [options]
 */
export function buildLossBandStateDoc(entryIds, options = {}) {
  const size = resolveAndValidateLossBandSize(entryIds.length, options.bracketSize);
  if (!size.valid) {
    const error = new Error(size.error);
    error.code = size.code;
    throw error;
  }
  const bracketSize = size.bracketSize;
  return {
    version: LOSS_BAND_STATE_VERSION,
    teamCount: entryIds.length,
    bracketSize,
    entryIds: [...entryIds],
    currentRound: 1,
    currentRoundId: "r1",
    completedRankingRound: 0,
    status: LossBandTournamentStatus.ACTIVE,
    rankingMode: RankingMode.LOSS_BAND,
    rematchAvoidance: options.rematchAvoidance === true,
    thirdPlaceMatch: options.thirdPlaceMatch === true,
    exchangeMatches: options.exchangeMatches === true,
    exchangeRoundNumber: 0,
    guaranteedMatchCount: resolveGuaranteedMatchCount({
      guaranteedMatchCount: options.guaranteedMatchCount,
      bracketSize,
    }),
  };
}

/**
 * @param {object} pairings buildRankingRoundPairings の戻り値
 */
export function buildLossBandRoundDoc(pairings) {
  /** @type {Record<string, { lossCount: number, matchIds: string[], pairs: object[], byeEntryId: string|null }>} */
  const bands = {};
  const byesByLoss = new Map(
    (pairings.byes ?? []).map((b) => [b.lossCount, b.entryId])
  );
  for (const lossKey of Object.keys(pairings.byLossCount)
    .map(Number)
    .sort((a, b) => a - b)) {
    const matches = pairings.byLossCount[lossKey];
    bands[String(lossKey)] = {
      lossCount: lossKey,
      matchIds: matches.map((m) => m.matchId),
      pairs: matches.map((m) => ({
        matchId: m.matchId,
        team1EntryId: m.team1EntryId,
        team2EntryId: m.team2EntryId,
      })),
      byeEntryId: byesByLoss.get(lossKey) ?? null,
    };
  }

  // BYEのみの帯（試合0）もある
  for (const bye of pairings.byes ?? []) {
    const key = String(bye.lossCount);
    if (!bands[key]) {
      bands[key] = {
        lossCount: bye.lossCount,
        matchIds: [],
        pairs: [],
        byeEntryId: bye.entryId,
      };
    } else if (!bands[key].byeEntryId) {
      bands[key].byeEntryId = bye.entryId;
    }
  }

  return {
    roundId: buildLossBandRoundId(pairings.roundNumber),
    roundNumber: pairings.roundNumber,
    status: LossBandRoundStatus.OPEN,
    bands,
    matchIds: pairings.matches.map((m) => m.matchId),
    byeMatchIds: (pairings.byes ?? []).map((b) => b.matchId),
    byes: (pairings.byes ?? []).map((b) => ({
      matchId: b.matchId,
      entryId: b.entryId,
      lossCount: b.lossCount,
    })),
    pairingVersion: LOSS_BAND_PAIRING_VERSION,
    rematchAvoidance: pairings.rematchAvoidance === true,
    rematchCount: pairings.rematchCount ?? 0,
    completedMatchIds: [],
  };
}

/**
 * 永続化された round から domain pairings 形状を復元（再ペアリングしない）
 * @param {object} roundDoc
 */
export function pairingsFromRoundDoc(roundDoc) {
  if (
    roundDoc.matchPurpose === LossBandMatchPurpose.FINAL ||
    roundDoc.matchPurpose === LossBandMatchPurpose.THIRD_PLACE
  ) {
    const pair = (roundDoc.pairs || [])[0];
    if (!pair) {
      return {
        roundNumber: roundDoc.roundNumber,
        matches: [],
        byes: [],
        byLossCount: {},
        rematchCount: 0,
        rematchAvoidance: false,
        matchPurpose: roundDoc.matchPurpose,
      };
    }
    const match = {
      matchId: pair.matchId,
      roundNumber: roundDoc.roundNumber,
      lossCount: 0,
      team1EntryId: pair.team1EntryId,
      team2EntryId: pair.team2EntryId,
      purpose: roundDoc.matchPurpose,
    };
    return {
      roundNumber: roundDoc.roundNumber,
      matches: [match],
      byes: [],
      byLossCount: { 0: [match] },
      rematchCount: 0,
      rematchAvoidance: false,
      matchPurpose: roundDoc.matchPurpose,
    };
  }

  const matches = [];
  const byes = [];
  const byLossCount = {};
  const lossKeys = Object.keys(roundDoc.bands || {})
    .map(Number)
    .sort((a, b) => a - b);

  for (const lossCount of lossKeys) {
    const band = roundDoc.bands[String(lossCount)];
    const bandMatches = (band?.pairs || []).map((pair) => ({
      matchId: pair.matchId,
      roundNumber: roundDoc.roundNumber,
      lossCount,
      team1EntryId: pair.team1EntryId,
      team2EntryId: pair.team2EntryId,
      purpose: LossBandMatchPurpose.RANKING,
      isBye: false,
    }));
    byLossCount[lossCount] = bandMatches;
    matches.push(...bandMatches);

    const byeEntryId =
      band?.byeEntryId ??
      (roundDoc.byes || []).find((b) => b.lossCount === lossCount)?.entryId ??
      null;
    if (byeEntryId) {
      byes.push({
        matchId:
          (roundDoc.byes || []).find((b) => b.entryId === byeEntryId)?.matchId ??
          `lb-r${roundDoc.roundNumber}-l${lossCount}-bye`,
        roundNumber: roundDoc.roundNumber,
        lossCount,
        entryId: byeEntryId,
        team1EntryId: byeEntryId,
        team2EntryId: null,
        purpose: LossBandMatchPurpose.RANKING,
        isBye: true,
        resolution: "bye",
      });
    }
  }

  // roundDoc.byes が bands に無い場合のフォールバック
  for (const bye of roundDoc.byes || []) {
    if (byes.some((b) => b.entryId === bye.entryId)) continue;
    byes.push({
      matchId: bye.matchId,
      roundNumber: roundDoc.roundNumber,
      lossCount: bye.lossCount,
      entryId: bye.entryId,
      team1EntryId: bye.entryId,
      team2EntryId: null,
      purpose: LossBandMatchPurpose.RANKING,
      isBye: true,
      resolution: "bye",
    });
  }

  return {
    roundNumber: roundDoc.roundNumber,
    matches,
    byes,
    byLossCount,
    rematchCount: roundDoc.rematchCount ?? 0,
    rematchAvoidance: roundDoc.rematchAvoidance === true,
    matchPurpose: LossBandMatchPurpose.RANKING,
  };
}

/**
 * @param {object} match pairings 内の1試合
 * @param {number} matchNumber ラウンド内通番（1-based）
 * @param {{ entryId: string, teamName?: string, seed?: number }} team1
 * @param {{ entryId: string, teamName?: string, seed?: number }} team2
 */
export function buildLossBandMatchSessionDoc(match, matchNumber, team1, team2) {
  return {
    matchId: match.matchId,
    roundNumber: match.roundNumber,
    matchNumber,
    lossBand: match.lossCount ?? 0,
    team1EntryId: match.team1EntryId,
    team2EntryId: match.team2EntryId,
    matchPurpose: match.purpose ?? LossBandMatchPurpose.RANKING,
    status: MatchSessionStatus.READY,
    team1: {
      entryId: team1.entryId,
      teamName: team1.teamName ?? team1.entryId,
      seed: team1.seed ?? matchNumber * 2 - 1,
    },
    team2: {
      entryId: team2.entryId,
      teamName: team2.teamName ?? team2.entryId,
      seed: team2.seed ?? matchNumber * 2,
    },
  };
}

/**
 * Rules create / finish が前提とする session 必須フィールド
 * （timestamps は書き込み時に付与するため含まない）
 */
export const LOSS_BAND_MATCH_SESSION_REQUIRED_FIELDS = Object.freeze([
  "matchId",
  "matchNumber",
  "matchPurpose",
  "roundNumber",
  "lossBand",
  "team1",
  "team2",
  "team1EntryId",
  "team2EntryId",
  "status",
]);

/**
 * 保存前の session 構造チェック（存在する session 向け）
 * @param {object|null|undefined} session
 * @returns {{ valid: true } | { valid: false, message: string, missing: string[] }}
 */
export function validateLossBandMatchSessionStructure(session) {
  if (!session || typeof session !== "object") {
    return {
      valid: false,
      message: "試合データが不完全です。大会データを確認してください。",
      missing: ["session"],
    };
  }

  const missing = [];
  if (typeof session.matchId !== "string" || !session.matchId) {
    missing.push("matchId");
  }
  if (!Number.isInteger(session.roundNumber)) {
    missing.push("roundNumber");
  }
  if (!Number.isInteger(session.lossBand) || session.lossBand < 0) {
    missing.push("lossBand");
  }
  if (typeof session.team1EntryId !== "string" || !session.team1EntryId) {
    missing.push("team1EntryId");
  }
  if (typeof session.team2EntryId !== "string" || !session.team2EntryId) {
    missing.push("team2EntryId");
  }

  if (missing.length > 0) {
    return {
      valid: false,
      message: "試合データが不完全です。大会データを確認してください。",
      missing,
    };
  }

  return { valid: true };
}

/**
 * buildLossBandMatchSessionDoc 結果が Rules create 相当の必須フィールドを持つこと
 * @param {object} session
 */
export function hasLossBandMatchSessionCreateShape(session) {
  if (!session || typeof session !== "object") return false;
  for (const key of LOSS_BAND_MATCH_SESSION_REQUIRED_FIELDS) {
    if (!(key in session)) return false;
  }
  if (typeof session.matchId !== "string" || !session.matchId) return false;
  if (!Number.isInteger(session.matchNumber) || session.matchNumber < 1) {
    return false;
  }
  if (!Number.isInteger(session.roundNumber)) return false;
  if (!Number.isInteger(session.lossBand) || session.lossBand < 0) return false;
  if (typeof session.team1EntryId !== "string") return false;
  if (typeof session.team2EntryId !== "string") return false;
  if (typeof session.matchPurpose !== "string") return false;
  if (typeof session.status !== "string") return false;
  if (session.status !== MatchSessionStatus.READY) return false;
  if (!session.team1?.entryId || !session.team2?.entryId) return false;
  return true;
}

/**
 * Phase 2 ロック用: session が実試合開始済みか
 * ready は未開始。legacy playing / finished は開始済み。
 * @param {object|null|undefined} session
 */
export function isLossBandSessionStartedForLock(session) {
  if (!session || typeof session !== "object") return false;
  return (
    session.status === MatchSessionStatus.PLAYING ||
    session.status === MatchSessionStatus.FINISHED
  );
}

/**
 * 次ラウンドが修正ロック対象か（playing / finished / result）
 * @param {{
 *   nextRoundMatchIds?: string[],
 *   sessionsMap?: Map<string, object>,
 *   resultsMap?: Map<string, object>,
 * }} params
 */
export function isLossBandNextRoundStartedForEditLock({
  nextRoundMatchIds = [],
  sessionsMap = new Map(),
  resultsMap = new Map(),
} = {}) {
  for (const matchId of nextRoundMatchIds) {
    if (!matchId) continue;
    if (resultsMap.has(matchId) && resultsMap.get(matchId)) {
      return true;
    }
    if (isLossBandSessionStartedForLock(sessionsMap.get(matchId))) {
      return true;
    }
  }
  return false;
}

/**
 * 運営UI / 公開表示用の session 状態ラベル
 * @param {object|null|undefined} session
 * @param {object|null|undefined} result
 */
export function resolveLossBandMatchSessionDisplay(session, result) {
  if (result) {
    return {
      status: MatchSessionStatus.FINISHED,
      label: "完了",
      canStart: false,
      canEnterResult: false,
    };
  }
  const status = session?.status ?? null;
  if (status === MatchSessionStatus.READY) {
    return {
      status: MatchSessionStatus.READY,
      label: "未開始",
      canStart: true,
      canEnterResult: false,
    };
  }
  if (status === MatchSessionStatus.PLAYING) {
    return {
      status: MatchSessionStatus.PLAYING,
      label: "試合中",
      canStart: false,
      canEnterResult: true,
    };
  }
  if (status === MatchSessionStatus.FINISHED) {
    return {
      status: MatchSessionStatus.FINISHED,
      label: "完了",
      canStart: false,
      canEnterResult: false,
    };
  }
  return {
    status: null,
    label: "待機",
    canStart: false,
    canEnterResult: false,
  };
}

/**
 * round docs の pairing から session 欠落フィールドを一意解決
 * @param {Iterable<object>} roundDocs
 * @param {string} matchId
 * @returns {{ ok: true, roundNumber: number, lossBand: number } | { ok: false, reason: string }}
 */
export function resolveLossBandSessionBackfillFromRounds(roundDocs, matchId) {
  /** @type {Array<{ roundNumber: number, lossBand: number }>} */
  const hits = [];
  for (const roundDoc of roundDocs || []) {
    if (!roundDoc) continue;
    const pairings = pairingsFromRoundDoc(roundDoc);
    for (const match of pairings.matches || []) {
      if (match.matchId !== matchId) continue;
      hits.push({
        roundNumber: match.roundNumber ?? roundDoc.roundNumber,
        lossBand: match.lossCount ?? 0,
      });
    }
  }

  if (hits.length === 0) {
    return { ok: false, reason: "not-found" };
  }

  const uniqueKeys = new Set(
    hits.map((h) => `${h.roundNumber}:${h.lossBand}`)
  );
  if (uniqueKeys.size > 1) {
    return { ok: false, reason: "ambiguous" };
  }

  return {
    ok: true,
    roundNumber: hits[0].roundNumber,
    lossBand: hits[0].lossBand,
  };
}

/**
 * H2H 入力を検証し、loss-band 結果ペイロードを構築
 * @param {object} params
 */
export function buildValidatedLossBandMatchResult({
  match,
  matchNumber,
  team1,
  team2,
  scoreInput,
  winsRequired = 2,
}) {
  const validated = validateFinalsMatchResultInput(scoreInput, { winsRequired });
  if (!validated.valid) {
    return validated;
  }

  const base = buildPlayedFinalsMatchResultPayload({
    match: {
      matchId: match.matchId,
      roundNumber: match.roundNumber,
      matchNumber,
    },
    team1,
    team2,
    validatedData: validated.data,
  });

  return {
    valid: true,
    data: {
      ...base,
      lossBand: match.lossCount,
      team1EntryId: match.team1EntryId,
      team2EntryId: match.team2EntryId,
      matchPurpose: match.purpose ?? LossBandMatchPurpose.RANKING,
      status: MatchResultStatus.FINISHED,
      resolution: FinalsMatchResolution.PLAYED,
    },
    message: null,
  };
}

/**
 * @param {object} roundDoc
 * @param {Iterable<string>} completedMatchIds
 */
export function isLossBandRoundComplete(roundDoc, completedMatchIds) {
  const done = new Set(completedMatchIds);
  const matchIds = roundDoc.matchIds || [];
  if (matchIds.length === 0) return false;
  return matchIds.every((id) => done.has(id));
}

/**
 * @param {object[]} resultDocs
 * @returns {Record<string, string>} matchId → winnerEntryId
 */
export function winnersMapFromResults(resultDocs) {
  /** @type {Record<string, string>} */
  const map = {};
  for (const result of resultDocs) {
    if (result?.isBye === true || result?.resolution === "bye") {
      continue;
    }
    const winnerEntryId =
      result.winner?.entryId ||
      (result.winnerSide === "team1"
        ? result.team1EntryId || result.team1?.entryId
        : result.team2EntryId || result.team2?.entryId);
    if (result.matchId && winnerEntryId) {
      map[result.matchId] = winnerEntryId;
    }
  }
  return map;
}

/**
 * BYE 結果ドキュメント（運営者のみ作成想定）
 * @param {object} byeAssignment
 * @param {{ teamName?: string }} [team]
 */
export function buildLossBandByeResultDoc(byeAssignment, team = {}) {
  const entryId = byeAssignment.entryId;
  return {
    matchId: byeAssignment.matchId,
    roundNumber: byeAssignment.roundNumber,
    matchNumber: 0,
    lossBand: byeAssignment.lossCount ?? 0,
    team1EntryId: entryId,
    team2EntryId: null,
    team1: {
      entryId,
      teamName: team.teamName ?? entryId,
      seed: null,
    },
    team2: null,
    winner: {
      entryId,
      teamName: team.teamName ?? entryId,
    },
    loser: null,
    matchPurpose: byeAssignment.purpose ?? LossBandMatchPurpose.RANKING,
    status: MatchResultStatus.FINISHED,
    resolution: FinalsMatchResolution.BYE,
    isBye: true,
    sets: [],
  };
}

/**
 * 完了済みラウンド結果から domain state を再構築（lossCount 等は二重保存しない）
 * @param {string[]} entryIds
 * @param {Array<{ roundDoc: object, results: object[] }>} completedRounds 昇順
 * @param {{ thirdPlaceMatch?: boolean, rematchAvoidance?: boolean }} [options]
 */
export function rebuildDomainStateFromCompletedRounds(
  entryIds,
  completedRounds,
  options = {}
) {
  let state = createInitialLossBandState(entryIds, {
    thirdPlaceMatch: options.thirdPlaceMatch === true,
    rematchAvoidance: options.rematchAvoidance === true,
    guaranteedMatchCount: options.guaranteedMatchCount,
    bracketSize: options.bracketSize,
  });
  const rankingRounds = rankingRoundCountFromState(state);
  for (const { roundDoc, results } of completedRounds) {
    const purpose = roundDoc.matchPurpose || LossBandMatchPurpose.RANKING;
    const winners = winnersMapFromResults(results);
    if (purpose === LossBandMatchPurpose.FINAL) {
      const winnerEntryId = winners["lb-final"] || Object.values(winners)[0];
      state = applyFinalResult(state, winnerEntryId);
      continue;
    }
    if (purpose === LossBandMatchPurpose.THIRD_PLACE) {
      const winnerEntryId =
        winners["lb-third-place"] || Object.values(winners)[0];
      state = applyThirdPlaceResult(state, winnerEntryId);
      continue;
    }
    if (purpose === LossBandMatchPurpose.EXCHANGE) {
      // 交流戦は順位 rebuild から除外（played count は別経路）
      continue;
    }
    const pairings = pairingsFromRoundDoc(roundDoc);
    if (pairings.roundNumber < rankingRounds) {
      state = applyRankingRoundResults(state, pairings, winners);
    } else if (pairings.roundNumber === rankingRounds) {
      state = applyFinalRankingRoundResults(state, pairings, winners, {
        thirdPlaceMatch: options.thirdPlaceMatch === true,
      });
    }
  }
  return state;
}

/**
 * 決勝 / 3位決定戦用の疑似ラウンド doc
 * @param {object} match buildFinalPairing / buildThirdPlacePairing
 */
export function buildSpecialMatchRoundDoc(match) {
  const roundId =
    match.purpose === LossBandMatchPurpose.THIRD_PLACE ? "third_place" : "final";
  return {
    roundId,
    roundNumber: match.roundNumber,
    status: LossBandRoundStatus.OPEN,
    bands: {},
    matchIds: [match.matchId],
    pairs: [
      {
        matchId: match.matchId,
        team1EntryId: match.team1EntryId,
        team2EntryId: match.team2EntryId,
      },
    ],
    pairingVersion: LOSS_BAND_PAIRING_VERSION,
    rematchAvoidance: false,
    rematchCount: 0,
    completedMatchIds: [],
    matchPurpose: match.purpose,
  };
}

/**
 * @param {object} state domain complete state
 * @param {{ thirdPlaceMatch?: boolean }} [options]
 */
export function buildLossBandPlacementsDoc(state, options = {}) {
  const thirdPlaceMatch =
    options.thirdPlaceMatch === true || state.thirdPlaceMatch === true;
  const validation = validateCompletePlacements(state, { thirdPlaceMatch });
  if (!validation.valid) {
    const error = new Error(validation.errors.join("; "));
    error.code = "loss-band/placements-invalid";
    throw error;
  }

  const records = buildPlacementRecords(state);
  /** @type {Record<string, number>} */
  const placementCounts = {};
  for (const [placement, count] of validation.placementCounts) {
    placementCounts[String(placement)] = count;
  }

  const champion = records.find((r) => r.placement === 1);
  const runnerUp = records.find((r) => r.placement === 2);

  return {
    version: LOSS_BAND_PLACEMENTS_VERSION,
    teamCount: state.teamCount ?? records.length,
    rankingMode: RankingMode.LOSS_BAND,
    thirdPlaceMatch,
    status: LossBandTournamentStatus.COMPLETED,
    placements: records,
    placementCounts,
    championEntryId: champion?.entryId ?? null,
    runnerUpEntryId: runnerUp?.entryId ?? null,
  };
}

/**
 * 初期化計画: state + R1 round + match メタ
 * @param {string[]} entryIds
 * @param {{ rematchAvoidance?: boolean, thirdPlaceMatch?: boolean, exchangeMatches?: boolean, guaranteedMatchCount?: number }} [options]
 */
export function planLossBandInitialize(entryIds, options = {}) {
  const rematchAvoidance = options.rematchAvoidance === true;
  const thirdPlaceMatch = options.thirdPlaceMatch === true;
  const exchangeMatches = options.exchangeMatches === true;
  const domainState = createInitialLossBandState(entryIds, {
    rematchAvoidance,
    thirdPlaceMatch,
    guaranteedMatchCount: options.guaranteedMatchCount,
    bracketSize: options.bracketSize,
  });
  const guaranteedMatchCount = resolveGuaranteedMatchCount({
    guaranteedMatchCount:
      options.guaranteedMatchCount ?? domainState.guaranteedMatchCount,
    bracketSize: domainState.bracketSize,
  });
  const pairings = buildRankingRoundPairings(domainState, 1, { rematchAvoidance });
  const stateDoc = buildLossBandStateDoc(entryIds, {
    rematchAvoidance,
    thirdPlaceMatch,
    exchangeMatches,
    guaranteedMatchCount,
    bracketSize: domainState.bracketSize,
  });
  const roundDoc = buildLossBandRoundDoc(pairings);

  const matchPlans = pairings.matches.map((match, index) => ({
    match,
    matchNumber: index + 1,
    session: buildLossBandMatchSessionDoc(
      match,
      index + 1,
      { entryId: match.team1EntryId },
      { entryId: match.team2EntryId }
    ),
  }));

  return { stateDoc, roundDoc, pairings, matchPlans, domainState };
}

/**
 * 1試合確定後の進行計画。全試合完了時のみ次ラウンドを生成する。
 * @param {object} params
 */
export function planAfterLossBandMatchSaved(params) {
  const {
    stateDoc,
    roundDoc,
    priorCompletedResults,
    newResult,
    rematchAvoidance,
  } = params;

  if (stateDoc.status === LossBandTournamentStatus.COMPLETED) {
    const error = new Error("loss-band already completed");
    error.code = "loss-band/already-complete";
    throw error;
  }

  if (roundDoc.status === LossBandRoundStatus.COMPLETE) {
    const error = new Error("round already complete");
    error.code = "loss-band/round-already-complete";
    throw error;
  }

  if (!(roundDoc.matchIds || []).includes(newResult.matchId)) {
    const error = new Error(`match ${newResult.matchId} not in round`);
    error.code = "loss-band/match-not-in-round";
    throw error;
  }

  const priorIds = new Set(
    (priorCompletedResults || []).map((r) => r.matchId).filter(Boolean)
  );
  if (priorIds.has(newResult.matchId)) {
    const error = new Error(`result already exists for ${newResult.matchId}`);
    error.code = "loss-band/result-exists";
    throw error;
  }

  const completedMatchIds = [...priorIds, newResult.matchId];
  const roundComplete = isLossBandRoundComplete(roundDoc, completedMatchIds);

  const nextRoundDoc = {
    ...roundDoc,
    completedMatchIds: [...completedMatchIds].sort((a, b) =>
      a.localeCompare(b, "en")
    ),
    status: roundComplete
      ? LossBandRoundStatus.COMPLETE
      : LossBandRoundStatus.OPEN,
  };

  if (!roundComplete) {
    return {
      roundComplete: false,
      nextRoundDoc,
      nextStateDoc: {
        ...stateDoc,
        currentRound: roundDoc.roundNumber,
        currentRoundId: roundDoc.roundId,
        completedRankingRound:
          stateDoc.completedRankingRound ?? roundDoc.roundNumber - 1,
        status: stateDoc.status || LossBandTournamentStatus.ACTIVE,
      },
      nextRoundPlan: null,
      placementsDoc: null,
      domainStateAfterRound: null,
      completion: null,
      exchangeRoundPlan: null,
    };
  }

  const allResults = [...(priorCompletedResults || []), newResult];
  /** @type {Array<{ roundDoc: object, results: object[] }>} */
  const completedRounds = [];
  if (
    Array.isArray(params.priorCompletedRounds) &&
    params.priorCompletedRounds.length > 0
  ) {
    completedRounds.push(...params.priorCompletedRounds);
  }
  completedRounds.push({
    roundDoc: nextRoundDoc,
    results: allResults,
  });

  const thirdPlaceMatch = stateDoc.thirdPlaceMatch === true;
  const avoidance =
    rematchAvoidance === true || stateDoc.rematchAvoidance === true;

  // 決勝 / 3位決定戦の完了
  if (
    roundDoc.matchPurpose === LossBandMatchPurpose.FINAL ||
    roundDoc.matchPurpose === LossBandMatchPurpose.THIRD_PLACE
  ) {
    const domainStateAfterRound = rebuildDomainStateFromCompletedRounds(
      stateDoc.entryIds,
      completedRounds,
      {
        thirdPlaceMatch,
        rematchAvoidance: avoidance,
        bracketSize: stateDoc.bracketSize,
        guaranteedMatchCount: stateDoc.guaranteedMatchCount,
      }
    );

    if (roundDoc.matchPurpose === LossBandMatchPurpose.FINAL) {
      if (thirdPlaceMatch) {
        const third = buildThirdPlacePairing(domainStateAfterRound);
        const generatedRoundDoc = buildSpecialMatchRoundDoc(third);
        return {
          roundComplete: true,
          nextRoundDoc,
          nextStateDoc: {
            ...stateDoc,
            currentRound: third.roundNumber,
            currentRoundId: "third_place",
            completedRankingRound: rankingRoundsFromStateDoc(
              stateDoc,
              stateDoc.entryIds
            ),
            status: LossBandTournamentStatus.THIRD_PLACE_PENDING,
            rematchAvoidance: avoidance,
            thirdPlaceMatch: true,
          },
          nextRoundPlan: {
            pairings: { matches: [third], roundNumber: third.roundNumber },
            roundDoc: generatedRoundDoc,
            matchPlans: [
              {
                match: third,
                matchNumber: 1,
                session: buildLossBandMatchSessionDoc(
                  third,
                  1,
                  { entryId: third.team1EntryId },
                  { entryId: third.team2EntryId }
                ),
              },
            ],
          },
          placementsDoc: null,
          exchangeRoundPlan: null,
          domainStateAfterRound,
          completion: evaluateLossBandRankingCompletion(domainStateAfterRound),
        };
      }

      const afterPlaced = planAfterRankingFullyPlaced({
        stateDoc: {
          ...stateDoc,
          currentRound: roundDoc.roundNumber,
          currentRoundId: roundDoc.roundId,
          completedRankingRound: rankingRoundsFromStateDoc(
            stateDoc,
            stateDoc.entryIds
          ),
        },
        domainState: domainStateAfterRound,
        rematchAvoidance: avoidance,
      });
      return {
        roundComplete: true,
        nextRoundDoc,
        nextStateDoc: afterPlaced.nextStateDoc,
        nextRoundPlan: null,
        placementsDoc: afterPlaced.placementsDoc,
        exchangeRoundPlan: afterPlaced.exchangeRoundPlan,
        domainStateAfterRound,
        completion: afterPlaced.rankingCompletion,
      };
    }

    // third place complete
    const afterPlaced = planAfterRankingFullyPlaced({
      stateDoc: {
        ...stateDoc,
        currentRound: roundDoc.roundNumber,
        currentRoundId: roundDoc.roundId,
        completedRankingRound: rankingRoundsFromStateDoc(
          stateDoc,
          stateDoc.entryIds
        ),
      },
      domainState: domainStateAfterRound,
      rematchAvoidance: avoidance,
    });
    return {
      roundComplete: true,
      nextRoundDoc,
      nextStateDoc: afterPlaced.nextStateDoc,
      nextRoundPlan: null,
      placementsDoc: afterPlaced.placementsDoc,
      exchangeRoundPlan: afterPlaced.exchangeRoundPlan,
      domainStateAfterRound,
      completion: afterPlaced.rankingCompletion,
    };
  }

  const domainStateAfterRound = rebuildDomainStateFromCompletedRounds(
    stateDoc.entryIds,
    completedRounds,
    {
      thirdPlaceMatch,
      rematchAvoidance: avoidance,
      bracketSize: stateDoc.bracketSize,
      guaranteedMatchCount: stateDoc.guaranteedMatchCount,
    }
  );

  const finishedRound = roundDoc.roundNumber;
  const rankingRounds = rankingRoundsFromStateDoc(stateDoc, stateDoc.entryIds);
  if (finishedRound >= rankingRounds) {
    const final = buildFinalPairing(domainStateAfterRound);
    const generatedRoundDoc = buildSpecialMatchRoundDoc(final);
    return {
      roundComplete: true,
      nextRoundDoc,
      nextStateDoc: {
        ...stateDoc,
        currentRound: final.roundNumber,
        currentRoundId: "final",
        completedRankingRound: finishedRound,
        status: LossBandTournamentStatus.FINALS_PENDING,
        rematchAvoidance: avoidance,
        thirdPlaceMatch,
      },
      nextRoundPlan: {
        pairings: { matches: [final], roundNumber: final.roundNumber },
        roundDoc: generatedRoundDoc,
        matchPlans: [
          {
            match: final,
            matchNumber: 1,
            session: buildLossBandMatchSessionDoc(
              final,
              1,
              { entryId: final.team1EntryId },
              { entryId: final.team2EntryId }
            ),
          },
        ],
      },
      placementsDoc: null,
      domainStateAfterRound,
      completion: evaluateLossBandRankingCompletion(domainStateAfterRound),
      exchangeRoundPlan: null,
    };
  }

  const nextPairings = buildRankingRoundPairings(
    domainStateAfterRound,
    finishedRound + 1,
    { rematchAvoidance: avoidance }
  );
  const generatedRoundDoc = buildLossBandRoundDoc(nextPairings);
  const matchPlans = nextPairings.matches.map((match, index) => ({
    match,
    matchNumber: index + 1,
    session: buildLossBandMatchSessionDoc(
      match,
      index + 1,
      { entryId: match.team1EntryId },
      { entryId: match.team2EntryId }
    ),
  }));

  return {
    roundComplete: true,
    nextRoundDoc,
    nextStateDoc: {
      ...stateDoc,
      currentRound: finishedRound + 1,
      currentRoundId: `r${finishedRound + 1}`,
      completedRankingRound: finishedRound,
      status: LossBandTournamentStatus.ACTIVE,
      rematchAvoidance: avoidance,
      thirdPlaceMatch,
    },
    nextRoundPlan: {
      pairings: nextPairings,
      roundDoc: generatedRoundDoc,
      matchPlans,
    },
    placementsDoc: null,
    domainStateAfterRound,
    completion: null,
    exchangeRoundPlan: null,
  };
}

/**
 * @param {object} exchangePlan planExchangeRound
 */
export function buildExchangeRoundDoc(exchangePlan) {
  const roundNumber = exchangePlan.exchangeRoundNumber;
  return {
    roundId: `ex${roundNumber}`,
    exchangeRoundNumber: roundNumber,
    status: LossBandRoundStatus.OPEN,
    matchIds: exchangePlan.matches.map((m) => m.matchId),
    pairs: exchangePlan.matches.map((m) => ({
      matchId: m.matchId,
      team1EntryId: m.team1EntryId,
      team2EntryId: m.team2EntryId,
    })),
    sitOutEntryId: exchangePlan.sitOutEntryId ?? null,
    eligibleEntryIds: [...(exchangePlan.eligible || [])].sort((a, b) =>
      a.localeCompare(b, "en")
    ),
    pairingVersion:
      exchangePlan.pairingVersion || LOSS_BAND_EXCHANGE_PAIRING_VERSION,
    rematchCount: exchangePlan.rematchCount ?? 0,
    matchPurpose: LossBandMatchPurpose.EXCHANGE,
    completedMatchIds: [],
    guaranteedMatchCount: exchangePlan.guaranteedMatchCount,
  };
}

/**
 * @param {object} match
 * @param {number} matchNumber
 * @param {{ entryId: string, teamName?: string, seed?: number }} team1
 * @param {{ entryId: string, teamName?: string, seed?: number }} team2
 */
export function buildExchangeMatchSessionDoc(match, matchNumber, team1, team2) {
  return {
    matchId: match.matchId,
    exchangeRoundNumber: match.exchangeRoundNumber,
    matchNumber,
    team1EntryId: match.team1EntryId,
    team2EntryId: match.team2EntryId,
    matchPurpose: LossBandMatchPurpose.EXCHANGE,
    status: MatchSessionStatus.PLAYING,
    team1: {
      entryId: team1.entryId,
      teamName: team1.teamName ?? team1.entryId,
      seed: team1.seed ?? matchNumber * 2 - 1,
    },
    team2: {
      entryId: team2.entryId,
      teamName: team2.teamName ?? team2.entryId,
      seed: team2.seed ?? matchNumber * 2,
    },
  };
}

/**
 * 順位確定後: placements 確定 + 必要なら交流戦第1ラウンド
 * @param {object} params
 */
export function planAfterRankingFullyPlaced(params) {
  const {
    stateDoc,
    domainState,
    rematchAvoidance,
  } = params;
  const thirdPlaceMatch = stateDoc.thirdPlaceMatch === true;
  const exchangeMatches = stateDoc.exchangeMatches === true;
  const placementsDoc = buildLossBandPlacementsDoc(domainState, {
    thirdPlaceMatch,
  });
  const rankingCompletion = evaluateLossBandRankingCompletion(domainState, {
    thirdPlaceMatch,
  });

  if (!exchangeMatches) {
    return {
      nextStateDoc: {
        ...stateDoc,
        status: LossBandTournamentStatus.COMPLETED,
        rematchAvoidance: rematchAvoidance === true,
        thirdPlaceMatch,
        exchangeMatches: false,
        exchangeRoundNumber: 0,
      },
      placementsDoc,
      exchangeRoundPlan: null,
      domainState,
      rankingCompletion,
      tournamentComplete: true,
    };
  }

  const exchangePlan = planExchangeRound({
    state: domainState,
    matchLog: domainState.matchLog,
    exchangeRoundNumber: 1,
    priorExchangeRounds: [],
    guaranteedMatchCount: stateDoc.guaranteedMatchCount,
  });

  if (!exchangePlan.needed) {
    return {
      nextStateDoc: {
        ...stateDoc,
        status: LossBandTournamentStatus.COMPLETED,
        rematchAvoidance: rematchAvoidance === true,
        thirdPlaceMatch,
        exchangeMatches: true,
        exchangeRoundNumber: 0,
      },
      placementsDoc,
      exchangeRoundPlan: null,
      domainState,
      rankingCompletion,
      tournamentComplete: true,
    };
  }

  const roundDoc = buildExchangeRoundDoc(exchangePlan);
  const matchPlans = exchangePlan.matches.map((match, index) => ({
    match,
    matchNumber: index + 1,
    session: buildExchangeMatchSessionDoc(
      match,
      index + 1,
      { entryId: match.team1EntryId },
      { entryId: match.team2EntryId }
    ),
  }));

  return {
    nextStateDoc: {
      ...stateDoc,
      status: LossBandTournamentStatus.EXCHANGE_PENDING,
      rematchAvoidance: rematchAvoidance === true,
      thirdPlaceMatch,
      exchangeMatches: true,
      exchangeRoundNumber: 1,
      currentRoundId: roundDoc.roundId,
      currentRound: exchangePlan.exchangeRoundNumber,
    },
    placementsDoc,
    exchangeRoundPlan: {
      plan: exchangePlan,
      roundDoc,
      matchPlans,
    },
    domainState,
    rankingCompletion,
    tournamentComplete: false,
  };
}

/**
 * 交流戦1試合保存後の進行
 * @param {object} params
 */
export function planAfterExchangeMatchSaved(params) {
  const {
    stateDoc,
    exchangeRoundDoc,
    priorCompletedResults,
    newResult,
    domainStateBeforeExchangeAppend,
    priorExchangeRounds = [],
  } = params;

  if (stateDoc.status === LossBandTournamentStatus.COMPLETED) {
    const error = new Error("loss-band already completed");
    error.code = "loss-band/already-complete";
    throw error;
  }
  if (stateDoc.status !== LossBandTournamentStatus.EXCHANGE_PENDING) {
    const error = new Error("exchange not pending");
    error.code = "loss-band/exchange-not-pending";
    throw error;
  }
  if (exchangeRoundDoc.status === LossBandRoundStatus.COMPLETE) {
    const error = new Error("exchange round already complete");
    error.code = "loss-band/round-already-complete";
    throw error;
  }
  if (!(exchangeRoundDoc.matchIds || []).includes(newResult.matchId)) {
    const error = new Error(`match ${newResult.matchId} not in exchange round`);
    error.code = "loss-band/match-not-in-round";
    throw error;
  }

  const priorIds = new Set(
    (priorCompletedResults || []).map((r) => r.matchId).filter(Boolean)
  );
  if (priorIds.has(newResult.matchId)) {
    const error = new Error(`result already exists for ${newResult.matchId}`);
    error.code = "loss-band/result-exists";
    throw error;
  }

  const completedMatchIds = [...priorIds, newResult.matchId];
  const roundComplete = isLossBandRoundComplete(
    exchangeRoundDoc,
    completedMatchIds
  );
  const nextRoundDoc = {
    ...exchangeRoundDoc,
    completedMatchIds: [...completedMatchIds].sort((a, b) =>
      a.localeCompare(b, "en")
    ),
    status: roundComplete
      ? LossBandRoundStatus.COMPLETE
      : LossBandRoundStatus.OPEN,
  };

  if (!roundComplete) {
    return {
      roundComplete: false,
      nextRoundDoc,
      nextStateDoc: { ...stateDoc },
      nextExchangePlan: null,
      domainState: domainStateBeforeExchangeAppend,
      tournamentComplete: false,
    };
  }

  // ラウンド完了: winners → matchLog 追記（placements 不変）
  const allResults = [...(priorCompletedResults || []), newResult];
  /** @type {Record<string, string>} */
  const winners = {};
  for (const result of allResults) {
    const winnerEntryId =
      result.winner?.entryId ||
      (result.winnerSide === "team1"
        ? result.team1EntryId
        : result.team2EntryId);
    if (result.matchId && winnerEntryId) {
      winners[result.matchId] = winnerEntryId;
    }
  }

  const exchangePlanForLog = {
    matches: (exchangeRoundDoc.pairs || []).map((pair) => ({
      matchId: pair.matchId,
      exchangeRoundNumber: exchangeRoundDoc.exchangeRoundNumber,
      team1EntryId: pair.team1EntryId,
      team2EntryId: pair.team2EntryId,
      purpose: LossBandMatchPurpose.EXCHANGE,
    })),
  };
  const domainState = appendExchangeResultsToMatchLog(
    domainStateBeforeExchangeAppend,
    exchangePlanForLog,
    winners
  );

  const completedExchangeRounds = [
    ...priorExchangeRounds,
    { ...nextRoundDoc, sitOutEntryId: nextRoundDoc.sitOutEntryId ?? null },
  ];

  const nextNumber = (exchangeRoundDoc.exchangeRoundNumber || 0) + 1;
  const nextPlan = planExchangeRound({
    state: domainState,
    matchLog: domainState.matchLog,
    exchangeRoundNumber: nextNumber,
    priorExchangeRounds: completedExchangeRounds,
    guaranteedMatchCount: stateDoc.guaranteedMatchCount,
  });

  if (!nextPlan.needed) {
    const guaranteeCheck = validateGuaranteedMatchCounts(domainState, domainState.matchLog, {
      guaranteedMatchCount: stateDoc.guaranteedMatchCount,
    });
    return {
      roundComplete: true,
      nextRoundDoc,
      nextStateDoc: {
        ...stateDoc,
        status: LossBandTournamentStatus.COMPLETED,
        exchangeRoundNumber: exchangeRoundDoc.exchangeRoundNumber,
      },
      nextExchangePlan: null,
      domainState,
      tournamentComplete: true,
      guaranteeCheck,
    };
  }

  const generatedRoundDoc = buildExchangeRoundDoc(nextPlan);
  const matchPlans = nextPlan.matches.map((match, index) => ({
    match,
    matchNumber: index + 1,
    session: buildExchangeMatchSessionDoc(
      match,
      index + 1,
      { entryId: match.team1EntryId },
      { entryId: match.team2EntryId }
    ),
  }));

  return {
    roundComplete: true,
    nextRoundDoc,
    nextStateDoc: {
      ...stateDoc,
      status: LossBandTournamentStatus.EXCHANGE_PENDING,
      exchangeRoundNumber: nextNumber,
      currentRoundId: generatedRoundDoc.roundId,
      currentRound: nextNumber,
    },
    nextExchangePlan: {
      plan: nextPlan,
      roundDoc: generatedRoundDoc,
      matchPlans,
    },
    domainState,
    tournamentComplete: false,
  };
}

/**
 * 同一ラウンドで同一チームが複数試合に出ないこと
 * @param {object} roundDoc
 */
export function validateRoundTeamUniqueness(roundDoc) {
  const ids = [];
  if (roundDoc.matchPurpose === LossBandMatchPurpose.EXCHANGE) {
    for (const pair of roundDoc.pairs || []) {
      ids.push(pair.team1EntryId, pair.team2EntryId);
    }
    if (roundDoc.sitOutEntryId) {
      // sit-out は試合に出ない
    }
    return (
      new Set(ids).size === ids.length &&
      ids.length === (roundDoc.matchIds?.length ?? 0) * 2
    );
  }
  for (const match of pairingsFromRoundDoc(roundDoc).matches) {
    ids.push(match.team1EntryId, match.team2EntryId);
  }
  return (
    new Set(ids).size === ids.length &&
    ids.length === (roundDoc.matchIds?.length ?? 0) * 2
  );
}
