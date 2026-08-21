/**
 * エントリー完了後案内の編集（大会管理から）
 * 既存 entryCompletionGuidance service / domain のみを使用
 */
import { isValidTournamentId } from "../../domain/validators.js";
import { isTournamentDeleted } from "../../domain/tournament-deletion.js";
import { validateEntryCompletionGuidanceInput } from "../../domain/entry-completion-guidance.js";
import { getTournament } from "../../services/tournament-service.js";
import {
  getEntryCompletionGuidance,
  saveEntryCompletionGuidance,
} from "../../services/entry-completion-guidance-service.js";
import { initTournamentManageGuard } from "../../lib/operator-guard.js";
import { classifyError, InvalidTournamentIdError } from "../../lib/errors.js";
import { withPublicSnapshotRebuild } from "../../lib/public-snapshot-hook.js";
import { showToast } from "../components/toast.js";
import { showFormAlert, clearFormAlert, clearFormErrors } from "../components/form-errors.js";

const views = {
  loading: document.getElementById("viewLoading"),
  config: document.getElementById("viewConfig"),
  operatorDenied: document.getElementById("viewOperatorDenied"),
  error: document.getElementById("viewError"),
  form: document.getElementById("viewForm"),
};

const headerActions = document.getElementById("headerActions");
const backToDashboardBtn = document.getElementById("backToDashboardBtn");
const cancelBtn = document.getElementById("cancelBtn");
const tournamentNameEl = document.getElementById("tournamentName");
const formEl = document.getElementById("guidanceForm");
const formAlert = document.getElementById("formAlert");
const submitBtn = document.getElementById("submitBtn");
const configAlert = document.getElementById("configAlert");
const operatorDeniedAlert = document.getElementById("operatorDeniedAlert");

let tournamentId = null;

function showView(name) {
  Object.entries(views).forEach(([key, el]) => {
    if (el) {
      el.classList.toggle("hidden", key !== name);
    }
  });
  if (headerActions) {
    headerActions.classList.toggle("hidden", name !== "form");
  }
}

function buildDashboardHref(id) {
  return `tournament-dashboard.html?id=${encodeURIComponent(id)}`;
}

function setDashboardLinks() {
  if (!isValidTournamentId(tournamentId)) {
    return;
  }
  const href = buildDashboardHref(tournamentId);
  if (backToDashboardBtn) backToDashboardBtn.href = href;
  if (cancelBtn) cancelBtn.href = href;
}

function clearFieldErrors() {
  for (const id of [
    "entryCompletionMessageError",
    "entryCompletionLinkUrlError",
    "entryCompletionLinkLabelError",
  ]) {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = "";
      el.classList.add("hidden");
    }
  }
  if (formEl) {
    clearFormErrors(formEl);
  }
}

function applyFieldErrors(errors) {
  clearFieldErrors();
  for (const [field, message] of Object.entries(errors || {})) {
    const el = document.getElementById(`${field}Error`);
    if (el) {
      el.textContent = message;
      el.classList.remove("hidden");
    }
  }
}

function populateForm(guidance) {
  const setValue = (id, value) => {
    const el = document.getElementById(id);
    if (el) {
      el.value = value ?? "";
    }
  };
  setValue("entryCompletionMessage", guidance?.entryCompletionMessage ?? "");
  setValue("entryCompletionLinkUrl", guidance?.entryCompletionLinkUrl ?? "");
  setValue("entryCompletionLinkLabel", guidance?.entryCompletionLinkLabel ?? "");
}

function readFormInput() {
  return {
    entryCompletionMessage:
      document.getElementById("entryCompletionMessage")?.value ?? "",
    entryCompletionLinkUrl:
      document.getElementById("entryCompletionLinkUrl")?.value ?? "",
    entryCompletionLinkLabel:
      document.getElementById("entryCompletionLinkLabel")?.value ?? "",
  };
}

function showPageError(message) {
  const errorAlert = document.getElementById("errorAlert");
  if (errorAlert) {
    errorAlert.textContent = message;
  }
  showView("error");
}

function initConfigView() {
  if (configAlert) {
    configAlert.textContent = "Firebase 設定が未完了です。";
  }
  showView("config");
}

function initAccessDeniedView() {
  if (operatorDeniedAlert) {
    operatorDeniedAlert.textContent = "この大会を管理する権限がありません。";
  }
  showView("operatorDenied");
}

async function loadPage() {
  clearFormAlert(formAlert);
  clearFieldErrors();
  const tournament = await getTournament(tournamentId, { source: "server" });
  if (isTournamentDeleted(tournament)) {
    showPageError("この大会は削除されています。");
    return;
  }
  if (tournamentNameEl) {
    tournamentNameEl.textContent = tournament.name || "大会";
  }
  const guidance = await getEntryCompletionGuidance(tournamentId, {
    source: "server",
  });
  populateForm(guidance);
  showView("form");
}

async function handleSubmit(event) {
  event.preventDefault();
  clearFormAlert(formAlert);
  clearFieldErrors();

  const validation = validateEntryCompletionGuidanceInput(readFormInput());
  if (!validation.valid) {
    applyFieldErrors(validation.errors);
    showFormAlert(formAlert, "入力内容を確認してください。", "error");
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
  }

  try {
    await saveEntryCompletionGuidance(tournamentId, validation.values);
    await withPublicSnapshotRebuild(tournamentId, {});
    showToast("エントリー後の案内を更新しました");
  } catch (error) {
    console.error("[entry-completion-guidance-edit] save failed", error);
    const { message } = classifyError(error);
    showFormAlert(formAlert, message, "error");
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
    }
  }
}

function initPage() {
  tournamentId = new URLSearchParams(window.location.search).get("id");
  setDashboardLinks();

  if (!isValidTournamentId(tournamentId)) {
    showPageError(new InvalidTournamentIdError().message);
    return;
  }

  if (formEl) {
    formEl.addEventListener("submit", handleSubmit);
  }

  initTournamentManageGuard({
    tournamentId,
    onConfigRequired: initConfigView,
    onAccessDenied: initAccessDeniedView,
    onReady: () => {
      loadPage().catch((error) => {
        console.error("[entry-completion-guidance-edit] load failed", error);
        const { message } = classifyError(error);
        showPageError(message);
      });
    },
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initPage);
} else {
  initPage();
}
