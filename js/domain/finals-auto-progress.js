/**
 * 決勝トーナメント自動進行（E2E テスト支援・DOM / Firestore 非依存）
 */
import { EntryStatus, MatchSessionStatus } from "./constants.js";
import { TournamentFormat } from "./tournament-format.js";
import { canUseTournamentTestTools } from "./test-tournament-access.js";
import { areAllConfirmedEntriesDummy } from "./qualifying-auto-progress.js";
import {
  buildByeMatchResultPayload,
  evaluateFinalsMatchStart,
  getFinalsChampionAndRunnerUp,
  listDoubleByeMatches,
  resolveFinalsMatchTeams,
} from "./finals-match-progress.js";
import { isSingleByeMatch } from "./finals-match-bye.js";
import { isSingleEliminationBracket } from "./single-elimination-bracket.js";
import { validateTournamentCompletion } from "./tournament-results.js";
import {
  FinalsSimulationMode,
  generateValidatedFinalsMatchResult,
} from "./finals-match-result-generator.js";
import {
  buildFinalsMatchSessionPayload,
  buildPlayedFinalsMatchResultPayload,
  ensureFinalsTeamWithSeed,
} from "./finals-match-result-payload.js";
import { deriveDefaultSimulationSeed } from "./seeded-random.js";
import { resolveMatchWinsRequired } from "./finals-match-format.js";

/**
 * @param {object|null|undefined} tournament
 */
export function isSupportedFinalsAutoProgressFormat(tournament) {
  const format = tournament?.tournamentFormat;
  return (
    format === TournamentFormat.QUALIFYING_AND_FINALS ||
    format === TournamentFormat.SINGLE_ELIMINATION
  );
}

/**
 * @param {object|null|undefined} bracket
 */
export function countFinalsParticipantTeams(bracket) {
  if (!bracket) {
    return 0;
  }
  if (typeof bracket.teamCount === "number") {
    return bracket.teamCount;
  }
  if (typeof bracket.qualifierCount === "number") {
    return bracket.qualifierCount;
  }
  return (bracket.slots ?? []).filter((slot) => !slot.isBye && slot.entryId).length;
}

/**
 * @param {object|null|undefined} bracket
 */
export function countExpectedFinalsPlayedMatches(bracket) {
  const teamCount = countFinalsParticipantTeams(bracket);
  return Math.max(0, teamCount - 1);
}

/**
 * @param {object|null|undefined} bracket
 */
export function countFinalsByeMatches(bracket) {
  return (bracket?.matches ?? []).filter(
    (match) => match.roundNumber === 1 && isSingleByeMatch(match.team1, match.team2)
  ).length;
}

/**
 * @param {object|null|undefined} bracket
 * @param {Map<string, object>} resultsMap
 */
export function countFinalsMatchProgress(bracket, resultsMap = new Map()) {
  const expectedPlayed = countExpectedFinalsPlayedMatches(bracket);
  const playedResults = [...resultsMap.values()].filter(
    (result) => result.resolution === "played"
  );
  return {
    expectedPlayedMatches: expectedPlayed,
    finishedPlayedMatches: playedResults.length,
    remainingPlayedMatches: Math.max(0, expectedPlayed - playedResults.length),
    totalBracketMatches: bracket?.matches?.length ?? 0,
    byeCount: countFinalsByeMatches(bracket),
    complete: playedResults.length >= expectedPlayed && expectedPlayed > 0,
  };
}

/**
 * @param {object|null|undefined} bracket
 */
export function validateFinalsBracketSlots(bracket) {
  if (!bracket?.finalized) {
    return { valid: false, message: "決勝ブラケットが確定していません。" };
  }

  if (listDoubleByeMatches(bracket).length > 0) {
    return { valid: false, message: "両側BYEの試合が含まれる不正なブラケットです。" };
  }

  for (const slot of bracket.slots ?? []) {
    if (slot.isBye) {
      continue;
    }
    if (!slot.entryId || !slot.teamName) {
      return {
        valid: false,
        message: "決勝ブラケットに entryId または teamName が欠けた参加枠があります。",
      };
    }
  }

  return { valid: true, message: null };
}

/**
 * @param {object} params
 */
