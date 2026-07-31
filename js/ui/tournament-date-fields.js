/**
 * 大会フォームの開催日・エントリー締切（分割日付）初期化
 */
import {
  composeDateTimeLocal,
  splitDateTimeLocal,
} from "../domain/date-parts.js";
import { mountDatePartsField } from "./components/date-parts-field.js";

/** @type {WeakMap<HTMLFormElement, { eventDate: object, entryDeadlineDate: object, entryDeadlineTime: HTMLInputElement|null }>} */
const formControllers = new WeakMap();

/**
 * @param {HTMLFormElement|null} formEl
 */
export function getTournamentDateFieldControllers(formEl) {
  return formEl ? formControllers.get(formEl) ?? null : null;
}

/**
 * @param {HTMLFormElement|null} [formEl]
 */
export function initTournamentDateFields(formEl = document.getElementById("tournamentForm")) {
  if (!formEl) {
    return null;
  }
  const existing = formControllers.get(formEl);
  if (existing) {
    return existing;
  }

  const eventHost = formEl.querySelector("[data-date-parts='eventDate']");
  const deadlineHost = formEl.querySelector("[data-date-parts='entryDeadline']");
  const eventHidden = formEl.querySelector("#eventDate");
  const deadlineHidden = formEl.querySelector("#entryDeadline");
  const timeInput = formEl.querySelector("#entryDeadlineTime");

  if (!eventHost || !deadlineHost || !eventHidden || !deadlineHidden || !timeInput) {
    return null;
  }

  const eventDate = mountDatePartsField({
    container: eventHost,
    idPrefix: "eventDate",
    label: "開催日",
    required: true,
    hiddenInput: eventHidden,
    initialValue: eventHidden.value || "",
    getNextFocusElement: () => formEl.querySelector("#venue"),
    messages: {
      required: "開催日を入力してください。",
      invalid: "開催日に存在しない日付が入力されています。",
    },
  });

  const entryDeadlineDate = mountDatePartsField({
    container: deadlineHost,
    idPrefix: "entryDeadlineDate",
    label: "エントリー締切",
    required: true,
    hiddenInput: null,
    initialValue: splitDateTimeLocal(deadlineHidden.value).date,
    getNextFocusElement: () => timeInput,
    messages: {
      required: "エントリー締切の日付を入力してください。",
      invalid: "エントリー締切に存在しない日付が入力されています。",
    },
  });

  function syncDeadlineHidden() {
    const dateValue = entryDeadlineDate.getValue();
    const timeValue = timeInput.value || "";
    if (dateValue && timeValue) {
      deadlineHidden.value = composeDateTimeLocal(dateValue, timeValue) || `${dateValue}T${timeValue}`;
    } else if (dateValue) {
      // 時刻未入力でも日付は残し、検証で時刻不足を検知できるようにする
      deadlineHidden.value = `${dateValue}T`;
    } else if (timeValue) {
      deadlineHidden.value = `T${timeValue}`;
    } else {
      deadlineHidden.value = "";
    }
  }

  // 初期時刻
  const initialSplit = splitDateTimeLocal(deadlineHidden.value);
  if (initialSplit.time) {
    timeInput.value = initialSplit.time;
  }
  syncDeadlineHidden();

  const onDeadlinePartInput = () => syncDeadlineHidden();
  deadlineHost.addEventListener("input", onDeadlinePartInput);
  deadlineHost.addEventListener("blur", onDeadlinePartInput, true);
  timeInput.addEventListener("input", syncDeadlineHidden);
  timeInput.addEventListener("change", syncDeadlineHidden);

  const controllers = {
    eventDate,
    entryDeadlineDate,
    entryDeadlineTime: timeInput,
    syncDeadlineHidden,
    setEntryDeadlineValue(value) {
      const split = splitDateTimeLocal(value || "");
      entryDeadlineDate.setValue(split.date);
      timeInput.value = split.time || "";
      syncDeadlineHidden();
    },
    getEntryDeadlineValue() {
      syncDeadlineHidden();
      return deadlineHidden.value || "";
    },
    destroy() {
      deadlineHost.removeEventListener("input", onDeadlinePartInput);
      deadlineHost.removeEventListener("blur", onDeadlinePartInput, true);
      timeInput.removeEventListener("input", syncDeadlineHidden);
      timeInput.removeEventListener("change", syncDeadlineHidden);
      eventDate.destroy();
      entryDeadlineDate.destroy();
      formControllers.delete(formEl);
    },
  };

  formControllers.set(formEl, controllers);
  return controllers;
}
