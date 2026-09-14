/**
 * 大会スケジュール一覧ページ（管理 / 公開）
 */
import { isValidTournamentId } from "../../domain/validators.js";
import {
  buildScheduleOverview,
  buildScheduleOverviewFromSnapshot,
} from "../../domain/schedule-overview.js";
import { isTournamentDeleted } from "../../domain/tournament-deletion.js";
import { isFirebaseConfigured } from "../../lib/firebase-app.js";
import {
  classifyError,
  InvalidTournamentIdError,
} from "../../lib/errors.js";
import { showFormAlert } from "../components/form-errors.js";
import {
  renderAllMatchesHtml,
  renderScheduleOverviewPrintHtml,
  renderTeamScheduleHtml,
  renderTeamSelectHtml,
  scheduleOverviewDocumentTitle,
} from "../schedule-overview-render.js";

const views = {
  loading: document.getElementById("viewLoading"),
  config: document.getElementById("viewConfig"),
  operatorDenied: document.getElementById("viewOperatorDenied"),
  error: document.getElementById("viewError"),
  content: document.getElementById("viewContent"),
};

const headerActions = document.getElementById("headerActions");
const backBtn = document.getElementById("backBtn");
const overviewTitle = document.getElementById("overviewTitle");
const overviewMeta = document.getElementById("overviewMeta");
const modeAllBtn = document.getElementById("modeAllBtn");
const modeTeamBtn = document.getElementById("modeTeamBtn");
const printBtn = document.getElementById("printBtn");
const printHint = document.getElementById("printHint");
const teamSelectWrap = document.getElementById("teamSelectWrap");
const overviewRoot = document.getElementById("overviewRoot");
const printRoot = document.getElementById("printRoot");

let tournamentId = null;
let isPublicView = false;
/** @type {object|null} */
let overview = null;
/** @type {"all"|"team"} */
let mode = "all";
/** @type {string} */
let selectedTeamId = "";

function showView(name) {
  Object.entries(views).forEach(([key, el]) => {
    if (el) {
      el.classList.toggle("hidden", key !== name);
    }
  });
  headerActions?.classList.toggle("hidden", name !== "content" && name !== "error");
}

function readParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    tournamentId: params.get("id")?.trim() ?? "",
    isPublic: params.get("public") === "1",
    teamId: params.get("team")?.trim() ?? "",
    mode: params.get("view") === "team" ? "team" : "all",
  };
}

function buildBackHref() {
  if (!isValidTournamentId(tournamentId)) {
    return "index.html";
  }
  if (isPublicView) {
    return `tournament-public.html?id=${encodeURIComponent(tournamentId)}`;
  }
  return `tournament-dashboard.html?id=${encodeURIComponent(tournamentId)}`;
}

function syncUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set("id", tournamentId);
  if (isPublicView) {
    url.searchParams.set("public", "1");
  } else {
    url.searchParams.delete("public");
  }
  if (mode === "team") {
    url.searchParams.set("view", "team");
  } else {
    url.searchParams.delete("view");
  }
  if (mode === "team" && selectedTeamId) {
    url.searchParams.set("team", selectedTeamId);
  } else {
    url.searchParams.delete("team");
  }
  window.history.replaceState({}, "", url);
}

function setMode(nextMode) {
  mode = nextMode === "team" ? "team" : "all";
  modeAllBtn?.classList.toggle("btn--primary", mode === "all");
  modeAllBtn?.classList.toggle("btn--ghost", mode !== "all");
  modeTeamBtn?.classList.toggle("btn--primary", mode === "team");
  modeTeamBtn?.classList.toggle("btn--ghost", mode !== "team");
  modeAllBtn?.setAttribute("aria-selected", mode === "all" ? "true" : "false");
  modeTeamBtn?.setAttribute("aria-selected", mode === "team" ? "true" : "false");
  renderOverview();
  syncUrl();
}

