/**
 * E2E テスト支援 — ダミー参加者一括操作ページ
 */
import { isValidTournamentId } from "../../domain/validators.js";
import { resolveTournamentFormat } from "../../domain/tournament-format.js";
import {
  calculateDummyFillPlan,
  DUMMY_ENTRY_TARGET_PRESETS,
  findLatestDummyBatchId,
} from "../../domain/dummy-entries.js";
import { canUseTournamentTestTools } from "../../domain/test-tournament-access.js";
import { getTournament } from "../../services/tournament-service.js";
import {
  deleteDummyEntries,
  fillDummyEntriesToTarget,
  loadDummyEntryToolContext,
} from "../../services/dummy-entry-service.js";
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
  tools: document.getElementById("viewTools"),
};

const headerActions = document.getElementById("headerActions");
const backToDashboardBtn = document.getElementById("backToDashboardBtn");
const toolsPageTitleEl = document.getElementById("toolsPageTitle");
const toolsMetaEl = document.getElementById("toolsMeta");
const toolsInfoEl = document.getElementById("toolsInfo");
const targetCountInputEl = document.getElementById("targetCountInput");
const presetButtonsEl = document.getElementById("presetButtons");
const fillPreviewEl = document.getElementById("fillPreview");
const fillDummyBtn = document.getElementById("fillDummyBtn");
const latestBatchDescEl = document.getElementById("latestBatchDesc");
const deleteLatestBatchBtn = document.getElementById("deleteLatestBatchBtn");
const deleteAllDummyBtn = document.getElementById("deleteAllDummyBtn");

let tournamentId = null;
let toolContext = null;
let busy = false;

