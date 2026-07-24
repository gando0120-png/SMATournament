/**
 * 大会作成ページ
 */
import { DEFAULT_PREFERRED_BLOCK_SIZE } from "../../domain/constants.js";
import { validateTournamentInput } from "../../domain/validators.js";
import { createTournament } from "../../services/tournament-service.js";
import { initOperatorGuard } from "../../lib/operator-guard.js";
import { classifyError } from "../../lib/errors.js";
import { showErrorToast, showToast } from "../components/toast.js";
import {
  clearFormAlert,
  clearFormErrors,
  setFieldError,
  showFormAlert,
} from "../components/form-errors.js";

const views = {
  loading: document.getElementById("viewLoading"),
  config: document.getElementById("viewConfig"),
  operatorDenied: document.getElementById("viewOperatorDenied"),
  form: document.getElementById("viewForm"),
};

const form = document.getElementById("tournamentForm");
const formAlert = document.getElementById("formAlert");
const submitBtn = document.getElementById("submitBtn");
const headerActions = document.getElementById("headerActions");
const preferredBlockSizeInput = document.getElementById("preferredBlockSize");

let currentUser = null;

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

function readFormInput() {
  return {
    name: document.getElementById("name").value,
    eventDate: document.getElementById("eventDate").value,
    venue: document.getElementById("venue").value,
    entryDeadline: document.getElementById("entryDeadline").value,
    maxTeams: document.getElementById("maxTeams").value,
    teamSize: document.getElementById("teamSize").value,
    courtCount: document.getElementById("courtCount").value,
    preferredBlockSize: preferredBlockSizeInput.value,
  };
}

function applyValidationErrors(errors) {
  clearFormErrors(form);
  clearFormAlert(formAlert);
  Object.entries(errors).forEach(([field, message]) => {
    setFieldError(document.getElementById(field), message);
  });
  showFormAlert(formAlert, "入力内容を確認してください。", "error");
}

async function handleSubmit(event) {
  event.preventDefault();
  clearFormErrors(form);
  clearFormAlert(formAlert);

  const validation = validateTournamentInput(readFormInput());
  if (!validation.valid) {
    applyValidationErrors(validation.errors);
    return;
  }

  submitBtn.disabled = true;

  try {
    await createTournament(validation.values, currentUser.uid);
    showToast("大会を作成しました。");
    window.location.href = "index.html";
  } catch (error) {
    const { message } = classifyError(error);
    showFormAlert(formAlert, message, "error");
  } finally {
    submitBtn.disabled = false;
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

function initFormView(user) {
  currentUser = user;
  if (preferredBlockSizeInput && !preferredBlockSizeInput.value) {
    preferredBlockSizeInput.value = String(DEFAULT_PREFERRED_BLOCK_SIZE);
  }
  showView("form");
}

function initOperatorDeniedView() {
  showFormAlert(
    document.getElementById("operatorDeniedAlert"),
    "運営者として登録されていません。",
    "warning"
  );
  showView("operatorDenied");
}

function initTournamentNewPage() {
  preferredBlockSizeInput.value = String(DEFAULT_PREFERRED_BLOCK_SIZE);
  form.addEventListener("submit", handleSubmit);

  initOperatorGuard({
    onConfigRequired: initConfigView,
    onReady: initFormView,
    onOperatorDenied: initOperatorDeniedView,
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initTournamentNewPage);
} else {
  initTournamentNewPage();
}
