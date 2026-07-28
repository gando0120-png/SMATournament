/**
 * 決勝試合画面
 */
import {
  FinalsMatchDisplayStatus,
  getFinalsMatchDisplayStatusLabel,
  resolveFinalsMatchTeams,
  evaluateFinalsMatchStart,
  findBracketMatch,
  shouldOpenFinalsMatchScoreEntryOnLoad,
} from "../../domain/finals-match-progress.js";
import {
  buildFinalsMatchResultInitialValues,
  formatFinalsMatchResultDetail,
} from "../../domain/finals-match-result.js";
import { MatchResultStatus, MatchSessionStatus } from "../../domain/constants.js";
import { isValidTournamentId } from "../../domain/validators.js";
import { getTournament } from "../../services/tournament-service.js";
import { getFinalsBracket } from "../../services/finals-bracket-service.js";
import { getConsolationBracket } from "../../services/consolation-bracket-service.js";
import { BracketKind } from "../../domain/bracket-collections.js";
import {
  buildBracketPageHref,
  resolveMatchPageBracketKind,
} from "../consolation-bracket-ui.js";
import { formatFinalsMatchCourtLabel } from "../../domain/finals-bracket-display.js";
import {
  getFinalsMatchResult,
  getFinalsMatchResults,
  saveFinalsMatchResult,
  ensureFinalsByeResults,
} from "../../services/finals-match-result-service.js";
import {
  getFinalsMatchSession,
  getFinalsMatchSessions,
  startFinalsMatchSession,
} from "../../services/finals-match-session-service.js";
import { initTournamentManageGuard } from "../../lib/operator-guard.js";
import {
  classifyError,
  InvalidTournamentIdError,
  InvalidMatchIdError,
} from "../../lib/errors.js";
import { showErrorToast, showToast } from "../components/toast.js";
import { confirmDialog } from "../components/confirm-dialog.js";
import { showFormAlert } from "../components/form-errors.js";
import { warnSnapshotRebuildFailure } from "../../lib/public-snapshot-ui.js";
import { finalsMatchResultDialog } from "../components/finals-match-result-dialog.js";

const views = {
  loading: document.getElementById("viewLoading"),
  config: document.getElementById("viewConfig"),
  operatorDenied: document.getElementById("viewOperatorDenied"),
  error: document.getElementById("viewError"),
  match: document.getElementById("viewMatch"),
};

const headerActions = document.getElementById("headerActions");
const backToBracketBtn = document.getElementById("backToBracketBtn");
const matchTournamentNameEl = document.getElementById("matchTournamentName");
const matchMetaEl = document.getElementById("matchMeta");
const matchTeam1NameEl = document.getElementById("matchTeam1Name");
const matchTeam2NameEl = document.getElementById("matchTeam2Name");
const matchStatusBadgeEl = document.getElementById("matchStatusBadge");
const matchStartedAtEl = document.getElementById("matchStartedAt");
const matchResultPanelEl = document.getElementById("matchResultPanel");
const matchStartPanelEl = document.getElementById("matchStartPanel");
const matchPlayingPanelEl = document.getElementById("matchPlayingPanel");
const startMatchBtn = document.getElementById("startMatchBtn");
const enterResultBtn = document.getElementById("enterResultBtn");
const editResultBtn = document.getElementById("editResultBtn");

let tournamentId = null;
let matchId = null;
let bracketKind = BracketKind.MAIN;
let currentBracket = null;
let currentMatch = null;
let shouldAutoEnterResult = false;

function getBracketServiceOptions() {
  return { bracketKind };
}

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

function buildFinalsBracketHref(id) {
  return buildBracketPageHref(id, bracketKind);
}

function clearEnterResultQueryParam() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("enterResult")) {
    return;
  }
  url.searchParams.delete("enterResult");
  history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
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

function formatTeamLabel(team) {
  if (!team) {
    return "—";
  }
  const seed = team.seed != null ? ` (seed ${team.seed})` : "";
  return `${team.teamName ?? "—"}${seed}`;
}

function getStatusBadgeDataset(displayStatus) {
  if (displayStatus === FinalsMatchDisplayStatus.FINISHED) {
    return "confirmed";
  }
  if (displayStatus === FinalsMatchDisplayStatus.PLAYING) {
    return "open";
  }
  return "draft";
}

