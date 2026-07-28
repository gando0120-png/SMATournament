/**
 * 大会正式結果・到達順位（DOM / Firestore 非依存）
 */
import {
  FinalsMatchResolution,
  MatchResultStatus,
  TournamentStatus,
} from "./constants.js";
import { getFinalsChampionAndRunnerUp } from "./finals-match-progress.js";
import { hasCreatedConsolationBracket } from "./consolation-bracket.js";
import {
  getSingleEliminationParticipants,
  isSingleEliminationBracket,
} from "./single-elimination-bracket.js";

export const TournamentFinalizeReasonCode = {
  ALREADY_FINALIZED: "already-finalized",
  MAIN_INCOMPLETE: "main-incomplete",
  CONSOLATION_INCOMPLETE: "consolation-incomplete",
};

export const PlacementType = {
  CHAMPION: "champion",
  RUNNER_UP: "runner_up",
  ELIMINATED: "eliminated",
};

/**
 * 確定済み決勝 bracket の slots から結果算出用参加者を取得
 * @param {object|null|undefined} bracket
 */
export function getFinalsBracketParticipants(bracket) {
  if (!bracket?.finalized) {
    return [];
  }

  return (bracket.slots ?? [])
    .filter((slot) => !slot.isBye && slot.entryId)
    .map((slot) => ({
      entryId: slot.entryId,
      teamName: slot.teamName ?? null,
      blockId: slot.blockId ?? null,
      blockName: slot.blockName ?? null,
      blockRank: slot.blockRank ?? null,
      seed: slot.seed ?? slot.slotNumber ?? null,
    }));
}

/**
 * @param {object|null|undefined} bracket
 * @param {object|null|undefined} advancement
 */
export function getTournamentResultParticipants(bracket, advancement) {
  if (isSingleEliminationBracket(bracket)) {
    return getSingleEliminationParticipants(bracket);
  }

  const fromBracket = getFinalsBracketParticipants(bracket);
  if (fromBracket.length > 0) {
    return fromBracket;
  }

  return (advancement?.qualifiers ?? []).filter((qualifier) => qualifier?.entryId && !qualifier.isBye);
}

/**
 * @param {number} eliminatedRoundNumber
 * @param {number} roundCount
 */
export function getEliminationPlacementLabel(eliminatedRoundNumber, roundCount) {
  if (eliminatedRoundNumber >= roundCount) {
    return {
      placementType: PlacementType.RUNNER_UP,
      placementLabel: "準優勝",
    };
  }

  const bestN = 2 ** (roundCount - eliminatedRoundNumber + 1);
  return {
    placementType: PlacementType.ELIMINATED,
    placementLabel: `ベスト${bestN}`,
  };
}

/**
 * @param {object|null|undefined} bracket
 */
export function findFinalMatch(bracket) {
  if (!bracket?.matches?.length) {
    return null;
  }

  return (
    bracket.matches.find((match) => !match.nextMatchId) ??
    bracket.matches.find((match) => match.roundNumber === bracket.roundCount) ??
    null
  );
}

/**
 * @param {object|null|undefined} result
 */
function isValidFinishedResult(result) {
  if (!result || result.status !== MatchResultStatus.FINISHED) {
    return false;
  }

  if (result.resolution === FinalsMatchResolution.BYE) {
    return Boolean(result.winner?.entryId);
  }

  if (result.resolution === FinalsMatchResolution.PLAYED) {
    return Boolean(result.winner?.entryId && result.loser?.entryId);
  }

  return false;
}

/**
 * @param {object|null|undefined} bracket
 * @param {Map<string, object>} resultsMap
 * @param {{ requirePlayedFinal?: boolean }} [options]
 */
