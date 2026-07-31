/**
 * 複数チーム形式の最終順位・途中敗退集計
 */
import { MatchFormat } from "./aggregate-match-format.js";
import { isMultiTeamFinalMatch } from "./multi-team-bracket.js";

/**
 * @param {number} rank 1-based
 */
export function getMultiTeamFinalPlacementLabel(rank) {
  if (rank === 1) return "優勝";
  if (rank === 2) return "準優勝";
  if (rank === 3) return "3位";
  if (rank === 4) return "4位";
  if (Number.isInteger(rank) && rank >= 1) return `${rank}位`;
  return null;
}

/**
 * @param {object} params
 * @param {object} params.bracket
 * @param {Map<string, object>|Record<string, object>} params.resultsByMatchId
 * @returns {{ placements: object[], champion: object|null, runnerUp: object|null }}
 */
export function buildMultiTeamPlacements({ bracket, resultsByMatchId } = {}) {
  const getResult = (matchId) => {
    if (!resultsByMatchId) return null;
    if (resultsByMatchId instanceof Map) return resultsByMatchId.get(matchId);
    return resultsByMatchId[matchId];
  };

  const matches = (bracket?.matches || []).filter(
    (m) => m.matchFormat === MatchFormat.MULTI_TEAM_TOTAL || Array.isArray(m.participantEntryIds)
  );

  /** @type {Map<string, { entryId: string, teamName: string|null, eliminatedRound: number|null, placementLabel: string|null, rank: number|null }>} */
  const byEntry = new Map();

  function ensure(entryId, teamName = null) {
    if (!byEntry.has(entryId)) {
      byEntry.set(entryId, {
        entryId,
        teamName,
        eliminatedRound: null,
        placementLabel: null,
        rank: null,
      });
    }
    const row = byEntry.get(entryId);
    if (teamName && !row.teamName) row.teamName = teamName;
    return row;
  }

  for (const match of matches) {
    for (const p of match.participants || []) {
      if (p?.entryId) ensure(p.entryId, p.teamName);
    }
  }

  // 構造上の最終試合（最大 roundNumber）。古い isFinal フラグだけには依存しない。
  const finalMatch =
    matches.find((m) => isMultiTeamFinalMatch(m, bracket)) ||
    matches.find((m) => m.isFinal) ||
    [...matches].sort((a, b) => (b.roundNumber || 0) - (a.roundNumber || 0))[0] ||
    null;
  const finalResult = finalMatch ? getResult(finalMatch.matchId) : null;

  if (finalResult?.rankingEntryIds?.length) {
    finalResult.rankingEntryIds.forEach((entryId, index) => {
      const row = ensure(entryId);
      row.rank = index + 1;
      row.placementLabel = getMultiTeamFinalPlacementLabel(index + 1);
    });
  }

  // 途中敗退: 中間ラウンドの非進出者のみ（最終ラウンドの qualifierEntryIds は無視）
  const maxRound = Math.max(0, ...matches.map((m) => m.roundNumber || 0));
  for (const match of matches) {
    if (isMultiTeamFinalMatch(match, bracket)) continue;
    const result = getResult(match.matchId);
    if (!result?.rankingEntryIds?.length) continue;
    const qualifierIds = Array.isArray(result.qualifierEntryIds)
      ? result.qualifierEntryIds
      : result.rankingEntryIds.slice(0, match.qualifiersCount || 0);
    if (!qualifierIds.length) continue;
    const qualifierSet = new Set(qualifierIds);
    const eliminated = result.rankingEntryIds.filter((id) => !qualifierSet.has(id));
    const teamsInRound = estimateTeamsInRound(match.roundNumber, maxRound, matches);
    const label = teamsInRound ? `ベスト${teamsInRound}` : `ラウンド${match.roundNumber}敗退`;
    for (const entryId of eliminated) {
      const row = ensure(entryId);
      if (row.rank != null) continue;
      row.eliminatedRound = match.roundNumber;
      row.placementLabel = label;
    }
  }

  const placements = [...byEntry.values()].sort((a, b) => {
    if (a.rank != null && b.rank != null) return a.rank - b.rank;
    if (a.rank != null) return -1;
    if (b.rank != null) return 1;
    return (b.eliminatedRound ?? 0) - (a.eliminatedRound ?? 0);
  });

  const champion = placements.find((p) => p.rank === 1) || null;
  const runnerUp = placements.find((p) => p.rank === 2) || null;

  return { placements, champion, runnerUp };
}

/**
 * @param {number} roundNumber
 * @param {number} maxRound
 * @param {object[]} matches
 */
function estimateTeamsInRound(roundNumber, maxRound, matches) {
  const roundMatches = matches.filter((m) => m.roundNumber === roundNumber);
  const participants = roundMatches.reduce(
    (sum, m) => sum + (m.participants?.length || m.participantEntryIds?.length || 0),
    0
  );
  if (participants >= 2) {
    // 次の2の冪へ丸め表示（ベスト8等）
    let pow = 2;
    while (pow < participants) pow *= 2;
    return pow;
  }
  return null;
}
