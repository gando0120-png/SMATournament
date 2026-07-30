/**
 * 決勝トーナメント表 UI（ラウンド表示 / 全体表切替）
 */
import {
  BracketViewMode,
  formatFinalsMatchCourtLabel,
  getAdjacentBracketRoundNumbers,
  getFinalsMatchCardStateClass,
  getFinalsMatchStatusBadgeDataset,
  mapFinalsStatusLabelToDisplayStatus,
  resolveDefaultBracketViewMode,
  resolveInitialBracketRoundNumber,
  resolveMatchCourtNumber,
} from "../../domain/finals-bracket-display.js";
import { FinalsMatchDisplayStatus } from "../../domain/finals-match-progress.js";

/**
 * @typedef {object} FinalsBracketViewMountOptions
 * @property {'admin'|'public'} surface
 * @property {boolean} [hideSeed]
 * @property {function(string): string} escapeHtml
 * @property {function(object): string} [renderAdminTeamLine]
 * @property {function(object): string} [renderPublicTeamLine]
 * @property {function(object): string} [renderAdminMatchActions]
 * @property {function(object): string} [getAdminDisplayStatus]
 * @property {Array<{ roundNumber: number, roundLabel: string, matches: object[] }>} rounds
 */

/**
 * @param {HTMLElement} container
 * @param {FinalsBracketViewMountOptions} options
 */
