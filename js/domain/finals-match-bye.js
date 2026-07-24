/**
 * 決勝 BYE 判定ヘルパー
 *
 * - 第1ラウンドの isBye: true スロットのみ BYE
 * - team が null / 未設定 → 第2ラウンド以降の feeder 結果待ち（BYE ではない）
 */

/**
 * feeder 未確定（後続ラウンドの空き枠）
 * @param {object|null|undefined} team
 */
export function isPendingTeam(team) {
  return team == null;
}

/**
 * 第1ラウンドの明示的 BYE スロット
 * @param {object|null|undefined} team
 */
export function isByeTeam(team) {
  return Boolean(team && team.isBye === true);
}

/**
 * 第1ラウンド向け: 片側のみ BYE
 * @param {object|null|undefined} team1
 * @param {object|null|undefined} team2
 */
export function isSingleByeMatch(team1, team2) {
  const team1Bye = isByeTeam(team1);
  const team2Bye = isByeTeam(team2);
  return (team1Bye && !team2Bye) || (!team1Bye && team2Bye);
}

/**
 * 第1ラウンド向け: 両側 BYE（不正構造）
 * @param {object|null|undefined} team1
 * @param {object|null|undefined} team2
 */
export function isDoubleByeMatch(team1, team2) {
  return isByeTeam(team1) && isByeTeam(team2);
}

/**
 * @param {object|null|undefined} team1
 * @param {object|null|undefined} team2
 */
export function getByeWinnerTeam(team1, team2) {
  if (!isByeTeam(team1) && team1?.entryId) {
    return {
      entryId: team1.entryId,
      teamName: team1.teamName,
      seed: team1.seed ?? null,
    };
  }
  if (!isByeTeam(team2) && team2?.entryId) {
    return {
      entryId: team2.entryId,
      teamName: team2.teamName,
      seed: team2.seed ?? null,
    };
  }
  return null;
}
