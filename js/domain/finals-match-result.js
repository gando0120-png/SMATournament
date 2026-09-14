/**
 * 決勝試合結果の検証・集計（DOM 非依存）
 */
import {
  deriveH2HSetOutcome,
  formatSetFinishReasonLabel,
  getSetFinishReasonFieldName,
  inferSetFinishReasonForEdit,
  parseH2HSetScore,
} from "./h2h-set-finish.js";
import {
  formatFinalsWinsRequiredLabel,
  getFinalsSetScoreFieldNames,
  resolveFinalsMaxSets,
  resolveFinalsWinsRequired,
} from "./finals-match-format.js";

/**
 * @param {number} team1Score
 * @param {number} team2Score
 * @param {{ finishReason?: unknown }} [options]
 * @returns {"team1"|"team2"|null}
 */
export function deriveFinalsSetWinner(team1Score, team2Score, options = {}) {
  const outcome = deriveH2HSetOutcome({
    team1Score,
    team2Score,
    finishReason: options.finishReason,
    allowDraw: false,
  });
  if (!outcome.valid) {
    return null;
  }
  return outcome.winner;
}

/**
 * @param {unknown} team1Score
 * @param {unknown} team2Score
 * @param {string} setLabel
 * @param {{ finishReason?: unknown, requireFinishReason?: boolean }} [options]
 */
export function validateFinalsSetScores(team1Score, team2Score, setLabel, options = {}) {
  const parsedTeam1 = parseH2HSetScore(team1Score);
  if (!parsedTeam1.valid) {
    return parsedTeam1;
  }

  const parsedTeam2 = parseH2HSetScore(team2Score);
  if (!parsedTeam2.valid) {
    return parsedTeam2;
  }

  const outcome = deriveH2HSetOutcome({
    team1Score: parsedTeam1.value,
    team2Score: parsedTeam2.value,
    finishReason: options.finishReason,
    allowDraw: false,
    setLabel,
  });
  if (!outcome.valid) {
    return outcome;
  }

  return {
    valid: true,
    data: {
      team1Score: parsedTeam1.value,
      team2Score: parsedTeam2.value,
      winner: outcome.winner,
      finishReason: outcome.finishReason,
    },
  };
}

function hasSetScoreInput(input, setNumber) {
  const fields = getFinalsSetScoreFieldNames(setNumber);
  const team1 = input?.[fields.team1];
  const team2 = input?.[fields.team2];
  return (
    (team1 !== undefined && team1 !== null && String(team1).trim() !== "") ||
    (team2 !== undefined && team2 !== null && String(team2).trim() !== "")
  );
}

function readFinishReasonFromInput(input, setNumber) {
  const field = getSetFinishReasonFieldName(setNumber);
  return input?.[field] ?? input?.[`set${setNumber}FinishReason`];
}

/**
 * @param {object} input
 * @param {{ winsRequired?: unknown, requireFinishReason?: boolean }} [options]
 */
export function validateFinalsMatchResultInput(input, options = {}) {
  const winsRequired = resolveFinalsWinsRequired(options.winsRequired);
  const maxSets = resolveFinalsMaxSets(winsRequired);
  const sets = [];
  let team1SetWins = 0;
  let team2SetWins = 0;

  for (let setNumber = 1; setNumber <= maxSets; setNumber += 1) {
    if (team1SetWins >= winsRequired || team2SetWins >= winsRequired) {
      if (hasSetScoreInput(input, setNumber)) {
        return {
          valid: false,
          message: `勝敗確定後の第${setNumber}セットは入力しないでください。`,
        };
      }
      break;
    }

    const fields = getFinalsSetScoreFieldNames(setNumber);
    const finishReason = readFinishReasonFromInput(input, setNumber);
    const setResult = validateFinalsSetScores(
      input?.[fields.team1],
      input?.[fields.team2],
      `第${setNumber}セット`,
      {
        finishReason,
        requireFinishReason: options.requireFinishReason,
      }
    );
    if (!setResult.valid) {
      return setResult;
    }

    sets.push({ setNumber, ...setResult.data });
    if (setResult.data.winner === "team1") {
      team1SetWins += 1;
    } else {
      team2SetWins += 1;
    }
  }

  if (team1SetWins === winsRequired || team2SetWins === winsRequired) {
    return {
      valid: true,
      data: {
        sets,
        team1SetWins,
        team2SetWins,
        winnerSide: team1SetWins === winsRequired ? "team1" : "team2",
        winsRequired,
      },
    };
  }

  return {
    valid: false,
    message: `${formatFinalsWinsRequiredLabel(winsRequired)}の勝者が決まる結果を入力してください。`,
  };
}