function validateBracketMatchesComplete(bracket, resultsMap, options = {}) {
  const { requirePlayedFinal = true } = options;

  if (!bracket?.finalized) {
    return { complete: false, message: "トーナメント表が未確定です。" };
  }

  const matches = bracket.matches ?? [];
  if (matches.length === 0) {
    return { complete: false, message: "トーナメント試合がありません。" };
  }

  for (const match of matches) {
    const result = resultsMap.get(match.matchId);
    if (!isValidFinishedResult(result)) {
      return {
        complete: false,
        message: `試合 ${match.matchId} の結果が未完了です。`,
      };
    }
  }

  const finalMatch = findFinalMatch(bracket);
  if (!finalMatch) {
    return { complete: false, message: "決勝戦を特定できません。" };
  }

  const finalResult = resultsMap.get(finalMatch.matchId);
  if (!finalResult) {
    return { complete: false, message: "決勝戦が正しく終了していません。" };
  }

  if (requirePlayedFinal && finalResult.resolution === FinalsMatchResolution.BYE) {
    return { complete: false, message: "決勝戦が正しく終了していません。" };
  }

  const { champion, runnerUp, complete } = getFinalsChampionAndRunnerUp(bracket, resultsMap);
  if (!complete || !champion?.entryId) {
    return { complete: false, message: "優勝を判定できません。" };
  }

  if (requirePlayedFinal && (!runnerUp?.entryId || champion.entryId === runnerUp.entryId)) {
    return { complete: false, message: "優勝・準優勝を判定できません。" };
  }

  return { complete: true, champion, runnerUp, finalMatch };
}

/**
 * @param {object} params
 */
function validateMainBracketCompletion({
  bracket,
  resultsMap,
  qualifiers,
  advancement,
}) {
  const participants =
    Array.isArray(qualifiers) && qualifiers.length > 0
      ? qualifiers
      : getTournamentResultParticipants(bracket, advancement);

  if (!bracket?.finalized) {
    return { complete: false, message: "決勝トーナメントが未確定です。" };
  }

  if (!Array.isArray(participants) || participants.length === 0) {
    return {
      complete: false,
      message: isSingleEliminationBracket(bracket)
        ? "参加チームがありません。"
        : "決勝進出チームがありません。",
    };
  }

  const bracketCheck = validateBracketMatchesComplete(bracket, resultsMap, {
    requirePlayedFinal: true,
  });
  if (!bracketCheck.complete) {
    return bracketCheck;
  }

  const placementPreview = buildTournamentPlacements({
    bracket,
    resultsMap,
    qualifiers: participants,
  });

  if (!placementPreview.valid) {
    return {
      complete: false,
      message: placementPreview.message ?? "到達順位を算出できません。",
    };
  }

  return {
    complete: true,
    champion: placementPreview.champion,
    runnerUp: placementPreview.runnerUp,
    finalMatch: bracketCheck.finalMatch,
    placements: placementPreview.placements,
    completedMatchCount: bracket.matches?.length ?? 0,
    expectedMatchCount: bracket.matches?.length ?? 0,
  };
}

/**
 * @param {object|null|undefined} consolationBracket
 * @param {Map<string, object>} consolationResultsMap
 */
function validateConsolationBracketCompletion(consolationBracket, consolationResultsMap) {
  if (!hasCreatedConsolationBracket(consolationBracket)) {
    return { complete: true, required: false };
  }

  const bracketCheck = validateBracketMatchesComplete(
    consolationBracket,
    consolationResultsMap,
    { requirePlayedFinal: false }
  );

  if (!bracketCheck.complete) {
    return { complete: false, required: true, message: bracketCheck.message };
  }

  return {
    complete: true,
    required: true,
    champion: bracketCheck.champion,
    runnerUp: bracketCheck.runnerUp,
  };
}

/**
 * 大会終了可否の唯一の判定入口
 * @param {object} params
 */
