/**
 * EmergencyExportV1 → 緊急 Excel 決勝運営（Sprint 2 / 2.1）
 *
 * SMATournament 本体の finals-advancement / finals-bracket / finals-match-* を再利用する。
 * Excel 独自の進出・配置・勝敗ルールは作らない。
 * 未実施のランダム抽選は再現しない（Sprint 2.1 緊急手動配置）。
 */
import {
  buildFinalsBracket,
  buildSeedOrder,
  getFinalsRoundLabel,
} from "./finals-bracket.js";
import {
  FinalsAdvancementMode,
  buildFinalsAdvancementPreview,
  selectFinalists,
} from "./finals-advancement.js";
import { resolveMatchWinsRequired } from "./finals-match-format.js";
import { validateFinalsMatchResultInput } from "./finals-match-result.js";
import {
  getFinalsChampionAndRunnerUp,
  resolveFinalsMatchTeams,
} from "./finals-match-progress.js";
import { getByeWinnerTeam, isByeTeam, isSingleByeMatch } from "./finals-match-bye.js";
import {
  resolveFinalQualifierCount,
  resolveQualifiersPerBlock,
} from "./tournament-format.js";
import { resolveWildcardComparisonMode } from "./wildcard-comparison.js";
import { MatchResultStatus } from "./constants.js";
import {
  buildEmergencyManualBracketFromPlacement,
  buildEmergencyManualBracketSkeleton,
  detectEmergencyPlacementTamper,
  resolveEmergencyManualBracketSize,
  validateEmergencyManualPlacement,
} from "./emergency-ops-finals-manual.js";

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

function resultsToMap(raw) {
  if (!raw) {
    return new Map();
  }
  if (raw instanceof Map) {
    return new Map(raw);
  }
  if (Array.isArray(raw)) {
    return new Map(raw.map((item) => [item.matchId || item.id, item]));
  }
  return new Map(Object.entries(raw));
}

function isFinishedResult(result) {
  return Boolean(
    result &&
      (result.status === MatchResultStatus.FINISHED || result.status === "finished") &&
      (result.winner?.entryId || result.resolution === "bye")
  );
}

/**
 * @param {object} exportDoc
 */
export function resolveEmergencyFinalsSettings(exportDoc) {
  const tournament = asObject(exportDoc?.source?.tournament);
  const advancement = asObject(exportDoc?.source?.finalsAdvancement);
  const qualifiersPerBlock =
    advancement.qualifiersPerBlock ?? resolveQualifiersPerBlock(tournament) ?? null;
  const finalTeamCount =
    advancement.finalTeamCount ??
    advancement.qualifierCount ??
    resolveFinalQualifierCount({
      tournament,
      blockDraw: exportDoc?.source?.blockDraw,
      teamCount: asArray(exportDoc?.source?.entries).length || null,
    }) ??
    null;
  const blockCount = advancement.blockCount ?? tournament.blockCount ?? null;

  let mode = advancement.mode || null;
  if (!mode) {
    if (qualifiersPerBlock == null) {
      mode = FinalsAdvancementMode.LEGACY;
    } else if (
      finalTeamCount != null &&
      blockCount != null &&
      finalTeamCount > blockCount * qualifiersPerBlock
    ) {
      mode = FinalsAdvancementMode.RANK_BAND_WILDCARDS;
    } else {
      mode = FinalsAdvancementMode.FIXED_BLOCK_QUALIFIERS;
    }
  }

  return {
    mode,
    blockCount,
    qualifiersPerBlock,
    finalTeamCount,
    wildcardCount: advancement.wildcardCount ?? null,
    wildcardComparisonMode:
      advancement.wildcardComparisonMode ??
      resolveWildcardComparisonMode(tournament) ??
      "raw",
    winsRequired: tournament.winsRequired ?? 2,
    finalsMatchRules: tournament.finalsMatchRules ?? null,
    advancementFinalized: advancement.finalized === true,
    placementMode: asObject(exportDoc?.source?.finalsBracket).placementMode || null,
  };
}

