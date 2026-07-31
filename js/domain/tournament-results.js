/**
 * 大会正式結果・到達順位（DOM / Firestore 非依存）
 */
import {
  FinalsMatchResolution,
  MatchResultStatus,
  TournamentStatus,
} from "./constants.js";
import { BracketKind } from "./bracket-collections.js";
import { getFinalsChampionAndRunnerUp } from "./finals-match-progress.js";
import { hasCreatedConsolationBracket } from "./consolation-bracket.js";
import {
  getSingleEliminationParticipants,
  isSingleEliminationBracket,
} from "./single-elimination-bracket.js";
import { MatchFormat } from "./aggregate-match-format.js";
import { buildMultiTeamPlacements } from "./multi-team-placements.js";
import { isMultiTeamBracket } from "./multi-team-bracket.js";

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

export const BracketPlacementMode = {
  STRICT: "strict",
  PARTIAL: "partial",
};

const MAIN_PLACEMENT_GROUP_ORDER = ["優勝", "準優勝", "ベスト4", "ベスト8"];
const CONSOLATION_PLACEMENT_GROUP_ORDER = [
  "下位トーナメント優勝",
  "下位トーナメント準優勝",
  "下位トーナメントベスト4",
  "下位トーナメントベスト8",
];

/**
 * @param {string} baseLabel
 * @param {{ bracketKind?: string }} [options]
 */
export function formatBracketPlacementLabel(baseLabel, { bracketKind = BracketKind.MAIN } = {}) {
  if (bracketKind === BracketKind.CONSOLATION) {
    return `下位トーナメント${baseLabel}`;
  }
  return baseLabel;
}

/**
 * @param {string|null|undefined} bracketKind
 */
export function getPlacementGroupOrder(bracketKind = BracketKind.MAIN) {
  return bracketKind === BracketKind.CONSOLATION
    ? CONSOLATION_PLACEMENT_GROUP_ORDER
    : MAIN_PLACEMENT_GROUP_ORDER;
}

/**
 * @param {Array<object>} placements
 * @param {{ bracketKind?: string }} [options]
 */
export function groupPlacementsByLabel(placements, { bracketKind = BracketKind.MAIN } = {}) {
  const order = getPlacementGroupOrder(bracketKind);
  const byLabel = new Map();

  for (const placement of placements ?? []) {
    const label = placement.placementLabel ?? placement.label ?? "—";
    if (!byLabel.has(label)) {
      byLabel.set(label, []);
    }
    const items = byLabel.get(label);
    if (placement.entryId && items.some((item) => item.entryId === placement.entryId)) {
      continue;
    }
    items.push(placement);
  }

  const known = order
    .filter((label) => byLabel.has(label))
    .map((label) => ({
      label,
      items: byLabel.get(label),
    }));

  // ベスト16 など order 外ラベルもラウンドが存在する分だけ末尾に追加
  for (const [label, items] of byLabel.entries()) {
    if (order.includes(label)) {
      continue;
    }
    known.push({ label, items });
  }

  return known;
}

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

  if (result.matchFormat === MatchFormat.MULTI_TEAM_TOTAL) {
    return (
      Array.isArray(result.rankingEntryIds) &&
      result.rankingEntryIds.length >= 2 &&
      Array.isArray(result.qualifierEntryIds) &&
      result.qualifierEntryIds.length >= 1 &&
      (result.resolution === FinalsMatchResolution.PLAYED ||
        result.resolution === "auto_advance")
    );
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
    const partial = buildBracketPlacements({
      bracket: consolationBracket,
      resultsMap: consolationResultsMap,
      bracketKind: BracketKind.CONSOLATION,
      mode: BracketPlacementMode.PARTIAL,
      requireRunnerUp: false,
    });
    return {
      complete: false,
      required: true,
      message: bracketCheck.message,
      status: "in_progress",
      placements: partial.placements,
      champion: partial.champion,
      runnerUp: partial.runnerUp,
    };
  }

  const placementsResult = buildBracketPlacements({
    bracket: consolationBracket,
    resultsMap: consolationResultsMap,
    bracketKind: BracketKind.CONSOLATION,
    mode: BracketPlacementMode.STRICT,
    requireRunnerUp: false,
  });

  if (!placementsResult.valid) {
    return {
      complete: false,
      required: true,
      message: placementsResult.message ?? "下位トーナメントの到達順位を算出できません。",
    };
  }

  return {
    complete: true,
    required: true,
    status: "complete",
    champion: placementsResult.champion,
    runnerUp: placementsResult.runnerUp,
    placements: placementsResult.placements,
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
      hasConsolation: true,
      consolationStatus: "in_progress",
      consolationChampion: consolationCheck.champion ?? null,
      consolationRunnerUp: consolationCheck.runnerUp ?? null,
      consolationPlacements: consolationCheck.placements ?? [],
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
    hasConsolation: consolationCheck.required === true,
    consolationRequired: consolationCheck.required === true,
    consolationComplete: consolationCheck.required ? consolationCheck.complete : null,
    consolationStatus: consolationCheck.required
      ? consolationCheck.status ?? "complete"
      : null,
    consolationChampion: consolationCheck.champion ?? null,
    consolationRunnerUp: consolationCheck.runnerUp ?? null,
    consolationPlacements: consolationCheck.placements ?? [],
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
    hasConsolation: decision.hasConsolation === true,
    consolationStatus: decision.consolationStatus ?? null,
    consolationChampion: decision.consolationChampion ?? null,
    consolationRunnerUp: decision.consolationRunnerUp ?? null,
    consolationPlacements: decision.consolationPlacements ?? [],
  };
}