export function canFinalizeTournament({
  tournament = null,
  bracket,
  resultsMap,
  qualifiers,
  advancement,
  existingResults,
  consolationBracket = null,
  consolationResultsMap = new Map(),
}) {
  if (
    existingResults?.finalized ||
    tournament?.status === TournamentStatus.CLOSED
  ) {
    return {
      canFinalize: false,
      message: "大会はすでに終了しています。",
      reasonCode: TournamentFinalizeReasonCode.ALREADY_FINALIZED,
    };
  }

  const mainCheck = validateMainBracketCompletion({
    bracket,
    resultsMap,
    qualifiers,
    advancement,
  });

  if (!mainCheck.complete) {
    return {
      canFinalize: false,
      message: "上位トーナメントが未終了です。",
      reasonCode: TournamentFinalizeReasonCode.MAIN_INCOMPLETE,
      detail: mainCheck.message,
    };
  }

  const consolationCheck = validateConsolationBracketCompletion(
    consolationBracket,
    consolationResultsMap
  );

  if (!consolationCheck.complete) {
    return {
      canFinalize: false,
      message: "下位トーナメントが未終了です。",
      reasonCode: TournamentFinalizeReasonCode.CONSOLATION_INCOMPLETE,
      detail: consolationCheck.message,
    };
  }

  return {
    canFinalize: true,
    message: null,
    reasonCode: null,
    champion: mainCheck.champion,
    runnerUp: mainCheck.runnerUp,
    finalMatch: mainCheck.finalMatch,
    placements: mainCheck.placements,
    completedMatchCount: mainCheck.completedMatchCount,
    expectedMatchCount: mainCheck.expectedMatchCount,
    consolationRequired: consolationCheck.required === true,
    consolationComplete: consolationCheck.required ? consolationCheck.complete : null,
    consolationChampion: consolationCheck.champion ?? null,
  };
}

/**
 * @param {object} params
 */
export function validateTournamentCompletion(params) {
  const decision = canFinalizeTournament(params);

  if (!decision.canFinalize) {
    return {
      canFinalize: false,
      message: decision.message,
      reasonCode: decision.reasonCode,
      detail: decision.detail ?? null,
    };
  }

  return {
    canFinalize: true,
    message: null,
    champion: decision.champion,
    runnerUp: decision.runnerUp,
    finalMatch: decision.finalMatch,
    placements: decision.placements,
    completedMatchCount: decision.completedMatchCount,
    expectedMatchCount: decision.expectedMatchCount,
  };
}

/**
 * @param {object} params
 */