/**
 * ブラケット解決優先順位（Sprint 2.1）:
 * 1) Export の正式 finalsBracket → 絶対的な正（モードA）
 * 2) なし → 緊急手動配置骨格（モードB）。未実施抽選は再現しない。
 * @param {object} exportDoc
 * @param {{
 *   placements?: object[],
 *   finalistsOverride?: object[],
 *   lockedFingerprint?: string,
 *   hasStartedFinals?: boolean,
 * }} [options]
 */
export function resolveEmergencyFinalsBracket(exportDoc, options = {}) {
  const settings = resolveEmergencyFinalsSettings(exportDoc);
  const exported = asObject(exportDoc?.source?.finalsBracket);
  if (asArray(exported.matches).length > 0) {
    return {
      bracket: exported,
      source: "export",
      mode: "official",
      bracketKindJa: "脱出前確定",
      messageJa: "EmergencyExportV1 の正式ブラケットを使用します。",
      placement: null,
      tamper: { tampered: false, messageJa: "" },
    };
  }

  const sizePack = resolveEmergencyManualBracketSize(settings.finalTeamCount);
  if (!sizePack.valid) {
    return {
      bracket: null,
      source: "manual_size_invalid",
      mode: "emergency_manual",
      bracketKindJa: "未確定",
      messageJa: sizePack.messageJa,
      placement: null,
      tamper: { tampered: false, messageJa: "" },
    };
  }

  const finalists =
    options.finalistsOverride ||
    buildEmergencyFinalsAdvancementRows(exportDoc).rows.filter((row) => row.advanced && row.entryId);

  if (
    options.finalistsOverride == null &&
    settings.advancementFinalized !== true
  ) {
    const skeleton = buildEmergencyManualBracketSkeleton(sizePack.bracketSize);
    return {
      bracket: skeleton.bracket,
      source: "emergency_manual_pending",
      mode: "emergency_manual",
      bracketKindJa: "未確定",
      messageJa: "決勝進出者が未確定です。先に予選順位と決勝進出者を確定してください。",
      placement: null,
      tamper: { tampered: false, messageJa: "" },
    };
  }

  const placements = options.placements;
  if (Array.isArray(placements)) {
    const built = buildEmergencyManualBracketFromPlacement(finalists, placements, {
      finalTeamCount: settings.finalTeamCount,
      requireConfirm: options.requireConfirm !== false,
    });
    const fingerprint = built.validation?.fingerprint || "";
    const tamper = detectEmergencyPlacementTamper(
      options.lockedFingerprint || "",
      fingerprint,
      options.hasStartedFinals === true
    );
    if (built.valid && built.confirmed && !tamper.tampered) {
      return {
        bracket: built.bracket,
        source: "emergency_manual",
        mode: "emergency_manual",
        bracketKindJa: "緊急手動",
        messageJa: "緊急手動ブラケット確定",
        placement: built.validation,
        tamper,
      };
    }
    const skeleton = buildEmergencyManualBracketSkeleton(sizePack.bracketSize);
    return {
      bracket: skeleton.bracket,
      source: "emergency_manual_pending",
      mode: "emergency_manual",
      bracketKindJa: tamper.tampered ? "緊急手動" : "未確定",
      messageJa: tamper.tampered
        ? tamper.messageJa
        : built.messageJa || "緊急手動配置が未確定です。",
      placement: built.validation,
      tamper,
      errors: built.errors || [],
    };
  }

  const skeleton = buildEmergencyManualBracketSkeleton(sizePack.bracketSize);
  return {
    bracket: skeleton.bracket,
    source: "emergency_manual_pending",
    mode: "emergency_manual",
    bracketKindJa: "未確定",
    messageJa:
      "正式ブラケットがありません。予選完了・進出者確定後、現場抽選結果を緊急手動配置へ入力してください。",
    placement: null,
    tamper: { tampered: false, messageJa: "" },
  };
}

/**
 * @param {object} exportDoc
 * @param {object|null} bracket
 */
export function listEmergencyFinalsEscapeFinishedMatchIds(exportDoc, bracket) {
  const resultsMap = resultsToMap(exportDoc?.source?.finalsMatchResults);
  const ids = new Set();
  for (const match of asArray(bracket?.matches)) {
    const result = resultsMap.get(match.matchId);
    if (isFinishedResult(result)) {
      ids.add(match.matchId);
      continue;
    }
  }
  return ids;
}