export function validateFinalsAutoProgress({
  tournament,
  canManage = false,
  entries = [],
  bracket = null,
  finalsAdvancement = null,
  existingResults = new Map(),
  structureState = null,
}) {
  const access = canUseTournamentTestTools({ tournament, canManage });
  if (!access.allowed) {
    return { allowed: false, reason: access.reason };
  }

  if (!isSupportedFinalsAutoProgressFormat(tournament)) {
    return {
      allowed: false,
      reason:
        "決勝自動進行は大会形式「予選＋決勝」または「一発トーナメント」のみ利用できます。従来形式（Legacy）は非対応です。",
    };
  }

  if (!areAllConfirmedEntriesDummy(entries)) {
    return {
      allowed: false,
      reason: "実参加者が含まれているため、決勝自動進行は実行できません。",
    };
  }

  const bracketValidation = validateFinalsBracketSlots(bracket);
  if (!bracketValidation.valid) {
    return { allowed: false, reason: bracketValidation.message };
  }

  if (tournament?.tournamentFormat === TournamentFormat.QUALIFYING_AND_FINALS) {
    if (!finalsAdvancement?.finalized) {
      return {
        allowed: false,
        reason: "決勝進出が確定していません。",
      };
    }
  }

  if (structureState?.hasTournamentResults) {
    return {
      allowed: false,
      reason: "大会結果が確定済みのため、決勝自動進行は実行できません。",
    };
  }

  if (existingResults.size > 0) {
    return {
      allowed: false,
      reason:
        "決勝結果がすでに入力されています。手動結果と自動結果の混在を防ぐため、自動進行できません。",
    };
  }

  const progress = countFinalsMatchProgress(bracket, existingResults);
  if (progress.expectedPlayedMatches === 0) {
    return { allowed: false, reason: "決勝の実試合がありません。" };
  }

  return {
    allowed: true,
    reason: null,
    progress,
    format: tournament.tournamentFormat,
    isSingleElimination: isSingleEliminationBracket(bracket),
  };
}

/**
 * @param {object|null|undefined} bracket
 */
export function sortBracketMatches(bracket) {
  return [...(bracket?.matches ?? [])].sort(
    (a, b) => a.roundNumber - b.roundNumber || a.matchNumber - b.matchNumber
  );
}

/**
 * @param {object} params
 */
export function simulateFinalsTournament({
  bracket,
  simulationSeed,
  mode = FinalsSimulationMode.STANDARD,
  tournament = null,
  winsRequired: winsRequiredInput = null,
}) {
  const resultsMap = new Map();
  const sessionsMap = new Map();
  const strengthCache = new Map();
  const byeResults = [];
  const playedPlans = [];
  const errors = [];
  const matches = sortBracketMatches(bracket);
  const maxIterations = matches.length * 4 + 1;

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    let progressed = false;

    for (const match of matches) {
      if (resultsMap.has(match.matchId)) {
        continue;
      }

      const teams = resolveFinalsMatchTeams({ match, bracket, resultsMap });
      if (teams.reason === "double_bye") {
        errors.push({ matchId: match.matchId, message: "両側BYEの試合です。" });
        continue;
      }

      if (teams.reason === "bye") {
        const payload = buildByeMatchResultPayload(match, ensureFinalsTeamWithSeed(teams.byeWinner));
        resultsMap.set(match.matchId, payload);
        byeResults.push({ matchId: match.matchId, payload });
        progressed = true;
        continue;
      }

      if (!teams.resolved) {
        continue;
      }

      const startEvaluation = evaluateFinalsMatchStart({
        match,
        bracket,
        resultsMap,
        sessionsMap,
      });

      if (!startEvaluation.canStart) {
        continue;
      }

      const winsRequired = resolveMatchWinsRequired({
        tournament: tournament ?? { winsRequired: winsRequiredInput },
        bracket,
        roundNumber: match.roundNumber,
      });

      const generated = generateValidatedFinalsMatchResult({
        matchId: match.matchId,
        team1: startEvaluation.team1,
        team2: startEvaluation.team2,
        simulationSeed,
        mode,
        strengthCache,
        winsRequired,
      });

      if (!generated.valid) {
        errors.push({ matchId: match.matchId, message: generated.message });
        continue;
      }

      const resultPayload = buildPlayedFinalsMatchResultPayload({
        match,
        team1: startEvaluation.team1,
        team2: startEvaluation.team2,
        validatedData: generated.validated,
      });

      const sessionBase = buildFinalsMatchSessionPayload({
        match,
        team1: startEvaluation.team1,
        team2: startEvaluation.team2,
      });

      resultsMap.set(match.matchId, resultPayload);
      sessionsMap.set(match.matchId, {
        ...sessionBase,
        status: MatchSessionStatus.FINISHED,
      });
      playedPlans.push({
        matchId: match.matchId,
        match,
        sessionBase,
        resultPayload,
      });
      progressed = true;
    }

    if (!progressed) {
      break;
    }
  }

  const progress = countFinalsMatchProgress(bracket, resultsMap);
  const outcome = getFinalsChampionAndRunnerUp(bracket, resultsMap);
  const completion = validateTournamentCompletion({
    bracket,
    resultsMap,
    qualifiers: [],
  });

  return {
    resultsMap,
    sessionsMap,
    byeResults,
    playedPlans,
    errors,
    progress,
    outcome,
    completion,
    strengthCache,
  };
}