export function buildTournamentPlacements({ bracket, resultsMap, qualifiers }) {
  const activeQualifiers = (qualifiers ?? []).filter(
    (qualifier) => qualifier?.entryId && !qualifier.isBye
  );

  if (!bracket?.finalized || activeQualifiers.length === 0) {
    return { valid: false, message: "入力データが不足しています。", placements: [] };
  }

  const slotByEntryId = new Map(
    (bracket.slots ?? [])
      .filter((slot) => slot.entryId && !slot.isBye)
      .map((slot) => [slot.entryId, slot])
  );

  function normalizeParticipant(qualifier) {
    const slot = slotByEntryId.get(qualifier.entryId);
    return {
      entryId: qualifier.entryId,
      teamName: qualifier.teamName ?? slot?.teamName ?? null,
      blockId: qualifier.blockId ?? slot?.blockId ?? null,
      blockName: qualifier.blockName ?? slot?.blockName ?? null,
      blockRank: qualifier.blockRank ?? slot?.blockRank ?? null,
      seed: qualifier.seed ?? slot?.seed ?? slot?.slotNumber ?? null,
    };
  }

  const { champion, runnerUp, complete } = getFinalsChampionAndRunnerUp(
    bracket,
    resultsMap
  );

  if (!complete || !champion?.entryId || !runnerUp?.entryId) {
    return { valid: false, message: "優勝・準優勝を判定できません。", placements: [] };
  }

  const eliminationByEntryId = new Map();

  for (const match of bracket.matches ?? []) {
    const result = resultsMap.get(match.matchId);
    if (!result?.loser?.entryId) {
      continue;
    }

    if (eliminationByEntryId.has(result.loser.entryId)) {
      return {
        valid: false,
        message: "同じチームが複数回敗退として記録されています。",
        placements: [],
      };
    }

    eliminationByEntryId.set(result.loser.entryId, {
      eliminatedRoundNumber: match.roundNumber,
      eliminatedByEntryId: result.winner?.entryId ?? null,
      eliminatedByTeamName: result.winner?.teamName ?? null,
    });
  }

  const placements = [];
  const seenEntryIds = new Set();

  for (const qualifier of activeQualifiers) {
    const participant = normalizeParticipant(qualifier);

    if (!participant.entryId) {
      return { valid: false, message: "進出チームに entryId がありません。", placements: [] };
    }

    if (!participant.teamName) {
      return {
        valid: false,
        message: `進出チーム ${participant.entryId} の teamName を特定できません。`,
        placements: [],
      };
    }

    if (seenEntryIds.has(participant.entryId)) {
      return { valid: false, message: "進出チームに重複があります。", placements: [] };
    }
    seenEntryIds.add(participant.entryId);

    if (participant.entryId === champion.entryId) {
      placements.push({
        entryId: participant.entryId,
        teamName: participant.teamName,
        blockId: participant.blockId,
        blockName: participant.blockName,
        blockRank: participant.blockRank,
        seed: participant.seed,
        placementType: PlacementType.CHAMPION,
        placementLabel: "優勝",
        reachedRoundNumber: bracket.roundCount,
        eliminatedRoundNumber: null,
        eliminatedByEntryId: null,
        eliminatedByTeamName: null,
      });
      continue;
    }

    if (participant.entryId === runnerUp.entryId) {
      placements.push({
        entryId: participant.entryId,
        teamName: participant.teamName,
        blockId: participant.blockId,
        blockName: participant.blockName,
        blockRank: participant.blockRank,
        seed: participant.seed,
        placementType: PlacementType.RUNNER_UP,
        placementLabel: "準優勝",
        reachedRoundNumber: bracket.roundCount,
        eliminatedRoundNumber: bracket.roundCount,
        eliminatedByEntryId: champion.entryId,
        eliminatedByTeamName: champion.teamName,
      });
      continue;
    }

    const elimination = eliminationByEntryId.get(participant.entryId);
    if (!elimination) {
      return {
        valid: false,
        message: `進出チーム ${participant.teamName} の敗退ラウンドを特定できません。`,
        placements: [],
      };
    }

    const { placementType, placementLabel } = getEliminationPlacementLabel(
      elimination.eliminatedRoundNumber,
      bracket.roundCount
    );

    placements.push({
      entryId: participant.entryId,
      teamName: participant.teamName,
      blockId: participant.blockId,
      blockName: participant.blockName,
      blockRank: participant.blockRank,
      seed: participant.seed,
      placementType,
      placementLabel,
      reachedRoundNumber: elimination.eliminatedRoundNumber,
      eliminatedRoundNumber: elimination.eliminatedRoundNumber,
      eliminatedByEntryId: elimination.eliminatedByEntryId,
      eliminatedByTeamName: elimination.eliminatedByTeamName,
    });
  }

  if (placements.length !== activeQualifiers.length) {
    return {
      valid: false,
      message: "全進出チームを到達順位に反映できません。",
      placements: [],
    };
  }

  placements.sort((a, b) => (a.seed ?? 0) - (b.seed ?? 0));

  return {
    valid: true,
    message: null,
    placements,
    champion,
    runnerUp,
  };
}

/**
 * @param {object} preview
 * @param {object} tournament
 * @param {object} advancement
 * @param {object} bracket
 */
export function buildPersistedTournamentResults(preview, tournament, advancement, bracket) {
  return {
    finalized: true,
    tournamentId: tournament.id,
    tournamentName: tournament.name ?? "",
    tournamentStatus: "closed",
    champion: preview.champion,
    runnerUp: preview.runnerUp,
    placements: preview.placements,
    qualifierCount:
      bracket?.teamCount ?? advancement?.finalTeamCount ?? preview.placements.length,
    bracketSize: bracket.bracketSize,
    completedMatchCount: preview.completedMatchCount,
    expectedMatchCount: preview.expectedMatchCount,
  };
}