function buildEmergencyByeResult(match, tournament, bracket) {
  const winner = getByeWinnerTeam(match.team1, match.team2);
  const winnerSide = isByeTeam(match.team1) ? "team2" : "team1";
  const winsRequired = resolveEmergencyMatchWinsRequired(match, tournament, bracket);
  return {
    matchId: match.matchId,
    status: MatchResultStatus.FINISHED,
    resolution: "bye",
    winnerSide,
    winner,
    loser: null,
    team1: match.team1,
    team2: match.team2,
    team1SetWins: winnerSide === "team1" ? winsRequired : 0,
    team2SetWins: winnerSide === "team2" ? winsRequired : 0,
    sets: [],
    winsRequired,
  };
}

/**
 * @param {object} match
 * @param {object} tournament
 * @param {object} bracket
 */
export function resolveEmergencyMatchWinsRequired(match, tournament, bracket) {
  return resolveMatchWinsRequired({
    tournament,
    bracket,
    roundNumber: match?.roundNumber,
  });
}

/**
 * @param {object} exportDoc
 * @param {object} bracket
 * @param {Map<string, object>} [resultsMapOverride]
 */
export function buildEmergencyFinalsMatchRows(exportDoc, bracket, resultsMapOverride = null) {
  const tournament = asObject(exportDoc?.source?.tournament);
  const resultsMap =
    resultsMapOverride || resultsToMap(exportDoc?.source?.finalsMatchResults);
  const escapeIds = listEmergencyFinalsEscapeFinishedMatchIds(exportDoc, bracket);

  const rows = [];
  for (const match of asArray(bracket?.matches)) {
    const resolved = resolveFinalsMatchTeams({ match, bracket, resultsMap });
    const result = resultsMap.get(match.matchId) || null;
    const bye = isSingleByeMatch(match.team1, match.team2);
    const winsRequired = resolveEmergencyMatchWinsRequired(match, tournament, bracket);
    const escapeFinished = escapeIds.has(match.matchId);
    const finished = isFinishedResult(result) || (bye && Boolean(getByeWinnerTeam(match.team1, match.team2)));

    let team1 = resolved.team1 || match.team1 || null;
    let team2 = resolved.team2 || match.team2 || null;
    let winner = result?.winner || null;
    if (bye) {
      winner = getByeWinnerTeam(match.team1, match.team2);
      team1 = winner;
      team2 = isByeTeam(match.team1) ? match.team1 : match.team2;
    }

    rows.push({
      matchId: match.matchId,
      roundNumber: match.roundNumber,
      matchNumber: match.matchNumber,
      roundLabel:
        match.roundLabel || getFinalsRoundLabel(bracket.bracketSize, match.roundNumber),
      courtNumber: match.courtNumber ?? match.matchNumber ?? "",
      scheduledTime: match.scheduledTime || "",
      team1,
      team2,
      nextMatchId: match.nextMatchId ?? null,
      nextTeamSlot: match.nextTeamSlot ?? null,
      winsRequired,
      bye,
      escapeFinished,
      finished,
      result,
      winner,
      team1SetWins: result?.team1SetWins ?? (bye ? winsRequired : null),
      team2SetWins: result?.team2SetWins ?? (bye ? 0 : null),
      sets: asArray(result?.sets),
      teamsResolved: resolved.resolved === true || bye,
      status: bye
        ? "BYE"
        : escapeFinished
          ? "脱出前確定"
          : finished
            ? "Excel確定"
            : resolved.resolved
              ? "実施可"
              : "対戦者待ち",
    });
  }
  return rows;
}

/**
 * @param {object} exportDoc
 * @param {Record<string, object>} excelInputsByMatchId
 * @param {object} [options]
 */
