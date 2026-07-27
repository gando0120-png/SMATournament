/**
 * 大会構造（ブロック抽選以降）の存在判定（DOM / Firestore 非依存）
 *
 * finalsMatchResults は client 側で件数確認するが、Firestore Rules では
 * コレクション内 1 件以上の存在判定を安全に行わない。
 * finalsBracket/current 作成済みならロックされ、通常フローでは
 * finalsMatchResults が bracket なしで単独存在しない前提とする。
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
