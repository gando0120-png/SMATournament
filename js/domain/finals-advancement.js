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
  applyMolkkyOutResolutions,
  buildQualifyingStandings,
  hasUnresolvedBlockMolkkyOuts,
  listUnresolvedBlockMolkkyOutGroups,
  normalizeEntryIds,
} from "./qualifying-standings.js";
import { findWildcardMolkkyOutResolution } from "./molkky-out-resolution.js";
import { usesLegacyFinalsAdvancement, resolveFinalQualifierCount, usesRankBandWildcards } from "./tournament-format.js";
import {
  selectFixedBlockQualifiers,
  validateFixedBlockAdvancementPrerequisites,
  groupFixedBlockQualifiersByBlock,
} from "./fixed-block-finals-advancement.js";
import {
  areWildcardCandidatesTied,
  buildWildcardCandidatePreview,
  compareWildcardCandidates,
  enrichWildcardCandidateMetrics,
  resolveWildcardComparisonMode,
} from "./wildcard-comparison.js";

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
  return enrichWildcardCandidateMetrics(entry).setWinRate;
}

/**
 * @param {object} entry
 * @param {object} block
 */
function toQualifierCandidate(entry, block) {
  return enrichWildcardCandidateMetrics({
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
  });
}

/**
 * 同一順位帯の WC 候補一覧（運営プレビュー用）
 * @param {object} qualifyingStandings
 * @param {{
 *   autoPassRanks?: number,
 *   wildcardSlots?: number,
 *   comparisonMode?: string|null,
 *   rankBand?: number,
 * }} [options]
 */
export function listWildcardBandCandidates(qualifyingStandings, options = {}) {
  const autoPassRanks =
    Number.isInteger(options.autoPassRanks) && options.autoPassRanks >= 1
      ? options.autoPassRanks
      : 1;
  const rankBand =
    Number.isInteger(options.rankBand) && options.rankBand > autoPassRanks
      ? options.rankBand
      : autoPassRanks + 1;
  const comparisonMode = resolveWildcardComparisonMode(options.comparisonMode);
  const wildcardSlots = Number.isInteger(options.wildcardSlots)
    ? Math.max(0, options.wildcardSlots)
    : 0;

  const candidates = [];
  for (const block of qualifyingStandings?.blocks || []) {
    for (const entry of block.standings || []) {
      if (entry.rank !== rankBand) {
        continue;
      }
      candidates.push(toQualifierCandidate(entry, block));
    }
  }

  return {
    rankBand,
    ...buildWildcardCandidatePreview(candidates, {
      wildcardSlots,
      comparisonMode,
    }),
  };
}

/**
 * @param {object} qualifyingStandings - applyMolkkyOutResolutions 済みを想定
 * @param {number} finalTeamCount
 * @param {{
 *   wildcardGroups?: object[],
 *   autoPassRanks?: number,
 *   comparisonMode?: string|null,
 * }} [options]
 */