export function projectEmergencyOpsFinals(exportDoc, excelInputsByMatchId = {}, options = {}) {
  const officialResults = resultsToMap(exportDoc?.source?.finalsMatchResults);
  const hasStartedFinals =
    options.hasStartedFinals ??
    (officialResults.size > 0 ||
      Object.keys(excelInputsByMatchId || {}).length > 0);
  const resolvedBracket = resolveEmergencyFinalsBracket(exportDoc, {
    ...options,
    hasStartedFinals,
  });
  const bracket = resolvedBracket.bracket;
  if (!bracket || asArray(bracket.matches).length === 0) {
    return {
      ok: false,
      reason: resolvedBracket.source,
      messageJa: resolvedBracket.messageJa,
      bracket: null,
      champion: null,
      complete: false,
      matches: [],
      bracketKindJa: resolvedBracket.bracketKindJa || "未確定",
      mode: resolvedBracket.mode,
      tamper: resolvedBracket.tamper,
    };
  }

  const bracketReady =
    resolvedBracket.source === "export" ||
    (resolvedBracket.source === "emergency_manual" && !resolvedBracket.tamper?.tampered);

  const tournament = asObject(exportDoc?.source?.tournament);
  const resultsMap = new Map();
  const official = officialResults;
  const escapeIds = listEmergencyFinalsEscapeFinishedMatchIds(exportDoc, bracket);

  for (const match of asArray(bracket.matches)) {
    if (!escapeIds.has(match.matchId)) {
      continue;
    }
    const officialResult = official.get(match.matchId);
    if (isFinishedResult(officialResult)) {
      resultsMap.set(match.matchId, officialResult);
      continue;
    }
    if (isSingleByeMatch(match.team1, match.team2)) {
      resultsMap.set(
        match.matchId,
        buildEmergencyByeResult(match, tournament, bracket)
      );
    }
  }

  const matchesInOrder = [...asArray(bracket.matches)].sort((a, b) => {
    if (a.roundNumber !== b.roundNumber) {
      return a.roundNumber - b.roundNumber;
    }
    return a.matchNumber - b.matchNumber;
  });

  if (bracketReady) {
    for (const match of matchesInOrder) {
      if (resultsMap.has(match.matchId)) {
        continue;
      }
      if (isSingleByeMatch(match.team1, match.team2)) {
        resultsMap.set(
          match.matchId,
          buildEmergencyByeResult(match, tournament, bracket)
        );
        continue;
      }

      const input = excelInputsByMatchId?.[match.matchId];
      if (!input) {
        continue;
      }
      const winsRequired = resolveEmergencyMatchWinsRequired(match, tournament, bracket);
      const validated = validateFinalsMatchResultInput(input, { winsRequired });
      if (!validated.valid) {
        continue;
      }
      const teams = resolveFinalsMatchTeams({ match, bracket, resultsMap });
      if (!teams.resolved) {
        continue;
      }
      const winnerSide = validated.data.winnerSide;
      resultsMap.set(match.matchId, {
        matchId: match.matchId,
        status: MatchResultStatus.FINISHED,
        resolution: "played",
        team1: teams.team1,
        team2: teams.team2,
        sets: validated.data.sets,
        team1SetWins: validated.data.team1SetWins,
        team2SetWins: validated.data.team2SetWins,
        winnerSide,
        winner: winnerSide === "team1" ? teams.team1 : teams.team2,
        loser: winnerSide === "team1" ? teams.team2 : teams.team1,
        winsRequired,
      });
    }
  }

  const placement = getFinalsChampionAndRunnerUp(bracket, resultsMap);
  const matchRows = buildEmergencyFinalsMatchRows(exportDoc, bracket, resultsMap);
  const finishedCount = [...resultsMap.keys()].length;

  return {
    ok: bracketReady,
    reason: resolvedBracket.source,
    messageJa: resolvedBracket.messageJa,
    bracket,
    champion: bracketReady && placement.complete ? placement.champion : null,
    runnerUp: bracketReady && placement.complete ? placement.runnerUp : null,
    complete: bracketReady && placement.complete === true,
    totalMatches: asArray(bracket.matches).length,
    finishedMatches: finishedCount,
    remainingMatches: Math.max(0, asArray(bracket.matches).length - finishedCount),
    matches: matchRows,
    resultsMap,
    bracketKindJa: resolvedBracket.bracketKindJa,
    mode: resolvedBracket.mode,
    placement: resolvedBracket.placement,
    tamper: resolvedBracket.tamper,
  };
}

/**
 * @param {object} exportDoc
 */
