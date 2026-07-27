/**
 * 大会正式結果・到達順位（DOM / Firestore 非依存）
 */
import {
  FinalsMatchResolution,
  MatchResultStatus,
} from "./constants.js";
import { getFinalsChampionAndRunnerUp } from "./finals-match-progress.js";
import {
  getSingleEliminationParticipants,
  isSingleEliminationBracket,
} from "./single-elimination-bracket.js";

export const PlacementType = {
  CHAMPION: "champion",
  RUNNER_UP: "runner_up",
  ELIMINATED: "eliminated",
};

/**
 * @param {object|null|undefined} bracket
 * @param {object|null|undefined} advancement
 */
export function getTournamentResultParticipants(bracket, advancement) {
  if (isSingleEliminationBracket(bracket)) {
    return getSingleEliminationParticipants(bracket);
  }
  return advancement?.qualifiers ?? [];
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
 * @param {object} params
 */
export function validateTournamentCompletion({
  bracket,
  resultsMap,
  qualifiers,
  advancement,
  existingResults,
}) {
  const participants =
    Array.isArray(qualifiers) && qualifiers.length > 0
      ? qualifiers
      : getTournamentResultParticipants(bracket, advancement);
  if (existingResults?.finalized) {
    return {
      canFinalize: false,
      message: "大会結果はすでに確定済みです。",
    };
  }

  if (!bracket?.finalized) {
    return {
      canFinalize: false,
      message: "決勝トーナメントが未確定です。",
    };
  }

  if (!Array.isArray(participants) || participants.length === 0) {
    return {
      canFinalize: false,
      message: isSingleEliminationBracket(bracket)
        ? "参加チームがありません。"
        : "決勝進出チームがありません。",
    };
  }

  const matches = bracket.matches ?? [];
  if (matches.length === 0) {
    return {
      canFinalize: false,
      message: "トーナメント試合がありません。",
    };
  }

  for (const match of matches) {
    const result = resultsMap.get(match.matchId);
    if (!isValidFinishedResult(result)) {
      return {
        canFinalize: false,
        message: `決勝試合 ${match.matchId} の結果が未完了です。`,
      };
    }
  }

  const finalMatch = findFinalMatch(bracket);
  if (!finalMatch) {
    return {
      canFinalize: false,
      message: "決勝戦を特定できません。",
    };
  }

  const finalResult = resultsMap.get(finalMatch.matchId);
  if (!finalResult || finalResult.resolution === FinalsMatchResolution.BYE) {
    return {
      canFinalize: false,
      message: "決勝戦が正しく終了していません。",
    };
  }

  const { champion, runnerUp, complete } = getFinalsChampionAndRunnerUp(
    bracket,
    resultsMap
  );

  if (!complete || !champion?.entryId || !runnerUp?.entryId) {
    return {
      canFinalize: false,
      message: "優勝・準優勝を判定できません。",
    };
  }

  if (champion.entryId === runnerUp.entryId) {
    return {
      canFinalize: false,
      message: "優勝チームが一意ではありません。",
    };
  }

  const placementPreview = buildTournamentPlacements({
    bracket,
    resultsMap,
    qualifiers: participants,
  });

  if (!placementPreview.valid) {
    return {
      canFinalize: false,
      message: placementPreview.message ?? "到達順位を算出できません。",
    };
  }

  return {
    canFinalize: true,
    message: null,
    champion,
    runnerUp,
    finalMatch,
    placements: placementPreview.placements,
    completedMatchCount: matches.length,
    expectedMatchCount: matches.length,
  };
}

/**
 * @param {object} params
 */
export function buildTournamentPlacements({ bracket, resultsMap, qualifiers }) {
  if (!bracket?.finalized || !Array.isArray(qualifiers) || qualifiers.length === 0) {
    return { valid: false, message: "入力データが不足しています。", placements: [] };
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

  for (const qualifier of qualifiers) {
    if (!qualifier?.entryId) {
      return { valid: false, message: "進出チームに entryId がありません。", placements: [] };
    }

    if (seenEntryIds.has(qualifier.entryId)) {
      return { valid: false, message: "進出チームに重複があります。", placements: [] };
    }
    seenEntryIds.add(qualifier.entryId);

    if (qualifier.entryId === champion.entryId) {
      placements.push({
        entryId: qualifier.entryId,
        teamName: qualifier.teamName,
        seed: qualifier.seed,
        placementType: PlacementType.CHAMPION,
        placementLabel: "優勝",
        reachedRoundNumber: bracket.roundCount,
        eliminatedRoundNumber: null,
        eliminatedByEntryId: null,
        eliminatedByTeamName: null,
      });
      continue;
    }

    if (qualifier.entryId === runnerUp.entryId) {
      placements.push({
        entryId: qualifier.entryId,
        teamName: qualifier.teamName,
        seed: qualifier.seed,
        placementType: PlacementType.RUNNER_UP,
        placementLabel: "準優勝",
        reachedRoundNumber: bracket.roundCount,
        eliminatedRoundNumber: bracket.roundCount,
        eliminatedByEntryId: champion.entryId,
        eliminatedByTeamName: champion.teamName,
      });
      continue;
    }

    const elimination = eliminationByEntryId.get(qualifier.entryId);
    if (!elimination) {
      return {
        valid: false,
        message: `進出チーム ${qualifier.teamName} の敗退ラウンドを特定できません。`,
        placements: [],
      };
    }

    const { placementType, placementLabel } = getEliminationPlacementLabel(
      elimination.eliminatedRoundNumber,
      bracket.roundCount
    );

    placements.push({
      entryId: qualifier.entryId,
      teamName: qualifier.teamName,
      seed: qualifier.seed,
      placementType,
      placementLabel,
      reachedRoundNumber: elimination.eliminatedRoundNumber,
      eliminatedRoundNumber: elimination.eliminatedRoundNumber,
      eliminatedByEntryId: elimination.eliminatedByEntryId,
      eliminatedByTeamName: elimination.eliminatedByTeamName,
    });
  }

  if (placements.length !== qualifiers.length) {
    return {
      valid: false,
      message: "全進出チームを到達順位に反映できません。",
      placements: [],
    };
  }

  placements.sort((a, b) => a.seed - b.seed);

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
