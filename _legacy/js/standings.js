/**
 * SMATournament — 順位表計算
 */
(function () {
  function createRow(team) {
    return {
      teamId: team.id,
      teamName: team.name,
      played: 0,
      wins: 0,
      losses: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      pointDiff: 0,
      winRate: 0,
    };
  }

  function applyMatchResult(rowsById, match, teamA, teamB) {
    if (match.status !== "completed") return;
    if (match.scoreA === null || match.scoreB === null) return;
    if (!match.winnerId) return;

    const rowA = rowsById.get(match.teamAId);
    const rowB = rowsById.get(match.teamBId);
    if (!rowA || !rowB) return;

    rowA.played += 1;
    rowB.played += 1;
    rowA.pointsFor += match.scoreA;
    rowA.pointsAgainst += match.scoreB;
    rowB.pointsFor += match.scoreB;
    rowB.pointsAgainst += match.scoreA;

    if (match.winnerId === match.teamAId) {
      rowA.wins += 1;
      rowB.losses += 1;
    } else if (match.winnerId === match.teamBId) {
      rowB.wins += 1;
      rowA.losses += 1;
    }
  }

  function finalizeRows(rows) {
    rows.forEach((row) => {
      row.pointDiff = row.pointsFor - row.pointsAgainst;
      row.winRate = row.played > 0 ? row.wins / row.played : 0;
    });

    rows.sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins;
      if (b.pointDiff !== a.pointDiff) return b.pointDiff - a.pointDiff;
      if (b.pointsFor !== a.pointsFor) return b.pointsFor - a.pointsFor;
      return a.teamName.localeCompare(b.teamName, "ja");
    });

    return rows.map((row, index) => ({
      ...row,
      rank: index + 1,
      winRateText: row.played > 0 ? `${Math.round(row.winRate * 1000) / 10}%` : "—",
    }));
  }

  function calculateStandingsForMatches(state, matchIds, teamIds) {
    const teamSet = new Set(teamIds);
    const filteredTeams = state.teams.filter((team) => teamSet.has(team.id));
    const matchSet = new Set(matchIds);

    const rows = filteredTeams.map(createRow);
    const rowsById = new Map(rows.map((row) => [row.teamId, row]));

    state.matches
      .filter((match) => matchSet.has(match.id))
      .forEach((match) => applyMatchResult(rowsById, match));

    return finalizeRows(rows);
  }

  function calculateStandings(state) {
    return calculateStandingsForMatches(
      state,
      state.matches.map((match) => match.id),
      state.teams.map((team) => team.id)
    );
  }

  window.SMATournamentStandings = {
    calculateStandings,
    calculateStandingsForMatches,
  };
})();
