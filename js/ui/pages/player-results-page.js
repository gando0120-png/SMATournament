/**
 * プレイヤー予選結果入力ページ（大会共通URL + チーム選択）
 */
import { isFirebaseConfigured } from "../../lib/firebase-app.js";
import { classifyError } from "../../lib/errors.js";
import { showFormAlert } from "../components/form-errors.js";
import { showToast } from "../components/toast.js";
import { playerOwnSideResultDialog } from "../components/match-result-dialog.js";
import {
  listPlayerTeamChoices,
  listMyQualifyingMatches,
  submitPlayerQualifyingResult,
} from "../../services/player-qualifying-result-service.js";
import { formatTeamStatsLine } from "../../domain/qualifying-match-result.js";
import {
  PlayerMatchUiStatus,
  normalizeTeamNumber,
  filterPlayerTeamChoices,
  formatPlayerTeamChoiceLabel,
} from "../../domain/player-qualifying-submission.js";

const STORAGE_KEY_PREFIX = "sma.playerTeamNumber.";

const views = {
  loading: document.getElementById("viewLoading"),
  config: document.getElementById("viewConfig"),
  error: document.getElementById("viewError"),
  teamNumber: document.getElementById("viewTeamNumber"),
  main: document.getElementById("viewMain"),
};

const tournamentNameEl = document.getElementById("tournamentName");
const teamSummaryEl = document.getElementById("teamSummary");
const gateAlertEl = document.getElementById("gateAlert");
const matchListEl = document.getElementById("matchList");
const configAlert = document.getElementById("configAlert");
const errorAlert = document.getElementById("errorAlert");
const teamSearchInput = document.getElementById("teamSearchInput");
const teamNumberAlert = document.getElementById("teamNumberAlert");
const teamChoiceListEl = document.getElementById("teamChoiceList");
const teamChoiceCountEl = document.getElementById("teamChoiceCount");
const teamPickerTitleEl = document.getElementById("teamPickerTitle");
const teamPickerDescEl = document.getElementById("teamPickerDesc");
const changeTeamBtn = document.getElementById("changeTeamBtn");

let tournamentId = null;
/** @type {{ teamNumber?: string|number, teamToken?: string }} */
let identity = {};
let currentPayload = null;
/** @type {Array<{ teamNumber: number, teamNumberLabel: string, teamName: string }>} */
let allTeamChoices = [];
let selectedTeamNumber = null;

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

function storageKey() {
  return `${STORAGE_KEY_PREFIX}${tournamentId}`;
}

function rememberTeamNumber(value) {
  try {
    sessionStorage.setItem(storageKey(), String(value));
  } catch {
    // ignore
  }
}

function clearRememberedTeamNumber() {
  try {
    sessionStorage.removeItem(storageKey());
  } catch {
    // ignore
  }
}

function readRememberedTeamNumber() {
  try {
    return sessionStorage.getItem(storageKey());
  } catch {
    return null;
  }
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

function clearTeamAlert() {
  if (teamNumberAlert) {
    teamNumberAlert.classList.add("hidden");
    teamNumberAlert.textContent = "";
  }
}

function renderTeamChoices(query = "") {
  if (!teamChoiceListEl) {
    return;
  }
  const filtered = filterPlayerTeamChoices(allTeamChoices, query);
  if (teamChoiceCountEl) {
    if (!allTeamChoices.length) {
      teamChoiceCountEl.textContent = "表示できる確定参加チームがありません。";
    } else if (!filtered.length) {
      teamChoiceCountEl.textContent = "該当するチームがありません。";
    } else {
      teamChoiceCountEl.textContent = `${filtered.length} / ${allTeamChoices.length} チーム`;
    }
  }

  if (!filtered.length) {
    teamChoiceListEl.innerHTML = `<p class="team-choice-empty">${
      allTeamChoices.length ? "検索条件に一致するチームがありません。" : "確定済みの参加チームがありません。"
    }</p>`;
    return;
  }

  teamChoiceListEl.innerHTML = filtered
    .map((choice) => {
      const selected =
        selectedTeamNumber != null && Number(selectedTeamNumber) === Number(choice.teamNumber);
      return `
        <button
          type="button"
          class="team-choice-item${selected ? " is-selected" : ""}"
          role="option"
          aria-selected="${selected ? "true" : "false"}"
          data-team-number="${escapeHtml(String(choice.teamNumber))}"
        >
          <span class="team-choice-item__number">${escapeHtml(choice.teamNumberLabel)}</span>
          <span class="team-choice-item__name">${escapeHtml(choice.teamName)}</span>
        </button>
      `;
    })
    .join("");

  teamChoiceListEl.querySelectorAll("[data-team-number]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const value = btn.getAttribute("data-team-number");
      selectedTeamNumber = value;
      enterWithTeamNumber(value);
    });
  });
}