export function selectFinalists(qualifyingStandings, finalTeamCount, options = {}) {
  if (!qualifyingStandings?.blocks?.length) {
    return { valid: false, message: "予選順位表を取得できません。" };
  }

  if (!Number.isInteger(finalTeamCount) || finalTeamCount < 2) {
    return { valid: false, message: "決勝進出人数が不正です。" };
  }

  const autoPassRanks =
    Number.isInteger(options.autoPassRanks) && options.autoPassRanks >= 1
      ? options.autoPassRanks
      : 1;
  const comparisonMode = resolveWildcardComparisonMode(options.comparisonMode);

  const unresolvedBlocks = listUnresolvedBlockMolkkyOutGroups(qualifyingStandings);
  if (unresolvedBlocks.length > 0) {
    return {
      valid: false,
      needsMolkkyOut: {
        scope: "block",
        groups: unresolvedBlocks,
      },
      message:
        "ブロック内にモルックアウト対象の同順位があります。予選順位表で順位を確定してください。",
    };
  }

  const qualifiers = [];
  const selectedIds = new Set();
  const wildcardGroups = options.wildcardGroups ?? [];

  for (const block of qualifyingStandings.blocks) {
    const autoPassEntries = (block.standings || []).filter(
      (entry) => Number.isInteger(entry.rank) && entry.rank >= 1 && entry.rank <= autoPassRanks
    );
    for (const entry of autoPassEntries) {
      if (selectedIds.has(entry.entryId)) {
        continue;
      }
      selectedIds.add(entry.entryId);
      qualifiers.push({
        ...toQualifierCandidate(entry, block),
        source:
          entry.rank === 1
            ? FinalsQualifierSource.BLOCK_WINNER
            : FinalsQualifierSource.FIXED_BLOCK,
      });
    }
  }

  if (qualifiers.length > finalTeamCount) {
    return {
      valid: false,
      message: `自動通過が ${qualifiers.length} チームあり、決勝枠 ${finalTeamCount} を超えています。同順位の解消または決勝枠数の見直しが必要です。`,
    };
  }

  const wildcards = [];
  let remaining = finalTeamCount - qualifiers.length;
  /** @type {ReturnType<typeof listWildcardBandCandidates>|null} */
  let primaryWildcardBandPreview = null;

  const maxRank = Math.max(
    autoPassRanks,
    ...qualifyingStandings.blocks.flatMap((block) =>
      (block.standings || []).map((entry) => entry.rank ?? 0)
    )
  );

  for (let rankBand = autoPassRanks + 1; rankBand <= maxRank && remaining > 0; rankBand += 1) {
    const candidates = [];
    for (const block of qualifyingStandings.blocks) {
      for (const entry of block.standings || []) {
        if (selectedIds.has(entry.entryId) || entry.rank !== rankBand) {
          continue;
        }
        candidates.push(toQualifierCandidate(entry, block));
      }
    }

    if (candidates.length === 0) {
      continue;
    }

    candidates.sort((a, b) => compareWildcardCandidates(a, b, comparisonMode));

    if (primaryWildcardBandPreview == null) {
      primaryWildcardBandPreview = {
        rankBand,
        ...buildWildcardCandidatePreview(candidates, {
          wildcardSlots: remaining,
          comparisonMode,
        }),
      };
    }

    if (candidates.length <= remaining) {
      for (const candidate of candidates) {
        selectedIds.add(candidate.entryId);
        wildcards.push({
          ...candidate,
          source: FinalsQualifierSource.WILDCARD,
        });
        remaining -= 1;
      }
      continue;
    }

    const slotsNeeded = remaining;
    let groupStart = slotsNeeded - 1;
    while (
      groupStart > 0 &&
      areWildcardCandidatesTied(
        candidates[groupStart - 1],
        candidates[slotsNeeded - 1],
        comparisonMode
      )
    ) {
      groupStart -= 1;
    }
    let groupEnd = slotsNeeded - 1;
    while (
      groupEnd + 1 < candidates.length &&
      areWildcardCandidatesTied(
        candidates[groupEnd + 1],
        candidates[slotsNeeded - 1],
        comparisonMode
      )
    ) {
      groupEnd += 1;
    }

    for (let index = 0; index < groupStart; index += 1) {
      const candidate = candidates[index];
      selectedIds.add(candidate.entryId);
      wildcards.push({
        ...candidate,
        source: FinalsQualifierSource.WILDCARD,
      });
      remaining -= 1;
    }

    const tiedGroup = candidates.slice(groupStart, groupEnd + 1);
    const stillNeeded = remaining;

    if (tiedGroup.length === stillNeeded) {
      for (const candidate of tiedGroup) {
        selectedIds.add(candidate.entryId);
        wildcards.push({
          ...candidate,
          source: FinalsQualifierSource.WILDCARD,
        });
        remaining -= 1;
      }
      continue;
    }

    const entryIds = normalizeEntryIds(tiedGroup.map((entry) => entry.entryId));
    const resolution = findWildcardMolkkyOutResolution(
      wildcardGroups,
      rankBand,
      entryIds
    );

    if (!resolution) {
      return {
        valid: false,
        needsMolkkyOut: {
          scope: "wildcard",
          rankBand,
          candidates: tiedGroup,
          slotsNeeded: stillNeeded,
          entryIds,
        },
        message: `各ブロック${rankBand}位の比較でモルックアウト対象の同順位があります。順位を確定してから進出を確定してください。`,
        partialQualifiers: [...qualifiers, ...wildcards],
        comparisonMode,
        wildcardBandPreview: primaryWildcardBandPreview,
      };
    }

    const byId = new Map(tiedGroup.map((entry) => [entry.entryId, entry]));
    for (let index = 0; index < stillNeeded; index += 1) {
      const candidate = byId.get(String(resolution.orderedEntryIds[index]));
      if (!candidate) {
        return {
          valid: false,
          message: "ワイルドカードのモルックアウト解消データが不正です。",
        };
      }
      selectedIds.add(candidate.entryId);
      wildcards.push({
        ...candidate,
        source: FinalsQualifierSource.WILDCARD,
      });
      remaining -= 1;
    }
  }

  if (remaining > 0) {
    return {
      valid: false,
      message: `進出枠を埋められません（不足 ${remaining} チーム）。`,
      comparisonMode,
      wildcardBandPreview: primaryWildcardBandPreview,
    };
  }

  const allQualifiers = [...qualifiers, ...wildcards].map((entry, index) => ({
    ...entry,
    seed: index + 1,
  }));

  return {
    valid: true,
    finalTeamCount,
    blockWinnerCount: qualifiers.length,
    wildcardCount: wildcards.length,
    comparisonMode,
    wildcardBandPreview: primaryWildcardBandPreview,
    qualifiers: allQualifiers,
  };
}

