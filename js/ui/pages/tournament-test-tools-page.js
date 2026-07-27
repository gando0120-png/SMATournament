/**
 * E2E テスト支援 — ダミー参加者一括操作・予選自動進行ページ
 */
import { isValidTournamentId } from "../../domain/validators.js";
import { resolveTournamentFormat } from "../../domain/tournament-format.js";
import {
  calculateDummyFillPlan,
  DUMMY_ENTRY_TARGET_PRESETS,
  findLatestDummyBatchId,
} from "../../domain/dummy-entries.js";
import {
  buildQualifyingAutoProgressPlan,
  countQualifyingMatchProgress,
  validateQualifyingAutoProgress,
} from "../../domain/qualifying-auto-progress.js";
import { deriveDefaultSimulationSeed } from "../../domain/seeded-random.js";
import { isBlockDrawFinalized } from "../../domain/block-draw-state.js";
import { canUseTournamentTestTools } from "../../domain/test-tournament-access.js";
import { getTournament } from "../../services/tournament-service.js";
import {
  deleteDummyEntries,
  fillDummyEntriesToTarget,
  loadDummyEntryToolContext,
} from "../../services/dummy-entry-service.js";
import {
  loadQualifyingAutoProgressContext,
  runQualifyingAutoProgress,
} from "../../services/qualifying-auto-progress-service.js";
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
const qualifyingAutoInfoEl = document.getElementById("qualifyingAutoInfo");
const simulationSeedInputEl = document.getElementById("simulationSeedInput");
const simulationModeSelectEl = document.getElementById("simulationModeSelect");
const qualifyingAutoStatusEl = document.getElementById("qualifyingAutoStatus");
const qualifyingAutoProgressEl = document.getElementById("qualifyingAutoProgress");
const qualifyingAutoSummaryEl = document.getElementById("qualifyingAutoSummary");
const runQualifyingAutoBtn = document.getElementById("runQualifyingAutoBtn");
const openScheduleBtn = document.getElementById("openScheduleBtn");
const openStandingsBtn = document.getElementById("openStandingsBtn");

let tournamentId = null;
let toolContext = null;
let qualifyingContext = null;
let busy = false;
let lastQualifyingSummary = null;

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

function buildTournamentScheduleHref(id) {
  return `tournament-schedule.html?id=${encodeURIComponent(id)}`;
}

function buildTournamentStandingsHref(id) {
  return `tournament-standings.html?id=${encodeURIComponent(id)}`;
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
  runQualifyingAutoBtn.disabled = nextBusy || !isQualifyingAutoRunnable();
  targetCountInputEl.disabled = nextBusy;
  simulationSeedInputEl.disabled = nextBusy;
  simulationModeSelectEl.disabled = nextBusy;
}

function isQualifyingAutoRunnable() {
  if (!qualifyingContext) {
    return false;
  }
  const validation = validateQualifyingAutoProgress({
    tournament: qualifyingContext.tournament,
    canManage: true,
    entries: qualifyingContext.entries,
    blockDraw: qualifyingContext.blockDraw,
    schedule: qualifyingContext.schedule,
    structureState: qualifyingContext.structureState,
    existingResults: qualifyingContext.existingResults,
  });
  return validation.allowed;
}

function updateQualifyingAutoPreview() {
  if (!qualifyingContext) {
    qualifyingAutoStatusEl.textContent = "実行可否：—";
    qualifyingAutoProgressEl.textContent = "進捗：—";
    return;
  }

  const validation = validateQualifyingAutoProgress({
    tournament: qualifyingContext.tournament,
    canManage: true,
    entries: qualifyingContext.entries,
    blockDraw: qualifyingContext.blockDraw,
    schedule: qualifyingContext.schedule,
    structureState: qualifyingContext.structureState,
    existingResults: qualifyingContext.existingResults,
  });

  qualifyingAutoStatusEl.textContent = validation.allowed
    ? "実行可否：実行可能"
    : `実行可否：不可 — ${validation.reason}`;

  const progress = countQualifyingMatchProgress(
    qualifyingContext.schedule,
    qualifyingContext.existingResults
  );
  qualifyingAutoProgressEl.textContent = busy
    ? qualifyingAutoProgressEl.textContent
    : `進捗：入力済み ${progress.finishedMatches} / ${progress.totalMatches} 試合（未入力 ${progress.remainingMatches}）`;

  runQualifyingAutoBtn.disabled = busy || !validation.allowed;
}

