/**
 * 予選試合結果の自動生成（E2E テスト支援・DOM / Firestore 非依存）
 */
import { SET_WINNING_SCORE } from "./constants.js";
import { buildScheduleMatchIndex, validateMatchResultInput } from "./qualifying-match-result.js";
import { seededUnitRandom } from "./seeded-random.js";

export const QualifyingSimulationMode = {
  STANDARD: "standard",
  INCLUDE_DRAWS: "include-draws",
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
    strengthCache.set(entryId, seededUnitRandom(simulationSeed, `strength:${entryId}`) * 100);
  }
  return strengthCache.get(entryId);
}

/**
 * @param {object} params
 */
function generateSetScores({
  matchId,
  setNumber,
  team1Strength,
  team2Strength,
  simulationSeed,
  mode,
  allowUpset = false,
}) {
  const drawRoll = seededUnitRandom(simulationSeed, `${matchId}:set${setNumber}:draw`);
  if (mode === QualifyingSimulationMode.INCLUDE_DRAWS && drawRoll < 0.12) {
    const scoreRoll = seededUnitRandom(simulationSeed, `${matchId}:set${setNumber}:drawScore`);
    const drawScore = 10 + Math.floor(scoreRoll * 39);
    return { team1Score: drawScore, team2Score: drawScore };
  }

  const noise1 = seededUnitRandom(simulationSeed, `${matchId}:set${setNumber}:n1`);
  const noise2 = seededUnitRandom(simulationSeed, `${matchId}:set${setNumber}:n2`);
  let effective1 = team1Strength + (noise1 - 0.5) * 40;
  let effective2 = team2Strength + (noise2 - 0.5) * 40;

  if (allowUpset) {
    const upsetRoll = seededUnitRandom(simulationSeed, `${matchId}:set${setNumber}:upset`);
    if (upsetRoll < 0.2) {
      const swapped1 = effective2;
      effective2 = effective1;
      effective1 = swapped1;
    }
  }

  const loserRoll = seededUnitRandom(simulationSeed, `${matchId}:set${setNumber}:loser`);
  const loserScore = Math.min(49, 10 + Math.floor(loserRoll * 35));

  if (effective1 >= effective2) {
    return { team1Score: SET_WINNING_SCORE, team2Score: loserScore };
  }
  return { team1Score: loserScore, team2Score: SET_WINNING_SCORE };
}

/**
 * @param {object} params
 */
export function generateMatchResultInput({
  matchId,
  scheduleMatch,
  simulationSeed,
  mode = QualifyingSimulationMode.STANDARD,
  strengthCache = new Map(),
}) {
  const team1Strength = getTeamStrength(scheduleMatch.team1?.entryId, simulationSeed, strengthCache);
  const team2Strength = getTeamStrength(scheduleMatch.team2?.entryId, simulationSeed, strengthCache);

  const set1 = generateSetScores({
    matchId,
    setNumber: 1,
    team1Strength,
    team2Strength,
    simulationSeed,
    mode,
    allowUpset: false,
  });
  const set2 = generateSetScores({
    matchId,
    setNumber: 2,
    team1Strength,
    team2Strength,
    simulationSeed,
    mode,
    allowUpset: mode === QualifyingSimulationMode.STANDARD,
  });

  return {
    set1Team1Score: set1.team1Score,
    set1Team2Score: set1.team2Score,
    set2Team1Score: set2.team1Score,
    set2Team2Score: set2.team2Score,
  };
}

/**
 * @param {object|null|undefined} persistedSchedule
 * @param {string|number} simulationSeed
 * @param {string} [mode]
 */
export function generateQualifyingMatchResults({
  schedule,
  simulationSeed,
  mode = QualifyingSimulationMode.STANDARD,
}) {
  const matchIndex = buildScheduleMatchIndex(schedule);
  const strengthCache = new Map();
  const generated = new Map();
  const errors = [];

  for (const [matchId, scheduleMatch] of matchIndex) {
    if (!scheduleMatch.team1?.entryId || !scheduleMatch.team2?.entryId) {
      continue;
    }

    const input = generateMatchResultInput({
      matchId,
      scheduleMatch,
      simulationSeed,
      mode,
      strengthCache,
    });
    const validation = validateMatchResultInput(input);
    if (!validation.valid) {
      errors.push({ matchId, message: validation.message });
      continue;
    }

    generated.set(matchId, {
      input,
      validated: validation.data,
      scheduleMatch,
    });
  }

  return {
    results: generated,
    errors,
    matchCount: matchIndex.size,
    strengthCache,
  };
}
