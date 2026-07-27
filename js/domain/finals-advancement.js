/**
 * 決勝進出チーム選出（DOM 非依存）
 */
import {
  MatchResultStatus,
  FinalsQualifierSource,
  FinalsAdvancementMode,
  DEFAULT_FINAL_TEAM_COUNT,
} from "./constants.js";
import {
  buildQualifyingStandings,
  compareStandingsEntries,
} from "./qualifying-standings.js";
import { usesLegacyFinalsAdvancement, resolveFinalQualifierCount } from "./tournament-format.js";
import {
  selectFixedBlockQualifiers,
  validateFixedBlockAdvancementPrerequisites,
  groupFixedBlockQualifiersByBlock,
} from "./fixed-block-finals-advancement.js";

export { FinalsQualifierSource, FinalsAdvancementMode };

/**
 * @param {object|null|undefined} persistedSchedule
 * @param {Map<string, object>} resultsMap
 */
export function getQualifyingCompletionStatus(persistedSchedule, resultsMap) {
  const incompleteMatches = [];
  let totalMatches = 0;
  let finishedMatches = 0;

  if (!persistedSchedule?.finalized) {
    return {
      complete: false,
      totalMatches: 0,
      finishedMatches: 0,
      remainingMatches: 0,
      incompleteMatches,
    };
  }

  for (const block of persistedSchedule.blocks || []) {
    for (const round of block.rounds || []) {
      for (const match of round.matches || []) {
        totalMatches += 1;
        const result = resultsMap.get(match.matchId);
        const isFinished =
          result?.status === MatchResultStatus.FINISHED &&
          result.team1?.entryId === match.team1?.entryId &&
          result.team2?.entryId === match.team2?.entryId;

        if (isFinished) {
          finishedMatches += 1;
        } else {
          incompleteMatches.push({
            matchId: match.matchId,
            blockId: block.blockId,
            blockName: block.blockName,
            roundNumber: round.roundNumber,
            courtNumber: match.courtNumber,
            team1Name: match.team1?.teamName ?? "—",
            team2Name: match.team2?.teamName ?? "—",
          });
        }
      }
    }
  }

  return {
    complete: totalMatches > 0 && finishedMatches === totalMatches,
    totalMatches,
    finishedMatches,
    remainingMatches: totalMatches - finishedMatches,
    incompleteMatches,
  };
}

/**
 * @param {object} entry
 */
export function computeSetWinRate(entry) {
  const totalSets = (entry.setWins ?? 0) + (entry.setDraws ?? 0) + (entry.setLosses ?? 0);
  if (totalSets === 0) {
    return 0;
  }
  return entry.setWins / totalSets;
}

/**
 * @param {object} qualifyingStandings - buildQualifyingStandings の戻り値
 * @param {number} finalTeamCount
 */
export function selectFinalists(qualifyingStandings, finalTeamCount) {
  if (!qualifyingStandings?.blocks?.length) {
    return { valid: false, message: "予選順位表を取得できません。" };
  }

  if (!Number.isInteger(finalTeamCount) || finalTeamCount < 2) {
    return { valid: false, message: "決勝進出人数が不正です。" };
  }

  const qualifiers = [];
  const selectedIds = new Set();

  for (const block of qualifyingStandings.blocks) {
    const blockWinners = block.standings.filter((entry) => entry.rank === 1);
    for (const entry of blockWinners) {
      if (selectedIds.has(entry.entryId)) {
        continue;
      }
      selectedIds.add(entry.entryId);
      qualifiers.push({
        entryId: entry.entryId,
        teamName: entry.teamName,
        symbol: entry.symbol ?? "",
        blockId: block.blockId,
        blockName: block.blockName,
        blockRank: entry.rank,
        source: FinalsQualifierSource.BLOCK_WINNER,
        setWins: entry.setWins,
        setDraws: entry.setDraws,
        setLosses: entry.setLosses,
        totalScore: entry.totalScore,
        playedMatches: entry.playedMatches,
        setWinRate: computeSetWinRate(entry),
      });
    }
  }

  if (qualifiers.length > finalTeamCount) {
    return {
      valid: false,
      message: `ブロック1位が ${qualifiers.length} チームあり、決勝枠 ${finalTeamCount} を超えています。同順位の解消または決勝枠数の見直しが必要です。`,
    };
  }

  const wildcardSlots = finalTeamCount - qualifiers.length;
  const pool = [];

  for (const block of qualifyingStandings.blocks) {
    for (const entry of block.standings) {
      if (selectedIds.has(entry.entryId)) {
        continue;
      }
      pool.push({
        entryId: entry.entryId,
        teamName: entry.teamName,
        symbol: entry.symbol ?? "",
        blockId: block.blockId,
        blockName: block.blockName,
        blockRank: entry.rank,
        setWins: entry.setWins,
        setDraws: entry.setDraws,
        setLosses: entry.setLosses,
        totalScore: entry.totalScore,
        playedMatches: entry.playedMatches,
        setWinRate: computeSetWinRate(entry),
      });
    }
  }

  pool.sort(compareStandingsEntries);

  const wildcards = pool.slice(0, wildcardSlots).map((entry) => ({
    ...entry,
    source: FinalsQualifierSource.WILDCARD,
  }));

  const allQualifiers = [...qualifiers, ...wildcards].map((entry, index) => ({
    ...entry,
    seed: index + 1,
  }));

  return {
    valid: true,
    finalTeamCount,
    blockWinnerCount: qualifiers.length,
    wildcardCount: wildcards.length,
    qualifiers: allQualifiers,
  };
}