function isRealTeam(team) {
  return Boolean(team?.entryId) && team.isBye !== true;
}

/**
 * 上位 / 下位ブラケット共通の到達順位生成
 * @param {object} params
 * @param {'strict'|'partial'} [params.mode]
 * @param {string} [params.bracketKind]
 * @param {boolean} [params.requireRunnerUp]
 */
export function buildBracketPlacements({
  bracket,
  resultsMap,
  participants = null,
  bracketKind = BracketKind.MAIN,
  mode = BracketPlacementMode.STRICT,
  requireRunnerUp = bracketKind === BracketKind.MAIN,
}) {
  if (isMultiTeamBracket(bracket) || bracket?.matchFormat === MatchFormat.MULTI_TEAM_TOTAL) {
    const { placements: multiPlacements, champion, runnerUp } = buildMultiTeamPlacements({
      bracket,
      resultsMapByMatchId: resultsMap,
    });
    const complete = Boolean(champion?.entryId && (!requireRunnerUp || runnerUp?.entryId));
    if (mode === BracketPlacementMode.STRICT && !complete) {
      return {
        valid: false,
        complete: false,
        status: "in_progress",
        message: "優勝・準優勝を判定できません。",
        placements: [],
        champion: champion ?? null,
        runnerUp: runnerUp ?? null,
        placementGroups: [],
      };
    }
    const placements = multiPlacements.map((row) => ({
      entryId: row.entryId,
      teamName: row.teamName,
      placementLabel: row.placementLabel,
      placementType:
        row.rank === 1
          ? PlacementType.CHAMPION
          : row.rank === 2
            ? PlacementType.RUNNER_UP
            : PlacementType.ELIMINATED,
      rank: row.rank,
      seed: null,
      blockId: null,
      blockName: null,
      blockRank: null,
    }));
    return {
      valid: true,
      complete,
      status: complete ? "complete" : "in_progress",
      message: null,
      placements,
      champion,
      runnerUp,
      placementGroups: groupPlacementsByLabel(placements, { bracketKind }),
    };
  }

  const activeParticipants = (participants ?? getFinalsBracketParticipants(bracket)).filter(
    (participant) => isRealTeam(participant)
  );

  if (!bracket?.finalized || activeParticipants.length === 0) {
    return {
      valid: false,
      complete: false,
      status: "unavailable",
      message: "入力データが不足しています。",
      placements: [],
      champion: null,
      runnerUp: null,
      placementGroups: [],
    };
  }

  const slotByEntryId = new Map(
    (bracket.slots ?? [])
      .filter((slot) => isRealTeam(slot))
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

  const {
    champion: rawChampion,
    runnerUp: rawRunnerUp,
    complete: finalsComplete,
  } = getFinalsChampionAndRunnerUp(bracket, resultsMap);

  const champion = isRealTeam(rawChampion) ? rawChampion : null;
  const runnerUp = isRealTeam(rawRunnerUp) ? rawRunnerUp : null;

  if (mode === BracketPlacementMode.STRICT) {
    if (!finalsComplete || !champion?.entryId) {
      return {
        valid: false,
        complete: false,
        status: "in_progress",
        message: "優勝を判定できません。",
        placements: [],
        champion: null,
        runnerUp: null,
        placementGroups: [],
      };
    }
    if (requireRunnerUp && !runnerUp?.entryId) {
      return {
        valid: false,
        complete: false,
        status: "in_progress",
        message: "優勝・準優勝を判定できません。",
        placements: [],
        champion,
        runnerUp: null,
        placementGroups: [],
      };
    }
  }

  const eliminationByEntryId = new Map();

  for (const match of bracket.matches ?? []) {
    const result = resultsMap.get(match.matchId);
    const loser = result?.loser;
    if (!isRealTeam(loser)) {
      continue;
    }

    if (eliminationByEntryId.has(loser.entryId)) {
      if (mode === BracketPlacementMode.STRICT) {
        return {
          valid: false,
          complete: false,
          status: "invalid",
          message: "同じチームが複数回敗退として記録されています。",
          placements: [],
          champion,
          runnerUp,
          placementGroups: [],
        };
      }
      continue;
    }

    eliminationByEntryId.set(loser.entryId, {
      eliminatedRoundNumber: match.roundNumber,
      eliminatedByEntryId: isRealTeam(result.winner) ? result.winner.entryId : null,
      eliminatedByTeamName: isRealTeam(result.winner) ? result.winner.teamName : null,
    });
  }

  const placements = [];
  const seenEntryIds = new Set();

  for (const qualifier of activeParticipants) {
    const participant = normalizeParticipant(qualifier);

    if (!participant.entryId) {
      if (mode === BracketPlacementMode.STRICT) {
        return {
          valid: false,
          complete: false,
          status: "invalid",
          message: "進出チームに entryId がありません。",
          placements: [],
          champion,
          runnerUp,
          placementGroups: [],
        };
      }
      continue;
    }

    if (!participant.teamName) {
      if (mode === BracketPlacementMode.STRICT) {
        return {
          valid: false,
          complete: false,
          status: "invalid",
          message: `進出チーム ${participant.entryId} の teamName を特定できません。`,
          placements: [],
          champion,
          runnerUp,
          placementGroups: [],
        };
      }
      continue;
    }

    if (seenEntryIds.has(participant.entryId)) {
      if (mode === BracketPlacementMode.STRICT) {
        return {
          valid: false,
          complete: false,
          status: "invalid",
          message: "進出チームに重複があります。",
          placements: [],
          champion,
          runnerUp,
          placementGroups: [],
        };
      }
      continue;
    }
    seenEntryIds.add(participant.entryId);

    if (champion && participant.entryId === champion.entryId) {
      placements.push({
        entryId: participant.entryId,
        teamName: participant.teamName,
        blockId: participant.blockId,
        blockName: participant.blockName,
        blockRank: participant.blockRank,
        seed: participant.seed,
        placementType: PlacementType.CHAMPION,
        placementLabel: formatBracketPlacementLabel("優勝", { bracketKind }),
        reachedRoundNumber: bracket.roundCount,
        eliminatedRoundNumber: null,
        eliminatedByEntryId: null,
        eliminatedByTeamName: null,
        bracketKind,
      });
      continue;
    }

    if (runnerUp && participant.entryId === runnerUp.entryId) {
      placements.push({
        entryId: participant.entryId,
        teamName: participant.teamName,
        blockId: participant.blockId,
        blockName: participant.blockName,
        blockRank: participant.blockRank,
        seed: participant.seed,
        placementType: PlacementType.RUNNER_UP,
        placementLabel: formatBracketPlacementLabel("準優勝", { bracketKind }),
        reachedRoundNumber: bracket.roundCount,
        eliminatedRoundNumber: bracket.roundCount,
        eliminatedByEntryId: champion?.entryId ?? null,
        eliminatedByTeamName: champion?.teamName ?? null,
        bracketKind,
      });
      continue;
    }

    const elimination = eliminationByEntryId.get(participant.entryId);
    if (!elimination) {
      if (mode === BracketPlacementMode.STRICT) {
        return {
          valid: false,
          complete: false,
          status: "in_progress",
          message: `進出チーム ${participant.teamName} の敗退ラウンドを特定できません。`,
          placements: [],
          champion,
          runnerUp,
          placementGroups: [],
        };
      }
      // partial: 未確定チームはスキップ（勝手に確定しない）
      continue;
    }

    const { placementType, placementLabel: baseLabel } = getEliminationPlacementLabel(
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
      placementLabel: formatBracketPlacementLabel(baseLabel, { bracketKind }),
      reachedRoundNumber: elimination.eliminatedRoundNumber,
      eliminatedRoundNumber: elimination.eliminatedRoundNumber,
      eliminatedByEntryId: elimination.eliminatedByEntryId,
      eliminatedByTeamName: elimination.eliminatedByTeamName,
      bracketKind,
    });
  }

  if (mode === BracketPlacementMode.STRICT) {
    const placedIds = new Set(placements.map((placement) => placement.entryId));
    const unresolved = activeParticipants.filter(
      (participant) => !placedIds.has(participant.entryId)
    );
    if (unresolved.length > 0 || placements.length !== activeParticipants.length) {
      return {
        valid: false,
        complete: false,
        status: "in_progress",
        message: "全進出チームを到達順位に反映できません。",
        placements: [],
        champion,
        runnerUp,
        placementGroups: [],
      };
    }
  }

  placements.sort((a, b) => (a.seed ?? 0) - (b.seed ?? 0));

  const allResolved = activeParticipants.every((participant) =>
    placements.some((placement) => placement.entryId === participant.entryId)
  );
  const complete =
    Boolean(champion?.entryId) &&
    (Boolean(runnerUp?.entryId) || !requireRunnerUp) &&
    allResolved;

  return {
    valid: mode === BracketPlacementMode.STRICT ? complete : true,
    complete,
    status: complete ? "complete" : "in_progress",
    message: null,
    placements,
    champion,
    runnerUp,
    placementGroups: groupPlacementsByLabel(placements, { bracketKind }),
  };
}