function resolveDisplayTeams(match, bracket, resultsMap, session, result) {
  if (session?.team1 && session?.team2) {
    return { team1: session.team1, team2: session.team2 };
  }
  if (result?.team1 && result?.team2) {
    return { team1: result.team1, team2: result.team2 };
  }
  return resolveFinalsMatchTeams({ match, bracket, resultsMap });
}

function renderFinishedResultPanel(result, team1Name, team2Name) {
  const detail = formatFinalsMatchResultDetail(result);
  const setLines = detail.sets
    .map(
      (set) =>
        `<li><strong>${escapeHtml(set.label)}</strong> ${escapeHtml(set.scoreLine)}（${escapeHtml(set.winnerLabel)}）</li>`
    )
    .join("");

  const winnerName =
    result.winnerSide === "team1" ? team1Name : team2Name;

  matchResultPanelEl.innerHTML = `
    <h3 class="match-screen__result-title">試合結果</h3>
    <p class="panel__desc"><strong>勝者：</strong>${escapeHtml(winnerName)}</p>
    <p class="panel__desc">セット勝数：${detail.team1SetWins} - ${detail.team2SetWins}</p>
    ${setLines ? `<ul class="match-screen__set-list">${setLines}</ul>` : ""}
  `;
  matchResultPanelEl.classList.remove("hidden");
}

function renderMatchView(tournament, { match, bracket, resultsMap, session, result, displayStatus }) {
  const teams = resolveDisplayTeams(match, bracket, resultsMap, session, result);
  const team1 = teams.team1;
  const team2 = teams.team2;

  matchTournamentNameEl.textContent = tournament?.name || "（名称未設定）";
  matchMetaEl.textContent = `${match.roundLabel ?? "—"} / ${formatFinalsMatchCourtLabel(match.matchNumber)}`;
  matchTeam1NameEl.textContent = formatTeamLabel(team1);
  matchTeam2NameEl.textContent = formatTeamLabel(team2);

  matchStatusBadgeEl.textContent = getFinalsMatchDisplayStatusLabel(displayStatus);
  matchStatusBadgeEl.dataset.status = getStatusBadgeDataset(displayStatus);

  if (session?.startedAt) {
    matchStartedAtEl.textContent = `開始：${formatTimestamp(session.startedAt)}`;
    matchStartedAtEl.classList.remove("hidden");
  } else {
    matchStartedAtEl.classList.add("hidden");
  }

  matchStartPanelEl.classList.add("hidden");
  matchPlayingPanelEl.classList.add("hidden");
  matchResultPanelEl.classList.add("hidden");
  editResultBtn.classList.add("hidden");

  if (displayStatus === FinalsMatchDisplayStatus.FINISHED && result) {
    renderFinishedResultPanel(result, team1?.teamName ?? "チーム1", team2?.teamName ?? "チーム2");
    editResultBtn.classList.remove("hidden");
    matchPlayingPanelEl.classList.remove("hidden");
    enterResultBtn.classList.add("hidden");
    editResultBtn.textContent = "結果を修正";
    return;
  }

  if (displayStatus === FinalsMatchDisplayStatus.PLAYING) {
    matchPlayingPanelEl.classList.remove("hidden");
    enterResultBtn.classList.remove("hidden");
    return;
  }

  if (displayStatus === FinalsMatchDisplayStatus.READY) {
    matchStartPanelEl.classList.remove("hidden");
  }
}

