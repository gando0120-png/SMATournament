/**
 * 予選試合結果の検証・集計（DOM 非依存）
 */
import { SetResult, SET_WINNING_SCORE } from "./constants.js";

/**
 * @param {unknown} value
 * @returns {{ valid: true, value: number } | { valid: false, message: string }}
 */
export function parseNonNegativeInteger(value) {
  if (value === null || value === undefined || value === "") {
    return { valid: false, message: "必須項目です。" };
  }

  const str = String(value).trim();
  if (!/^\d+$/.test(str)) {
    return { valid: false, message: "0以上の整数を入力してください。" };
  }

  const num = Number(str);
  if (!Number.isSafeInteger(num) || num < 0) {
    return { valid: false, message: "0以上の整数を入力してください。" };
  }

  return { valid: true, value: num };
}

/**
 * @param {number} team1Score
 * @param {number} team2Score
 * @returns {string|null}
 */
export function deriveSetResult(team1Score, team2Score) {
  if (team1Score > team2Score) {
    return SetResult.TEAM1;
  }
  if (team1Score < team2Score) {
    return SetResult.TEAM2;
  }
  if (team1Score === team2Score && team1Score < SET_WINNING_SCORE) {
    return SetResult.DRAW;
  }
  return null;
}

/**
 * @param {unknown} team1Score
 * @param {unknown} team2Score
 * @param {string} setLabel
 */
export function validateSetScores(team1Score, team2Score, setLabel) {
  const parsedTeam1 = parseNonNegativeInteger(team1Score);
  if (!parsedTeam1.valid) {
    return { valid: false, message: `${setLabel} チーム1得点：${parsedTeam1.message}` };
  }

  const parsedTeam2 = parseNonNegativeInteger(team2Score);
  if (!parsedTeam2.valid) {
    return { valid: false, message: `${setLabel} チーム2得点：${parsedTeam2.message}` };
  }

  const result = deriveSetResult(parsedTeam1.value, parsedTeam2.value);
  if (!result) {
    return {
      valid: false,
      message: `${setLabel}：同点の場合は両チームとも50点未満である必要があります。`,
    };
  }

  return {
    valid: true,
    data: {
      team1Score: parsedTeam1.value,
      team2Score: parsedTeam2.value,
      result,
    },
  };
}

/**
 * @param {Array<{ result: string, team1Score: number, team2Score: number }>} sets
 */
export function computeTeamStatsFromSets(sets) {
  const team1Stats = { setWins: 0, setDraws: 0, setLosses: 0, totalScore: 0 };
  const team2Stats = { setWins: 0, setDraws: 0, setLosses: 0, totalScore: 0 };

  for (const set of sets) {
    team1Stats.totalScore += set.team1Score;
    team2Stats.totalScore += set.team2Score;

    if (set.result === SetResult.TEAM1) {
      team1Stats.setWins += 1;
      team2Stats.setLosses += 1;
    } else if (set.result === SetResult.TEAM2) {
      team2Stats.setWins += 1;
      team1Stats.setLosses += 1;
    } else if (set.result === SetResult.DRAW) {
      team1Stats.setDraws += 1;
      team2Stats.setDraws += 1;
    }
  }

  return { team1Stats, team2Stats };
}

/**
 * @param {object} input
 * @returns {{ valid: true, data: object } | { valid: false, message: string }}
 */
export function validateMatchResultInput(input) {
  const set1 = validateSetScores(input?.set1Team1Score, input?.set1Team2Score, "第1セット");
  if (!set1.valid) {
    return set1;
  }

  const set2 = validateSetScores(input?.set2Team1Score, input?.set2Team2Score, "第2セット");
  if (!set2.valid) {
    return set2;
  }

  const sets = [
    { setNumber: 1, ...set1.data },
    { setNumber: 2, ...set2.data },
  ];

  const { team1Stats, team2Stats } = computeTeamStatsFromSets(sets);

  return {
    valid: true,
    data: { sets, team1Stats, team2Stats },
  };
}

/**
 * @param {object|null|undefined} persistedSchedule
 * @returns {Map<string, object>}
 */
export function buildScheduleMatchIndex(persistedSchedule) {
  const index = new Map();

  if (!persistedSchedule?.finalized || !Array.isArray(persistedSchedule.blocks)) {
    return index;
  }

  for (const block of persistedSchedule.blocks) {
    for (const round of block.rounds || []) {
      for (const match of round.matches || []) {
        if (match.matchId) {
          index.set(match.matchId, {
            matchId: match.matchId,
            blockId: block.blockId,
            roundNumber: round.roundNumber,
            courtNumber: match.courtNumber,
            team1: match.team1,
            team2: match.team2,
          });
        }
      }
    }
  }

  return index;
}

/**
 * @param {object} displaySchedule
 * @param {Map<string, object>} resultsMap
 */
export function mergeMatchResultsIntoSchedule(displaySchedule, resultsMap) {
  return {
    ...displaySchedule,
    blocks: displaySchedule.blocks.map((block) => ({
      ...block,
      rounds: block.rounds.map((round) => ({
        ...round,
        matches: round.matches.map((match) => ({
          ...match,
          result: resultsMap.get(match.matchId) ?? null,
        })),
      })),
    })),
  };
}

/**
 * @param {object|null|undefined} result
 */
export function buildMatchResultInitialValues(result) {
  if (!result?.sets?.length) {
    return {};
  }

  const set1 = result.sets.find((set) => set.setNumber === 1) ?? result.sets[0];
  const set2 = result.sets.find((set) => set.setNumber === 2) ?? result.sets[1];

  return {
    set1Team1Score: set1?.team1Score,
    set1Team2Score: set1?.team2Score,
    set2Team1Score: set2?.team1Score,
    set2Team2Score: set2?.team2Score,
  };
}

/**
 * @param {object} match
 * @param {object} result
 */
export function formatMatchResultSummary(match, result) {
  const team1Stats = result.team1Stats ?? {};
  const team2Stats = result.team2Stats ?? {};

  return {
    team1Line: `${match.homeTeamName}　${team1Stats.setWins ?? 0}-${team1Stats.setDraws ?? 0}-${team1Stats.setLosses ?? 0}　${team1Stats.totalScore ?? 0}点`,
    team2Line: `${match.awayTeamName}　${team2Stats.setWins ?? 0}-${team2Stats.setDraws ?? 0}-${team2Stats.setLosses ?? 0}　${team2Stats.totalScore ?? 0}点`,
  };
}

/**
 * @param {object} stats
 */
export function formatTeamStatsLine(stats) {
  return `${stats.setWins ?? 0}勝 ${stats.setDraws ?? 0}分 ${stats.setLosses ?? 0}敗 / ${stats.totalScore ?? 0}点`;
}