function renderQualifyingAutoSection(context) {
  qualifyingContext = context;
  const { tournament, entries, blockDraw, schedule, existingResults, structureState } = context;
  const progress = countQualifyingMatchProgress(schedule, existingResults);
  const stats = {
    confirmedCount: entries.filter((entry) => entry.status === "confirmed").length,
    dummyCount: entries.filter((entry) => entry.isDummy === true).length,
  };

  if (!simulationSeedInputEl.dataset.initialized) {
    simulationSeedInputEl.value = String(deriveDefaultSimulationSeed(tournamentId));
    simulationSeedInputEl.dataset.initialized = "true";
  }

  openScheduleBtn.href = buildTournamentScheduleHref(tournamentId);
  openStandingsBtn.href = buildTournamentStandingsHref(tournamentId);

  qualifyingAutoInfoEl.innerHTML = [
    renderInfoRow("ブロック抽選", isBlockDrawFinalized(blockDraw) ? "確定済み" : "未確定"),
    renderInfoRow("予選対戦表", schedule?.finalized ? "確定済み" : "未作成"),
    renderInfoRow("予選総試合数", String(progress.totalMatches)),
    renderInfoRow("入力済み試合数", String(progress.finishedMatches)),
    renderInfoRow("未入力試合数", String(progress.remainingMatches)),
    renderInfoRow("確定参加者数", String(stats.confirmedCount)),
    renderInfoRow("ダミー参加者数", String(stats.dummyCount)),
    renderInfoRow(
      "決勝進出 / ブラケット",
      structureState.hasFinalsAdvancement || structureState.hasFinalsBracket ? "作成済み" : "未作成"
    ),
  ].join("");

  if (lastQualifyingSummary) {
    qualifyingAutoSummaryEl.textContent =
      `実行結果：${lastQualifyingSummary.matchCount} 試合入力 / ${lastQualifyingSummary.blockCount} ブロック / ` +
      `${lastQualifyingSummary.teamCount} チーム / seed ${lastQualifyingSummary.simulationSeed} / ` +
      `未完了 ${lastQualifyingSummary.remainingMatches} 試合`;
  } else {
    qualifyingAutoSummaryEl.textContent = "実行結果：—";
  }

  updateQualifyingAutoPreview();
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
      structureState.hasStructure ? "はい（ダミー追加・削除不可）" : "いいえ"
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

    const [dummyContext, qualifyingAutoContext] = await Promise.all([
      loadDummyEntryToolContext(tournamentId),
      loadQualifyingAutoProgressContext(tournamentId),
    ]);

    renderToolsView(dummyContext);
    renderQualifyingAutoSection(qualifyingAutoContext);
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

async function handleRunQualifyingAuto() {
  const validation = validateQualifyingAutoProgress({
    tournament: qualifyingContext.tournament,
    canManage: true,
    entries: qualifyingContext.entries,
    blockDraw: qualifyingContext.blockDraw,
    schedule: qualifyingContext.schedule,
    structureState: qualifyingContext.structureState,
    existingResults: qualifyingContext.existingResults,
  });

  if (!validation.allowed) {
    showErrorToast(validation.reason ?? "予選自動進行を実行できません。");
    return;
  }

  const simulationSeed = Number(simulationSeedInputEl.value);
  const mode = simulationModeSelectEl.value;

  const previewPlan = buildQualifyingAutoProgressPlan({
    tournament: qualifyingContext.tournament,
    canManage: true,
    entries: qualifyingContext.entries,
    blockDraw: qualifyingContext.blockDraw,
    schedule: qualifyingContext.schedule,
    structureState: qualifyingContext.structureState,
    existingResults: qualifyingContext.existingResults,
    simulationSeed,
    mode,
    tournamentId,
  });

  if (!previewPlan.valid) {
    showErrorToast(previewPlan.message ?? "予選結果の生成計画が不正です。");
    return;
  }

  const confirmed = await confirmDialog({
    title: "予選自動進行",
    message:
      "この操作は全予選試合へテスト結果を入力します。手動結果がある大会では実行できません。実行後は通常画面から結果を確認できます。",
    confirmLabel: "実行する",
    cancelLabel: "キャンセル",
  });

  if (!confirmed) {
    return;
  }

  setBusy(true);
  qualifyingAutoProgressEl.textContent = "進捗：0 / 0 試合を処理中";

  try {
    const result = await runQualifyingAutoProgress(tournamentId, {
      simulationSeed,
      mode,
      onProgress: ({ processedMatches, totalMatches, phase }) => {
        const phaseLabel =
          phase === "saving" ? "保存中" : phase === "generating" ? "生成中" : "処理中";
        qualifyingAutoProgressEl.textContent = `${phaseLabel}：${processedMatches} / ${totalMatches} 試合`;
      },
    });

    warnSnapshotRebuildFailure(result);
    lastQualifyingSummary = {
      matchCount: result.matchCount,
      blockCount: result.blockCount,
      teamCount: result.teamCount,
      simulationSeed: result.simulationSeed,
      remainingMatches: result.remainingMatches,
    };

    showToast(`${result.matchCount} 試合の予選結果を自動入力しました。`);
    await loadPage();
  } catch (error) {
    console.error("[test-tools] qualifying auto progress failed", error);
    showErrorToast(classifyError(error).message);
    qualifyingAutoProgressEl.textContent = "進捗：失敗（再実行前に入力済み結果を確認してください）";
  } finally {
    setBusy(false);
    updateQualifyingAutoPreview();
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
  runQualifyingAutoBtn?.addEventListener("click", handleRunQualifyingAuto);

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
