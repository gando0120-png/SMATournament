/**

 * 公開エントリーフォーム

 */

import { isFirebaseConfigured } from "../../lib/firebase-app.js";

import {

  createPublicEntry,

  loadTournamentForPublicEntry,

} from "../../services/public-entry-service.js";

import { isValidTournamentId, validateEntryInput } from "../../domain/validators.js";

import { buildEntryCompletionGuidanceView } from "../../domain/entry-completion-guidance.js";

import {

  collectEntryMemberNames,

  getAdditionalMemberFieldKeys,

  getMemberFieldLabel,

  resolveTeamSizeFromTournament,

} from "../../domain/entry-members.js";

import { isTournamentDeleted } from "../../domain/tournament-deletion.js";

import {

  getEntryClosedMessage,

  isEntryOpenForTournament,

} from "../../lib/entry-open.js";

import { getCurrentUser } from "../../lib/auth.js";

import {

  classifyEntryError,

  InvalidTournamentIdError,

} from "../../lib/errors.js";

import {

  clearFormAlert,

  clearFormErrors,

  setFieldError,

  showFormAlert,

} from "../components/form-errors.js";

import { confirmDialog } from "../components/confirm-dialog.js";



const views = {

  loading: document.getElementById("viewLoading"),

  config: document.getElementById("viewConfig"),

  error: document.getElementById("viewError"),

  form: document.getElementById("viewForm"),

  success: document.getElementById("viewSuccess"),

};



const formAlert = document.getElementById("formAlert");

const submitBtn = document.getElementById("submitBtn");



let formEl = null;

let tournamentId = null;

let currentTournament = null;



function showView(name) {

  Object.entries(views).forEach(([key, el]) => {

    if (el) {

      el.classList.toggle("hidden", key !== name);

    }

  });

}



/**
 * エントリー完了画面の大会案内（textContent のみ。HTML は挿入しない）
 * @param {object|null|undefined} tournament
 */
function renderEntryCompletionGuidance(tournament) {

  const section = document.getElementById("entryCompletionGuidance");

  const messageEl = document.getElementById("entryCompletionGuidanceMessage");

  const urlTextEl = document.getElementById("entryCompletionGuidanceUrlText");

  const linkEl = document.getElementById("entryCompletionGuidanceLink");

  if (!section || !messageEl || !linkEl) {

    return;

  }

  const view = buildEntryCompletionGuidanceView(tournament);

  function clearUrlAnchors() {
    if (urlTextEl) {
      urlTextEl.classList.add("hidden");
      urlTextEl.removeAttribute("href");
      urlTextEl.textContent = "";
    }
    linkEl.classList.add("hidden");
    linkEl.removeAttribute("href");
    linkEl.textContent = "";
  }

  if (!view.visible) {

    section.classList.add("hidden");

    messageEl.textContent = "";

    messageEl.classList.add("hidden");

    clearUrlAnchors();

    return;

  }

  section.classList.remove("hidden");

  if (view.message) {

    messageEl.classList.remove("hidden");

    messageEl.textContent = view.message;

  } else {

    messageEl.classList.add("hidden");

    messageEl.textContent = "";

  }

  if (view.linkUrl) {

    if (urlTextEl) {
      urlTextEl.classList.remove("hidden");
      urlTextEl.href = view.linkUrl;
      urlTextEl.textContent = view.linkUrl;
      urlTextEl.target = "_blank";
      urlTextEl.rel = "noopener noreferrer";
    }

    linkEl.classList.remove("hidden");

    linkEl.href = view.linkUrl;

    linkEl.textContent = view.linkLabel || "詳しく見る";

    linkEl.target = "_blank";

    linkEl.rel = "noopener noreferrer";

  } else {

    clearUrlAnchors();

  }

}



function isLoadingVisible() {

  return views.loading && !views.loading.classList.contains("hidden");

}



