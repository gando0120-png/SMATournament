/**
 * SMATournament — 対戦表ビュー描画
 */
(function () {
  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function getTeamName(state, teamId) {
    if (!teamId) return null;
    return window.SMATournamentModels.getTeamById(state, teamId)?.name ?? null;
  }

  function formatMatchStatus(match) {
    if (match.status === "completed") return { label: "終了", className: "badge--done" };
    return { label: "未開始", className: "badge--pending" };
  }

  function renderMatchLine(state, match) {
    const teamA = getTeamName(state, match.teamAId) ?? "未定";
    const teamB = getTeamName(state, match.teamBId) ?? "未定";
    const status = formatMatchStatus(match);
    const score =
      match.status === "completed" && match.scoreA !== null
        ? ` <span class="match-score">(${match.scoreA}-${match.scoreB})</span>`
        : "";

    return `<li class="match-line"><span class="match-line__teams">${escapeHtml(teamA)} vs ${escapeHtml(teamB)}${score}</span><span class="badge ${status.className}">${status.label}</span></li>`;
  }

  function renderBlocksView(state) {
    if (!state.blocks.length) {
      return `<p class="view-empty">ブロック情報がありません。</p>`;
    }

    return `
      <div class="block-grid">
        ${state.blocks
          .map((block) => {
            const rows = window.SMATournamentStandings.calculateStandingsForMatches(
              state,
              block.matchIds,
              block.teamIds
            );
            const blockMatches = state.matches.filter((match) => block.matchIds.includes(match.id));

            return `
              <article class="block-card">
                <header class="block-card__header">
                  <h3 class="block-card__title">${escapeHtml(block.name)}</h3>
                  <p class="block-card__meta">決勝進出 ${block.qualifyingCount} チーム</p>
                </header>
                <section class="block-card__section">
                  <h4 class="block-card__subtitle">順位</h4>
                  <ol class="block-standings">
                    ${rows
                      .map((row) => {
                        const qualified = row.rank <= block.qualifyingCount;
                        return `
                          <li class="block-standings__item${qualified ? " block-standings__item--qualified" : ""}">
                            <span class="block-standings__rank">${row.rank}位</span>
                            <span class="block-standings__name">${escapeHtml(row.teamName)}</span>
                            <span class="block-standings__record">${row.wins}勝${row.losses}敗</span>
                            <span class="block-standings__diff">${row.pointDiff >= 0 ? "+" : ""}${row.pointDiff}</span>
                          </li>
                        `;
                      })
                      .join("")}
                  </ol>
                </section>
                <section class="block-card__section">
                  <h4 class="block-card__subtitle">対戦</h4>
                  <ul class="match-lines">${blockMatches.map((match) => renderMatchLine(state, match)).join("")}</ul>
                </section>
              </article>
            `;
          })
          .join("")}
      </div>
    `;
  }

  function renderSlotTeam(state, slot, side, match) {
    const teamId = side === "a" ? slot.teamAId : slot.teamBId;
    const isBye = side === "a" ? slot.teamAIsBye : slot.teamBIsBye;
    const name = isBye ? "BYE" : getTeamName(state, teamId) ?? "未定";
    const isWinner = match?.winnerId === teamId && teamId;
    const classes = ["bracket-team", isWinner ? "bracket-team--winner" : "", isBye ? "bracket-team--bye" : ""]
      .filter(Boolean)
      .join(" ");

    return `<div class="${classes}">${escapeHtml(name)}</div>`;
  }

  function renderKnockoutView(state) {
    if (!state.knockout) {
      return `<p class="view-empty">トーナメント情報がありません。</p>`;
    }

    window.SMATournamentBracket.syncBracketFromMatches(state);

    const { size, slots } = state.knockout;
    const rounds = Math.log2(size);
    const championId = window.SMATournamentBracket.getChampion(state);
    const championName = getTeamName(state, championId) ?? "—";

    const columns = Array.from({ length: rounds }, (_, roundIndex) => {
      const roundSlots = slots.filter((slot) => slot.roundIndex === roundIndex);
      const label = window.SMATournamentBracket.roundLabel(size, roundIndex);

      return `
        <div class="bracket-column">
          <h3 class="bracket-column__title">${escapeHtml(label)}</h3>
          <div class="bracket-column__matches">
            ${roundSlots
              .map((slot) => {
                const match = state.matches.find((item) => item.bracketMatchId === slot.id);
                const status = match ? formatMatchStatus(match) : { label: "未定", className: "badge--pending" };

                return `
                  <div class="bracket-match" data-slot-id="${slot.id}">
                    ${renderSlotTeam(state, slot, "a", match)}
                    ${renderSlotTeam(state, slot, "b", match)}
                    <span class="badge ${status.className} bracket-match__status">${status.label}</span>
                  </div>
                `;
              })
              .join("")}
          </div>
        </div>
      `;
    }).join("");

    return `
      <div class="bracket-scroll">
        <div class="bracket-board">${columns}</div>
      </div>
      <div class="bracket-champion">
        <span class="bracket-champion__label">優勝</span>
        <span class="bracket-champion__name">${escapeHtml(championName)}</span>
      </div>
    `;
  }

  function getWaitingTeams(state, roundMatches) {
    const playing = new Set();
    roundMatches.forEach((match) => {
      if (match.teamAId) playing.add(match.teamAId);
      if (match.teamBId) playing.add(match.teamBId);
    });

    const teamMatchCounts = new Map(state.teams.map((team) => [team.id, 0]));
    state.matches.forEach((match) => {
      if (match.teamAId) teamMatchCounts.set(match.teamAId, (teamMatchCounts.get(match.teamAId) ?? 0) + 1);
      if (match.teamBId) teamMatchCounts.set(match.teamBId, (teamMatchCounts.get(match.teamBId) ?? 0) + 1);
    });

    const maxRound = Math.max(...state.matches.map((match) => match.round ?? 1), 1);

    return state.teams
      .filter((team) => !playing.has(team.id))
      .map((team) => team.name);
  }

  function getNextMatches(state) {
    const pending = state.matches.filter((match) => match.status !== "completed");
    return pending.slice(0, state.tournament.courtCount);
  }

  function renderOperationsView(state) {
    const rounds = new Map();
    state.matches.forEach((match) => {
      const round = match.round ?? 1;
      if (!rounds.has(round)) rounds.set(round, []);
      rounds.get(round).push(match);
    });

    const roundNumbers = [...rounds.keys()].sort((a, b) => a - b);
    const nextMatches = getNextMatches(state);

    return `
      <div class="ops-view">
        ${roundNumbers
          .map((round) => {
            const roundMatches = rounds.get(round).sort((a, b) => a.court - b.court);
            const waiting = getWaitingTeams(state, roundMatches);
            const allDone = roundMatches.every((match) => match.status === "completed");
            const roundStatus = allDone ? "終了" : roundMatches.some((m) => m.status === "completed") ? "進行中" : "未開始";

            return `
              <section class="ops-round">
                <header class="ops-round__header">
                  <h3 class="ops-round__title">第${round}ラウンド</h3>
                  <span class="badge ${allDone ? "badge--done" : "badge--pending"}">${roundStatus}</span>
                </header>
                <div class="ops-round__courts">
                  ${roundMatches
                    .map((match) => {
                      const teamA = getTeamName(state, match.teamAId) ?? "未定";
                      const teamB = getTeamName(state, match.teamBId) ?? "未定";
                      const status = formatMatchStatus(match);
                      return `
                        <div class="ops-court">
                          <span class="ops-court__label">コート ${match.court}</span>
                          <span class="ops-court__match">${escapeHtml(teamA)} vs ${escapeHtml(teamB)}</span>
                          <span class="badge ${status.className}">${status.label}</span>
                        </div>
                      `;
                    })
                    .join("")}
                </div>
                ${waiting.length ? `<p class="ops-round__waiting"><span>待機：</span>${waiting.map(escapeHtml).join("、")}</p>` : ""}
              </section>
            `;
          })
          .join("")}
        <section class="ops-next">
          <h3 class="ops-next__title">次の試合</h3>
          ${
            nextMatches.length
              ? `<ul class="match-lines">${nextMatches.map((match) => renderMatchLine(state, match)).join("")}</ul>`
              : `<p class="view-empty">すべての試合が終了しました。</p>`
          }
        </section>
      </div>
    `;
  }

  function renderListView(state) {
    return `
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>試合No.</th>
              <th>ラウンド</th>
              <th>コート</th>
              <th>対戦</th>
              <th>状態</th>
            </tr>
          </thead>
          <tbody>
            ${state.matches
              .map((match) => {
                const teamA = getTeamName(state, match.teamAId) ?? "未定";
                const teamB = getTeamName(state, match.teamBId) ?? "未定";
                const status = formatMatchStatus(match);
                return `
                  <tr>
                    <td>${match.matchNumber}</td>
                    <td>第${match.round ?? 1}R</td>
                    <td>コート ${match.court}</td>
                    <td>${escapeHtml(teamA)} <span class="vs">vs</span> ${escapeHtml(teamB)}</td>
                    <td><span class="badge ${status.className}">${status.label}</span></td>
                  </tr>
                `;
              })
              .join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderScheduleView(state, view) {
    switch (view) {
      case "blocks":
        return renderBlocksView(state);
      case "knockout":
        return renderKnockoutView(state);
      case "operations":
        return renderOperationsView(state);
      case "list":
      default:
        return renderListView(state);
    }
  }

  window.SMATournamentViews = {
    renderScheduleView,
    renderBlocksView,
    renderKnockoutView,
    renderOperationsView,
    renderListView,
  };
})();
