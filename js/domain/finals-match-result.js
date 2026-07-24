/**
 * 決勝試合結果の検証・集計（DOM 非依存）
 */
import {
  FINALS_MATCH_MAX_SETS,
  FINALS_MATCH_SETS_TO_WIN,
  SET_WINNING_SCORE,
} from "./constants.js";
import { parseNonNegativeInteger } from "./qualifying-match-result.js";

/**
 * @param {number} team1Score
 * @param {number} team2Score
 * @returns {"team1"|"team2"|null}
 */
export function deriveFinalsSetWinner(team1Score, team2Score) {
  if (team1Score === team2Score) {
    return null;
  }
  if (team1Score === SET_WINNING_SCORE && team2Score < SET_WINNING_SCORE) {
    return "team1";
  }
  if (team2Score === SET_WINNING_SCORE && team1Score < SET_WINNING_SCORE) {
    return "team2";
  }
  return null;
}

/**
 * @param {unknown} team1Score
 * @param {unknown} team2Score
 * @param {string} setLabel
 */
export function validateFinalsSetScores(team1Score, team2Score, setLabel) {
  const parsedTeam1 = parseNonNegativeInteger(team1Score);
  if (!parsedTeam1.valid) {
    return { valid: false, message: `${setLabel} チーム1得点：${parsedTeam1.message}` };
  }

  const parsedTeam2 = parseNonNegativeInteger(team2Score);
  if (!parsedTeam2.valid) {
    return { valid: false, message: `${setLabel} チーム2得点：${parsedTeam2.message}` };
  }

  if (parsedTeam1.value > SET_WINNING_SCORE || parsedTeam2.value > SET_WINNING_SCORE) {
    return {
      valid: false,
      message: `${setLabel}：得点は0〜${SET_WINNING_SCORE}の整数で入力してください。`,
    };
  }

  const winner = deriveFinalsSetWinner(parsedTeam1.value, parsedTeam2.value);
  if (!winner) {
    return {
      valid: false,
      message: `${setLabel}：勝者側は${SET_WINNING_SCORE}点、敗者側は${SET_WINNING_SCORE}点未満である必要があります。同点は不可です。`,
    };
  }

  return {
    valid: true,
    data: {
      team1Score: parsedTeam1.value,
      team2Score: parsedTeam2.value,
      winner,
    },
  };
}

/**
 * @param {object} input
 */
export function validateFinalsMatchResultInput(input) {
  const set1 = validateFinalsSetScores(input?.set1Team1Score, input?.set1Team2Score, "第1セット");
  if (!set1.valid) {
    return set1;
  }

  const set2 = validateFinalsSetScores(input?.set2Team1Score, input?.set2Team2Score, "第2セット");
  if (!set2.valid) {
    return set2;
  }

  const sets = [
    { setNumber: 1, ...set1.data },
    { setNumber: 2, ...set2.data },
  ];

  let team1SetWins = 0;
  let team2SetWins = 0;

  for (const set of sets) {
    if (set.winner === "team1") {
      team1SetWins += 1;
    } else {
      team2SetWins += 1;
    }
  }

  if (team1SetWins === FINALS_MATCH_SETS_TO_WIN || team2SetWins === FINALS_MATCH_SETS_TO_WIN) {
    return {
      valid: true,
      data: {
        sets,
        team1SetWins,
        team2SetWins,
        winnerSide: team1SetWins === FINALS_MATCH_SETS_TO_WIN ? "team1" : "team2",
      },
    };
  }

  if (team1SetWins === 1 && team2SetWins === 1) {
    const set3 = validateFinalsSetScores(input?.set3Team1Score, input?.set3Team2Score, "第3セット");
    if (!set3.valid) {
      return set3;
    }

    sets.push({ setNumber: 3, ...set3.data });
    if (set3.data.winner === "team1") {
      team1SetWins += 1;
    } else {
      team2SetWins += 1;
    }

    if (team1SetWins === FINALS_MATCH_SETS_TO_WIN || team2SetWins === FINALS_MATCH_SETS_TO_WIN) {
      return {
        valid: true,
        data: {
          sets,
          team1SetWins,
          team2SetWins,
          winnerSide: team1SetWins === FINALS_MATCH_SETS_TO_WIN ? "team1" : "team2",
        },
      };
    }

    return {
      valid: false,
      message: "第3セット後も勝者が2セットに達していません。",
    };
  }

  return {
    valid: false,
    message: "2セット先取の勝者が決まる結果を入力してください。",
  };
}

/**
 * @param {object|null|undefined} result
 */
export function buildFinalsMatchResultInitialValues(result) {
  if (!result?.sets?.length || result.resolution === "bye") {
    return {};
  }

  const values = {};
  for (const set of result.sets) {
    if (set.setNumber === 1) {
      values.set1Team1Score = set.team1Score;
      values.set1Team2Score = set.team2Score;
    } else if (set.setNumber === 2) {
      values.set2Team1Score = set.team1Score;
      values.set2Team2Score = set.team2Score;
    } else if (set.setNumber === 3) {
      values.set3Team1Score = set.team1Score;
      values.set3Team2Score = set.team2Score;
    }
  }

  return values;
}

/**
 * @param {object|null|undefined} result
 */
export function formatFinalsMatchResultDetail(result) {
  if (!result || result.resolution === "bye") {
    return { sets: [], team1SetWins: 0, team2SetWins: 0, isBye: true };
  }

  const sets = [...(result.sets ?? [])]
    .sort((a, b) => (a.setNumber ?? 0) - (b.setNumber ?? 0))
    .map((set) => ({
      setNumber: set.setNumber,
      label: `第${set.setNumber}セット`,
      scoreLine: `${set.team1Score} - ${set.team2Score}`,
      winnerLabel: set.winner === "team1" ? "チーム1" : "チーム2",
    }));

  return {
    sets,
    team1SetWins: result.team1SetWins ?? 0,
    team2SetWins: result.team2SetWins ?? 0,
    isBye: false,
  };
}

/**
 * @param {object} input
 */
export function needsFinalsSet3Input(input) {
  const set1 = validateFinalsSetScores(input?.set1Team1Score, input?.set1Team2Score, "第1セット");
  if (!set1.valid) {
    return false;
  }
  const set2 = validateFinalsSetScores(input?.set2Team1Score, input?.set2Team2Score, "第2セット");
  if (!set2.valid) {
    return false;
  }

  let team1Wins = 0;
  let team2Wins = 0;
  if (set1.data.winner === "team1") {
    team1Wins += 1;
  } else {
    team2Wins += 1;
  }
  if (set2.data.winner === "team1") {
    team1Wins += 1;
  } else {
    team2Wins += 1;
  }

  return team1Wins === 1 && team2Wins === 1;
}
