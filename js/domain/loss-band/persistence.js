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
  LOSS_BAND_RANKING_ROUND_COUNT,
  LOSS_BAND_TEAM_COUNT,
  LossBandMatchPurpose,
  RankingMode,
} from "./constants.js";
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
import { createInitialLossBandState } from "./state.js";

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
  /** 全順位確定 */
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
 * @param {{ rematchAvoidance?: boolean, thirdPlaceMatch?: boolean }} [options]
 */
export function buildLossBandStateDoc(entryIds, options = {}) {
  return {
    version: LOSS_BAND_STATE_VERSION,
    teamCount: LOSS_BAND_TEAM_COUNT,
    entryIds: [...entryIds],
    currentRound: 1,
    currentRoundId: "r1",
    completedRankingRound: 0,
    status: LossBandTournamentStatus.ACTIVE,
    rankingMode: RankingMode.LOSS_BAND,
    rematchAvoidance: options.rematchAvoidance === true,
    thirdPlaceMatch: options.thirdPlaceMatch === true,
  };
}

/**
 * @param {object} pairings buildRankingRoundPairings の戻り値
 */
export function buildLossBandRoundDoc(pairings) {
  /** @type {Record<string, { lossCount: number, matchIds: string[], pairs: object[] }>} */
  const bands = {};
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
    };
  }

  return {
    roundId: buildLossBandRoundId(pairings.roundNumber),
    roundNumber: pairings.roundNumber,
    status: LossBandRoundStatus.OPEN,
    bands,
    matchIds: pairings.matches.map((m) => m.matchId),
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
      byLossCount: { 0: [match] },
      rematchCount: 0,
      rematchAvoidance: false,
      matchPurpose: roundDoc.matchPurpose,
    };
  }

  const matches = [];
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
      purpose: "ranking",
    }));
    byLossCount[lossCount] = bandMatches;
    matches.push(...bandMatches);
  }

  return {
    roundNumber: roundDoc.roundNumber,
    matches,
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
  });
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
    const pairings = pairingsFromRoundDoc(roundDoc);
    if (pairings.roundNumber < LOSS_BAND_RANKING_ROUND_COUNT) {
      state = applyRankingRoundResults(state, pairings, winners);
    } else if (pairings.roundNumber === LOSS_BAND_RANKING_ROUND_COUNT) {
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
    teamCount: LOSS_BAND_TEAM_COUNT,
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
 * @param {{ rematchAvoidance?: boolean, thirdPlaceMatch?: boolean }} [options]
 */
export function planLossBandInitialize(entryIds, options = {}) {
  const rematchAvoidance = options.rematchAvoidance === true;
  const thirdPlaceMatch = options.thirdPlaceMatch === true;
  const domainState = createInitialLossBandState(entryIds, {
    rematchAvoidance,
    thirdPlaceMatch,
  });
  const pairings = buildRankingRoundPairings(domainState, 1, { rematchAvoidance });
  const stateDoc = buildLossBandStateDoc(entryIds, {
    rematchAvoidance,
    thirdPlaceMatch,
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
      { thirdPlaceMatch, rematchAvoidance: avoidance }
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
            completedRankingRound: LOSS_BAND_RANKING_ROUND_COUNT,
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
          domainStateAfterRound,
          completion: evaluateLossBandRankingCompletion(domainStateAfterRound),
        };
      }

      const placementsDoc = buildLossBandPlacementsDoc(domainStateAfterRound, {
        thirdPlaceMatch: false,
      });
      return {
        roundComplete: true,
        nextRoundDoc,
        nextStateDoc: {
          ...stateDoc,
          currentRound: roundDoc.roundNumber,
          currentRoundId: roundDoc.roundId,
          completedRankingRound: LOSS_BAND_RANKING_ROUND_COUNT,
          status: LossBandTournamentStatus.COMPLETED,
          rematchAvoidance: avoidance,
          thirdPlaceMatch: false,
        },
        nextRoundPlan: null,
        placementsDoc,
        domainStateAfterRound,
        completion: evaluateLossBandRankingCompletion(domainStateAfterRound),
      };
    }

    // third place complete
    const placementsDoc = buildLossBandPlacementsDoc(domainStateAfterRound, {
      thirdPlaceMatch: true,
    });
    return {
      roundComplete: true,
      nextRoundDoc,
      nextStateDoc: {
        ...stateDoc,
        currentRound: roundDoc.roundNumber,
        currentRoundId: roundDoc.roundId,
        completedRankingRound: LOSS_BAND_RANKING_ROUND_COUNT,
        status: LossBandTournamentStatus.COMPLETED,
        rematchAvoidance: avoidance,
        thirdPlaceMatch: true,
      },
      nextRoundPlan: null,
      placementsDoc,
      domainStateAfterRound,
      completion: evaluateLossBandRankingCompletion(domainStateAfterRound),
    };
  }

  const domainStateAfterRound = rebuildDomainStateFromCompletedRounds(
    stateDoc.entryIds,
    completedRounds,
    { thirdPlaceMatch, rematchAvoidance: avoidance }
  );

  const finishedRound = roundDoc.roundNumber;
  if (finishedRound >= LOSS_BAND_RANKING_ROUND_COUNT) {
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
  };
}

/**
 * 同一ラウンドで同一チームが複数試合に出ないこと
 * @param {object} roundDoc
 */
export function validateRoundTeamUniqueness(roundDoc) {
  const ids = [];
  for (const match of pairingsFromRoundDoc(roundDoc).matches) {
    ids.push(match.team1EntryId, match.team2EntryId);
  }
  return (
    new Set(ids).size === ids.length &&
    ids.length === (roundDoc.matchIds?.length ?? 0) * 2
  );
}