/**
 * @param {object|null|undefined} persistedSchedule
 * @param {Map<string, object>} resultsMap
 * @param {{ tournament?: object|null, blockDraw?: object|null, finalTeamCount?: number }} [options]
 */
export function buildFinalsAdvancementPreview(persistedSchedule, resultsMap, options = {}) {
  const { tournament = null, blockDraw = null } = options;
  const completion = getQualifyingCompletionStatus(persistedSchedule, resultsMap);
  const qualifyingStandings = buildQualifyingStandings(persistedSchedule, resultsMap);

  if (!persistedSchedule?.finalized) {
    return {
      canFinalize: false,
      completion,
      qualifyingStandings,
      selection: null,
      mode: usesLegacyFinalsAdvancement(tournament)
        ? FinalsAdvancementMode.LEGACY
        : FinalsAdvancementMode.FIXED_BLOCK_QUALIFIERS,
      message: "予選対戦表が確定していません。",
    };
  }

  if (!completion.complete) {
    return {
      canFinalize: false,
      completion,
      qualifyingStandings,
      selection: null,
      mode: usesLegacyFinalsAdvancement(tournament)
        ? FinalsAdvancementMode.LEGACY
        : FinalsAdvancementMode.FIXED_BLOCK_QUALIFIERS,
      message: `予選試合が未入力です（残り ${completion.remainingMatches} 試合）。すべての結果を入力してから決勝進出を確定してください。`,
    };
  }

  if (usesLegacyFinalsAdvancement(tournament)) {
    const finalTeamCount = options.finalTeamCount ?? DEFAULT_FINAL_TEAM_COUNT;
    const selection = selectFinalists(qualifyingStandings, finalTeamCount);
    if (!selection.valid) {
      return {
        canFinalize: false,
        completion,
        qualifyingStandings,
        selection,
        mode: FinalsAdvancementMode.LEGACY,
        message: selection.message,
      };
    }

    return {
      canFinalize: true,
      completion,
      qualifyingStandings,
      selection,
      mode: FinalsAdvancementMode.LEGACY,
      message: null,
    };
  }

  const blockCount = tournament?.blockCount;
  const qualifiersPerBlock = tournament?.qualifiersPerBlock;
  const qualifierCount = resolveFinalQualifierCount({ tournament, blockDraw });

  const prerequisites = validateFixedBlockAdvancementPrerequisites({ blockDraw, blockCount });
  if (!prerequisites.valid) {
    return {
      canFinalize: false,
      completion,
      qualifyingStandings,
      selection: null,
      mode: FinalsAdvancementMode.FIXED_BLOCK_QUALIFIERS,
      message: prerequisites.message,
    };
  }

  const selection = selectFixedBlockQualifiers({
    qualifyingStandings,
    blockCount,
    qualifiersPerBlock,
  });

  if (!selection.valid) {
    return {
      canFinalize: false,
      completion,
      qualifyingStandings,
      selection,
      mode: FinalsAdvancementMode.FIXED_BLOCK_QUALIFIERS,
      message: selection.errors[0] ?? "決勝進出者を選出できません。",
    };
  }

  return {
    canFinalize: true,
    completion,
    qualifyingStandings,
    selection: {
      valid: true,
      qualifierCount: selection.qualifierCount,
      qualifiers: selection.qualifiers,
      blockGroups: groupFixedBlockQualifiersByBlock(selection.qualifiers),
      qualifiersPerBlock,
      blockCount,
    },
    mode: FinalsAdvancementMode.FIXED_BLOCK_QUALIFIERS,
    message: null,
  };
}

/**
 * @param {object} preview - buildFinalsAdvancementPreview の戻り値（canFinalize === true）
 * @param {{ tournament?: object|null }} [options]
 */
export function buildPersistedFinalsAdvancement(preview, options = {}) {
  const { completion, selection, mode } = preview;
  const { tournament = null } = options;

  if (mode === FinalsAdvancementMode.FIXED_BLOCK_QUALIFIERS) {
    return {
      finalized: true,
      mode: FinalsAdvancementMode.FIXED_BLOCK_QUALIFIERS,
      blockCount: tournament?.blockCount ?? selection.blockCount,
      qualifiersPerBlock: tournament?.qualifiersPerBlock ?? selection.qualifiersPerBlock,
      qualifierCount: selection.qualifierCount,
      finalTeamCount: selection.qualifierCount,
      qualifiers: selection.qualifiers.map((qualifier) => ({
        entryId: qualifier.entryId,
        teamName: qualifier.teamName,
        blockId: qualifier.blockId,
        blockName: qualifier.blockName ?? qualifier.blockId,
        blockRank: qualifier.blockRank,
      })),
      qualifyingMatchCount: completion.totalMatches,
      qualifyingFinishedMatchCount: completion.finishedMatches,
    };
  }

  return {
    finalized: true,
    mode: FinalsAdvancementMode.LEGACY,
    finalTeamCount: selection.finalTeamCount,
    blockCount: preview.qualifyingStandings.blocks.length,
    blockWinnerCount: selection.blockWinnerCount,
    wildcardCount: selection.wildcardCount,
    qualifiers: selection.qualifiers,
    qualifyingMatchCount: completion.totalMatches,
    qualifyingFinishedMatchCount: completion.finishedMatches,
  };
}
