/**
 * 大会結果・大会終了ページ
 */
import { TournamentStatus } from "../../domain/constants.js";
import { isValidTournamentId } from "../../domain/validators.js";
import {
  resolveTournamentFormat,
  TournamentFormat,
  usesLegacyFinalsAdvancement,
} from "../../domain/tournament-format.js";
import { isSingleEliminationBracket } from "../../domain/single-elimination-bracket.js";
import { hasCreatedConsolationBracket } from "../../domain/consolation-bracket.js";
import {
  BracketPlacementMode,
  buildConsolationPlacements,
} from "../../domain/tournament-results.js";
import { BracketKind } from "../../domain/bracket-collections.js";
import { getTournament } from "../../services/tournament-service.js";
import {
  getTournamentResults,
  previewTournamentResults,
  finalizeTournamentResults,
} from "../../services/tournament-results-service.js";
import { getConsolationBracket } from "../../services/consolation-bracket-service.js";
import { getFinalsMatchResults } from "../../services/finals-match-result-service.js";
import { listEntries } from "../../services/entry-service.js";
import {
  buildEntryTeamNameLookup,
  overlayEntryTeamNames,
} from "../../domain/entry-team-name-overlay.js";
import { initTournamentManageGuard } from "../../lib/operator-guard.js";
import {
  classifyError,
  InvalidTournamentIdError,
} from "../../lib/errors.js";
import { showErrorToast, showToast } from "../components/toast.js";
import { confirmDialog } from "../components/confirm-dialog.js";
import { showFormAlert } from "../components/form-errors.js";
import { warnSnapshotRebuildFailure } from "../../lib/public-snapshot-ui.js";

const views = {
  loading: document.getElementById("viewLoading"),
  config: document.getElementById("viewConfig"),
  operatorDenied: document.getElementById("viewOperatorDenied"),
  error: document.getElementById("viewError"),
  incomplete: document.getElementById("viewIncomplete"),
  results: document.getElementById("viewResults"),
};

const headerActions = document.getElementById("headerActions");
const backToDashboardBtn = document.getElementById("backToDashboardBtn");
const openFinalsBracketBtn = document.getElementById("openFinalsBracketBtn");
const incompleteBracketBtn = document.getElementById("incompleteBracketBtn");
const resultsPageTitleEl = document.getElementById("resultsPageTitle");
const resultsMetaEl = document.getElementById("resultsMeta");
const finalizedBadgeEl = document.getElementById("finalizedBadge");
const championLineEl = document.getElementById("championLine");
const runnerUpLineEl = document.getElementById("runnerUpLine");
const closedAtLineEl = document.getElementById("closedAtLine");
const completionMetaEl = document.getElementById("completionMeta");
const placementsBodyEl = document.getElementById("placementsBody");
const placementsTableEl = document.getElementById("placementsTable");
const consolationResultsPanelEl = document.getElementById("consolationResultsPanel");
const consolationStatusLineEl = document.getElementById("consolationStatusLine");
const consolationChampionLineEl = document.getElementById("consolationChampionLine");
const consolationRunnerUpLineEl = document.getElementById("consolationRunnerUpLine");
const consolationPlacementsBodyEl = document.getElementById("consolationPlacementsBody");
const finalizePanelEl = document.getElementById("finalizePanel");
const finalizeResultsBtn = document.getElementById("finalizeResultsBtn");

let tournamentId = null;

function showView(name) {
  Object.entries(views).forEach(([key, el]) => {
    if (el) {
      el.classList.toggle("hidden", key !== name);
    }
  });
  if (headerActions) {
    headerActions.classList.toggle(
      "hidden",
      name !== "results" && name !== "incomplete"
    );
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
  });
}

function buildTournamentDashboardHref(id) {
  return `tournament-dashboard.html?id=${encodeURIComponent(id)}`;
}

function buildFinalsBracketHref(id) {
  return `tournament-finals-bracket.html?id=${encodeURIComponent(id)}`;
}

function setNavigationLinks() {
  backToDashboardBtn.href = buildTournamentDashboardHref(tournamentId);
  openFinalsBracketBtn.href = buildFinalsBracketHref(tournamentId);
  incompleteBracketBtn.href = buildFinalsBracketHref(tournamentId);
}

function shouldHideSeed(tournament, bracket) {
  return (
    resolveTournamentFormat(tournament) === TournamentFormat.SINGLE_ELIMINATION ||
    isSingleEliminationBracket(bracket) ||
    !usesLegacyFinalsAdvancement(tournament)
  );
}