function requireElement(id, label = id) {

  const el = document.getElementById(id);

  if (!el) {

    throw new Error(`Required element #${id} (${label}) not found`);

  }

  return el;

}



function logAuthContext() {

  const user = getCurrentUser();

  if (user) {

    console.warn("[entry-page] authenticated session detected", {

      uid: user.uid,

      email: user.email ?? null,

    });

  } else {

    console.info("[entry-page] unauthenticated session");

  }

}



function formatTournamentDate(value) {

  if (value == null || value === "") {

    return "—";

  }

  if (typeof value.toDate === "function") {

    const date = value.toDate();

    if (!Number.isNaN(date.getTime())) {

      return date.toLocaleDateString("ja-JP");

    }

  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {

    return value.toLocaleDateString("ja-JP");

  }

  return String(value);

}



function renderMemberFields(teamSize) {

  const memberFieldsContainer = document.getElementById("memberFields");

  if (!memberFieldsContainer) {

    throw new Error("Required element #memberFields not found");

  }



  console.log("[entry-page] render member fields start", teamSize);

  memberFieldsContainer.innerHTML = "";



  for (const fieldKey of getAdditionalMemberFieldKeys(teamSize)) {

    const label = document.createElement("label");

    label.className = "field";

    label.htmlFor = fieldKey;



    const labelText = document.createElement("span");

    labelText.className = "field__label";

    labelText.textContent = getMemberFieldLabel(fieldKey);



    const input = document.createElement("input");

    input.className = "field__input";

    input.type = "text";

    input.id = fieldKey;

    input.name = fieldKey;

    input.required = true;



    label.append(labelText, input);

    memberFieldsContainer.appendChild(label);

  }



  console.log("[entry-page] render member fields ok", {

    teamSize,

    fieldCount: getAdditionalMemberFieldKeys(teamSize).length,

  });

}



function readFormInput() {

  const teamSize = currentTournament

    ? resolveTeamSizeFromTournament(currentTournament)

    : 1;



  const input = {
    email: requireElement("email").value,
    teamName: requireElement("teamName").value,
    representativeName: requireElement("representativeName").value,
    comment: requireElement("comment").value,
  };



  for (const fieldKey of getAdditionalMemberFieldKeys(teamSize)) {

    const field = document.getElementById(fieldKey);

    if (field) {

      input[fieldKey] = field.value;

    }

  }



  return input;

}



function applyValidationErrors(errors) {

  if (!formEl) {

    return;

  }

  clearFormErrors(formEl);

  clearFormAlert(formAlert);

  Object.entries(errors).forEach(([field, message]) => {

    setFieldError(document.getElementById(field), message);

  });

  showFormAlert(formAlert, "入力内容を確認してください。", "error");

}



function renderTournament(tournament) {

  console.log("[entry-page] render tournament info start");



  const tournamentNameEl = requireElement("tournamentName");

  const tournamentMetaEl = requireElement("tournamentMeta");

  const teamSize = resolveTeamSizeFromTournament(tournament);



  tournamentNameEl.textContent = tournament.name || "（名称未設定）";

  tournamentMetaEl.textContent = `開催日: ${formatTournamentDate(tournament.eventDate)} / 会場: ${tournament.venue || "—"} / ${teamSize}人制`;



  renderMemberFields(teamSize);



  console.log("[entry-page] render tournament info ok", {

    status: tournament.status,

    teamSize,

    rawTeamSize: tournament.teamSize ?? null,

    entryDeadline: tournament.entryDeadline ?? null,

  });

}



function showPageError(message) {

  const errorAlert = document.getElementById("errorAlert");

  showFormAlert(errorAlert, message, "error");

  showView("error");

}



function ensureNotLoading(message = "エントリーページの読み込みに失敗しました。") {

  if (isLoadingVisible()) {

    console.error("[entry-page] loading view still visible — forcing error view");

    showPageError(message);

  }

}



async function loadTournament() {

  console.log("[entry-page] tournament load start", tournamentId);

  showView("loading");



  if (!isValidTournamentId(tournamentId)) {

    const { message } = classifyEntryError(new InvalidTournamentIdError());

    showPageError(message);

    return;

  }



  try {

    const tournament = await loadTournamentForPublicEntry(tournamentId);

    if (isTournamentDeleted(tournament)) {
      showPageError("この大会は削除されています。");
      return;
    }

    console.log("[entry-page] tournament load ok", {

      status: tournament.status,

      teamSize: resolveTeamSizeFromTournament(tournament),

      entryDeadline: tournament.entryDeadline ?? null,

    });



    currentTournament = {

      ...tournament,

      teamSize: resolveTeamSizeFromTournament(tournament),

    };



    renderTournament(currentTournament);



    if (!isEntryOpenForTournament(currentTournament)) {

      console.log("[entry-page] entry closed", {

        status: currentTournament.status,

        entryDeadline: currentTournament.entryDeadline ?? null,

      });

      showPageError(getEntryClosedMessage(currentTournament));

      return;

    }



    console.log("[entry-page] show form");

    showView("form");

  } catch (error) {

    console.error("[entry-page] init failed", error?.code, error?.message, error);

    const { message } = classifyEntryError(error);

    showPageError(message);

  } finally {

    ensureNotLoading();

  }

}



function buildEntryConfirmMessage(values) {

  const lines = [`チーム名: ${values.teamName}`];

  const members = collectEntryMemberNames(values);

  if (members.length > 0) {

    lines.push(`メンバー: ${members.join("、")}`);

  }

  return lines.join("\n");

}



async function handleSubmit(event) {

  event.preventDefault();

  if (!formEl) {

    return;

  }



  clearFormErrors(formEl);

  clearFormAlert(formAlert);



  if (!currentTournament) {

    return;

  }



  const teamSize = resolveTeamSizeFromTournament(currentTournament);

  const validation = validateEntryInput(readFormInput(), teamSize);

  if (!validation.valid) {

    applyValidationErrors(validation.errors);

    return;

  }



  const confirmed = await confirmDialog({

    title: "エントリー内容の確認",

    message: `${buildEntryConfirmMessage(validation.values)}\n\nこの内容でエントリーしますか？`,

    confirmLabel: "エントリーする",

    cancelLabel: "キャンセル",

  });



  if (!confirmed) {

    return;

  }



  if (submitBtn) {

    submitBtn.disabled = true;

  }



  try {

    await createPublicEntry(tournamentId, validation.values, {

      tournament: currentTournament,

    });

    renderEntryCompletionGuidance(currentTournament);

    showView("success");

  } catch (error) {

    console.error("[entry] handleSubmit failed", tournamentId, error?.code, error);

    const { message } = classifyEntryError(error);

    showFormAlert(formAlert, message, "error");

    if (submitBtn) {

      submitBtn.disabled = false;

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



async function initEntryPage() {

  console.log("[entry-page] init start");



  try {

    tournamentId = new URLSearchParams(window.location.search).get("id");

    console.log("[entry-page] tournament id", tournamentId);



    if (!isFirebaseConfigured()) {

      initConfigView();

      console.log("[entry-page] init complete (config required)");

      return;

    }



    logAuthContext();



    formEl = document.getElementById("entryForm");

    if (!formEl) {

      throw new Error("Required element #entryForm not found");

    }

    formEl.addEventListener("submit", handleSubmit);



    await loadTournament();

    console.log("[entry-page] init complete");

  } catch (error) {

    console.error("[entry-page] init failed", error?.code, error?.message, error);

    const { message } = classifyEntryError(error);

    showPageError(message);

  } finally {

    ensureNotLoading();

  }

}



if (document.readyState === "loading") {

  document.addEventListener("DOMContentLoaded", () => {

    initEntryPage();

  });

} else {

  initEntryPage();

}