/**
 * @param {object} params
 */
export function buildFinalsAutoProgressPlan({
  tournament,
  canManage = false,
  entries = [],
  bracket = null,
  finalsAdvancement = null,
  existingResults = new Map(),
  structureState = null,
  simulationSeed,
  mode = FinalsSimulationMode.STANDARD,
  tournamentId = null,
}) {
  const validation = validateFinalsAutoProgress({
    tournament,
    canManage,
    entries,
    bracket,
    finalsAdvancement,
    existingResults,
    structureState,
  });

  if (!validation.allowed) {
    return {
      valid: false,
      message: validation.reason,
      simulation: null,
      simulationSeed: null,
      mode,
    };
  }

  const resolvedSeed =
    simulationSeed != null && simulationSeed !== ""
      ? Number(simulationSeed)
      : deriveDefaultSimulationSeed(tournamentId ?? tournament?.id);

  if (!Number.isFinite(resolvedSeed)) {
    return {
      valid: false,
      message: "simulationSeed は数値で指定してください。",
      simulation: null,
      simulationSeed: null,
      mode,
    };
  }

  const normalizedMode =
    mode === FinalsSimulationMode.CLOSE
      ? FinalsSimulationMode.CLOSE
      : FinalsSimulationMode.STANDARD;

  const simulation = simulateFinalsTournament({
    bracket,
    simulationSeed: resolvedSeed,
    mode: normalizedMode,
    tournament,
  });

  if (simulation.errors.length > 0) {
    return {
      valid: false,
      message: simulation.errors[0]?.message ?? "決勝結果の生成に失敗しました。",
      simulation: null,
      simulationSeed: resolvedSeed,
      mode: normalizedMode,
    };
  }

  if (!simulation.progress.complete) {
    return {
      valid: false,
      message: "決勝トーナメントを最後までシミュレーションできませんでした。",
      simulation: null,
      simulationSeed: resolvedSeed,
      mode: normalizedMode,
    };
  }

  if (!simulation.outcome.complete || !simulation.outcome.champion?.teamName) {
    return {
      valid: false,
      message: "優勝者を算出できませんでした。",
      simulation: null,
      simulationSeed: resolvedSeed,
      mode: normalizedMode,
    };
  }

  for (const plan of simulation.playedPlans) {
    if (!plan.resultPayload.winner?.entryId || !plan.resultPayload.winner?.teamName) {
      return {
        valid: false,
        message: "勝者情報に entryId または teamName が欠けています。",
        simulation: null,
        simulationSeed: resolvedSeed,
        mode: normalizedMode,
      };
    }
  }

  return {
    valid: true,
    message: null,
    simulation,
    simulationSeed: resolvedSeed,
    mode: normalizedMode,
  };
}

/**
 * @param {object|null|undefined} bracket
 * @param {Map<string, object>} resultsMap
 */
export function summarizeFinalsAutoProgressOutcome(bracket, resultsMap) {
  const progress = countFinalsMatchProgress(bracket, resultsMap);
  const outcome = getFinalsChampionAndRunnerUp(bracket, resultsMap);
  const completion = validateTournamentCompletion({
    bracket,
    resultsMap,
    qualifiers: [],
  });

  return {
    ...progress,
    champion: outcome.champion,
    runnerUp: outcome.runnerUp,
    complete: outcome.complete,
    canPreviewTournamentResults: completion.canFinalize,
    previewMessage: completion.canFinalize ? null : completion.message,
    roundCount: bracket?.roundCount ?? 0,
    participantCount: countFinalsParticipantTeams(bracket),
  };
}
