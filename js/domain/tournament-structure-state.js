/**
 * 大会構造（ブロック抽選以降）の存在判定（DOM / Firestore 非依存）
 */

/**
 * @param {{
 *   blockDraw?: object|null,
 *   qualifyingSchedule?: object|null,
 *   finalsAdvancement?: object|null,
 *   finalsBracket?: object|null,
 *   finalsMatchResultsCount?: number,
 *   tournamentResults?: object|null,
 * }} params
 */
export function buildTournamentStructureState({
  blockDraw = null,
  qualifyingSchedule = null,
  finalsAdvancement = null,
  finalsBracket = null,
  finalsMatchResultsCount = 0,
  tournamentResults = null,
} = {}) {
  const flags = {
    hasBlockDraw: Boolean(blockDraw),
    hasQualifyingSchedule: Boolean(qualifyingSchedule),
    hasFinalsAdvancement: Boolean(finalsAdvancement),
    hasFinalsBracket: Boolean(finalsBracket),
    hasFinalsMatchResults: finalsMatchResultsCount > 0,
    hasTournamentResults: Boolean(tournamentResults),
  };

  const hasStructure = Object.values(flags).some(Boolean);

  return {
    ...flags,
    hasStructure,
  };
}

/**
 * ダミー参加者の追加・削除を拒否する構造作成済み判定
 * @param {ReturnType<typeof buildTournamentStructureState>} structureState
 */
export function isDummyEntryMutationBlocked(structureState) {
  return structureState?.hasStructure === true;
}
