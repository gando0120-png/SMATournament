/**
 * テスト大会一括削除ページ
 */
import { isFirebaseConfigured } from "../../lib/firebase-app.js";
import { initOperatorGuard } from "../../lib/operator-guard.js";
import { classifyError } from "../../lib/errors.js";
import { getTournamentStatusLabel } from "../../domain/constants.js";
import { getPublicFormatLabel, resolvePublicTournamentFormat } from "../../domain/tournament-format.js";
import {
  isLooseTestTournamentName,
  summarizeCleanupExecution,
  summarizeDryRunOutcome,
  validateCleanupSelection,
} from "../../domain/test-tournament-cleanup.js";
import {
  dryRunTestTournamentCleanup,
  executeTestTournamentCleanup,
  loadTestTournamentCleanupCandidates,
} from "../../services/test-tournament-cleanup-service.js";
import { showErrorToast, showToast } from "../components/toast.js";
import { showFormAlert } from "../components/form-errors.js";

const views = {
  loading: document.getElementById("viewLoading"),
  config: document.getElementById("viewConfig"),
  operatorDenied: document.getElementById("viewOperatorDenied"),
  cleanup: document.getElementById("viewCleanup"),
};

const headerActions = document.getElementById("headerActions");
const pageAlert = document.getElementById("pageAlert");
const candidateEmpty = document.getElementById("candidateEmpty");
const candidateTableWrap = document.getElementById("candidateTableWrap");
const candidateTableBody = document.getElementById("candidateTableBody");
const selectAllBtn = document.getElementById("selectAllBtn");
const clearSelectionBtn = document.getElementById("clearSelectionBtn");
const dryRunBtn = document.getElementById("dryRunBtn");
const deleteBtn = document.getElementById("deleteBtn");
const dryRunPanel = document.getElementById("dryRunPanel");
const dryRunContent = document.getElementById("dryRunContent");
const progressPanel = document.getElementById("progressPanel");
const progressContent = document.getElementById("progressContent");
const resultPanel = document.getElementById("resultPanel");
const resultContent = document.getElementById("resultContent");

/** @type {Array<object>} */
let candidates = [];
/** @type {Set<string>} */
let selectedIds = new Set();
let busy = false;
let dryRunBlocked = true;
/** @type {object|null} */
let lastDryRun = null;

function showView(name) {
  Object.entries(views).forEach(([key, el]) => {
    if (el) {
      el.classList.toggle("hidden", key !== name);
    }
  });
  headerActions?.classList.toggle("hidden", name !== "cleanup");
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
  return date.toLocaleString("ja-JP");
}

function getSelectedIds() {
  return [...selectedIds];
}

function updateActionButtons() {
  const hasSelection = selectedIds.size > 0;
  selectAllBtn.disabled = busy || candidates.length === 0;
  clearSelectionBtn.disabled = busy || selectedIds.size === 0;
  dryRunBtn.disabled = busy || !hasSelection;
  deleteBtn.disabled = busy || !hasSelection || dryRunBlocked;
}

function renderCandidateTable() {
  candidateTableBody.innerHTML = "";

  if (candidates.length === 0) {
    candidateEmpty.classList.remove("hidden");
    candidateTableWrap.classList.add("hidden");
    updateActionButtons();
    return;
  }

  candidateEmpty.classList.add("hidden");
  candidateTableWrap.classList.remove("hidden");

  for (const tournament of candidates) {
    const tr = document.createElement("tr");
    const format = resolvePublicTournamentFormat(tournament);
    const formatLabel = getPublicFormatLabel(format);
    const looseBadge = isLooseTestTournamentName(tournament.name)
      ? '<span class="cleanup-badge">曖昧一致</span>'
      : "";
    const checked = selectedIds.has(tournament.id);

    tr.innerHTML = `
      <td>
        <input type="checkbox" data-tournament-id="${escapeHtml(tournament.id)}" ${checked ? "checked" : ""} ${busy ? "disabled" : ""} aria-label="${escapeHtml(tournament.name || "大会")}を選択">
      </td>
      <td>${escapeHtml(tournament.name || "（名称未設定）")}${looseBadge}</td>
      <td>${escapeHtml(tournament.eventDate || "—")}</td>
      <td>${escapeHtml(formatLabel)}</td>
      <td>${escapeHtml(getTournamentStatusLabel(tournament.status))}</td>
      <td>${escapeHtml(String(tournament.confirmedCount ?? 0))}</td>
      <td>${escapeHtml(formatTimestamp(tournament.createdAt))}</td>
    `;

    const checkbox = tr.querySelector('input[type="checkbox"]');
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        selectedIds.add(tournament.id);
      } else {
        selectedIds.delete(tournament.id);
      }
      dryRunBlocked = true;
      lastDryRun = null;
      dryRunPanel.classList.add("hidden");
      updateActionButtons();
    });

    candidateTableBody.appendChild(tr);
  }

  updateActionButtons();
}

