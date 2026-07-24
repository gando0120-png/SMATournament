/**
 * 公開エントリーフォーム
 */
import { isFirebaseConfigured } from "../../lib/firebase-app.js";
import { getTournament } from "../../services/tournament-service.js";
import { createEntry } from "../../services/entry-service.js";
import { isValidTournamentId, validateEntryInput } from "../../domain/validators.js";
import {
  getEntryClosedMessage,
  isEntryOpenForTournament,
} from "../../lib/entry-open.js";
import {
  classifyError,
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

const form = document.getElementById("entryForm");
const formAlert = document.getElementById("formAlert");
const submitBtn = document.getElementById("submitBtn");
const tournamentNameEl = document.getElementById("tournamentName");
const tournamentMetaEl = document.getElementById("tournamentMeta");

let tournamentId = null;

function showView(name) {
  Object.entries(views).forEach(([key, el]) => {
    if (el) {
      el.classList.toggle("hidden", key !== name);
    }
  });
}

function readFormInput() {
  return {
    teamName: document.getElementById("teamName").value,
    representativeName: document.getElementById("representativeName").value,
    member2: document.getElementById("member2").value,
    member3: document.getElementById("member3").value,
    email: document.getElementById("email").value,
    comment: document.getElementById("comment").value,
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

function renderTournament(tournament) {
  tournamentNameEl.textContent = tournament.name || "（名称未設定）";
  tournamentMetaEl.textContent = `開催日: ${tournament.eventDate || "—"} / 会場: ${tournament.venue || "—"}`;
}

function showPageError(message) {
  showFormAlert(document.getElementById("errorAlert"), message, "error");
  showView("error");
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

    if (!isEntryOpenForTournament(tournament)) {
      showPageError(getEntryClosedMessage(tournament));
      return;
    }

    showView("form");
  } catch (error) {
    const { message } = classifyError(error);
    showPageError(message);
  }
}

function buildEntryConfirmMessage(values) {
  const lines = [
    `チーム名: ${values.teamName}`,
    `代表者名: ${values.representativeName}`,
  ];
  const members = [values.member2, values.member3].filter(Boolean);
  if (members.length > 0) {
    lines.push(`メンバー: ${members.join("、")}`);
  }
  return lines.join("\n");
}

async function handleSubmit(event) {
  event.preventDefault();
  clearFormErrors(form);
  clearFormAlert(formAlert);

  const validation = validateEntryInput(readFormInput());
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

  submitBtn.disabled = true;

  try {
    await createEntry(tournamentId, validation.values);
    showView("success");
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

function initEntryPage() {
  tournamentId = new URLSearchParams(window.location.search).get("id");
  form.addEventListener("submit", handleSubmit);

  if (!isFirebaseConfigured()) {
    initConfigView();
    return;
  }

  loadTournament();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initEntryPage);
} else {
  initEntryPage();
}
