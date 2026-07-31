/**
 * 複数チーム形式の最終順位・途中敗退集計
 */
import { MatchFormat } from "./aggregate-match-format.js";

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

  const finalMatch = matches.find((m) => m.isFinal) || matches.sort((a, b) => b.roundNumber - a.roundNumber)[0];
  const finalResult = finalMatch ? getResult(finalMatch.matchId) : null;

  if (finalResult?.rankingEntryIds?.length) {
    finalResult.rankingEntryIds.forEach((entryId, index) => {
      const row = ensure(entryId);
      row.rank = index + 1;
      if (index === 0) row.placementLabel = "優勝";
      else if (index === 1) row.placementLabel = "準優勝";
      else if (index === 2) row.placementLabel = "3位";
      else if (index === 3) row.placementLabel = "4位";
      else row.placementLabel = `${index + 1}位`;
    });
  }

  // 途中敗退: 非進出者
  const maxRound = Math.max(0, ...matches.map((m) => m.roundNumber || 0));
  for (const match of matches) {
    if (match.isFinal) continue;
    const result = getResult(match.matchId);
    if (!result?.rankingEntryIds || !result?.qualifierEntryIds) continue;
    const qualifierSet = new Set(result.qualifierEntryIds);
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