function renderPlacementsTable(tableEl, bodyEl, placements, options = {}) {
  const { hideSeed = false } = options;

  if (tableEl) {
    tableEl.querySelector("thead tr").innerHTML = hideSeed
      ? `
          <th scope="col">チーム</th>
          <th scope="col">到達順位</th>
        `
      : `
          <th scope="col">Seed</th>
          <th scope="col">チーム</th>
          <th scope="col">到達順位</th>
        `;
  }

  bodyEl.innerHTML = (placements ?? [])
    .filter((entry) => entry?.entryId && entry.isBye !== true)
    .map((entry) =>
      hideSeed
        ? `
        <tr>
          <td class="standings-table__team">${escapeHtml(entry.teamName ?? "—")}</td>
          <td>${escapeHtml(entry.placementLabel ?? "—")}</td>
        </tr>
      `
        : `
        <tr>
          <td class="standings-table__rank">${entry.seed ?? "—"}</td>
          <td class="standings-table__team">${escapeHtml(entry.teamName ?? "—")}</td>
          <td>${escapeHtml(entry.placementLabel ?? "—")}</td>
        </tr>
      `
    )
    .join("");
}

function resolveConsolationResultsView({ savedResults, preview, consolationLive }) {
  if (savedResults?.hasConsolation || (savedResults?.consolationPlacements ?? []).length > 0) {
    return {
      visible: true,
      status: savedResults.consolationStatus ?? "complete",
      champion: savedResults.consolationChampion ?? null,
      runnerUp: savedResults.consolationRunnerUp ?? null,
      placements: savedResults.consolationPlacements ?? [],
    };
  }

  if (preview?.hasConsolation || (preview?.consolationPlacements ?? []).length > 0) {
    return {
      visible: true,
      status: preview.consolationStatus ?? "complete",
      champion: preview.consolationChampion ?? null,
      runnerUp: preview.consolationRunnerUp ?? null,
      placements: preview.consolationPlacements ?? [],
    };
  }

  if (consolationLive) {
    return consolationLive;
  }

  return { visible: false };
}

async function loadConsolationResultsForClosedTournament() {
  const [consolationBracket, consolationResultsMap] = await Promise.all([
    getConsolationBracket(tournamentId),
    getFinalsMatchResults(tournamentId, { bracketKind: BracketKind.CONSOLATION }),
  ]);

  if (!hasCreatedConsolationBracket(consolationBracket)) {
    return { visible: false };
  }

  const built = buildConsolationPlacements({
    bracket: consolationBracket,
    resultsMap: consolationResultsMap,
    mode: BracketPlacementMode.PARTIAL,
  });

  return {
    visible: true,
    status: built.status ?? (built.complete ? "complete" : "in_progress"),
    champion: built.champion,
    runnerUp: built.runnerUp,
    placements: built.placements,
  };
}

function renderConsolationResultsSection(consolation, { hideSeed = true } = {}) {
  if (!consolationResultsPanelEl) {
    return;
  }

  if (!consolation?.visible) {
    consolationResultsPanelEl.classList.add("hidden");
    return;
  }

  consolationResultsPanelEl.classList.remove("hidden");

  const status = consolation.status ?? "complete";
  if (consolationStatusLineEl) {
    if (status === "in_progress") {
      consolationStatusLineEl.textContent =
        consolation.placements?.length > 0
          ? "進行中（確定済みの結果のみ表示）"
          : "進行中";
      consolationStatusLineEl.classList.remove("hidden");
    } else {
      consolationStatusLineEl.textContent = "";
      consolationStatusLineEl.classList.add("hidden");
    }
  }

  if (consolationChampionLineEl) {
    consolationChampionLineEl.innerHTML = `<strong>下位トーナメント優勝：</strong>${escapeHtml(
      consolation.champion?.teamName ?? "—"
    )}`;
  }
  if (consolationRunnerUpLineEl) {
    consolationRunnerUpLineEl.innerHTML = `<strong>下位トーナメント準優勝：</strong>${escapeHtml(
      consolation.runnerUp?.teamName ?? "—"
    )}`;
  }

  renderPlacementsTable(
    document.getElementById("consolationPlacementsTable"),
    consolationPlacementsBodyEl,
    consolation.placements ?? [],
    { hideSeed }
  );
}