function renderDryRunPanel(outcome) {
  const summary = summarizeDryRunOutcome({ tournaments: outcome.tournaments ?? [] });
  const lines = summary.tournaments
    .map((item) => {
      const subSummary = Object.entries(item.subcollections ?? {})
        .map(([name, count]) => `${name}: ${count}`)
        .join(" / ");
      return `<li><strong>${escapeHtml(item.name ?? item.tournamentId)}</strong> — ${item.documentCount ?? 0} 件${subSummary ? `（${escapeHtml(subSummary)}）` : ""}</li>`;
    })
    .join("");

  const invalidLines = (outcome.invalid ?? [])
    .map((item) => `<li>${escapeHtml(item.tournamentId)}: ${escapeHtml(item.reason ?? "拒否")}</li>`)
    .join("");

  dryRunContent.innerHTML = `
    <p>対象大会数: <strong>${summary.tournamentCount}</strong></p>
    <p>合計削除予定ドキュメント数: <strong>${summary.totalDocuments}</strong></p>
    <ul>${lines || "<li>（対象なし）</li>"}</ul>
    ${invalidLines ? `<p style="color:#b91c1c;">削除不可:</p><ul>${invalidLines}</ul>` : ""}
    ${outcome.blocked ? "<p style=\"color:#b91c1c;\">テスト大会以外が含まれているため、実削除は無効です。</p>" : ""}
  `;
  dryRunPanel.classList.remove("hidden");
}

function renderProgressPanel(progress) {
  progressContent.innerHTML = `
    <p>現在処理中: <strong>${escapeHtml(progress.currentName ?? "—")}</strong></p>
    <p>進捗: ${progress.completedCount ?? 0} / ${progress.selectedCount ?? 0}</p>
    <p>削除済みドキュメント数: ${progress.deletedDocumentCount ?? 0}</p>
    ${
      (progress.failed ?? []).length > 0
        ? `<p>失敗: ${progress.failed.map((item) => escapeHtml(item.name ?? item.tournamentId)).join(", ")}</p>`
        : ""
    }
  `;
  progressPanel.classList.remove("hidden");
}

function renderResultPanel(summary) {
  const outcome = summarizeCleanupExecution(summary);
  const successLines = outcome.succeeded
    .map((item) => `<li>${escapeHtml(item.name ?? item.tournamentId)}（${item.deletedDocumentCount ?? 0} 件）</li>`)
    .join("");
  const failureLines = outcome.failed
    .map(
      (item) =>
        `<li>${escapeHtml(item.name ?? item.tournamentId)} — ${escapeHtml(item.reason ?? "不明なエラー")}</li>`
    )
    .join("");

  resultContent.innerHTML = `
    <p>完了: ${outcome.completedCount} / ${outcome.selectedCount}</p>
    <p>削除済みドキュメント数: ${outcome.deletedDocumentCount}</p>
    ${successLines ? `<p>成功した大会:</p><ul>${successLines}</ul>` : ""}
    ${failureLines ? `<p style="color:#b91c1c;">失敗した大会:</p><ul>${failureLines}</ul>` : ""}
  `;
  resultPanel.classList.remove("hidden");
}

function setBusy(nextBusy) {
  busy = nextBusy;
  updateActionButtons();
  renderCandidateTable();
}

/**
 * DELETE 入力必須の最終確認ダイアログ
 * @param {string[]} tournamentNames
 */
function confirmDeleteDialog(tournamentNames) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "confirm-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");

    const nameList = tournamentNames.map((name) => `<li>${escapeHtml(name)}</li>`).join("");

    overlay.innerHTML = `
      <div class="confirm-dialog">
        <h2 class="confirm-dialog__title">テスト大会の削除</h2>
        <p class="confirm-dialog__message">
          選択したテスト大会と、その大会に属する参加者・試合結果・ブラケット・公開データを削除します。
          この操作は元に戻せません。
        </p>
        <ul>${nameList}</ul>
        <label class="field cleanup-delete-input" for="deleteConfirmInput">
          <span class="field__label">続行するには <code>DELETE</code> と入力してください</span>
          <input class="field__input" type="text" id="deleteConfirmInput" autocomplete="off" spellcheck="false">
        </label>
        <div class="confirm-dialog__actions">
          <button type="button" class="btn btn--ghost" data-action="cancel">キャンセル</button>
          <button type="button" class="btn btn--danger" data-action="confirm" disabled>選択したテスト大会を削除</button>
        </div>
      </div>
    `;

    const input = overlay.querySelector("#deleteConfirmInput");
    const confirmBtn = overlay.querySelector('[data-action="confirm"]');

    function close(result) {
      overlay.remove();
      resolve(result);
    }

    input.addEventListener("input", () => {
      confirmBtn.disabled = input.value.trim() !== "DELETE";
    });

    overlay.querySelector('[data-action="cancel"]').addEventListener("click", () => close(false));
    confirmBtn.addEventListener("click", () => close(true));
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        close(false);
      }
    });

    document.body.appendChild(overlay);
    input.focus();
  });
}

