/**
 * SMATournament v0.2 — メインアプリ
 */
(function () {
  const STEPS = [
    { id: 1, label: "基本設定" },
    { id: 2, label: "チーム登録" },
    { id: 3, label: "対戦表" },
    { id: 4, label: "結果入力" },
    { id: 5, label: "順位表" },
  ];

  let state = window.SMATournamentModels.createEmptyState();

  const stepNavEl = document.getElementById("stepNav");
  const panels = {
    1: document.getElementById("step1Panel"),
    2: document.getElementById("step2Panel"),
    3: document.getElementById("step3Panel"),
    4: document.getElementById("step4Panel"),
    5: document.getElementById("step5Panel"),
  };

  const setupForm = document.getElementById("setupForm");
  const teamsForm = document.getElementById("teamsForm");
  const teamFieldsEl = document.getElementById("teamFields");
  const scheduleSummaryEl = document.getElementById("scheduleSummary");
  const scheduleViewTabsEl = document.getElementById("scheduleViewTabs");
  const scheduleViewEl = document.getElementById("scheduleView");
  const resultListEl = document.getElementById("resultList");
  const standingsBodyEl = document.getElementById("standingsBody");
  const tournamentFormatEl = document.getElementById("tournamentFormat");
  const blockCountFieldEl = document.getElementById("blockCountField");
  const matchesPerTeamFieldEl = document.getElementById("matchesPerTeamField");

  function persist() {
    window.SMATournamentStorage.save(state);
  }

  function getTeamName(teamId) {
    return window.SMATournamentModels.getTeamById(state, teamId)?.name ?? "—";
  }

  function showMessage(el, messages, visible) {
    if (!el) return;
    if (!visible || !messages.length) {
      el.hidden = true;
      el.innerHTML = "";
      return;
    }
    el.hidden = false;
    el.innerHTML = messages.map((msg) => `<p>${msg}</p>`).join("");
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function maybeFillKnockoutQualifiers() {
    if (state.tournament.format !== "blocks_and_knockout" || !state.knockout) return;

    const blockMatchesDone = state.blocks.every((block) =>
      block.matchIds.every((id) => state.matches.find((match) => match.id === id)?.status === "completed")
    );

    if (!blockMatchesDone) return;

    window.SMATournamentBracket.fillKnockoutFromBlockQualifiers(state);
  }

  function renderStepNav() {
    stepNavEl.innerHTML = STEPS.map((step) => {
      const active = step.id === state.currentStep ? " step-nav__item--active" : "";
      const done = step.id < state.currentStep ? " step-nav__item--done" : "";
      return `<button type="button" class="step-nav__item${active}${done}" data-step="${step.id}">${step.id}. ${step.label}</button>`;
    }).join("");

    stepNavEl.querySelectorAll(".step-nav__item").forEach((button) => {
      button.addEventListener("click", () => {
        const target = Number(button.dataset.step);
        if (target <= state.currentStep) goToStep(target);
      });
    });
  }

  function goToStep(step) {
    state.currentStep = step;
    Object.entries(panels).forEach(([id, panel]) => {
      panel.hidden = Number(id) !== step;
    });
    renderStepNav();
    persist();

    if (step === 2) renderTeamFields();
    if (step === 3) renderSchedule();
    if (step === 4) {
      maybeFillKnockoutQualifiers();
      renderResults();
    }
    if (step === 5) renderStandings();
  }

  function updateSetupFieldVisibility() {
    const format = tournamentFormatEl.value;
    const isBlocks = format === "blocks" || format === "blocks_and_knockout";
    const isKnockoutOnly = format === "knockout";

    blockCountFieldEl.hidden = !isBlocks;
    matchesPerTeamFieldEl.hidden = isKnockoutOnly;

    const note = document.getElementById("setupFormNote");
    if (isKnockoutOnly) {
      note.textContent = "※ トーナメント形式では 4 / 8 / 16 / 32 枠で BYE を自動配置します。";
    } else if (isBlocks) {
      note.textContent = "※ ブロック内のチーム数 × 予選試合数は偶数である必要があります。";
    } else {
      note.textContent = "※ 参加チーム数 × 予選試合数は偶数である必要があります。";
    }
  }

  function fillSetupForm() {
    document.getElementById("tournamentName").value = state.tournament.name;
    document.getElementById("tournamentDate").value = state.tournament.date;
    tournamentFormatEl.value = state.tournament.format ?? "round_robin";
    document.getElementById("teamCount").value = state.tournament.teamCount;
    document.getElementById("courtCount").value = state.tournament.courtCount;
    document.getElementById("blockCount").value = state.tournament.blockCount ?? 2;
    document.getElementById("matchesPerTeam").value = state.tournament.matchesPerTeam;
    document.getElementById("finalTeamCount").value = state.tournament.finalTeamCount;
    updateSetupFieldVisibility();
  }

  function readSetupForm() {
    return {
      name: document.getElementById("tournamentName").value.trim(),
      date: document.getElementById("tournamentDate").value,
      format: tournamentFormatEl.value,
      teamCount: Number(document.getElementById("teamCount").value),
      courtCount: Number(document.getElementById("courtCount").value),
      blockCount: Number(document.getElementById("blockCount").value),
      matchesPerTeam: Number(document.getElementById("matchesPerTeam").value),
      finalTeamCount: Number(document.getElementById("finalTeamCount").value),
    };
  }

  function renderTeamFields() {
    const count = state.tournament.teamCount;
    teamFieldsEl.innerHTML = Array.from({ length: count }, (_, index) => {
      const value = state.teams[index]?.name ?? "";
      return `
        <label class="field field--team">
          <span class="field__label">チーム ${index + 1}</span>
          <input class="field__input team-name-input" type="text" data-index="${index}" value="${escapeHtml(value)}" placeholder="チーム名を入力" required>
        </label>
      `;
    }).join("");
  }

  function readTeamsFromForm() {
    const count = state.tournament.teamCount;
    const teams = [];

    for (let i = 0; i < count; i += 1) {
      const input = teamFieldsEl.querySelector(`input[data-index="${i}"]`);
      const name = input?.value.trim() ?? "";
      const existingId = state.teams[i]?.id ?? `t${i + 1}`;
      teams.push(window.SMATournamentModels.createTeam(existingId, name || `チーム ${i + 1}`));
    }

    return teams;
  }

  function generateSchedule() {
    const result = window.SMATournamentScheduler.generateFullSchedule(state.teams, state.tournament);

    if (result.error) {
      showMessage(document.getElementById("scheduleErrors"), [result.error], true);
      return false;
    }

    state.matches = result.matches;
    state.blocks = result.blocks ?? [];
    state.knockout = result.knockout ?? null;

    if (!window.SMATournamentModels.availableViews(state.tournament.format).includes(state.scheduleView)) {
      state.scheduleView = window.SMATournamentModels.defaultScheduleView(state.tournament.format);
    }

    showMessage(document.getElementById("scheduleErrors"), [], false);
    return true;
  }

  function renderScheduleTabs() {
    const views = window.SMATournamentModels.availableViews(state.tournament.format);

    scheduleViewTabsEl.innerHTML = views
      .map((view) => {
        const active = view === state.scheduleView ? " view-tabs__item--active" : "";
        const label = window.SMATournamentModels.VIEW_LABELS[view];
        return `<button type="button" class="view-tabs__item${active}" data-view="${view}">${label}</button>`;
      })
      .join("");

    scheduleViewTabsEl.querySelectorAll(".view-tabs__item").forEach((button) => {
      button.addEventListener("click", () => {
        state.scheduleView = button.dataset.view;
        persist();
        renderSchedule();
      });
    });
  }

  function renderSchedule() {
    maybeFillKnockoutQualifiers();

    const { tournament, matches, teams } = state;
    const formatLabel = window.SMATournamentModels.FORMAT_LABELS[tournament.format] ?? "";
    scheduleSummaryEl.textContent = `${tournament.name || "大会"} / ${formatLabel} / ${teams.length}チーム / ${matches.length}試合 / ${tournament.courtCount}コート`;

    document.getElementById("printScheduleTitle").textContent = `${tournament.name || "大会"} 対戦表`;
    document.getElementById("printScheduleMeta").textContent = `開催日: ${tournament.date || "—"} / ${formatLabel}`;

    renderScheduleTabs();
    scheduleViewEl.className = `schedule-view schedule-view--${state.scheduleView}`;
    scheduleViewEl.innerHTML = window.SMATournamentViews.renderScheduleView(state, state.scheduleView);
  }

  function updateMatchFromInputs(matchId, scoreA, scoreB, winnerId) {
    const match = state.matches.find((item) => item.id === matchId);
    if (!match || !match.teamAId || !match.teamBId) return;

    const hasScores = scoreA !== "" && scoreB !== "" && scoreA !== null && scoreB !== null;
    const parsedA = hasScores ? Number(scoreA) : null;
    const parsedB = hasScores ? Number(scoreB) : null;

    if (!hasScores || Number.isNaN(parsedA) || Number.isNaN(parsedB)) {
      match.status = "pending";
      match.scoreA = null;
      match.scoreB = null;
      match.winnerId = null;
      window.SMATournamentBracket.propagateWinner(state, match);
      return;
    }

    match.scoreA = parsedA;
    match.scoreB = parsedB;

    if (winnerId) {
      match.winnerId = winnerId;
      match.status = "completed";
    } else if (parsedA === parsedB) {
      match.winnerId = null;
      match.status = "pending";
    } else {
      match.winnerId = parsedA > parsedB ? match.teamAId : match.teamBId;
      match.status = "completed";
    }

    window.SMATournamentBracket.propagateWinner(state, match);
    maybeFillKnockoutQualifiers();
  }

  function renderResults() {
    maybeFillKnockoutQualifiers();

    resultListEl.innerHTML = state.matches
      .map((match) => {
        const teamA = match.teamAId ? getTeamName(match.teamAId) : "未定";
        const teamB = match.teamBId ? getTeamName(match.teamBId) : "未定";
        const disabled = !match.teamAId || !match.teamBId;
        const scoreA = match.scoreA ?? "";
        const scoreB = match.scoreB ?? "";
        const statusClass = match.status === "completed" ? "result-card--done" : "result-card--pending";

        const winnerOptions = match.teamAId && match.teamBId
          ? [
              `<option value="">勝者を選択</option>`,
              `<option value="${match.teamAId}"${match.winnerId === match.teamAId ? " selected" : ""}>${escapeHtml(teamA)}</option>`,
              `<option value="${match.teamBId}"${match.winnerId === match.teamBId ? " selected" : ""}>${escapeHtml(teamB)}</option>`,
            ].join("")
          : `<option value="">対戦未定</option>`;

        return `
          <article class="result-card ${statusClass}${disabled ? " result-card--disabled" : ""}" data-match-id="${match.id}">
            <header class="result-card__header">
              <span class="result-card__no">試合 ${match.matchNumber}</span>
              <span class="result-card__court">第${match.round ?? 1}R / コート ${match.court}</span>
              <span class="badge ${match.status === "completed" ? "badge--done" : "badge--pending"}">${disabled ? "未定" : match.status === "completed" ? "入力済" : "未入力"}</span>
            </header>
            <p class="result-card__teams">${escapeHtml(teamA)} <span class="vs">vs</span> ${escapeHtml(teamB)}</p>
            <div class="result-card__inputs">
              <label class="field field--compact">
                <span class="field__label">${escapeHtml(teamA)} 得点</span>
                <input class="field__input score-input" type="number" min="0" max="50" data-side="a" value="${scoreA}" placeholder="—" ${disabled ? "disabled" : ""}>
              </label>
              <label class="field field--compact">
                <span class="field__label">${escapeHtml(teamB)} 得点</span>
                <input class="field__input score-input" type="number" min="0" max="50" data-side="b" value="${scoreB}" placeholder="—" ${disabled ? "disabled" : ""}>
              </label>
              <label class="field field--compact">
                <span class="field__label">勝者</span>
                <select class="field__input winner-select" ${disabled ? "disabled" : ""}>${winnerOptions}</select>
              </label>
            </div>
          </article>
        `;
      })
      .join("");

    resultListEl.querySelectorAll(".result-card:not(.result-card--disabled)").forEach((card) => {
      const matchId = card.dataset.matchId;
      const scoreAInput = card.querySelector('[data-side="a"]');
      const scoreBInput = card.querySelector('[data-side="b"]');
      const winnerSelect = card.querySelector(".winner-select");

      const sync = () => {
        updateMatchFromInputs(matchId, scoreAInput.value, scoreBInput.value, winnerSelect.value);
        persist();
        const match = state.matches.find((item) => item.id === matchId);
        card.classList.toggle("result-card--done", match?.status === "completed");
        card.classList.toggle("result-card--pending", match?.status !== "completed");
        const badge = card.querySelector(".badge");
        badge.className = `badge ${match?.status === "completed" ? "badge--done" : "badge--pending"}`;
        badge.textContent = match?.status === "completed" ? "入力済" : "未入力";
      };

      scoreAInput.addEventListener("input", sync);
      scoreBInput.addEventListener("input", sync);
      winnerSelect.addEventListener("change", sync);
    });
  }

  function renderStandings() {
    const rows = window.SMATournamentStandings.calculateStandings(state);
    const { tournament } = state;

    document.getElementById("printStandingsTitle").textContent = `${tournament.name || "大会"} 順位表`;
    document.getElementById("printStandingsMeta").textContent = `開催日: ${tournament.date || "—"} / 順位基準: 勝数 → 得失点差 → 得点`;

    standingsBodyEl.innerHTML = rows
      .map(
        (row) => `
        <tr>
          <td>${row.rank}</td>
          <td>${escapeHtml(row.teamName)}</td>
          <td>${row.played}</td>
          <td>${row.wins}</td>
          <td>${row.losses}</td>
          <td>${row.pointsFor}</td>
          <td>${row.pointsAgainst}</td>
          <td>${row.pointDiff >= 0 ? "+" : ""}${row.pointDiff}</td>
          <td>${row.winRateText}</td>
        </tr>
      `
      )
      .join("");
  }

  tournamentFormatEl.addEventListener("change", updateSetupFieldVisibility);

  setupForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const tournament = readSetupForm();
    const errors = window.SMATournamentModels.validateTournament(tournament);
    showMessage(document.getElementById("setupErrors"), errors, errors.length > 0);
    if (errors.length) return;

    state.tournament = tournament;
    state.scheduleView = window.SMATournamentModels.defaultScheduleView(tournament.format);

    if (state.teams.length !== tournament.teamCount) {
      state.teams = [];
      state.matches = [];
      state.blocks = [];
      state.knockout = null;
    }

    persist();
    goToStep(2);
  });

  teamsForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const teams = readTeamsFromForm();
    const validation = window.SMATournamentModels.validateTeams(teams, state.tournament.teamCount);

    showMessage(document.getElementById("teamErrors"), validation.errors, validation.errors.length > 0);
    showMessage(document.getElementById("teamWarnings"), validation.warnings, validation.warnings.length > 0);
    if (validation.errors.length) return;

    state.teams = teams;
    if (!generateSchedule()) return;

    persist();
    goToStep(3);
  });

  document.getElementById("backToSetupBtn").addEventListener("click", () => goToStep(1));
  document.getElementById("backToTeamsBtn").addEventListener("click", () => goToStep(2));
  document.getElementById("backToScheduleBtn").addEventListener("click", () => goToStep(3));
  document.getElementById("backToResultsBtn").addEventListener("click", () => goToStep(4));

  document.getElementById("regenerateScheduleBtn").addEventListener("click", () => {
    if (window.confirm("対戦表を再生成します。現在の試合結果はリセットされます。よろしいですか？")) {
      if (generateSchedule()) {
        persist();
        renderSchedule();
      }
    }
  });

  document.getElementById("toResultsBtn").addEventListener("click", () => goToStep(4));
  document.getElementById("toStandingsBtn").addEventListener("click", () => goToStep(5));

  document.getElementById("printScheduleBtn").addEventListener("click", () => {
    document.body.classList.add("print-schedule");
    document.body.classList.remove("print-standings");
    document.body.dataset.printView = state.scheduleView;
    window.print();
    document.body.classList.remove("print-schedule");
    delete document.body.dataset.printView;
  });

  document.getElementById("printStandingsBtn").addEventListener("click", () => {
    document.body.classList.add("print-standings");
    document.body.classList.remove("print-schedule");
    window.print();
    document.body.classList.remove("print-standings");
  });

  document.getElementById("newTournamentBtn").addEventListener("click", () => {
    if (!window.confirm("現在の大会データを削除して、新しい大会を始めますか？")) return;
    window.SMATournamentStorage.clear();
    state = window.SMATournamentModels.createEmptyState();
    fillSetupForm();
    goToStep(1);
  });

  function bootstrap() {
    const saved = window.SMATournamentStorage.load();
    state = window.SMATournamentModels.normalizeState(saved);
    fillSetupForm();
    renderStepNav();
    goToStep(state.currentStep || 1);
  }

  bootstrap();
})();
