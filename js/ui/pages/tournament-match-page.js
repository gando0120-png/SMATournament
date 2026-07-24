/**
 * 大会専用試合画面
 */
import {
  MatchDisplayStatus,
  findScheduleMatchContext,
  resolveMatchDisplayState,
  getMatchDisplayStatusLabel,
  formatFinishedResultDetail,
} from "../../domain/qualifying-match-session.js";
import { isValidTournamentId } from "../../domain/validators.js";
import { getTournament } from "../../services/tournament-service.js";
import { getQualifyingSchedule } from "../../services/qualifying-schedule-service.js";
import { getQualifyingMatchResult } from "../../services/qualifying-match-result-service.js";
import {
  getQualifyingMatchSession,
  startQualifyingMatchSession,
} from "../../services/qualifying-match-session-service.js";
import { initOperatorGuard } from "../../lib/operator-guard.js";
import {
  classifyError,
  InvalidTournamentIdError,
  InvalidMatchIdError,
} from "../../lib/errors.js";
import { showErrorToast, showToast } from "../components/toast.js";
import { confirmDialog } from "../components/confirm-dialog.js";
import { showFormAlert } from "../components/form-errors.js";

const views = {
  loading: document.getElementById("viewLoading"),
  config: document.getElementById("viewConfig"),
  operatorDenied: document.getElementById("viewOperatorDenied"),
  error: document.getElementById("viewError"),
  match: document.getElementById("viewMatch"),
};

const headerActions = document.getElementById("headerActions");
const backToScheduleBtn = document.getElementById("backToScheduleBtn");
const matchTournamentNameEl = document.getElementById("matchTournamentName");
const matchMetaEl = document.getElementById("matchMeta");
const matchCourtEl = document.getElementById("matchCourt");
const matchTeam1NameEl = document.getElementById("matchTeam1Name");
const matchTeam2NameEl = document.getElementById("matchTeam2Name");
const matchStatusBadgeEl = document.getElementById("matchStatusBadge");
const matchStartedAtEl = document.getElementById("matchStartedAt");
const matchResultPanelEl = document.getElementById("matchResultPanel");
const matchStartPanelEl = document.getElementById("matchStartPanel");
const matchPlayingPanelEl = document.getElementById("matchPlayingPanel");
const startMatchBtn = document.getElementById("startMatchBtn");

let tournamentId = null;
let matchId = null;
let currentMatchContext = null;