function showView(name) {
  Object.entries(views).forEach(([key, el]) => {
    if (el) {
      el.classList.toggle("hidden", key !== name);
    }
  });
  headerActions?.classList.toggle("hidden", name !== "tools");
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

function renderInfoRow(label, value) {
  return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function formatTimestamp(value) {
  if (!value) {
    return "—";
  }
  const date = typeof value.toDate === "function" ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return date.toLocaleString("ja-JP");
}

function setBusy(nextBusy) {
  busy = nextBusy;
  fillDummyBtn.disabled = nextBusy;
  deleteLatestBatchBtn.disabled = nextBusy;
  deleteAllDummyBtn.disabled = nextBusy;
}

function updateFillPreview() {
  if (!toolContext) {
    fillPreviewEl.textContent = "追加予定：—";
    return;
  }

  const targetCount = Number(targetCountInputEl.value);
  const plan = calculateDummyFillPlan({
    targetCount,
    confirmedCount: toolContext.stats.confirmedCount,
    maxTeams: toolContext.tournament.maxTeams ?? 64,
    existingEntries: toolContext.entries,
  });

  if (!plan.valid) {
    fillPreviewEl.textContent = plan.message ?? "追加予定：—";
    fillDummyBtn.disabled = busy || toolContext.structureState.hasStructure;
    return;
  }

  if (plan.toAdd === 0) {
    fillPreviewEl.textContent = `追加予定：0 人（すでに目標 ${plan.targetCount} 人に達しています）`;
  } else {
    fillPreviewEl.textContent = `追加予定：${plan.toAdd} 人（現在 ${toolContext.stats.confirmedCount} 人 → 目標 ${plan.targetCount} 人）`;
  }

  fillDummyBtn.disabled = busy || toolContext.structureState.hasStructure || plan.toAdd === 0;
}

function renderToolsView(context) {
  toolContext = context;
  const { tournament, entries, structureState, stats } = context;
  const latestBatchId = findLatestDummyBatchId(entries);
  const latestBatchEntries = latestBatchId
    ? entries.filter((entry) => entry.isDummy === true && entry.dummyBatchId === latestBatchId)
    : [];
  const latestCreatedAt = latestBatchEntries[0]?.createdAt;

  toolsPageTitleEl.textContent = "E2E テストツール";
  toolsMetaEl.textContent = tournament.name ?? "（名称未設定）";

  toolsInfoEl.innerHTML = [
    renderInfoRow("大会形式", resolveTournamentFormat(tournament) ?? "—"),
    renderInfoRow("確定参加者数", String(stats.confirmedCount)),
    renderInfoRow("ダミー参加者数", String(stats.dummyCount)),
    renderInfoRow("募集上限", String(tournament.maxTeams ?? "—")),
    renderInfoRow(
      "構造作成済み",
      structureState.hasStructure ? "はい（追加・削除不可）" : "いいえ"
    ),
    renderInfoRow("最新バッチ ID", latestBatchId ?? "—"),
    renderInfoRow("最新バッチ作成", formatTimestamp(latestCreatedAt)),
  ].join("");

  latestBatchDescEl.textContent = latestBatchId
    ? `最新バッチ：${latestBatchEntries.length} 件（${latestBatchId}）`
    : "最新バッチ：なし";

  const structureLocked = structureState.hasStructure;
  deleteLatestBatchBtn.disabled = busy || structureLocked || stats.dummyCount === 0;
  deleteAllDummyBtn.disabled = busy || structureLocked || stats.dummyCount === 0;

  updateFillPreview();
}

function renderPresetButtons() {
  presetButtonsEl.innerHTML = DUMMY_ENTRY_TARGET_PRESETS.map(
    (count) =>
      `<button type="button" class="btn btn--ghost" data-target-count="${count}">目標 ${count} 人</button>`
  ).join("");

  presetButtonsEl.querySelectorAll("[data-target-count]").forEach((button) => {
    button.addEventListener("click", () => {
      targetCountInputEl.value = button.dataset.targetCount;
      updateFillPreview();
    });
  });
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

  backToDashboardBtn.href = buildTournamentDashboardHref(tournamentId);

  try {
    const tournament = await getTournament(tournamentId);
    const access = canUseTournamentTestTools({ tournament, canManage: true });
    if (!access.allowed) {
      showPageError(access.reason);
      return;
    }

    const context = await loadDummyEntryToolContext(tournamentId);
    renderToolsView(context);
    showView("tools");
  } catch (error) {
    console.error("[test-tools] loadPage failed", error);
    const { message } = classifyError(error);
    showPageError(message);
  }
}

async function handleFillDummy() {
  const targetCount = Number(targetCountInputEl.value);
  const plan = calculateDummyFillPlan({
    targetCount,
    confirmedCount: toolContext.stats.confirmedCount,
    maxTeams: toolContext.tournament.maxTeams ?? 64,
    existingEntries: toolContext.entries,
  });

  if (!plan.valid) {
    showErrorToast(plan.message ?? "目標人数が不正です。");
    return;
  }

  if (plan.toAdd === 0) {
    showErrorToast("追加するダミー参加者はありません。");
    return;
  }

  const confirmed = await confirmDialog({
    title: "ダミー参加者の補充",
    message: `確定参加者を ${toolContext.stats.confirmedCount} 人から ${plan.targetCount} 人にするため、${plan.toAdd} 件のダミー参加者を追加します。`,
    confirmLabel: "追加する",
    cancelLabel: "キャンセル",
  });

  if (!confirmed) {
    return;
  }

  setBusy(true);
  try {
    const result = await fillDummyEntriesToTarget(tournamentId, targetCount);
    warnSnapshotRebuildFailure(result);
    showToast(`${result.addedCount ?? plan.toAdd} 件のダミー参加者を追加しました。`);
    await loadPage();
  } catch (error) {
    console.error("[test-tools] fill failed", error);
    showErrorToast(classifyError(error).message);
  } finally {
    setBusy(false);
  }
}

async function handleDeleteDummy(mode) {
  const isLatest = mode === "latest-batch";
  const message = isLatest
    ? "最新バッチのダミー参加者を削除します。実参加者は削除されません。"
    : "この大会の全ダミー参加者を削除します。実参加者は削除されません。";

  const confirmed = await confirmDialog({
    title: isLatest ? "最新バッチの削除" : "全ダミーの削除",
    message,
    confirmLabel: "削除する",
    cancelLabel: "キャンセル",
  });

  if (!confirmed) {
    return;
  }

  setBusy(true);
  try {
    const result = await deleteDummyEntries(tournamentId, mode);
    warnSnapshotRebuildFailure(result);
    showToast(`${result.deletedCount ?? 0} 件のダミー参加者を削除しました。`);
    await loadPage();
  } catch (error) {
    console.error("[test-tools] delete failed", error);
    showErrorToast(classifyError(error).message);
  } finally {
    setBusy(false);
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

function initTestToolsPage() {
  tournamentId = new URLSearchParams(window.location.search).get("id");
  renderPresetButtons();
  targetCountInputEl?.addEventListener("input", updateFillPreview);
  fillDummyBtn?.addEventListener("click", handleFillDummy);
  deleteLatestBatchBtn?.addEventListener("click", () => handleDeleteDummy("latest-batch"));
  deleteAllDummyBtn?.addEventListener("click", () => handleDeleteDummy("all"));

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
  document.addEventListener("DOMContentLoaded", initTestToolsPage);
} else {
  initTestToolsPage();
}
