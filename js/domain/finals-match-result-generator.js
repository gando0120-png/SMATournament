/**
 * 決勝試合結果の自動生成（E2E テスト支援・DOM / Firestore 非依存）
 */
import { SET_WINNING_SCORE } from "./constants.js";
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
  if (winnerSide === "team1") {
    return { set1Team1Score: SET_WINNING_SCORE, set1Team2Score: loserScore };
  }
  return { set1Team1Score: loserScore, set1Team2Score: SET_WINNING_SCORE };
}

/**
 * @param {"team1"|"team2"} winnerSide
 * @param {number} setNumber
 */
function mapWinnerSetScores(winnerSide, setNumber, scores) {
  if (setNumber === 1) {
    return scores;
  }
  if (setNumber === 2) {
    return {
      set2Team1Score: scores.set1Team1Score,
      set2Team2Score: scores.set1Team2Score,
    };
  }
  return {
    set3Team1Score: scores.set1Team1Score,
    set3Team2Score: scores.set1Team2Score,
  };
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
}) {
  const team1Strength = getTeamStrength(team1?.entryId, simulationSeed, strengthCache);
  const team2Strength = getTeamStrength(team2?.entryId, simulationSeed, strengthCache);

  const noise1 = seededUnitRandom(simulationSeed, `finals:${matchId}:noise1`);
  const noise2 = seededUnitRandom(simulationSeed, `finals:${matchId}:noise2`);
  let effective1 = team1Strength + (noise1 - 0.5) * 40;
  let effective2 = team2Strength + (noise2 - 0.5) * 40;

  const closeMatch =
    mode === FinalsSimulationMode.CLOSE ||
    (mode === FinalsSimulationMode.STANDARD &&
      seededUnitRandom(simulationSeed, `finals:${matchId}:close`) < 0.35);

  const input = {};

  if (closeMatch) {
    const set1Winner = effective1 >= effective2 ? "team1" : "team2";
    const set2Winner = set1Winner === "team1" ? "team2" : "team1";
    const set3Winner = effective1 >= effective2 ? "team1" : "team2";

    Object.assign(
      input,
      mapWinnerSetScores(set1Winner, 1, buildWinningSetScores({
        matchId,
        setNumber: 1,
        winnerSide: set1Winner,
        simulationSeed,
      }))
    );
    Object.assign(
      input,
      mapWinnerSetScores(set2Winner, 2, buildWinningSetScores({
        matchId,
        setNumber: 2,
        winnerSide: set2Winner,
        simulationSeed,
      }))
    );
    Object.assign(
      input,
      mapWinnerSetScores(set3Winner, 3, buildWinningSetScores({
        matchId,
        setNumber: 3,
        winnerSide: set3Winner,
        simulationSeed,
      }))
    );
    return input;
  }

  const set1Winner = effective1 >= effective2 ? "team1" : "team2";
  const set2Winner =
    seededUnitRandom(simulationSeed, `finals:${matchId}:set2`) < 0.25
      ? set1Winner === "team1"
        ? "team2"
        : "team1"
      : set1Winner;

  Object.assign(
    input,
    mapWinnerSetScores(set1Winner, 1, buildWinningSetScores({
      matchId,
      setNumber: 1,
      winnerSide: set1Winner,
      simulationSeed,
    }))
  );
  Object.assign(
    input,
    mapWinnerSetScores(set2Winner, 2, buildWinningSetScores({
      matchId,
      setNumber: 2,
      winnerSide: set2Winner,
      simulationSeed,
    }))
  );

  if (set2Winner !== set1Winner) {
    const set3Winner = effective1 >= effective2 ? "team1" : "team2";
    Object.assign(
      input,
      mapWinnerSetScores(set3Winner, 3, buildWinningSetScores({
        matchId,
        setNumber: 3,
        winnerSide: set3Winner,
        simulationSeed,
      }))
    );
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
}) {
  const input = generateFinalsMatchResultInput({
    matchId,
    team1,
    team2,
    simulationSeed,
    mode,
    strengthCache,
  });
  const validation = validateFinalsMatchResultInput(input);
  if (!validation.valid) {
    return { valid: false, message: validation.message, input: null, validated: null };
  }
  return { valid: true, message: null, input, validated: validation.data };
}