async function loadTeamChoices() {
  const payload = await listPlayerTeamChoices(tournamentId);
  allTeamChoices = Array.isArray(payload.teams) ? payload.teams : [];
  if (teamPickerTitleEl) {
    teamPickerTitleEl.textContent = payload.tournamentName
      ? `${payload.tournamentName}`
      : "チームを選択してください";
  }
  if (teamPickerDescEl) {
    teamPickerDescEl.textContent = payload.participantResultEntryEnabled
      ? "自チームを選ぶと、そのチームの予選試合だけが表示されます。"
      : "この大会ではプレイヤーによる結果入力が無効です。運営にお問い合わせください。";
  }
  renderTeamChoices(teamSearchInput?.value || "");
  return payload;
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
  const ownName =
    match.side === "team1" ? match.team1.teamName : match.team2.teamName;
  const opponentName =
    match.side === "team1" ? match.team2.teamName : match.team1.teamName;
  const initialValues = match.mySubmission
    ? {
        set1OwnScore: match.mySubmission.set1OwnScore,
        set2OwnScore: match.mySubmission.set2OwnScore,
      }
    : {};

  const clientRequestId =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;

  await playerOwnSideResultDialog({
    title: "予選結果を送信",
    teamName: ownName,
    opponentName,
    initialValues,
    submitLabel: "送信する",
    onSubmit: async (values) => {
      const result = await submitPlayerQualifyingResult(tournamentId, {
        ...identity,
        matchId: match.matchId,
        set1OwnScore: values.set1OwnScore,
        set2OwnScore: values.set2OwnScore,
        clientRequestId,
      });
      showToast(result.message || "送信しました。");
      await reload();
    },
  });
}

async function reload() {
  currentPayload = await listMyQualifyingMatches(tournamentId, identity);
  tournamentNameEl.textContent = currentPayload.tournamentName || "大会";
  const numberLabel = currentPayload.teamNumberLabel || currentPayload.teamNumber || "—";
  teamSummaryEl.textContent = formatPlayerTeamChoiceLabel({
    teamNumberLabel: numberLabel,
    teamName: currentPayload.teamName,
  });
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

async function showTeamPicker(message = "") {
  clearTeamAlert();
  if (message) {
    showFormAlert(teamNumberAlert, message, "error");
  }
  showView("loading");
  try {
    await loadTeamChoices();
    showView("teamNumber");
    teamSearchInput?.focus();
  } catch (error) {
    console.error("[player-results] team choices failed", error);
    const { message: errMessage } = classifyError(error);
    showFormAlert(errorAlert, errMessage, "error");
    showView("error");
  }
}

async function enterWithTeamNumber(raw) {
  const normalized = normalizeTeamNumber(raw);
  if (!normalized.valid) {
    showFormAlert(teamNumberAlert, normalized.message, "error");
    return;
  }
  identity = { teamNumber: normalized.value };
  selectedTeamNumber = normalized.value;
  showView("loading");
  try {
    await reload();
    rememberTeamNumber(normalized.value);
  } catch (error) {
    console.error("[player-results] load failed", error);
    const { message } = classifyError(error);
    await showTeamPicker(message);
  }
}

async function init() {
  const params = new URLSearchParams(window.location.search);
  tournamentId = params.get("tournamentId");
  const legacyToken = params.get("teamToken");

  if (!isFirebaseConfigured()) {
    showFormAlert(configAlert, "Firebase 設定が未入力です。", "error");
    showView("config");
    return;
  }

  if (!tournamentId) {
    showFormAlert(
      errorAlert,
      "URL に tournamentId が必要です。運営が掲示したQRコードから開いてください。",
      "error"
    );
    showView("error");
    return;
  }

  if (legacyToken) {
    identity = { teamToken: legacyToken };
    showView("loading");
    try {
      await reload();
    } catch (error) {
      console.error("[player-results] legacy token load failed", error);
      const { message } = classifyError(error);
      showFormAlert(errorAlert, message, "error");
      showView("error");
    }
    return;
  }

  const remembered = readRememberedTeamNumber();
  if (remembered) {
    await enterWithTeamNumber(remembered);
    return;
  }

  await showTeamPicker();
}

teamSearchInput?.addEventListener("input", () => {
  renderTeamChoices(teamSearchInput.value);
});

changeTeamBtn?.addEventListener("click", () => {
  clearRememberedTeamNumber();
  identity = {};
  currentPayload = null;
  selectedTeamNumber = null;
  if (teamSearchInput) {
    teamSearchInput.value = "";
  }
  showTeamPicker();
});

init();
