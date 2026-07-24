/**
 * 大会管理ダッシュボード
 */
import {
  TournamentStatus,
  EntryStatus,
  getTournamentStatusLabel,
} from "../../domain/constants.js";
import { isValidTournamentId } from "../../domain/validators.js";
import {
  getTournament,
  updateTournamentStatus,
  updateTournamentPublicView,
} from "../../services/tournament-service.js";
import { rebuildPublicTournamentSnapshot } from "../../services/public-tournament-snapshot-service.js";
import { warnSnapshotRebuildFailure } from "../../lib/public-snapshot-ui.js";
import { listEntries } from "../../services/entry-service.js";
import { getBlockDraw, runBlockDraw } from "../../services/block-draw-service.js";
import { getFinalsAdvancement } from "../../services/finals-advancement-service.js";
import { getFinalsBracket } from "../../services/finals-bracket-service.js";
import { getFinalsMatchResults } from "../../services/finals-match-result-service.js";
import {
  getTournamentResults,
} from "../../services/tournament-results-service.js";
import { validateTournamentCompletion } from "../../domain/tournament-results.js";
import { isPublicViewEnabled } from "../../domain/public-tournament-view.js";
import { initOperatorGuard } from "../../lib/operator-guard.js";
import {
  classifyError,
  InvalidTournamentIdError,
} from "../../lib/errors.js";
import { showErrorToast, showToast } from "../components/toast.js";
import { confirmDialog } from "../components/confirm-dialog.js";
import { showFormAlert } from "../components/form-errors.js";

const views = {
  loading: document.getElementById("viewLoading"),
  config: document.getElementById("viewConfig"),
  operatorDenied: document.getElementById("viewOperatorDenied"),
  error: document.getElementById("viewError"),
  dashboard: document.getElementById("viewDashboard"),
};

const headerActions = document.getElementById("headerActions");
const tournamentNameEl = document.getElementById("tournamentName");
const tournamentMetaEl = document.getElementById("tournamentMeta");
const statusBadgeEl = document.getElementById("statusBadge");
const tournamentInfoEl = document.getElementById("tournamentInfo");
const entryUrlEl = document.getElementById("entryUrl");
const copyUrlBtn = document.getElementById("copyUrlBtn");
const publicPageUrlEl = document.getElementById("publicPageUrl");
const copyPublicUrlBtn = document.getElementById("copyPublicUrlBtn");
const openPublicPageBtn = document.getElementById("openPublicPageBtn");
const publicPageDescEl = document.getElementById("publicPageDesc");
const publicViewSelectEl = document.getElementById("publicViewSelect");
const rebuildPublicSnapshotBtn = document.getElementById("rebuildPublicSnapshotBtn");
const openEntryBtn = document.getElementById("openEntryBtn");
const openEntryDescEl = document.getElementById("openEntryDesc");
const entryTotalCountEl = document.getElementById("entryTotalCount");
const entryPendingCountEl = document.getElementById("entryPendingCount");
const entryConfirmedCountEl = document.getElementById("entryConfirmedCount");
const entryMaxTeamsEl = document.getElementById("entryMaxTeams");
const openEntriesManageBtn = document.getElementById("openEntriesManageBtn");
const blockDrawBtn = document.getElementById("blockDrawBtn");
const blockDrawDescEl = document.getElementById("blockDrawDesc");
const blockDrawEmptyEl = document.getElementById("blockDrawEmpty");
const blockDrawResultsEl = document.getElementById("blockDrawResults");
const openScheduleBtn = document.getElementById("openScheduleBtn");
const openStandingsBtn = document.getElementById("openStandingsBtn");
const openFinalsAdvancementBtn = document.getElementById("openFinalsAdvancementBtn");
const openFinalsAdvancementPrimaryBtn = document.getElementById("openFinalsAdvancementPrimaryBtn");
const finalsBracketDescEl = document.getElementById("finalsBracketDesc");
const openFinalsBracketPrimaryBtn = document.getElementById("openFinalsBracketPrimaryBtn");
const closedSummaryPanelEl = document.getElementById("closedSummaryPanel");
const closedSummaryLineEl = document.getElementById("closedSummaryLine");
const openTournamentResultsBtn = document.getElementById("openTournamentResultsBtn");
const finalizeResultsPanelEl = document.getElementById("finalizeResultsPanel");
const openFinalizeResultsBtn = document.getElementById("openFinalizeResultsBtn");
const dashboardOperationsEl = document.getElementById("dashboardOperations");
const closedViewLinksPanelEl = document.getElementById("closedViewLinksPanel");
const closedEntriesBtn = document.getElementById("closedEntriesBtn");
const closedScheduleBtn = document.getElementById("closedScheduleBtn");
const closedStandingsBtn = document.getElementById("closedStandingsBtn");
const closedFinalsBracketBtn = document.getElementById("closedFinalsBracketBtn");
const closedResultsBtn = document.getElementById("closedResultsBtn");