export function mountFinalsBracketView(container, options) {
  const state = {
    viewMode: resolveDefaultBracketViewMode(window.innerWidth),
    selectedRoundNumber: null,
    rounds: options.rounds ?? [],
    userOverrodeViewMode: false,
  };

  container.classList.add("finals-bracket-view");
  container.innerHTML = `
    <div class="finals-bracket-view__toolbar finals-bracket-view__toolbar--sticky">
      <div class="finals-bracket-view__mode-toggle" role="tablist" aria-label="トーナメント表示切替">
        <button type="button" class="finals-bracket-view__mode-btn" data-view-mode="${BracketViewMode.ROUND}" role="tab">ラウンド表示</button>
        <button type="button" class="finals-bracket-view__mode-btn" data-view-mode="${BracketViewMode.BOARD}" role="tab">全体表</button>
      </div>
      <div class="finals-bracket-view__round-nav" data-round-nav hidden></div>
    </div>
    <div class="finals-bracket-view__round-panel" data-round-panel hidden></div>
    <div class="finals-bracket-view__board-panel finals-bracket public-bracket-scroll" data-board-panel></div>
  `;

  const modeButtons = [...container.querySelectorAll(".finals-bracket-view__mode-btn")];
  const roundNavEl = container.querySelector("[data-round-nav]");
  const roundPanelEl = container.querySelector("[data-round-panel]");
  const boardPanelEl = container.querySelector("[data-board-panel]");

  function getDisplayStatus(match) {
    if (options.surface === "admin" && options.getAdminDisplayStatus) {
      return options.getAdminDisplayStatus(match);
    }
    if (match.displayStatus) {
      return match.displayStatus;
    }
    if (match.statusLabel) {
      return mapFinalsStatusLabelToDisplayStatus(match.statusLabel);
    }
    return FinalsMatchDisplayStatus.WAITING_OPPONENT;
  }

  function ensureSelectedRound() {
    const valid = state.rounds.some((round) => round.roundNumber === state.selectedRoundNumber);
    if (!valid) {
      state.selectedRoundNumber = resolveInitialBracketRoundNumber(state.rounds, getDisplayStatus);
    }
  }

  function setViewMode(mode, { fromUser = false } = {}) {
    state.viewMode = mode;
    if (fromUser) {
      state.userOverrodeViewMode = true;
    }
    render();
  }

  function setSelectedRound(roundNumber) {
    state.selectedRoundNumber = roundNumber;
    renderRoundContent();
  }

  function renderModeToggle() {
    for (const button of modeButtons) {
      const mode = button.dataset.viewMode;
      const selected = mode === state.viewMode;
      button.classList.toggle("finals-bracket-view__mode-btn--active", selected);
      button.setAttribute("aria-selected", selected ? "true" : "false");
    }
    roundNavEl.hidden = state.viewMode !== BracketViewMode.ROUND;
  }

  function renderRoundNav() {
    ensureSelectedRound();
    const { previous, next } = getAdjacentBracketRoundNumbers(state.rounds, state.selectedRoundNumber);

    const tabs = state.rounds
      .map((round) => {
        const active = round.roundNumber === state.selectedRoundNumber;
        return `
          <button
            type="button"
            class="finals-bracket-view__round-tab${active ? " finals-bracket-view__round-tab--active" : ""}"
            data-round-number="${round.roundNumber}"
            aria-selected="${active ? "true" : "false"}"
          >${options.escapeHtml(round.roundLabel)}</button>
        `;
      })
      .join("");

    roundNavEl.innerHTML = `
      <div class="finals-bracket-view__round-nav-row">
        <button type="button" class="finals-bracket-view__round-step" data-round-step="prev"${previous == null ? " disabled" : ""} data-round-target="${previous ?? ""}">前のラウンドへ</button>
        <button type="button" class="finals-bracket-view__round-step" data-round-step="next"${next == null ? " disabled" : ""} data-round-target="${next ?? ""}">次のラウンドへ</button>
      </div>
      <div class="finals-bracket-view__round-tabs" role="tablist" aria-label="ラウンド切替">${tabs}</div>
    `;
  }

  function renderAdminMatchCard(matchContext) {
    const { match, displayStatus, teams, statusLabel } = matchContext;
    const stateClass = getFinalsMatchCardStateClass(displayStatus);
    const highlight = displayStatus === FinalsMatchDisplayStatus.FINISHED;
    const hideSeed = options.hideSeed === true;
    const team1Html = options.renderAdminTeamLine({
      team: teams.team1,
      highlightWinner: highlight,
      isWinner: teams.winnerEntryId === teams.team1?.entryId,
      isLoser:
        highlight &&
        Boolean(teams.winnerEntryId) &&
        Boolean(teams.team1?.entryId) &&
        teams.winnerEntryId !== teams.team1.entryId,
      hideSeed,
      displayStatus,
    });
    const team2Html = options.renderAdminTeamLine({
      team: teams.team2,
      highlightWinner: highlight,
      isWinner: teams.winnerEntryId === teams.team2?.entryId,
      isLoser:
        highlight &&
        Boolean(teams.winnerEntryId) &&
        Boolean(teams.team2?.entryId) &&
        teams.winnerEntryId !== teams.team2.entryId,
      hideSeed,
      displayStatus,
    });
    const actionsHtml = options.renderAdminMatchActions?.(matchContext) ?? "";

    return `
      <article class="finals-bracket__match ${stateClass}">
        <div class="finals-bracket__match-head">
          <p class="finals-bracket__match-title">${options.escapeHtml(formatFinalsMatchCourtLabel(resolveMatchCourtNumber(match)))}</p>
          <span class="status-badge finals-bracket__status" data-status="${getFinalsMatchStatusBadgeDataset(displayStatus)}">${options.escapeHtml(statusLabel)}</span>
        </div>
        <div class="finals-bracket__team">${team1Html}</div>
        <p class="finals-bracket__vs">vs</p>
        <div class="finals-bracket__team">${team2Html}</div>
        ${actionsHtml}
      </article>
    `;
  }

  function renderPublicMatchCard(match) {
    const displayStatus = getDisplayStatus(match);
    const stateClass = getFinalsMatchCardStateClass(displayStatus);
    const showSeed = options.hideSeed !== true;
    const highlightRow =
      match.team1?.highlighted || match.team2?.highlighted ? " public-highlight-row" : "";
    const team1Html = options.renderPublicTeamLine(match.team1, showSeed, {
      displayStatus,
      isWinner: match.winnerEntryId === match.team1?.entryId,
      hasWinner: Boolean(match.winnerEntryId),
    });
    const team2Html = options.renderPublicTeamLine(match.team2, showSeed, {
      displayStatus,
      isWinner: match.winnerEntryId === match.team2?.entryId,
      hasWinner: Boolean(match.winnerEntryId),
    });

    return `
      <article class="finals-bracket__match public-finals-match${highlightRow} ${stateClass}">
        <div class="finals-bracket__match-head">
          <p class="finals-bracket__match-title">${options.escapeHtml(formatFinalsMatchCourtLabel(resolveMatchCourtNumber(match)))}</p>
          <span class="status-badge finals-bracket__status" data-status="${getFinalsMatchStatusBadgeDataset(displayStatus)}">${options.escapeHtml(match.statusLabel)}</span>
        </div>
        <div class="finals-bracket__team">${team1Html}</div>
        <p class="finals-bracket__vs">vs</p>
        <div class="finals-bracket__team">${team2Html}</div>
        ${
          match.resultSummary
            ? `<p class="public-match-card__result">結果：${options.escapeHtml(match.resultSummary)}</p>`
            : ""
        }
      </article>
    `;
  }

  function renderMatchCard(matchContext) {
    if (options.surface === "admin") {
      return renderAdminMatchCard(matchContext);
    }
    return renderPublicMatchCard(matchContext);
  }

  function renderRoundMatches(round) {
    const matches = round.matches
      .map((match) => {
        if (options.surface === "admin") {
          return renderMatchCard(match);
        }
        return renderMatchCard(match);
      })
      .join("");

    return `
      <section class="panel finals-bracket__round">
        <h3 class="panel__title">${options.escapeHtml(round.roundLabel)}</h3>
        <div class="finals-bracket__matches">${matches}</div>
      </section>
    `;
  }

  function renderRoundContent() {
    ensureSelectedRound();
    const round = state.rounds.find((item) => item.roundNumber === state.selectedRoundNumber);
    roundPanelEl.innerHTML = round ? renderRoundMatches(round) : "";
  }

  function renderBoardContent() {
    boardPanelEl.innerHTML = state.rounds.map((round) => renderRoundMatches(round)).join("");
  }

  function render() {
    renderModeToggle();
    roundPanelEl.hidden = state.viewMode !== BracketViewMode.ROUND;
    boardPanelEl.hidden = state.viewMode !== BracketViewMode.BOARD;

    if (state.viewMode === BracketViewMode.ROUND) {
      renderRoundNav();
      renderRoundContent();
    } else {
      renderBoardContent();
    }
  }

  for (const button of modeButtons) {
    button.addEventListener("click", () => {
      setViewMode(button.dataset.viewMode, { fromUser: true });
    });
  }

  roundNavEl.addEventListener("click", (event) => {
    const target = event.target.closest("[data-round-number], [data-round-step]");
    if (!target || target.disabled) {
      return;
    }
    if (target.dataset.roundNumber) {
      setSelectedRound(Number(target.dataset.roundNumber));
      return;
    }
    const roundTarget = target.dataset.roundTarget;
    if (roundTarget) {
      setSelectedRound(Number(roundTarget));
    }
  });

  let resizeTimer = null;
  function handleResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!state.userOverrodeViewMode) {
        const nextMode = resolveDefaultBracketViewMode(window.innerWidth);
        if (nextMode !== state.viewMode) {
          state.viewMode = nextMode;
          render();
        }
      }
    }, 150);
  }

  window.addEventListener("resize", handleResize);

  ensureSelectedRound();
  render();

  return {
    update(nextOptions) {
      if (nextOptions.rounds) {
        state.rounds = nextOptions.rounds;
      }
      if (nextOptions.hideSeed !== undefined) {
        options.hideSeed = nextOptions.hideSeed;
      }
      ensureSelectedRound();
      render();
    },
    destroy() {
      window.removeEventListener("resize", handleResize);
      clearTimeout(resizeTimer);
      container.innerHTML = "";
      container.classList.remove("finals-bracket-view");
    },
  };
}