export function previewEmergencyFinalsAdvancement(exportDoc) {
  const settings = resolveEmergencyFinalsSettings(exportDoc);
  const tournament = {
    ...asObject(exportDoc?.source?.tournament),
    qualifiersPerBlock: settings.qualifiersPerBlock,
    finalTeamCount: settings.finalTeamCount,
    wildcardComparisonMode: settings.wildcardComparisonMode,
  };
  const schedule = exportDoc?.source?.qualifyingSchedule;
  const resultsMap = resultsToMap(exportDoc?.source?.qualifyingMatchResults);
  return buildFinalsAdvancementPreview(schedule, resultsMap, {
    tournament,
    blockDraw: exportDoc?.source?.blockDraw,
    molkkyOutResolutions: exportDoc?.source?.molkkyOutResolutions,
  });
}

/**
 * @param {object} exportDoc
 * @param {object} qualifyingStandingsDoc
 * @param {object} [options]
 */
export function selectEmergencyFinalistsFromStandings(
  exportDoc,
  qualifyingStandingsDoc,
  options = {}
) {
  const settings = resolveEmergencyFinalsSettings(exportDoc);
  return selectFinalists(qualifyingStandingsDoc, settings.finalTeamCount, {
    autoPassRanks: settings.qualifiersPerBlock,
    mode: settings.mode,
    wildcardComparisonMode: settings.wildcardComparisonMode,
    molkkyOutResolutions:
      options.molkkyOutResolutions || exportDoc?.source?.molkkyOutResolutions,
    tournament: asObject(exportDoc?.source?.tournament),
  });
}

/**
 * 進出シート行（Export 確定進出 or 設定に基づく枠）
 * @param {object} exportDoc
 */
export function buildEmergencyFinalsAdvancementRows(exportDoc) {
  const settings = resolveEmergencyFinalsSettings(exportDoc);
  const advancement = asObject(exportDoc?.source?.finalsAdvancement);
  const rows = [];

  if (asArray(advancement.qualifiers).length > 0) {
    for (const qualifier of advancement.qualifiers) {
      rows.push({
        blockId: text(qualifier.blockId),
        blockName: text(qualifier.blockName || qualifier.blockId),
        blockRank: qualifier.blockRank ?? qualifier.rank ?? "",
        teamNumber: qualifier.displayTeamNumber ?? "",
        teamName: text(qualifier.teamName),
        entryId: text(qualifier.entryId),
        advanced: true,
        reasonJa: text(qualifier.source || qualifier.advancementSource || settings.mode),
        seed: qualifier.seed ?? "",
        slot: qualifier.seed ?? "",
        needsConfirm: false,
      });
    }
    return { settings, rows, source: "export_advancement" };
  }

  // 未確定: 設定上の枠だけ示す（チームは予選順位確定後）
  const blockCount = Number(settings.blockCount) || 0;
  const perBlock = Number(settings.qualifiersPerBlock) || 1;
  for (let b = 0; b < blockCount; b += 1) {
    const blockId = String.fromCharCode(65 + b);
    for (let rank = 1; rank <= perBlock; rank += 1) {
      rows.push({
        blockId,
        blockName: `${blockId}ブロック`,
        blockRank: rank,
        teamNumber: "",
        teamName: "",
        entryId: "",
        advanced: false,
        reasonJa: `ブロック${rank}位枠（設定）`,
        seed: "",
        slot: "",
        needsConfirm: true,
      });
    }
  }
  if (settings.mode === FinalsAdvancementMode.RANK_BAND_WILDCARDS) {
    const wc = Number(settings.wildcardCount) || 0;
    for (let i = 0; i < wc; i += 1) {
      rows.push({
        blockId: "",
        blockName: "ワイルドカード",
        blockRank: "",
        teamNumber: "",
        teamName: "",
        entryId: "",
        advanced: false,
        reasonJa: "ワイルドカード枠（設定）",
        seed: "",
        slot: "",
        needsConfirm: true,
      });
    }
  }

  return { settings, rows, source: "settings_slots" };
}

export {
  buildSeedOrder,
  getFinalsRoundLabel,
  buildFinalsBracket,
  FinalsAdvancementMode,
  text as finalsText,
  validateEmergencyManualPlacement,
  buildEmergencyManualBracketFromPlacement,
  buildEmergencyManualBracketSkeleton,
  resolveEmergencyManualBracketSize,
  detectEmergencyPlacementTamper,
};
