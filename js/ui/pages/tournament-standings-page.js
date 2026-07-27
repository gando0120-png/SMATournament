/**
 * 予選順位表ページ
 */
import { isValidTournamentId } from "../../domain/validators.js";
import { buildQualifyingStandings } from "../../domain/qualifying-standings.js";
import { getTournament } from "../../services/tournament-service.js";
import { getQualifyingSchedule } from "../../services/qualifying-schedule-service.js";
import { getQualifyingMatchResults } from "../../services/qualifying-match-result-service.js";
import { getFinalsAdvancement } from "../../services/finals-advancement-service.js";
import { getFinalsBracket } from "../../services/finals-bracket-service.js";
import { initTournamentManageGuard } from "../../lib/operator-guard.js";
import {
  classifyError,
  InvalidTournamentIdError,
} from "../../lib/errors.js";
import { showFormAlert } from "../components/form-errors.js";

const views = {
  loading: document.getElementById("viewLoading"),
  config: document.getElementById("viewConfig"),
  operatorDenied: document.getElementById("viewOperatorDenied"),
  error: document.getElementById("viewError"),
  empty: document.getElementById("viewEmpty"),
  standings: document.getElementById("viewStandings"),
};

const headerActions = document.getElementById("headerActions");
const backToDashboardBtn = document.getElementById("backToDashboardBtn");
const openScheduleBtn = document.getElementById("openScheduleBtn");
const openFinalsAdvancementBtn = document.getElementById("openFinalsAdvancementBtn");
const openFinalsBracketBtn = document.getElementById("openFinalsBracketBtn");
const emptyBackBtn = document.getElementById("emptyBackBtn");
const emptyScheduleBtn = document.getElementById("emptyScheduleBtn");
const standingsPageTitleEl = document.getElementById("standingsPageTitle");
const standingsMetaEl = document.getElementById("standingsMeta");
const standingsBlocksEl = document.getElementById("standingsBlocks");

let tournamentId = null;

function showView(name) {
  Object.entries(views).forEach(([key, el]) => {
    if (el) {
      el.classList.toggle("hidden", key !== name);
    }
  });
  if (headerActions) {
    headerActions.classList.toggle("hidden", name !== "standings" && name !== "empty");
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildTournamentDashboardHref(id) {
  return `tournament-dashboard.html?id=${encodeURIComponent(id)}`;
}

function buildTournamentScheduleHref(id) {
  return `tournament-schedule.html?id=${encodeURIComponent(id)}`;
}

function buildTournamentFinalsAdvancementHref(id) {
  return `tournament-finals-advancement.html?id=${encodeURIComponent(id)}`;
}

function buildTournamentFinalsBracketHref(id) {
  return `tournament-finals-bracket.html?id=${encodeURIComponent(id)}`;
}

function updateFinalsNavigation(advancement, bracket) {
  if (!openFinalsBracketBtn) {
    return;
  }

  if (!advancement?.finalized) {
    openFinalsBracketBtn.classList.add("hidden");
    return;
  }

  openFinalsBracketBtn.classList.remove("hidden");
  openFinalsBracketBtn.href = buildTournamentFinalsBracketHref(tournamentId);
  openFinalsBracketBtn.textContent = bracket?.finalized
    ? "決勝トーナメントを見る"
    : "決勝トーナメントを作成";
}

function renderStandingsRow(entry) {
  return `
    <tr>
      <td class="standings-table__rank">${entry.rank}</td>
      <td class="standings-table__team">${escapeHtml(entry.teamName)}</td>
      <td class="standings-table__num">${entry.playedMatches}</td>
      <td class="standings-table__num">${entry.setWins}</td>
      <td class="standings-table__num">${entry.setDraws}</td>
      <td class="standings-table__num">${entry.setLosses}</td>
      <td class="standings-table__num">${entry.totalScore}</td>
      <td class="standings-table__num">${entry.remainingMatches}</td>
    </tr>
  `;
}

function renderBlockStandings(block) {
  const rows = block.standings.map((entry) => renderStandingsRow(entry)).join("");

  return `
    <section class="panel standings-block" style="margin-bottom: var(--space-lg);">
      <h3 class="panel__title">${escapeHtml(block.blockName)}</h3>
      <div class="standings-table-wrap">
        <table class="standings-table">
          <thead>
            <tr>
              <th scope="col">順位</th>
              <th scope="col">チーム</th>
              <th scope="col">試合</th>
              <th scope="col">セット勝</th>
              <th scope="col">分</th>
              <th scope="col">敗</th>
              <th scope="col">総得点</th>
              <th scope="col">残り</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderStandingsView(standings, tournament) {
  const tournamentName = tournament?.name || "（名称未設定）";
  standingsPageTitleEl.textContent = "予選順位表";
  standingsMetaEl.textContent = `${tournamentName} / ${standings.blocks.length} ブロック`;
  standingsBlocksEl.innerHTML = standings.blocks.map((block) => renderBlockStandings(block)).join("");
}

function showPageError(message) {
  showFormAlert(document.getElementById("errorAlert"), message, "error");
  showView("error");
}

function setNavigationLinks() {
  const dashboardHref = buildTournamentDashboardHref(tournamentId);
  const scheduleHref = buildTournamentScheduleHref(tournamentId);
  const finalsHref = buildTournamentFinalsAdvancementHref(tournamentId);
  backToDashboardBtn.href = dashboardHref;
  openScheduleBtn.href = scheduleHref;
  if (openFinalsAdvancementBtn) {
    openFinalsAdvancementBtn.href = finalsHref;
  }
  emptyBackBtn.href = dashboardHref;
  emptyScheduleBtn.href = scheduleHref;
}

async function loadPage() {
  showView("loading");

  if (!isValidTournamentId(tournamentId)) {
    const { message } = classifyError(new InvalidTournamentIdError());
    showPageError(message);
    return;
  }

  setNavigationLinks();

  try {
    const [tournament, savedSchedule, advancement, bracket] = await Promise.all([
      getTournament(tournamentId),
      getQualifyingSchedule(tournamentId),
      getFinalsAdvancement(tournamentId),
      getFinalsBracket(tournamentId),
    ]);

    if (!savedSchedule?.finalized) {
      showView("empty");
      return;
    }

    const resultsMap = await getQualifyingMatchResults(tournamentId);
    const standings = buildQualifyingStandings(savedSchedule, resultsMap);

    if (!standings) {
      showView("empty");
      return;
    }

    renderStandingsView(standings, tournament);
    updateFinalsNavigation(advancement, bracket);
    showView("standings");
  } catch (error) {
    const { message } = classifyError(error);
    showPageError(message);
  }
}

function initConfigView() {
  showFormAlert(
    document.getElementById("configAlert"),
    "Firebase 設定が未入力です。js/firebase-config.js を設定してください。",
    "error"
  );
  showView("config");
}

function initAccessDeniedView() {
  showFormAlert(
    document.getElementById("operatorDeniedAlert"),
    "この大会を管理する権限がありません。",
    "warning"
  );
  showView("operatorDenied");
}

function initStandingsPage() {
  tournamentId = new URLSearchParams(window.location.search).get("id");

  initTournamentManageGuard({
    tournamentId,
    onConfigRequired: initConfigView,
    onAccessDenied: initAccessDeniedView,
    onReady: () => {
      loadPage();
    },
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initStandingsPage);
} else {
  initStandingsPage();
}