function renderOverview() {
  if (!overview || !overviewRoot) {
    return;
  }
  const tournament = overview.tournament ?? {};
  if (overviewTitle) {
    overviewTitle.textContent = tournament.name || "大会スケジュール";
  }
  if (overviewMeta) {
    overviewMeta.textContent = [tournament.eventDateLabel, tournament.venue]
      .filter((part) => part && part !== "—")
      .join(" ／ ") || "—";
  }
  document.title = scheduleOverviewDocumentTitle(overview, {
    mode,
    teamName: overview.teams?.find((team) => team.entryId === selectedTeamId)?.teamName,
  });

  if (teamSelectWrap) {
    teamSelectWrap.classList.toggle("hidden", mode !== "team");
    if (mode === "team") {
      teamSelectWrap.innerHTML = renderTeamSelectHtml(overview, selectedTeamId);
      document.getElementById("teamSelect")?.addEventListener("change", (event) => {
        selectedTeamId = event.target.value || "";
        renderOverview();
        syncUrl();
      });
    }
  }

  overviewRoot.innerHTML =
    mode === "team"
      ? renderTeamScheduleHtml(overview, selectedTeamId)
      : renderAllMatchesHtml(overview);

  if (printRoot) {
    printRoot.innerHTML = renderScheduleOverviewPrintHtml(overview, {
      mode,
      teamId: mode === "team" ? selectedTeamId : null,
    });
  }
}

function showPageError(message) {
  showFormAlert(document.getElementById("errorAlert"), message, "error");
  showView("error");
}

async function loadPublicOverview() {
  const { loadPublicSnapshot } = await import("../../services/public-tournament-service.js");
  const snapshot = await loadPublicSnapshot(tournamentId);
  if (snapshot.tournament?.isDeleted === true) {
    throw new Error("この大会は削除されています。");
  }
  overview = buildScheduleOverviewFromSnapshot(snapshot);
}

async function loadAdminOverview() {
  const { loadOperatorTournamentData } = await import(
    "../../services/public-tournament-snapshot-service.js"
  );
  const data = await loadOperatorTournamentData(tournamentId);
  if (!data.tournament) {
    throw new Error("大会が見つかりません。");
  }
  if (isTournamentDeleted(data.tournament)) {
    throw new Error("この大会は削除されています。");
  }
  overview = buildScheduleOverview(data);
}

async function loadPage() {
  showView("loading");
  if (!isFirebaseConfigured()) {
    showFormAlert(
      document.getElementById("configAlert"),
      "Firebase 設定が必要です。",
      "error"
    );
    showView("config");
    return;
  }
  if (!isValidTournamentId(tournamentId)) {
    const { message } = classifyError(new InvalidTournamentIdError());
    showPageError(message);
    return;
  }

  try {
    if (isPublicView) {
      await loadPublicOverview();
    } else {
      await loadAdminOverview();
    }
    showView("content");
    headerActions?.classList.remove("hidden");
    renderOverview();
  } catch (error) {
    if (error?.code === "tournament/public-snapshot-not-ready") {
      showPageError("公開スケジュールの準備中です。しばらくしてから再度お試しください。");
      return;
    }
    const classified = classifyError(error);
    showPageError(classified.message || error.message || "スケジュールを表示できません。");
  }
}

function bindChrome() {
  if (backBtn) {
    backBtn.href = buildBackHref();
  }
  modeAllBtn?.addEventListener("click", () => setMode("all"));
  modeTeamBtn?.addEventListener("click", () => setMode("team"));
  printBtn?.addEventListener("click", () => {
    printHint?.classList.remove("hidden");
    window.print();
  });
  printHint?.classList.remove("hidden");
}

function start() {
  const params = readParams();
  tournamentId = params.tournamentId;
  isPublicView = params.isPublic;
  selectedTeamId = params.teamId;
  mode = params.teamId ? "team" : params.mode;
  bindChrome();

  if (isPublicView) {
    loadPage();
    return;
  }

  import("../../lib/operator-guard.js").then(({ initTournamentManageGuard }) => {
    initTournamentManageGuard({
      tournamentId,
      onConfigRequired() {
        showFormAlert(
          document.getElementById("configAlert"),
          "Firebase 設定が必要です。",
          "error"
        );
        showView("config");
      },
      onAccessDenied() {
        showFormAlert(
          document.getElementById("operatorDeniedAlert"),
          "この大会を管理する権限がありません。",
          "warning"
        );
        showView("operatorDenied");
      },
      onReady() {
        loadPage();
      },
    });
  });
}

start();
