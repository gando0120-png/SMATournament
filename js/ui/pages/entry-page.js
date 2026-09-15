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

  ADDITIONAL_MEMBER_FIELD_KEYS,

  collectEntryMemberNames,

  formatTeamSizeRangeLabel,

  getAdditionalMemberFieldKeys,

  resolveTeamSizeFromTournament,

  resolveTeamSizeRange,

} from "../../domain/entry-members.js";

import {

  fillTeamSizeSelect,

  readMemberFieldValues,

  renderAdditionalMemberFields,

} from "../entry-member-fields.js";

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
let selectedTeamSize = null;



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



function readPreservedMemberValues() {

  const memberFieldsContainer = document.getElementById("memberFields");

  return memberFieldsContainer
    ? readMemberFieldValues(memberFieldsContainer, ADDITIONAL_MEMBER_FIELD_KEYS)
    : {};

}



function renderMemberFields(teamSize) {

  const memberFieldsContainer = document.getElementById("memberFields");

  if (!memberFieldsContainer) {

    throw new Error("Required element #memberFields not found");

  }



  const preserved = readPreservedMemberValues();

  console.log("[entry-page] render member fields start", teamSize);

  renderAdditionalMemberFields(memberFieldsContainer, teamSize, { values: preserved });

  console.log("[entry-page] render member fields ok", {

    teamSize,

    fieldCount: getAdditionalMemberFieldKeys(teamSize).length,

  });

}



function bindSelectedTeamSizeControl(range) {

  const fieldEl = document.getElementById("selectedTeamSizeField");

  const selectEl = document.getElementById("selectedTeamSize");

  const hintEl = document.getElementById("teamSizeRangeHint");

  if (!fieldEl || !selectEl) {

    return;

  }

  if (!range.isRange) {

    fieldEl.classList.add("hidden");

    selectEl.removeAttribute("required");

    selectedTeamSize = range.max;

    return;

  }

  if (selectedTeamSize == null || selectedTeamSize < range.min || selectedTeamSize > range.max) {

    selectedTeamSize = range.min;

  }

  if (hintEl) {

    hintEl.textContent = formatTeamSizeRangeLabel(range);

  }

  fillTeamSizeSelect(selectEl, range, selectedTeamSize);

  selectEl.required = true;

  fieldEl.classList.remove("hidden");

  selectEl.onchange = () => {

    selectedTeamSize = Number(selectEl.value);

    renderMemberFields(selectedTeamSize);

  };

}



function readFormInput() {

  const range = currentTournament

    ? resolveTeamSizeRange(currentTournament)

    : { min: 1, max: 1, isRange: false };

  const teamSize = selectedTeamSize ?? range.max;



  const input = {
    email: requireElement("email").value,
    teamName: requireElement("teamName").value,
    representativeName: requireElement("representativeName").value,
    comment: requireElement("comment").value,
    selectedTeamSize: teamSize,
  };

  Object.assign(input, readMemberFieldValues(document, getAdditionalMemberFieldKeys(teamSize)));

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

  const range = resolveTeamSizeRange(tournament);



  tournamentNameEl.textContent = tournament.name || "（名称未設定）";

  tournamentMetaEl.textContent = `開催日: ${formatTournamentDate(tournament.eventDate)} / 会場: ${tournament.venue || "—"} / ${formatTeamSizeRangeLabel(range)}`;



  bindSelectedTeamSizeControl(range);

  renderMemberFields(selectedTeamSize ?? range.max);



  console.log("[entry-page] render tournament info ok", {

    status: tournament.status,

    teamSize: range.max,

    teamSizeRange: range,

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

    selectedTeamSize = null;



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



  const validation = validateEntryInput(readFormInput(), currentTournament);

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


