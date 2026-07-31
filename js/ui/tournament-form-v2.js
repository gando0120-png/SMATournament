/**
 * 大会作成・編集フォーム共通（DOM 操作）
 *
 * named export（利用側と一致させること）:
 * - formatTimestampForDateTimeLocal
 * - readTournamentFormInput
 * - readTournamentCreateFormInput
 * - populateTournamentForm
 * - setTournamentStructureFieldsLocked
 * - setFinalsWinsRequiredFieldsLocked
 * - applyTournamentValidationErrors
 *
 * module id: tournament-form-v2 (20260731c)
 */
import { DEFAULT_PREFERRED_BLOCK_SIZE } from "../domain/constants.js";
import { DEFAULT_FINALS_WINS_REQUIRED } from "../domain/finals-match-format.js";
import { STRUCTURE_LOCK_FIELD_KEYS } from "../domain/tournament-structure-lock.js";
import {
  clearFormAlert,
  clearFormErrors,
  setFieldError,
  showFormAlert,
} from "./components/form-errors.js";

function readWinsRequiredFromForm(formEl = document.getElementById("tournamentForm")) {
  return (
    formEl?.querySelector('input[name="winsRequired"]:checked')?.value ??
    String(DEFAULT_FINALS_WINS_REQUIRED)
  );
}

/**
 * @param {unknown} value
 */
export function formatTimestampForDateTimeLocal(value) {
  if (value == null || value === "") {
    return "";
  }
  const date = typeof value.toDate === "function" ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * @param {HTMLFormElement|null} formEl
 */
export function readTournamentFormInput(formEl = document.getElementById("tournamentForm")) {
  return {
    name: document.getElementById("name")?.value ?? "",
    eventDate: document.getElementById("eventDate")?.value ?? "",
    venue: document.getElementById("venue")?.value ?? "",
    entryDeadline: document.getElementById("entryDeadline")?.value ?? "",
    maxTeams: document.getElementById("maxTeams")?.value ?? "",
    teamSize: document.getElementById("teamSize")?.value ?? "",
    courtCount: document.getElementById("courtCount")?.value ?? "",
    preferredBlockSize: document.getElementById("preferredBlockSize")?.value ?? "",
    winsRequired: readWinsRequiredFromForm(formEl),
  };
}

/**
 * 大会作成フォーム入力（新形式フィールド含む）
 * @param {HTMLFormElement|null} formEl
 */
export function readTournamentCreateFormInput(formEl = document.getElementById("tournamentForm")) {
  return {
    name: document.getElementById("name")?.value ?? "",
    eventDate: document.getElementById("eventDate")?.value ?? "",
    venue: document.getElementById("venue")?.value ?? "",
    entryDeadline: document.getElementById("entryDeadline")?.value ?? "",
    maxTeams: document.getElementById("maxTeams")?.value ?? "",
    teamSize: document.getElementById("teamSize")?.value ?? "",
    courtCount: document.getElementById("courtCount")?.value ?? "",
    winsRequired: readWinsRequiredFromForm(formEl),
    tournamentFormat:
      formEl?.querySelector('input[name="tournamentFormat"]:checked')?.value ?? "",
    blockCount: document.getElementById("blockCount")?.value ?? "",
    qualifiersPerBlock:
      formEl?.querySelector('input[name="qualifiersPerBlock"]:checked')?.value ?? "",
  };
}

/**
 * @param {object} tournament
 */
export function populateTournamentForm(tournament) {
  const setValue = (id, value) => {
    const el = document.getElementById(id);
    if (el) {
      el.value = value ?? "";
    }
  };

  setValue("name", tournament.name ?? "");
  setValue("eventDate", tournament.eventDate ?? "");
  setValue("venue", tournament.venue ?? "");
  setValue("entryDeadline", formatTimestampForDateTimeLocal(tournament.entryDeadline));
  setValue("maxTeams", tournament.maxTeams ?? "");
  setValue("teamSize", tournament.teamSize ?? "");
  setValue("courtCount", tournament.courtCount ?? "");
  setValue(
    "preferredBlockSize",
    tournament.preferredBlockSize ?? String(DEFAULT_PREFERRED_BLOCK_SIZE)
  );
}

/**
 * @param {boolean} locked
 */
export function setTournamentStructureFieldsLocked(locked) {
  for (const fieldId of STRUCTURE_LOCK_FIELD_KEYS) {
    const input = document.getElementById(fieldId);
    if (input) {
      input.disabled = locked;
      input.setAttribute("aria-disabled", locked ? "true" : "false");
    }
  }

  const noteEl = document.getElementById("structureLockNote");
  if (noteEl) {
    noteEl.classList.toggle("hidden", !locked);
  }
}

/**
 * @param {boolean} locked
 * @param {{ setLocked?: (locked: boolean) => void }|null} [rulesForm]
 */
export function setFinalsWinsRequiredFieldsLocked(locked, rulesForm = null) {
  if (rulesForm?.setLocked) {
    rulesForm.setLocked(locked);
    return;
  }
  document.querySelectorAll('input[name="winsRequired"]').forEach((input) => {
    input.disabled = locked;
    input.setAttribute("aria-disabled", locked ? "true" : "false");
  });

  const noteEl = document.getElementById("winsRequiredLockNote");
  if (noteEl) {
    noteEl.classList.toggle("hidden", !locked);
  }
}

/**
 * @param {HTMLFormElement|null} formEl
 * @param {HTMLElement|null} formAlertEl
 * @param {Record<string, string>} errors
 */
export function applyTournamentValidationErrors(
  errors,
  formEl = document.getElementById("tournamentForm"),
  formAlertEl = document.getElementById("formAlert")
) {
  if (formEl) {
    clearFormErrors(formEl);
  }
  clearFormAlert(formAlertEl);
  Object.entries(errors).forEach(([field, message]) => {
    const target =
      document.getElementById(field) ||
      formEl?.querySelector(`input[name="${field}"]`) ||
      formEl?.querySelector(`#${field}`);
    if (target?.classList?.contains("field")) {
      let errorEl = target.querySelector(":scope > .field__error");
      if (!errorEl) {
        errorEl = document.createElement("p");
        errorEl.className = "field__error";
        errorEl.setAttribute("role", "alert");
        target.appendChild(errorEl);
      }
      errorEl.textContent = message;
      return;
    }
    setFieldError(target, message);
  });
  showFormAlert(formAlertEl, "入力内容を確認してください。", "error");
}