let tournamentId = null;
let currentTournament = null;
let currentEntries = [];

function showView(name) {
  Object.entries(views).forEach(([key, el]) => {
    if (el) {
      el.classList.toggle("hidden", key !== name);
    }
  });
  if (headerActions) {
    headerActions.classList.toggle("hidden", name !== "dashboard");
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

function buildPublicPageUrl(id) {
  const url = new URL("tournament-public.html", window.location.href);
  url.searchParams.set("id", id);
  return url.href;
}

function buildEntryUrl(id) {
  const url = new URL("entry.html", window.location.href);
  url.searchParams.set("id", id);
  return url.href;
}

function renderInfoRow(label, value) {
  return `
    <div class="info-list__row">
      <dt>${escapeHtml(label)}</dt>
      <dd>${escapeHtml(value)}</dd>
    </div>
  `;
}

function renderTournament(tournament) {
  currentTournament = tournament;
  const statusLabel = getTournamentStatusLabel(tournament.status);

  tournamentNameEl.textContent = tournament.name || "（名称未設定）";
  tournamentMetaEl.textContent = `開催日: ${tournament.eventDate || "—"} / 会場: ${tournament.venue || "—"}`;
  statusBadgeEl.textContent = statusLabel;
  statusBadgeEl.dataset.status = tournament.status || "";

  const infoRows = [
    renderInfoRow("大会名", tournament.name || "—"),
    renderInfoRow("開催日", tournament.eventDate || "—"),
    renderInfoRow("会場", tournament.venue || "—"),
    renderInfoRow("エントリー締切", formatTimestamp(tournament.entryDeadline)),
    renderInfoRow("募集チーム数", String(tournament.maxTeams ?? "—")),
    renderInfoRow("1チームの人数", String(tournament.teamSize ?? "—")),
    renderInfoRow("使用コート数", String(tournament.courtCount ?? "—")),
    renderInfoRow("ブロック基本人数", String(tournament.preferredBlockSize ?? "—")),
    renderInfoRow("状態", statusLabel),
  ];

  if (tournament.status === TournamentStatus.CLOSED && tournament.closedAt) {
    infoRows.push(renderInfoRow("終了日時", formatTimestamp(tournament.closedAt)));
  }

  tournamentInfoEl.innerHTML = infoRows.join("");

  entryUrlEl.value = buildEntryUrl(tournament.id);

  if (publicPageUrlEl) {
    publicPageUrlEl.value = buildPublicPageUrl(tournament.id);
  }
  if (openPublicPageBtn) {
    openPublicPageBtn.href = buildPublicPageUrl(tournament.id);
  }
  if (publicPageDescEl) {
    publicPageDescEl.textContent = isPublicViewEnabled(tournament)
      ? "プレイヤー向けの大会閲覧ページ URL です。ログイン不要で閲覧できます。"
      : "現在、公開ページは停止中です。";
  }
  if (publicViewSelectEl) {
    publicViewSelectEl.value = isPublicViewEnabled(tournament) ? "true" : "false";
  }
  if (openPublicPageBtn) {
    openPublicPageBtn.classList.toggle("hidden", !isPublicViewEnabled(tournament));
  }

  const isDraft = tournament.status === TournamentStatus.DRAFT;
  const isOpen = tournament.status === TournamentStatus.OPEN;

  if (isDraft) {
    openEntryBtn.classList.remove("hidden");
    openEntryBtn.disabled = false;
    openEntryDescEl.textContent =
      "下書き状態です。「エントリー受付を開始」で公開受付を開始します。";
  } else if (isOpen) {
    openEntryBtn.classList.add("hidden");
    openEntryDescEl.textContent = "エントリー受付中です。公開 URL から申込を受け付けられます。";
  } else {
    openEntryBtn.classList.add("hidden");
    openEntryDescEl.textContent = `現在の状態: ${statusLabel}`;
  }
}

function buildTournamentEntriesHref(id) {
  return `tournament-entries.html?id=${encodeURIComponent(id)}`;
}

function buildTournamentScheduleHref(id) {
  return `tournament-schedule.html?id=${encodeURIComponent(id)}`;
}

function buildTournamentStandingsHref(id) {
  return `tournament-standings.html?id=${encodeURIComponent(id)}`;
}

function buildTournamentResultsHref(id) {
  return `tournament-results.html?id=${encodeURIComponent(id)}`;
}

function buildTournamentFinalsAdvancementHref(id) {
  return `tournament-finals-advancement.html?id=${encodeURIComponent(id)}`;
}

function buildTournamentFinalsBracketHref(id) {
  return `tournament-finals-bracket.html?id=${encodeURIComponent(id)}`;
}

function setTournamentNavigationLinks() {
  if (!isValidTournamentId(tournamentId)) {
    return;
  }
  const scheduleHref = buildTournamentScheduleHref(tournamentId);
  const standingsHref = buildTournamentStandingsHref(tournamentId);
  const finalsHref = buildTournamentFinalsAdvancementHref(tournamentId);
  const bracketHref = buildTournamentFinalsBracketHref(tournamentId);
  openScheduleBtn.href = scheduleHref;
  openStandingsBtn.href = standingsHref;
  openFinalsAdvancementBtn.href = finalsHref;
  openFinalsAdvancementPrimaryBtn.href = finalsHref;
  openFinalsBracketPrimaryBtn.href = bracketHref;
}

function setClosedViewLinks() {
  if (!isValidTournamentId(tournamentId)) {
    return;
  }
  closedEntriesBtn.href = buildTournamentEntriesHref(tournamentId);
  closedScheduleBtn.href = buildTournamentScheduleHref(tournamentId);
  closedStandingsBtn.href = buildTournamentStandingsHref(tournamentId);
  closedFinalsBracketBtn.href = buildTournamentFinalsBracketHref(tournamentId);
  closedResultsBtn.href = buildTournamentResultsHref(tournamentId);
  openTournamentResultsBtn.href = buildTournamentResultsHref(tournamentId);
  openFinalizeResultsBtn.href = buildTournamentResultsHref(tournamentId);
}

function renderDashboardLifecycle(tournament, savedResults, completionPreview) {
  const isClosed = tournament.status === TournamentStatus.CLOSED;
  const isOpen = tournament.status === TournamentStatus.OPEN;
  const canFinalize = isOpen && completionPreview?.canFinalize && !savedResults?.finalized;

  closedSummaryPanelEl.classList.toggle("hidden", !isClosed);
  finalizeResultsPanelEl.classList.toggle("hidden", !canFinalize);
  dashboardOperationsEl.classList.toggle("hidden", isClosed);
  document.querySelectorAll("[data-hide-when-closed]").forEach((el) => {
    el.classList.toggle("hidden", isClosed);
  });
  closedViewLinksPanelEl.classList.toggle("hidden", !isClosed);

  if (isClosed) {
    const championName =
      savedResults?.champion?.teamName ??
      completionPreview?.champion?.teamName ??
      "—";
    closedSummaryLineEl.textContent = `優勝：${championName}`;
    setClosedViewLinks();
    return;
  }

  if (canFinalize) {
    const championName = completionPreview.champion?.teamName ?? "—";
    const runnerUpName = completionPreview.runnerUp?.teamName ?? "—";
    document.getElementById("finalizeResultsDesc").textContent =
      `決勝戦が終了しました（優勝：${championName} / 準優勝：${runnerUpName}）。大会結果を確定してください。`;
    openFinalizeResultsBtn.href = buildTournamentResultsHref(tournamentId);
  }
}

function renderFinalsBracketPanel(advancement, bracket) {
  if (!openFinalsBracketPrimaryBtn || !finalsBracketDescEl) {
    return;
  }

  if (!advancement?.finalized) {
    finalsBracketDescEl.textContent = "先に決勝進出チームを確定してください。";
    openFinalsBracketPrimaryBtn.classList.add("hidden");
    return;
  }

  openFinalsBracketPrimaryBtn.classList.remove("hidden");

  if (bracket?.finalized) {
    finalsBracketDescEl.textContent = "決勝トーナメント表は確定済みです。";
    openFinalsBracketPrimaryBtn.textContent = "決勝トーナメントを見る";
    return;
  }

  finalsBracketDescEl.textContent = "決勝進出チームをもとに、シード配置でトーナメント表を作成できます。";
  openFinalsBracketPrimaryBtn.textContent = "決勝トーナメントを作成";
}

function countEntriesByStatus(entries) {
  return {
    total: entries.length,
    pending: entries.filter((entry) => entry.status === EntryStatus.PENDING).length,
    confirmed: entries.filter((entry) => entry.status === EntryStatus.CONFIRMED).length,
  };
}

function renderEntrySummary(tournament, entries) {
  const counts = countEntriesByStatus(entries);
  entryTotalCountEl.textContent = String(counts.total);
  entryPendingCountEl.textContent = String(counts.pending);
  entryConfirmedCountEl.textContent = String(counts.confirmed);
  entryMaxTeamsEl.textContent = String(tournament.maxTeams ?? "—");
  openEntriesManageBtn.href = buildTournamentEntriesHref(tournament.id);
}

async function loadEntries() {
  const entries = await listEntries(tournamentId);
  currentEntries = entries;
  if (currentTournament) {
    renderEntrySummary(currentTournament, entries);
    updateBlockDrawDesc(currentTournament, entries);
  }
  return entries;
}

function getConfirmedEntries(entries) {
  return entries.filter((entry) => entry.status === EntryStatus.CONFIRMED);
}

function buildEntryLookup(entries) {
  return new Map(entries.map((entry) => [entry.id, entry]));
}

function updateBlockDrawDesc(tournament, entries) {
  const confirmedCount = getConfirmedEntries(entries).length;
  const preferredBlockSize = tournament.preferredBlockSize ?? "—";
  blockDrawDescEl.textContent =
    `参加承認済み ${confirmedCount} チーム / ブロック基本人数 ${preferredBlockSize}。ランダムにシャッフルし、均等に各ブロックへ振り分けます。`;
}

function renderBlockDraw(blockDraw, entries) {
  setTournamentNavigationLinks();

  const hasDraw =
    blockDraw && Array.isArray(blockDraw.blocks) && blockDraw.blocks.length > 0;
  blockDrawBtn.classList.toggle("hidden", Boolean(hasDraw));
  blockDrawEmptyEl.classList.toggle("hidden", Boolean(hasDraw));

  if (!hasDraw) {
    blockDrawResultsEl.classList.add("hidden");
    blockDrawResultsEl.innerHTML = "";
    return;
  }

  const entryLookup = buildEntryLookup(entries);
  blockDrawEmptyEl.classList.add("hidden");
  blockDrawResultsEl.classList.remove("hidden");
  blockDrawResultsEl.innerHTML = blockDraw.blocks
    .map((block) => {
      const teams = (block.entryIds || [])
        .map((entryId) => entryLookup.get(entryId))
        .filter(Boolean)
        .map((entry) => `<li>${escapeHtml(entry.teamName || "（名称未設定）")}</li>`)
        .join("");

      return `
        <article class="block-group">
          <h4 class="block-group__title">${escapeHtml(block.name || block.id || "ブロック")}</h4>
          <ul class="block-group__list">${teams || "<li>—</li>"}</ul>
        </article>
      `;
    })
    .join("");
}

async function loadBlockDraw(entries) {
  try {
    const blockDraw = await getBlockDraw(tournamentId);
    renderBlockDraw(blockDraw, entries);
  } catch (error) {
    const { message } = classifyError(error);
    showErrorToast(message);
    renderBlockDraw(null, entries);
  }
}

async function handleBlockDraw() {
  if (!currentTournament) {
    return;
  }

  const confirmedEntries = getConfirmedEntries(currentEntries);
  if (confirmedEntries.length === 0) {
    showErrorToast("参加承認済みのチームがありません。");
    return;
  }

  const preferredBlockSize = currentTournament.preferredBlockSize;
  const blockCount = Math.max(1, Math.ceil(confirmedEntries.length / preferredBlockSize));
  const confirmed = await confirmDialog({
    title: "ブロック抽選",
    message: `参加承認済み ${confirmedEntries.length} チームを ${blockCount} ブロック（基本人数 ${preferredBlockSize}）にランダム振り分けします。実行しますか？`,
    confirmLabel: "抽選する",
    cancelLabel: "キャンセル",
  });

  if (!confirmed) {
    return;
  }

  blockDrawBtn.disabled = true;

  try {
    const blockDraw = await runBlockDraw(
      tournamentId,
      confirmedEntries,
      preferredBlockSize
    );
    renderBlockDraw(blockDraw, currentEntries);
    warnSnapshotRebuildFailure(blockDraw);
    showToast("ブロック抽選が完了しました。");
  } catch (error) {
    const { message } = classifyError(error);
    showErrorToast(message);
  } finally {
    blockDrawBtn.disabled = false;
  }
}

function showPageError(message) {
  showFormAlert(document.getElementById("errorAlert"), message, "error");
  showView("error");
}

async function loadTournamentCompletionStatus() {
  if (!currentTournament) {
    return;
  }

  const savedResults = await getTournamentResults(tournamentId);

  if (
    currentTournament.status === TournamentStatus.CLOSED ||
    savedResults?.finalized
  ) {
    renderDashboardLifecycle(currentTournament, savedResults, null);
    return;
  }

  if (currentTournament.status !== TournamentStatus.OPEN) {
    renderDashboardLifecycle(currentTournament, savedResults, null);
    return;
  }

  try {
    const [advancement, bracket, resultsMap] = await Promise.all([
      getFinalsAdvancement(tournamentId),
      getFinalsBracket(tournamentId),
      getFinalsMatchResults(tournamentId),
    ]);

    const completionPreview = validateTournamentCompletion({
      bracket,
      resultsMap,
      qualifiers: advancement?.qualifiers ?? [],
      existingResults: savedResults,
    });

    renderDashboardLifecycle(currentTournament, savedResults, completionPreview);
  } catch {
    renderDashboardLifecycle(currentTournament, savedResults, null);
  }
}

async function loadFinalsStatus() {
  try {
    const [advancement, bracket] = await Promise.all([
      getFinalsAdvancement(tournamentId),
      getFinalsBracket(tournamentId),
    ]);
    renderFinalsBracketPanel(advancement, bracket);
  } catch (error) {
    const { message } = classifyError(error);
    showErrorToast(message);
    renderFinalsBracketPanel(null, null);
  }
}

async function loadTournament() {
  showView("loading");

  if (!isValidTournamentId(tournamentId)) {
    const { message } = classifyError(new InvalidTournamentIdError());
    showPageError(message);
    return;
  }

  try {
    const tournament = await getTournament(tournamentId);
    renderTournament(tournament);
    try {
      const entries = await loadEntries();
      await loadBlockDraw(entries);
      await loadFinalsStatus();
      await loadTournamentCompletionStatus();
    } catch (error) {
      const { message } = classifyError(error);
      showErrorToast(message);
      renderEntrySummary(tournament, []);
    }
    showView("dashboard");
  } catch (error) {
    const { message } = classifyError(error);
    showPageError(message);
  }
}

async function handleRebuildPublicSnapshot() {
  if (!rebuildPublicSnapshotBtn) {
    return;
  }

  rebuildPublicSnapshotBtn.disabled = true;
  try {
    await rebuildPublicTournamentSnapshot(tournamentId);
    showToast("公開情報を更新しました");
  } catch (error) {
    console.error("[dashboard] public snapshot rebuild failed", error);
    showErrorToast("公開情報を更新できませんでした");
  } finally {
    rebuildPublicSnapshotBtn.disabled = false;
  }
}

async function handlePublicViewChange() {
  if (!publicViewSelectEl || !currentTournament) {
    return;
  }

  const enabled = publicViewSelectEl.value === "true";
  if (enabled === isPublicViewEnabled(currentTournament)) {
    return;
  }

  publicViewSelectEl.disabled = true;
  try {
    const result = await updateTournamentPublicView(tournamentId, enabled);
    warnSnapshotRebuildFailure(result);
    showToast(enabled ? "公開ページを有効にしました。" : "公開ページを停止しました。");
    await loadTournament();
  } catch (error) {
    const { message } = classifyError(error);
    showErrorToast(message);
    publicViewSelectEl.value = isPublicViewEnabled(currentTournament) ? "true" : "false";
  } finally {
    publicViewSelectEl.disabled = false;
  }
}

async function handleCopyPublicUrl() {
  const url = publicPageUrlEl?.value;
  if (!url) {
    return;
  }

  try {
    await navigator.clipboard.writeText(url);
    showToast("公開URLをコピーしました");
  } catch {
    publicPageUrlEl.select();
    document.execCommand("copy");
    showToast("公開URLをコピーしました");
  }
}

async function handleCopyUrl() {
  const url = entryUrlEl.value;
  if (!url) {
    return;
  }

  try {
    await navigator.clipboard.writeText(url);
    showToast("URL をコピーしました。");
  } catch {
    entryUrlEl.select();
    document.execCommand("copy");
    showToast("URL をコピーしました。");
  }
}

async function handleOpenEntry() {
  if (!currentTournament || currentTournament.status !== TournamentStatus.DRAFT) {
    return;
  }

  const confirmed = await confirmDialog({
    title: "エントリー受付を開始",
    message: "エントリー受付を開始しますか？公開 URL から申込を受け付けられるようになります。",
    confirmLabel: "開始する",
    cancelLabel: "キャンセル",
  });

  if (!confirmed) {
    return;
  }

  openEntryBtn.disabled = true;

  try {
    const result = await updateTournamentStatus(tournamentId, TournamentStatus.OPEN);
    warnSnapshotRebuildFailure(result);
    showToast("エントリー受付を開始しました。");
    await loadTournament();
  } catch (error) {
    const { message } = classifyError(error);
    showErrorToast(message);
    openEntryBtn.disabled = false;
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

function initDashboardPage() {
  tournamentId = new URLSearchParams(window.location.search).get("id");
  setTournamentNavigationLinks();
  copyUrlBtn.addEventListener("click", handleCopyUrl);
  copyPublicUrlBtn?.addEventListener("click", handleCopyPublicUrl);
  rebuildPublicSnapshotBtn?.addEventListener("click", handleRebuildPublicSnapshot);
  publicViewSelectEl?.addEventListener("change", handlePublicViewChange);
  openEntryBtn.addEventListener("click", handleOpenEntry);
  blockDrawBtn.addEventListener("click", handleBlockDraw);

  initOperatorGuard({
    onConfigRequired: initConfigView,
    onOperatorDenied: initOperatorDeniedView,
    onReady: () => {
      loadTournament();
    },
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initDashboardPage);
} else {
  initDashboardPage();
}