/**
 * @param {object} params
 */
export function buildTournamentPlacements({ bracket, resultsMap, qualifiers }) {
  return buildBracketPlacements({
    bracket,
    resultsMap,
    participants: qualifiers,
    bracketKind: BracketKind.MAIN,
    mode: BracketPlacementMode.STRICT,
    requireRunnerUp: true,
  });
}

/**
 * @param {object} params
 */
export function buildConsolationPlacements({
  bracket,
  resultsMap,
  mode = BracketPlacementMode.PARTIAL,
} = {}) {
  if (!hasCreatedConsolationBracket(bracket)) {
    return {
      valid: true,
      complete: true,
      status: "absent",
      message: null,
      placements: [],
      champion: null,
      runnerUp: null,
      placementGroups: [],
    };
  }

  return buildBracketPlacements({
    bracket,
    resultsMap,
    participants: getFinalsBracketParticipants(bracket),
    bracketKind: BracketKind.CONSOLATION,
    mode,
    requireRunnerUp: false,
  });
}

/**
 * @param {object} preview
 * @param {object} tournament
 * @param {object} advancement
 * @param {object} bracket
 */
export function buildPersistedTournamentResults(preview, tournament, advancement, bracket) {
  const payload = {
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

  if (preview.hasConsolation || (preview.consolationPlacements ?? []).length > 0) {
    payload.hasConsolation = true;
    payload.consolationChampion = preview.consolationChampion ?? null;
    payload.consolationRunnerUp = preview.consolationRunnerUp ?? null;
    payload.consolationPlacements = preview.consolationPlacements ?? [];
    payload.consolationStatus = preview.consolationStatus ?? "complete";
  }

  return payload;
}