/**
 * @param {object|null|undefined} persistedSchedule
 * @param {Map<string, object>} resultsMap
 * @param {{ tournament?: object|null, blockDraw?: object|null, finalTeamCount?: number, molkkyOutResolutions?: object|null }} [options]
 */
export function buildFinalsAdvancementPreview(persistedSchedule, resultsMap, options = {}) {
  const { tournament = null, blockDraw = null, molkkyOutResolutions = null } = options;
  const completion = getQualifyingCompletionStatus(persistedSchedule, resultsMap);
  const baseStandings = buildQualifyingStandings(persistedSchedule, resultsMap);
  const qualifyingStandings = applyMolkkyOutResolutions(baseStandings, molkkyOutResolutions);

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

  if (hasUnresolvedBlockMolkkyOuts(qualifyingStandings)) {
    const groups = listUnresolvedBlockMolkkyOutGroups(qualifyingStandings);
    return {
      canFinalize: false,
      completion,
      qualifyingStandings,
      selection: {
        valid: false,
        needsMolkkyOut: { scope: "block", groups },
      },
      mode: usesLegacyFinalsAdvancement(tournament)
        ? FinalsAdvancementMode.LEGACY
        : FinalsAdvancementMode.FIXED_BLOCK_QUALIFIERS,
      message:
        "ブロック内にモルックアウト対象の同順位があります。予選順位表で順位を確定してください。",
    };
  }

  if (usesLegacyFinalsAdvancement(tournament)) {
    const finalTeamCount =
      options.finalTeamCount ??
      resolveFinalQualifierCount({ tournament }) ??
      DEFAULT_FINAL_TEAM_COUNT;
    const selection = selectFinalists(qualifyingStandings, finalTeamCount, {
      wildcardGroups: molkkyOutResolutions?.wildcardGroups ?? [],
      autoPassRanks: 1,
      comparisonMode: tournament?.wildcardComparisonMode,
    });
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

  // 決勝枠 > 自動通過 → 順位帯ワイルドカード選出
  if (usesRankBandWildcards(tournament)) {
    const selection = selectFinalists(qualifyingStandings, qualifierCount, {
      wildcardGroups: molkkyOutResolutions?.wildcardGroups ?? [],
      autoPassRanks: qualifiersPerBlock,
      comparisonMode: tournament?.wildcardComparisonMode,
    });
    if (!selection.valid) {
      return {
        canFinalize: false,
        completion,
        qualifyingStandings,
        selection,
        mode: FinalsAdvancementMode.RANK_BAND_WILDCARDS,
        message: selection.message,
      };
    }

    return {
      canFinalize: true,
      completion,
      qualifyingStandings,
      selection: {
        ...selection,
        qualifierCount: selection.finalTeamCount,
        blockCount,
        qualifiersPerBlock,
      },
      mode: FinalsAdvancementMode.RANK_BAND_WILDCARDS,
      message: null,
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

  if (mode === FinalsAdvancementMode.RANK_BAND_WILDCARDS) {
    return {
      finalized: true,
      mode: FinalsAdvancementMode.RANK_BAND_WILDCARDS,
      blockCount: tournament?.blockCount ?? selection.blockCount,
      qualifiersPerBlock: tournament?.qualifiersPerBlock ?? selection.qualifiersPerBlock,
      qualifierCount: selection.finalTeamCount ?? selection.qualifierCount,
      finalTeamCount: selection.finalTeamCount ?? selection.qualifierCount,
      blockWinnerCount: selection.blockWinnerCount,
      wildcardCount: selection.wildcardCount,
      wildcardComparisonMode: resolveWildcardComparisonMode(
        selection.comparisonMode ?? tournament?.wildcardComparisonMode
      ),
      qualifiers: selection.qualifiers.map((qualifier) => ({
        entryId: qualifier.entryId,
        teamName: qualifier.teamName,
        symbol: qualifier.symbol ?? "",
        blockId: qualifier.blockId,
        blockName: qualifier.blockName ?? qualifier.blockId,
        blockRank: qualifier.blockRank,
        source: qualifier.source,
        seed: qualifier.seed,
        setWins: qualifier.setWins,
        setDraws: qualifier.setDraws,
        setLosses: qualifier.setLosses,
        totalScore: qualifier.totalScore,
        playedMatches: qualifier.playedMatches,
        setWinRate: qualifier.setWinRate,
        averageScore: qualifier.averageScore,
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