/**
 * 入力状況から表示すべきセット数を算出（勝敗確定後は増やさない）
 * @param {object} input
 * @param {{ winsRequired?: unknown }} [options]
 */
export function resolveVisibleFinalsSetCount(input, options = {}) {
  const winsRequired = resolveFinalsWinsRequired(options.winsRequired);
  const maxSets = resolveFinalsMaxSets(winsRequired);
  let team1Wins = 0;
  let team2Wins = 0;
  let completed = 0;

  for (let setNumber = 1; setNumber <= maxSets; setNumber += 1) {
    const fields = getFinalsSetScoreFieldNames(setNumber);
    const setResult = validateFinalsSetScores(
      input?.[fields.team1],
      input?.[fields.team2],
      `第${setNumber}セット`,
      {
        finishReason: readFinishReasonFromInput(input, setNumber),
        requireFinishReason: false,
      }
    );
    if (!setResult.valid) {
      break;
    }
    completed = setNumber;
    if (setResult.data.winner === "team1") {
      team1Wins += 1;
    } else {
      team2Wins += 1;
    }
    if (team1Wins >= winsRequired || team2Wins >= winsRequired) {
      return completed;
    }
  }

  // 初期表示は winsRequired セット。途中経過がある場合は次セットまで広げる。
  let visible = completed === 0 ? winsRequired : Math.min(maxSets, completed + 1);
  visible = Math.max(visible, winsRequired);

  for (let setNumber = visible + 1; setNumber <= maxSets; setNumber += 1) {
    if (hasSetScoreInput(input, setNumber)) {
      visible = setNumber;
    }
  }

  return Math.min(maxSets, visible);
}

/**
 * 互換: 2先で第3セットが必要なとき true
 * @param {object} input
 * @param {{ winsRequired?: unknown }} [options]
 */
export function needsFinalsSet3Input(input, options = {}) {
  const winsRequired = resolveFinalsWinsRequired(options.winsRequired ?? 2);
  if (winsRequired !== 2) {
    return resolveVisibleFinalsSetCount(input, { winsRequired }) >= 3;
  }
  return resolveVisibleFinalsSetCount(input, { winsRequired: 2 }) >= 3;
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
    if (!Number.isInteger(set.setNumber) || set.setNumber < 1) {
      continue;
    }
    const fields = getFinalsSetScoreFieldNames(set.setNumber);
    values[fields.team1] = set.team1Score;
    values[fields.team2] = set.team2Score;
    values[getSetFinishReasonFieldName(set.setNumber)] = inferSetFinishReasonForEdit(set);
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
    .map((set) => {
      const reasonLabel = formatSetFinishReasonLabel(set.finishReason);
      return {
        setNumber: set.setNumber,
        label: `第${set.setNumber}セット`,
        scoreLine: reasonLabel
          ? `${set.team1Score} - ${set.team2Score}（${reasonLabel}）`
          : `${set.team1Score} - ${set.team2Score}`,
        winnerLabel: set.winner === "team1" ? "チーム1" : "チーム2",
        finishReason: set.finishReason ?? null,
      };
    });

  return {
    sets,
    team1SetWins: result.team1SetWins ?? 0,
    team2SetWins: result.team2SetWins ?? 0,
    isBye: false,
  };
}
