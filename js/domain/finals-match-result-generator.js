/**
 * 決勝試合結果の自動生成（E2E テスト支援・DOM / Firestore 非依存）
 */
import { SET_WINNING_SCORE } from "./constants.js";
import {
  getFinalsSetScoreFieldNames,
  resolveFinalsMaxSets,
  resolveFinalsWinsRequired,
} from "./finals-match-format.js";
import { validateFinalsMatchResultInput } from "./finals-match-result.js";
import { seededUnitRandom } from "./seeded-random.js";

export const FinalsSimulationMode = {
  STANDARD: "standard",
  CLOSE: "close",
};

/**
 * @param {string} entryId
 * @param {string|number} simulationSeed
 * @param {Map<string, number>} strengthCache
 */
function getTeamStrength(entryId, simulationSeed, strengthCache) {
  if (!entryId) {
    return 50;
  }
  if (!strengthCache.has(entryId)) {
    strengthCache.set(
      entryId,
      seededUnitRandom(simulationSeed, `finals:strength:${entryId}`) * 100
    );
  }
  return strengthCache.get(entryId);
}

/**
 * @param {object} params
 */
function buildWinningSetScores({ matchId, setNumber, winnerSide, simulationSeed }) {
  const loserRoll = seededUnitRandom(simulationSeed, `finals:${matchId}:set${setNumber}:loser`);
  const loserScore = Math.min(49, 10 + Math.floor(loserRoll * 35));
  const fields = getFinalsSetScoreFieldNames(setNumber);
  if (winnerSide === "team1") {
    return { [fields.team1]: SET_WINNING_SCORE, [fields.team2]: loserScore };
  }
  return { [fields.team1]: loserScore, [fields.team2]: SET_WINNING_SCORE };
}

/**
 * @param {object} params
 */
export function generateFinalsMatchResultInput({
  matchId,
  team1,
  team2,
  simulationSeed,
  mode = FinalsSimulationMode.STANDARD,
  strengthCache = new Map(),
  winsRequired: winsRequiredInput = 2,
}) {
  const winsRequired = resolveFinalsWinsRequired(winsRequiredInput);
  const maxSets = resolveFinalsMaxSets(winsRequired);
  const team1Strength = getTeamStrength(team1?.entryId, simulationSeed, strengthCache);
  const team2Strength = getTeamStrength(team2?.entryId, simulationSeed, strengthCache);

  const noise1 = seededUnitRandom(simulationSeed, `finals:${matchId}:noise1`);
  const noise2 = seededUnitRandom(simulationSeed, `finals:${matchId}:noise2`);
  const effective1 = team1Strength + (noise1 - 0.5) * 40;
  const effective2 = team2Strength + (noise2 - 0.5) * 40;
  const favorite = effective1 >= effective2 ? "team1" : "team2";

  const closeMatch =
    mode === FinalsSimulationMode.CLOSE ||
    (mode === FinalsSimulationMode.STANDARD &&
      seededUnitRandom(simulationSeed, `finals:${matchId}:close`) < 0.35);

  const input = {};
  let team1Wins = 0;
  let team2Wins = 0;

  for (let setNumber = 1; setNumber <= maxSets; setNumber += 1) {
    if (team1Wins >= winsRequired || team2Wins >= winsRequired) {
      break;
    }

    let winnerSide;
    if (closeMatch) {
      // 最終セット以外は交互寄り、最終セットは本命
      const remainingForFavorite = winsRequired - (favorite === "team1" ? team1Wins : team2Wins);
      const setsLeftIncludingCurrent = maxSets - setNumber + 1;
      if (remainingForFavorite >= setsLeftIncludingCurrent) {
        winnerSide = favorite;
      } else if (team1Wins === winsRequired - 1 && team2Wins === winsRequired - 1) {
        winnerSide = favorite;
      } else if (setNumber % 2 === 1) {
        winnerSide = favorite;
      } else {
        winnerSide = favorite === "team1" ? "team2" : "team1";
      }
    } else {
      const upset =
        seededUnitRandom(simulationSeed, `finals:${matchId}:set${setNumber}:upset`) < 0.25;
      winnerSide = upset ? (favorite === "team1" ? "team2" : "team1") : favorite;
      // 早めに決着するよう、必要以上に引き延ばさない
      if (
        setNumber >= winsRequired &&
        (team1Wins === winsRequired - 1 || team2Wins === winsRequired - 1)
      ) {
        const leader = team1Wins > team2Wins ? "team1" : team2Wins > team1Wins ? "team2" : favorite;
        winnerSide = leader;
      }
    }

    Object.assign(
      input,
      buildWinningSetScores({
        matchId,
        setNumber,
        winnerSide,
        simulationSeed,
      })
    );

    if (winnerSide === "team1") {
      team1Wins += 1;
    } else {
      team2Wins += 1;
    }
  }

  return input;
}

/**
 * @param {object} params
 */
export function generateValidatedFinalsMatchResult({
  matchId,
  team1,
  team2,
  simulationSeed,
  mode = FinalsSimulationMode.STANDARD,
  strengthCache = new Map(),
  winsRequired = 2,
}) {
  const input = generateFinalsMatchResultInput({
    matchId,
    team1,
    team2,
    simulationSeed,
    mode,
    strengthCache,
    winsRequired,
  });
  const validation = validateFinalsMatchResultInput(input, { winsRequired });
  if (!validation.valid) {
    return { valid: false, message: validation.message, input: null, validated: null };
  }
  return { valid: true, message: null, input, validated: validation.data };
}