function showView(name) {
  Object.entries(views).forEach(([key, el]) => {
    if (el) {
      el.classList.toggle("hidden", key !== name);
    }
  });
  if (headerActions) {
    headerActions.classList.toggle("hidden", name !== "match");
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isValidMatchId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 200;
}

function buildTournamentScheduleHref(id) {
  return `tournament-schedule.html?id=${encodeURIComponent(id)}`;
}

function formatTimestamp(value) {
  if (!value) {
    return "—";
  }
  const date = typeof value.toDate === "function" ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return date.toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function getStatusBadgeDataset(displayStatus) {
  if (displayStatus === MatchDisplayStatus.FINISHED) {
    return "confirmed";
  }
  if (displayStatus === MatchDisplayStatus.PLAYING) {
    return "open";
  }
  return "draft";
}

function renderFinishedResultPanel(result, team1Name, team2Name) {
  const detail = formatFinishedResultDetail(result);
  const setLines = detail.sets
    .map(
      (set) =>
        `<li><strong>${escapeHtml(set.label)}</strong> ${escapeHtml(set.scoreLine)}（${escapeHtml(set.resultLabel)}）</li>`
    )
    .join("");

  matchResultPanelEl.innerHTML = `
    <h3 class="match-screen__result-title">試合結果</h3>
    <ul class="match-screen__set-list">${setLines}</ul>
    <div class="match-screen__result-stats">
      <p><strong>${escapeHtml(team1Name)}</strong> ${escapeHtml(detail.team1StatsLine ?? "—")}</p>
      <p><strong>${escapeHtml(team2Name)}</strong> ${escapeHtml(detail.team2StatsLine ?? "—")}</p>
    </div>
  `;
  matchResultPanelEl.classList.remove("hidden");
}

function renderMatchView(tournament, matchContext, displayState) {
  const { status, session, result } = displayState;
  const team1Name = matchContext.team1?.teamName ?? "—";
  const team2Name = matchContext.team2?.teamName ?? "—";

  matchTournamentNameEl.textContent = tournament?.name || "（名称未設定）";
  matchMetaEl.textContent = `${matchContext.blockName}　第${matchContext.roundNumber}節`;
  matchCourtEl.textContent = `コート${matchContext.courtNumber}`;
  matchTeam1NameEl.textContent = team1Name;
  matchTeam2NameEl.textContent = team2Name;

  const statusLabel = getMatchDisplayStatusLabel(status);
  matchStatusBadgeEl.textContent = statusLabel;
  matchStatusBadgeEl.dataset.status = getStatusBadgeDataset(status);

  matchStartedAtEl.classList.add("hidden");
  matchStartedAtEl.textContent = "";
  matchResultPanelEl.classList.add("hidden");
  matchResultPanelEl.innerHTML = "";
  matchStartPanelEl.classList.add("hidden");
  matchPlayingPanelEl.classList.add("hidden");

  if (status === MatchDisplayStatus.FINISHED) {
    renderFinishedResultPanel(result, team1Name, team2Name);
    return;
  }

  if (status === MatchDisplayStatus.PLAYING) {
    matchStartedAtEl.textContent = `開始時刻：${formatTimestamp(session?.startedAt)}`;
    matchStartedAtEl.classList.remove("hidden");
    matchPlayingPanelEl.classList.remove("hidden");
    return;
  }

  matchStartPanelEl.classList.remove("hidden");
}

function showPageError(message) {
  showFormAlert(document.getElementById("errorAlert"), message, "error");
  showView("error");
}

async function loadMatchData() {
  const [tournament, savedSchedule, session, result] = await Promise.all([
    getTournament(tournamentId),
    getQualifyingSchedule(tournamentId),
    getQualifyingMatchSession(tournamentId, matchId),
    getQualifyingMatchResult(tournamentId, matchId),
  ]);

  if (!savedSchedule?.finalized) {
    const error = new Error("Qualifying schedule not finalized");
    error.code = "qualifying-match-session/no-schedule";
    throw error;
  }

  const matchContext = findScheduleMatchContext(savedSchedule, matchId);
  if (!matchContext) {
    throw new InvalidMatchIdError();
  }

  currentMatchContext = matchContext;
  const displayState = resolveMatchDisplayState(session, result);
  renderMatchView(tournament, matchContext, displayState);
  showView("match");
}

async function handleStartMatch() {
  if (!currentMatchContext) {
    return;
  }

  const confirmed = await confirmDialog({
    title: "試合開始",
    message:
      "この試合を開始しますか？\n\n今後タイマー機能を追加した際は、この開始時刻を基準にカウントします。",
    confirmLabel: "試合を開始する",
    cancelLabel: "キャンセル",
  });

  if (!confirmed) {
    return;
  }

  startMatchBtn.disabled = true;

  try {
    await startQualifyingMatchSession(tournamentId, matchId);
    await loadMatchData();
    showToast("試合を開始しました。");
  } catch (error) {
    const { message } = classifyError(error);
    showErrorToast(message);
  } finally {
    startMatchBtn.disabled = false;
  }
}

async function loadPage() {
  showView("loading");

  if (!isValidTournamentId(tournamentId)) {
    const { message } = classifyError(new InvalidTournamentIdError());
    showPageError(message);
    return;
  }

  if (!isValidMatchId(matchId)) {
    const { message } = classifyError(new InvalidMatchIdError());
    showPageError(message);
    return;
  }

  backToScheduleBtn.href = buildTournamentScheduleHref(tournamentId);

  try {
    await loadMatchData();
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

function initOperatorDeniedView() {
  showFormAlert(
    document.getElementById("operatorDeniedAlert"),
    "運営者として登録されていません。",
    "warning"
  );
  showView("operatorDenied");
}

function initMatchPage() {
  const params = new URLSearchParams(window.location.search);
  tournamentId = params.get("id");
  matchId = params.get("matchId");

  startMatchBtn.addEventListener("click", handleStartMatch);

  initOperatorGuard({
    onConfigRequired: initConfigView,
    onOperatorDenied: initOperatorDeniedView,
    onReady: () => {
      loadPage();
    },
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initMatchPage);
} else {
  initMatchPage();
}
