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
 * - syncPreferredBlockSizeFieldVisibility
 * - applyTournamentValidationErrors
 *
 * module id: tournament-form-v2 (20260731f)
 */
import { DEFAULT_PREFERRED_BLOCK_SIZE } from "../domain/constants.js";
import { DEFAULT_FINALS_WINS_REQUIRED } from "../domain/finals-match-format.js";
import { MatchFormat, resolveMatchFormat } from "../domain/aggregate-match-format.js";
import { usesPreferredBlockSize } from "../domain/tournament-settings-update.js";
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

function readMatchFormatFieldsFromForm(formEl = document.getElementById("tournamentForm")) {
  const matchFormat = resolveMatchFormat(
    formEl?.querySelector('input[name="matchFormat"]:checked')?.value
  );
  if (matchFormat !== MatchFormat.MULTI_TEAM_TOTAL) {
    return { matchFormat: MatchFormat.HEAD_TO_HEAD_SETS };
  }
  return {
    matchFormat: MatchFormat.MULTI_TEAM_TOTAL,
    teamCount: Number(
      formEl?.querySelector('input[name="aggregateTeamCount"]:checked')?.value || 4
    ),
    qualifiersCount: Number(
      formEl?.querySelector('input[name="aggregateQualifiersCount"]:checked')?.value || 2
    ),
    setCount: 2,
  };
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
  const tournamentFormat =
    formEl?.dataset?.tournamentFormat ||
    formEl?.querySelector('input[name="tournamentFormat"]:checked')?.value ||
    "";
  const input = {
    name: document.getElementById("name")?.value ?? "",
    eventDate: document.getElementById("eventDate")?.value ?? "",
    venue: document.getElementById("venue")?.value ?? "",
    entryDeadline: document.getElementById("entryDeadline")?.value ?? "",
    maxTeams: document.getElementById("maxTeams")?.value ?? "",
    teamSize: document.getElementById("teamSize")?.value ?? "",
    courtCount: document.getElementById("courtCount")?.value ?? "",
    winsRequired: readWinsRequiredFromForm(formEl),
    ...readMatchFormatFieldsFromForm(formEl),
  };

  // 一発TN / 予選＋決勝では preferredBlockSize を読まない（更新対象外）
  if (usesPreferredBlockSize(tournamentFormat)) {
    input.preferredBlockSize = document.getElementById("preferredBlockSize")?.value ?? "";
  }

  return input;
}

/**
 * 大会形式に応じて preferredBlockSize 入力の表示を切り替える
 * @param {string|null|undefined} tournamentFormat
 */
export function syncPreferredBlockSizeFieldVisibility(tournamentFormat) {
  const field =
    document.getElementById("preferredBlockSizeField") ||
    document.getElementById("preferredBlockSize")?.closest(".field");
  if (!field) {
    return;
  }
  const show = usesPreferredBlockSize(tournamentFormat);
  field.classList.toggle("hidden", !show);
  const input = document.getElementById("preferredBlockSize");
  if (input) {
    input.disabled = !show;
  }
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
    ...readMatchFormatFieldsFromForm(formEl),
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
  syncPreferredBlockSizeFieldVisibility(tournament.tournamentFormat);
  if (usesPreferredBlockSize(tournament.tournamentFormat)) {
    setValue(
      "preferredBlockSize",
      tournament.preferredBlockSize ?? String(DEFAULT_PREFERRED_BLOCK_SIZE)
    );
  }
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
 * @param {boolean} locked
 * @param {{ setLocked?: (locked: boolean) => void }|null} [aggregateForm]
 */
export function setAggregateMatchRulesFieldsLocked(locked, aggregateForm = null) {
  if (aggregateForm?.setLocked) {
    aggregateForm.setLocked(locked);
    return;
  }
  [
    'input[name="matchFormat"]',
    'input[name="aggregateTeamCount"]',
    'input[name="aggregateQualifiersCount"]',
  ].forEach((selector) => {
    document.querySelectorAll(selector).forEach((input) => {
      input.disabled = locked;
      input.setAttribute("aria-disabled", locked ? "true" : "false");
    });
  });
  const noteEl = document.getElementById("aggregateMatchRulesLockNote");
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
