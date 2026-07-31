/**

 * 大会編集ページ

 */

import { validateTournamentInput, isValidTournamentId } from "../../domain/validators.js";

import { isTournamentDeleted } from "../../domain/tournament-deletion.js";

import { isTournamentStructureLocked } from "../../domain/tournament-structure-lock.js";

import { isFinalsMatchRulesLocked } from "../../domain/finals-match-format.js";

import { getTournament, updateTournamentSettings } from "../../services/tournament-service.js";

import {

  ensureTournamentStructureLocked,

  getTournamentProgressSignals,

} from "../../services/tournament-progress-service.js";

import { initTournamentManageGuard } from "../../lib/operator-guard.js";

import {

  classifyError,

  InvalidTournamentIdError,

} from "../../lib/errors.js";

import { showToast } from "../components/toast.js";

import { confirmDialog } from "../components/confirm-dialog.js";

import { showFormAlert } from "../components/form-errors.js";

import {

  applyTournamentValidationErrors,

  populateTournamentForm,

  readTournamentFormInput,

  setFinalsWinsRequiredFieldsLocked,

  setTournamentStructureFieldsLocked,

} from "../tournament-form-v2.js?v=20260731c";

import { initFinalsMatchRulesForm } from "../finals-match-rules-form.js";



const views = {

  loading: document.getElementById("viewLoading"),

  config: document.getElementById("viewConfig"),

  operatorDenied: document.getElementById("viewOperatorDenied"),

  deleted: document.getElementById("viewDeleted"),

  error: document.getElementById("viewError"),

  form: document.getElementById("viewForm"),

};



const form = document.getElementById("tournamentForm");

const formAlert = document.getElementById("formAlert");

const submitBtn = document.getElementById("submitBtn");

const headerActions = document.getElementById("headerActions");

const backToDashboardBtn = document.getElementById("backToDashboardBtn");

const cancelBtn = document.getElementById("cancelBtn");



let tournamentId = null;

let currentTournament = null;

let structureLocked = false;

let finalsWinsRequiredLocked = false;

const finalsMatchRulesForm = initFinalsMatchRulesForm();



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



function showPageError(message) {

  showFormAlert(document.getElementById("errorAlert"), message, "error");

  showView("error");

}



async function loadPage() {

  showView("loading");



  if (!isValidTournamentId(tournamentId)) {

    showPageError(classifyError(new InvalidTournamentIdError()).message);

    return;

  }



  backToDashboardBtn?.setAttribute("href", buildDashboardHref(tournamentId));
  cancelBtn?.setAttribute("href", buildDashboardHref(tournamentId));



  try {

    let tournament = await getTournament(tournamentId);

    if (isTournamentDeleted(tournament)) {

      showView("deleted");

      return;

    }



    const signals = await getTournamentProgressSignals(tournamentId);

    tournament = await ensureTournamentStructureLocked(tournamentId, tournament, signals);

    currentTournament = tournament;

    structureLocked = isTournamentStructureLocked(tournament, signals);

    finalsWinsRequiredLocked = isFinalsMatchRulesLocked(signals);



    populateTournamentForm(tournament);

    if (form) {

      form.dataset.tournamentFormat = tournament.tournamentFormat || "";

    }

    finalsMatchRulesForm?.populate(tournament);

    setTournamentStructureFieldsLocked(structureLocked);

    setFinalsWinsRequiredFieldsLocked(finalsWinsRequiredLocked, finalsMatchRulesForm);

    showView("form");

  } catch (error) {

    const { message } = classifyError(error);

    showPageError(message);

  }

}



async function handleSubmit(event) {

  event.preventDefault();

  if (!currentTournament || !form) {

    return;

  }



  const formInput = {

    ...readTournamentFormInput(form),

    ...(finalsMatchRulesForm?.readInput() ?? {}),

  };

  if (currentTournament?.tournamentFormat) {

    formInput.tournamentFormat = currentTournament.tournamentFormat;

    if (currentTournament.tournamentFormat === "qualifying_and_finals") {

      formInput.blockCount = currentTournament.blockCount;

      formInput.qualifiersPerBlock = currentTournament.qualifiersPerBlock;

    }

  }

  const validation = validateTournamentInput(formInput);

  if (!validation.valid) {

    applyTournamentValidationErrors(validation.errors, form, formAlert);

    return;

  }



  const confirmed = await confirmDialog({

    title: "大会設定の保存",

    message: `「${validation.values.name}」の設定を保存しますか？`,

    confirmLabel: "保存する",

    cancelLabel: "キャンセル",

  });

  if (!confirmed) {

    return;

  }



  submitBtn.disabled = true;

  try {

    await updateTournamentSettings(tournamentId, validation.values, {

      structureLocked,

      finalsWinsRequiredLocked,

    });

    showToast("大会設定を保存しました。");

    window.location.href = buildDashboardHref(tournamentId);

  } catch (error) {

    const { message } = classifyError(error);

    showFormAlert(formAlert, message, "error");

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



function initAccessDeniedView() {

  showFormAlert(

    document.getElementById("operatorDeniedAlert"),

    "この大会を編集する権限がありません。",

    "warning"

  );

  showView("operatorDenied");

}



function initEditPage() {
  tournamentId = new URLSearchParams(window.location.search).get("id");
  form?.addEventListener("submit", handleSubmit);
  form?.addEventListener("input", () => {
    finalsMatchRulesForm?.refresh();
  });
  form?.addEventListener("change", () => {
    finalsMatchRulesForm?.refresh();
  });
  cancelBtn?.addEventListener("click", (event) => {
    if (!isValidTournamentId(tournamentId)) {
      return;
    }
    event.preventDefault();
    window.location.href = buildDashboardHref(tournamentId);
  });

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

  document.addEventListener("DOMContentLoaded", initEditPage);

} else {

  initEditPage();

}