function showPageError(message) {
  showFormAlert(document.getElementById("errorAlert"), message, "error");
  showView("error");
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

  backToBracketBtn.href = buildFinalsBracketHref(tournamentId);

  try {
    await ensureFinalsByeResults(tournamentId, getBracketServiceOptions());

    const serviceOptions = getBracketServiceOptions();
    const loadBracket =
      bracketKind === BracketKind.CONSOLATION ? getConsolationBracket : getFinalsBracket;

    const [tournament, bracket, resultsMap, sessionsMap, session, result] = await Promise.all([
      getTournament(tournamentId),
      loadBracket(tournamentId),
      getFinalsMatchResults(tournamentId, serviceOptions),
      getFinalsMatchSessions(tournamentId, serviceOptions),
      getFinalsMatchSession(tournamentId, matchId, serviceOptions),
      getFinalsMatchResult(tournamentId, matchId, serviceOptions),
    ]);

    if (!bracket?.finalized) {
      showPageError("トーナメントが未確定です。");
      return;
    }

    const match = findBracketMatch(bracket, matchId);
    if (!match) {
      showPageError("トーナメント表に存在しない試合です。");
      return;
    }

    currentBracket = bracket;
    currentMatch = match;

    let displayStatus = FinalsMatchDisplayStatus.WAITING_OPPONENT;
    if (result?.status === MatchResultStatus.FINISHED) {
      displayStatus = FinalsMatchDisplayStatus.FINISHED;
    } else if (session?.status === MatchSessionStatus.PLAYING) {
      displayStatus = FinalsMatchDisplayStatus.PLAYING;
    } else {
      const evaluation = evaluateFinalsMatchStart({
        match,
        bracket,
        resultsMap,
        sessionsMap,
      });
      if (evaluation.canStart) {
        displayStatus = FinalsMatchDisplayStatus.READY;
      }
    }

    renderMatchView(tournament, {
      match,
      bracket,
      resultsMap,
      session,
      result,
      displayStatus,
    });
    showView("match");

    if (shouldAutoEnterResult) {
      const openScoreEntry = shouldOpenFinalsMatchScoreEntryOnLoad(displayStatus, true);
      shouldAutoEnterResult = false;
      clearEnterResultQueryParam();
      if (openScoreEntry) {
        await openResultDialog(false);
      }
    }
  } catch (error) {
    const { message } = classifyError(error);
    showPageError(message);
  }
}

async function handleStartMatch() {
  const confirmed = await confirmDialog({
    title: "試合開始",
    message: "この決勝試合を開始しますか？",
    confirmLabel: "試合開始",
    cancelLabel: "キャンセル",
  });

  if (!confirmed) {
    return;
  }

  startMatchBtn.disabled = true;

  try {
    await startFinalsMatchSession(tournamentId, matchId, getBracketServiceOptions());
    showToast("試合を開始しました。");
    shouldAutoEnterResult = true;
    await loadPage();
  } catch (error) {
    const { message } = classifyError(error);
    showErrorToast(message);
  } finally {
    startMatchBtn.disabled = false;
  }
}

async function openResultDialog(isEdit) {
  const serviceOptions = getBracketServiceOptions();
  const session = await getFinalsMatchSession(tournamentId, matchId, serviceOptions);
  const existingResult = await getFinalsMatchResult(tournamentId, matchId, serviceOptions);

  if (!session && !existingResult) {
    showErrorToast("試合が開始されていません。");
    return;
  }

  const team1Name = session?.team1?.teamName ?? existingResult?.team1?.teamName ?? "チーム1";
  const team2Name = session?.team2?.teamName ?? existingResult?.team2?.teamName ?? "チーム2";

  await finalsMatchResultDialog({
    title: isEdit ? "結果を修正" : "結果を入力",
    team1Name,
    team2Name,
    submitLabel: isEdit ? "修正を保存" : "結果を確定",
    initialValues: buildFinalsMatchResultInitialValues(existingResult),
    onSubmit: async (values) => {
      const result = await saveFinalsMatchResult(
        tournamentId,
        matchId,
        values,
        getBracketServiceOptions()
      );
      warnSnapshotRebuildFailure(result);
      showToast(isEdit ? "結果を修正しました。" : "結果を保存しました。");
      await loadPage();
    },
  });
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

function initFinalsMatchPage() {
  const searchParams = new URLSearchParams(window.location.search);
  tournamentId = searchParams.get("id");
  matchId = searchParams.get("matchId");
  shouldAutoEnterResult = searchParams.get("enterResult") === "1";

  try {
    bracketKind = resolveMatchPageBracketKind(searchParams);
  } catch (error) {
    const { message } = classifyError(error);
    showPageError(message);
    return;
  }

  startMatchBtn.addEventListener("click", handleStartMatch);
  enterResultBtn.addEventListener("click", () => openResultDialog(false));
  editResultBtn.addEventListener("click", () => openResultDialog(true));

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
  document.addEventListener("DOMContentLoaded", initFinalsMatchPage);
} else {
  initFinalsMatchPage();
}
