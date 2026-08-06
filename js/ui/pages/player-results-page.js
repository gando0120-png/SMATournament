/**
 * プレイヤー予選結果入力ページ
 */
import { isFirebaseConfigured } from "../../lib/firebase-app.js";
import { classifyError } from "../../lib/errors.js";
import { showFormAlert } from "../components/form-errors.js";
import { showToast } from "../components/toast.js";
import { matchResultDialog } from "../components/match-result-dialog.js";
import {
  listMyQualifyingMatches,
  submitPlayerQualifyingResult,
} from "../../services/player-qualifying-result-service.js";
import { formatTeamStatsLine } from "../../domain/qualifying-match-result.js";
import { PlayerMatchUiStatus } from "../../domain/player-qualifying-submission.js";

const views = {
  loading: document.getElementById("viewLoading"),
  config: document.getElementById("viewConfig"),
  error: document.getElementById("viewError"),
  main: document.getElementById("viewMain"),
};

const tournamentNameEl = document.getElementById("tournamentName");
const teamSummaryEl = document.getElementById("teamSummary");
const gateAlertEl = document.getElementById("gateAlert");
const matchListEl = document.getElementById("matchList");
const configAlert = document.getElementById("configAlert");
const errorAlert = document.getElementById("errorAlert");

let tournamentId = null;
let teamToken = null;
let currentPayload = null;

function showView(name) {
  Object.entries(views).forEach(([key, el]) => {
    el?.classList.toggle("hidden", key !== name);
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function statusBadgeClass(status) {
  switch (status) {
    case PlayerMatchUiStatus.OFFICIAL:
    case PlayerMatchUiStatus.MATCHED:
      return "form-alert--success";
    case PlayerMatchUiStatus.CONFLICT:
      return "form-alert--error";
    case PlayerMatchUiStatus.AWAITING_OPPONENT:
      return "form-alert--warning";
    default:
      return "";
  }
}

function renderMatches(payload) {
  if (!matchListEl) {
    return;
  }
  if (!payload.matches?.length) {
    matchListEl.innerHTML = "<p class=\"panel__desc\">表示できる予選試合がありません。</p>";
    return;
  }

  matchListEl.innerHTML = payload.matches
    .map((match) => {
      const badgeClass = statusBadgeClass(match.uiStatus);
      const official =
        match.officialResult != null
          ? `<p class="panel__desc">${escapeHtml(formatTeamStatsLine(match.officialResult.team1Stats))} / ${escapeHtml(formatTeamStatsLine(match.officialResult.team2Stats))}</p>`
          : "";
      const action = match.canSubmit
        ? `<button type="button" class="btn btn--primary" data-action="submit" data-match-id="${escapeHtml(match.matchId)}">結果を送信</button>`
        : "";
      return `
        <article class="panel" style="margin-bottom: var(--space-md);" data-match-id="${escapeHtml(match.matchId)}">
          <h3 class="panel__title">第${match.roundNumber}節 / ${match.courtNumber}コート</h3>
          <p class="panel__desc">${escapeHtml(match.team1.teamName)} vs ${escapeHtml(match.team2.teamName)}</p>
          <p class="form-alert ${badgeClass}">${escapeHtml(match.uiStatusLabel)}</p>
          ${official}
          ${action}
        </article>
      `;
    })
    .join("");

  matchListEl.querySelectorAll('[data-action="submit"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const matchId = btn.getAttribute("data-match-id");
      const match = payload.matches.find((m) => m.matchId === matchId);
      if (match) {
        handleSubmitMatch(match);
      }
    });
  });
}

async function handleSubmitMatch(match) {
  const initialValues = match.mySubmission
    ? {
        set1Team1Score: match.mySubmission.set1Team1Score,
        set1Team2Score: match.mySubmission.set1Team2Score,
        set2Team1Score: match.mySubmission.set2Team1Score,
        set2Team2Score: match.mySubmission.set2Team2Score,
      }
    : {};

  const clientRequestId =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;

  await matchResultDialog({
    title: "予選結果を送信",
    team1Name: match.team1.teamName,
    team2Name: match.team2.teamName,
    initialValues,
    submitLabel: "送信する",
    onSubmit: async (values) => {
      const result = await submitPlayerQualifyingResult(tournamentId, {
        teamToken,
        matchId: match.matchId,
        ...values,
        clientRequestId,
      });
      showToast(result.message || "送信しました。");
      await reload();
    },
  });
}

async function reload() {
  currentPayload = await listMyQualifyingMatches(tournamentId, teamToken);
  tournamentNameEl.textContent = currentPayload.tournamentName || "大会";
  teamSummaryEl.textContent = `チーム: ${currentPayload.teamName}`;
  if (!currentPayload.submissionAllowed && currentPayload.submissionMessage) {
    gateAlertEl.textContent = currentPayload.submissionMessage;
    gateAlertEl.classList.remove("hidden");
  } else if (!currentPayload.participantResultEntryEnabled) {
    gateAlertEl.textContent = "この大会ではプレイヤーによる結果入力が無効です。";
    gateAlertEl.classList.remove("hidden");
  } else {
    gateAlertEl.classList.add("hidden");
  }
  renderMatches(currentPayload);
  showView("main");
}

async function init() {
  const params = new URLSearchParams(window.location.search);
  tournamentId = params.get("tournamentId");
  teamToken = params.get("teamToken");

  if (!isFirebaseConfigured()) {
    showFormAlert(configAlert, "Firebase 設定が未入力です。", "error");
    showView("config");
    return;
  }

  if (!tournamentId || !teamToken) {
    showFormAlert(
      errorAlert,
      "URL に tournamentId と teamToken が必要です。運営から共有されたリンクを開いてください。",
      "error"
    );
    showView("error");
    return;
  }

  try {
    await reload();
  } catch (error) {
    console.error("[player-results] load failed", error);
    const { message } = classifyError(error);
    showFormAlert(errorAlert, message, "error");
    showView("error");
  }
}

init();