function renderResultsView(
  tournament,
  { savedResults, preview, finalized, bracket, consolationLive = null }
) {
  const tournamentName = tournament?.name || "（名称未設定）";
  const champion = savedResults?.champion ?? preview?.champion;
  const runnerUp = savedResults?.runnerUp ?? preview?.runnerUp;
  const placements = savedResults?.placements ?? preview?.placements ?? [];
  const hideSeed = shouldHideSeed(tournament, bracket ?? preview?.bracket);

  resultsPageTitleEl.textContent = finalized ? "大会結果（確定済み）" : "大会結果（プレビュー）";
  resultsMetaEl.textContent = tournamentName;
  finalizedBadgeEl.classList.toggle("hidden", !finalized);

  const championSeed =
    hideSeed || champion?.seed == null ? "" : ` (seed ${champion.seed})`;
  const runnerUpSeed =
    hideSeed || runnerUp?.seed == null ? "" : ` (seed ${runnerUp.seed})`;

  championLineEl.innerHTML = `<strong>優勝：</strong>${escapeHtml(champion?.teamName ?? "—")}${championSeed}`;
  runnerUpLineEl.innerHTML = `<strong>準優勝：</strong>${escapeHtml(runnerUp?.teamName ?? "—")}${runnerUpSeed}`;

  if (finalized && tournament?.closedAt) {
    closedAtLineEl.textContent = `終了日時：${formatTimestamp(tournament.closedAt)}`;
    closedAtLineEl.classList.remove("hidden");
  } else {
    closedAtLineEl.classList.add("hidden");
  }

  const completed = savedResults?.completedMatchCount ?? preview?.completedMatchCount ?? "—";
  const expected = savedResults?.expectedMatchCount ?? preview?.expectedMatchCount ?? "—";
  completionMetaEl.textContent = `完了試合：${completed} / ${expected}`;

  renderPlacementsTable(placementsTableEl, placementsBodyEl, placements, { hideSeed });

  const consolation = resolveConsolationResultsView({
    savedResults,
    preview,
    consolationLive,
  });
  renderConsolationResultsSection(consolation, { hideSeed: true });

  finalizePanelEl.classList.toggle("hidden", finalized);
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

  setNavigationLinks();

  try {
    const [tournament, savedResults, entries] = await Promise.all([
      getTournament(tournamentId),
      getTournamentResults(tournamentId),
      listEntries(tournamentId),
    ]);
    const teamNameLookup = buildEntryTeamNameLookup(entries);

    if (savedResults?.finalized || tournament.status === TournamentStatus.CLOSED) {
      let consolationLive = null;
      if (
        !savedResults?.hasConsolation &&
        !(savedResults?.consolationPlacements ?? []).length
      ) {
        consolationLive = await loadConsolationResultsForClosedTournament();
      }
      renderResultsView(tournament, {
        savedResults: overlayEntryTeamNames(savedResults, teamNameLookup),
        preview: null,
        finalized: true,
        consolationLive: overlayEntryTeamNames(consolationLive, teamNameLookup),
      });
      showView("results");
      return;
    }

    let preview;
    try {
      preview = await previewTournamentResults(tournamentId);
    } catch (error) {
      if (error.code === "tournament/not-open") {
        showPageError(classifyError(error).message);
        return;
      }
      throw error;
    }

    if (!preview.canFinalize) {
      showFormAlert(
        document.getElementById("incompleteAlert"),
        preview.message || "大会を終了できる状態ではありません。",
        "error"
      );
      showView("incomplete");
      return;
    }

    renderResultsView(tournament, {
      savedResults: null,
      preview: overlayEntryTeamNames(preview, teamNameLookup),
      finalized: false,
      bracket: overlayEntryTeamNames(preview.bracket, teamNameLookup),
    });
    showView("results");
  } catch (error) {
    console.error("[tournament-results] loadPage failed", error);
    const { message } = classifyError(error);
    showPageError(message);
  }
}

async function handleFinalizeResults() {
  const confirmed = await confirmDialog({
    title: "大会結果の確定",
    message:
      "大会結果を確定し、この大会を終了します。\n\n確定後は試合結果や組み合わせを変更できません。",
    confirmLabel: "大会を終了する",
    cancelLabel: "キャンセル",
  });

  if (!confirmed) {
    return;
  }

  finalizeResultsBtn.disabled = true;

  try {
    const result = await finalizeTournamentResults(tournamentId);
    warnSnapshotRebuildFailure(result);
    showToast("大会結果を確定し、大会を終了しました。");
    await loadPage();
  } catch (error) {
    console.error("[tournament-results] finalize failed", error);
    const { message } = classifyError(error);
    showErrorToast(message);
  } finally {
    finalizeResultsBtn.disabled = false;
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

function initResultsPage() {
  tournamentId = new URLSearchParams(window.location.search).get("id");
  finalizeResultsBtn.addEventListener("click", handleFinalizeResults);

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
  document.addEventListener("DOMContentLoaded", initResultsPage);
} else {
  initResultsPage();
}