async function handleDryRun() {
  const ids = getSelectedIds();
  const validation = validateCleanupSelection(candidates, ids);
  if (!validation.selectedCount) {
    showErrorToast("削除対象を1件以上選択してください。");
    return;
  }

  setBusy(true);
  resultPanel.classList.add("hidden");
  progressPanel.classList.add("hidden");

  try {
    const outcome = await dryRunTestTournamentCleanup(ids, candidates);
    lastDryRun = outcome;
    dryRunBlocked = Boolean(outcome.blocked || outcome.hasNonTestTournament);
    renderDryRunPanel(outcome);
    updateActionButtons();
    if (dryRunBlocked) {
      showErrorToast("テスト大会以外が含まれているため、実削除は無効です。");
    } else {
      showToast("削除対象を確認しました。問題なければ削除を実行できます。");
    }
  } catch (error) {
    const { message } = classifyError(error);
    showErrorToast(message);
  } finally {
    setBusy(false);
  }
}

async function handleDelete() {
  const ids = getSelectedIds();
  const validation = validateCleanupSelection(candidates, ids);
  if (!validation.valid || dryRunBlocked) {
    showErrorToast("先に「削除対象を確認」を実行し、問題がないことを確認してください。");
    return;
  }

  const selectedNames = ids.map((id) => {
    const tournament = candidates.find((item) => item.id === id);
    return tournament?.name ?? id;
  });

  const confirmed = await confirmDeleteDialog(selectedNames);
  if (!confirmed) {
    return;
  }

  setBusy(true);
  resultPanel.classList.add("hidden");
  progressPanel.classList.remove("hidden");

  try {
    const summary = await executeTestTournamentCleanup(ids, candidates, (progress) => {
      renderProgressPanel(progress);
    });
    renderResultPanel(summary);

    const removedIds = new Set(summary.succeeded.map((item) => item.tournamentId));
    candidates = candidates.filter((item) => !removedIds.has(item.id));
    for (const id of removedIds) {
      selectedIds.delete(id);
    }

    dryRunBlocked = true;
    lastDryRun = null;
    dryRunPanel.classList.add("hidden");
    renderCandidateTable();

    if (summary.failed.length > 0) {
      showErrorToast("一部の大会の削除に失敗しました。結果を確認してください。");
    } else {
      showToast("選択したテスト大会を削除しました。");
    }
  } catch (error) {
    const { message } = classifyError(error);
    showErrorToast(message);
  } finally {
    setBusy(false);
    progressPanel.classList.add("hidden");
  }
}

async function loadPage() {
  showView("loading");
  try {
    candidates = await loadTestTournamentCleanupCandidates();
    selectedIds = new Set();
    dryRunBlocked = true;
    lastDryRun = null;
    dryRunPanel.classList.add("hidden");
    resultPanel.classList.add("hidden");
    progressPanel.classList.add("hidden");
    renderCandidateTable();
    showView("cleanup");
  } catch (error) {
    const { message } = classifyError(error);
    showFormAlert(pageAlert, message, "error");
    showView("cleanup");
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

function initPage() {
  if (!isFirebaseConfigured()) {
    initConfigView();
    return;
  }

  selectAllBtn.addEventListener("click", () => {
    if (busy) {
      return;
    }
    selectedIds = new Set(candidates.map((item) => item.id));
    dryRunBlocked = true;
    lastDryRun = null;
    dryRunPanel.classList.add("hidden");
    renderCandidateTable();
  });

  clearSelectionBtn.addEventListener("click", () => {
    if (busy) {
      return;
    }
    selectedIds.clear();
    dryRunBlocked = true;
    lastDryRun = null;
    dryRunPanel.classList.add("hidden");
    renderCandidateTable();
  });

  dryRunBtn.addEventListener("click", () => {
    if (!busy) {
      handleDryRun();
    }
  });

  deleteBtn.addEventListener("click", () => {
    if (!busy) {
      handleDelete();
    }
  });

  initOperatorGuard({
    onConfigRequired: initConfigView,
    onReady: () => {
      loadPage().catch((error) => {
        console.error("[test-cleanup] loadPage failed", error);
        const { message } = classifyError(error);
        showFormAlert(pageAlert, message, "error");
        showView("cleanup");
      });
    },
    onOperatorDenied: () => {
      showFormAlert(
        document.getElementById("operatorDeniedAlert"),
        "この機能は運営者（operators）のみ利用できます。",
        "error"
      );
      showView("operatorDenied");
    },
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initPage);
} else {
  initPage();
}
