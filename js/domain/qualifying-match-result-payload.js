/**
 * 予選試合結果ペイロード構築（DOM / Firestore 非依存）
 */
import { MatchResultStatus } from "./constants.js";
import { validateMatchResultInput } from "./qualifying-match-result.js";

/**
 * @param {string} matchId
 * @param {object} scheduleMatch
 * @param {{ sets: object[], team1Stats: object, team2Stats: object }} validatedData
 */
export function buildQualifyingMatchResultPayload(matchId, scheduleMatch, validatedData) {
  const { sets, team1Stats, team2Stats } = validatedData;

  return {
    matchId,
    blockId: scheduleMatch.blockId,
    roundNumber: scheduleMatch.roundNumber,
    courtNumber: scheduleMatch.courtNumber,
    team1: {
      entryId: scheduleMatch.team1.entryId,
      teamName: scheduleMatch.team1.teamName,
    },
    team2: {
      entryId: scheduleMatch.team2.entryId,
      teamName: scheduleMatch.team2.teamName,
    },
    sets,
    team1Stats,
    team2Stats,
    status: MatchResultStatus.FINISHED,
  };
}

/**
 * @param {string} matchId
 * @param {object} scheduleMatch
 * @param {object} input
 */
export function buildValidatedQualifyingMatchResultPayload(matchId, scheduleMatch, input) {
  const validation = validateMatchResultInput(input);
  if (!validation.valid) {
    const error = new Error(validation.message);
    error.code = "qualifying-match-result/invalid-input";
    throw error;
  }
  return buildQualifyingMatchResultPayload(matchId, scheduleMatch, validation.data);
}
