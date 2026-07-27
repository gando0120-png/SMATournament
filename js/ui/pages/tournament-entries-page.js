/**

 * エントリー管理ページ

 */

import { EntryStatus, getEntryStatusLabel } from "../../domain/constants.js";

import { formatEntryMembersDisplay, formatEntryEmailDisplay } from "../../domain/entry-members.js";

import { isValidTournamentId } from "../../domain/validators.js";

import { getTournament } from "../../services/tournament-service.js";

import { listEntries, confirmEntry } from "../../services/entry-service.js";

import { initTournamentManageGuard } from "../../lib/operator-guard.js";

import {

  classifyEntryAdminError,

  classifyError,

  InvalidTournamentIdError,

} from "../../lib/errors.js";

import { showErrorToast, showToast } from "../components/toast.js";

import { showFormAlert } from "../components/form-errors.js";

import { confirmDialog } from "../components/confirm-dialog.js";

import { warnSnapshotRebuildFailure } from "../../lib/public-snapshot-ui.js";



const views = {

  loading: document.getElementById("viewLoading"),

  config: document.getElementById("viewConfig"),

  operatorDenied: document.getElementById("viewOperatorDenied"),

  error: document.getElementById("viewError"),

  entries: document.getElementById("viewEntries"),

};



const headerActions = document.getElementById("headerActions");

const backToDashboardBtn = document.getElementById("backToDashboardBtn");

const tournamentNameEl = document.getElementById("tournamentName");

const entryTotalCountEl = document.getElementById("entryTotalCount");

const entryPendingCountEl = document.getElementById("entryPendingCount");

const entryConfirmedCountEl = document.getElementById("entryConfirmedCount");

const entryListEl = document.getElementById("entryList");

const entryEmptyEl = document.getElementById("entryEmpty");



let tournamentId = null;

let currentEntries = [];



function showView(name) {

  Object.entries(views).forEach(([key, el]) => {

    if (el) {

      el.classList.toggle("hidden", key !== name);

    }

  });

  if (headerActions) {

    headerActions.classList.toggle("hidden", name !== "entries");

  }

}



function isLoadingVisible() {

  return views.loading && !views.loading.classList.contains("hidden");

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



function countEntriesByStatus(entries) {

  return {

    total: entries.length,

    pending: entries.filter((entry) => entry.status === EntryStatus.PENDING).length,

    confirmed: entries.filter((entry) => entry.status === EntryStatus.CONFIRMED).length,

  };

}



function renderEntryStats(entries) {

  const counts = countEntriesByStatus(entries);

  entryTotalCountEl.textContent = String(counts.total);

  entryPendingCountEl.textContent = String(counts.pending);

  entryConfirmedCountEl.textContent = String(counts.confirmed);

}



function renderEntryRow(entry) {

  const row = document.createElement("article");

  row.className = "entry-row";

  row.dataset.entryId = entry.id;



  const statusLabel = getEntryStatusLabel(entry.status);

  const isPending = entry.status === EntryStatus.PENDING;



  row.innerHTML = `

    <span class="entry-row__team">${escapeHtml(entry.teamName || "（チーム名未設定）")}</span>

    <span class="entry-row__rep">${escapeHtml(formatEntryMembersDisplay(entry) || "—")}</span>

    <span class="entry-row__email">${escapeHtml(formatEntryEmailDisplay(entry))}</span>

    <span class="entry-row__date">${escapeHtml(formatTimestamp(entry.createdAt))}</span>

    <span class="entry-row__status">

      <span class="status-badge" data-status="${escapeHtml(entry.status || "")}">${escapeHtml(statusLabel)}</span>

    </span>

    <span class="entry-row__action"></span>

  `;



  if (isPending) {

    const btn = document.createElement("button");

    btn.type = "button";

    btn.className = "btn btn--primary";

    btn.textContent = "参加承認";

    btn.addEventListener("click", () => handleConfirmEntry(entry.id, btn));

    row.querySelector(".entry-row__action").appendChild(btn);

  }



  return row;

}



function renderEntries(entries) {

  currentEntries = entries;

  renderEntryStats(entries);

  entryListEl.innerHTML = "";



  if (entries.length === 0) {

    entryEmptyEl.classList.remove("hidden");

    return;

  }



  entryEmptyEl.classList.add("hidden");

  entries.forEach((entry) => {

    entryListEl.appendChild(renderEntryRow(entry));

  });

}



async function loadEntries() {

  const entries = await listEntries(tournamentId);

  renderEntries(entries);

  return entries;

}



async function handleConfirmEntry(entryId, buttonEl) {

  const entry = currentEntries.find((item) => item.id === entryId);

  if (!entry || entry.status !== EntryStatus.PENDING) {

    return;

  }



  const confirmed = await confirmDialog({

    title: "参加承認",

    message: `「${entry.teamName || "このチーム"}」の参加を承認しますか？`,

    confirmLabel: "承認する",

    cancelLabel: "キャンセル",

  });



  if (!confirmed) {

    return;

  }



  buttonEl.disabled = true;



  try {

    const result = await confirmEntry(tournamentId, entryId);

    warnSnapshotRebuildFailure(result);

    showToast("参加を承認しました。");

    await loadEntries();

  } catch (error) {

    const { message } = classifyError(error);

    showErrorToast(message);

    buttonEl.disabled = false;

  }

}



function showPageError(message) {

  showFormAlert(document.getElementById("errorAlert"), message, "error");

  showView("error");

}



async function loadPage() {

  console.log("[entry-admin] init start");

  showView("loading");



  if (!isValidTournamentId(tournamentId)) {

    const { message } = classifyEntryAdminError(new InvalidTournamentIdError());

    showPageError(message);

    return;

  }



  backToDashboardBtn.href = buildTournamentDashboardHref(tournamentId);



  try {

    const tournamentPath = `tournaments/${tournamentId}`;

    console.log("[entry-admin] tournament get start", tournamentPath);

    const tournament = await getTournament(tournamentId);

    console.log("[entry-admin] tournament get ok", tournamentId);



    tournamentNameEl.textContent = tournament.name || "（名称未設定）";



    const entries = await loadEntries();

    console.log("[entry-admin] render ok", { entryCount: entries.length });

    showView("entries");

  } catch (error) {

    console.error(

      "[entry-admin] load failed",

      tournamentId,

      error?.code ?? "(no code)",

      error

    );

    const { message } = classifyEntryAdminError(error);

    showPageError(message);

  } finally {

    if (isLoadingVisible()) {

      console.error("[entry-admin] load ended while loading view still visible");

      showPageError("エントリー管理画面の読み込みに失敗しました。");

    }

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

    "この大会を管理する権限がありません。operators/{uid} の enabled が boolean true であること、または大会作成者であることを確認してください。",

    "warning"

  );

  showView("operatorDenied");

}



function initEntriesPage() {

  console.log("[entry-admin] page init");

  tournamentId = new URLSearchParams(window.location.search).get("id");



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

  document.addEventListener("DOMContentLoaded", initEntriesPage);

} else {

  initEntriesPage();

}


