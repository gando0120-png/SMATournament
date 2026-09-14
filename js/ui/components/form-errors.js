/**
 * フォームエラー表示
 */
import { getUserFacingError } from "../../lib/user-facing-error.js";

export function clearFormErrors(formEl) {
  formEl.querySelectorAll(".field__error").forEach((el) => el.remove());
  formEl.querySelectorAll(".field__input--error").forEach((el) => {
    el.classList.remove("field__input--error");
  });
}

export function setFieldError(inputEl, message) {
  if (!inputEl) {
    return;
  }
  inputEl.classList.add("field__input--error");
  inputEl.setAttribute("aria-invalid", "true");

  const field = inputEl.closest(".field");
  if (!field) {
    return;
  }

  let errorEl = field.querySelector(".field__error");
  if (!errorEl) {
    errorEl = document.createElement("p");
    errorEl.className = "field__error";
    errorEl.setAttribute("role", "alert");
    field.appendChild(errorEl);
  }
  errorEl.textContent = message;
}

export function showFormAlert(containerEl, message, type = "error") {
  if (!containerEl) {
    return null;
  }
  containerEl.innerHTML = "";
  const alert = document.createElement("div");
  alert.className = `alert alert--${type} user-facing-error`;
  alert.setAttribute("role", "alert");
  alert.textContent = message;
  containerEl.appendChild(alert);
  return alert;
}

/**
 * @param {HTMLElement|null} errorEl
 * @param {{ title?: string, message?: string }} facing
 */
export function applyUserFacingError(errorEl, facing) {
  if (!errorEl) {
    return;
  }
  errorEl.replaceChildren();
  errorEl.classList.add("user-facing-error");
  const title = facing?.title?.trim() || "";
  const message = facing?.message?.trim() || "";
  if (title && title !== message) {
    const titleEl = document.createElement("span");
    titleEl.className = "user-facing-error__title";
    titleEl.textContent = title;
    errorEl.appendChild(titleEl);
  }
  if (message) {
    const messageEl = document.createElement("span");
    messageEl.className = "user-facing-error__message";
    messageEl.textContent = message;
    errorEl.appendChild(messageEl);
  }
  errorEl.classList.remove("hidden");
}

/**
 * @param {HTMLElement|null} errorEl
 * @param {unknown} error
 * @param {string} context
 * @param {string} [logScope]
 */
export function showDialogUserFacingError(errorEl, error, context, logScope) {
  const facing = getUserFacingError(error, context, { logScope });
  applyUserFacingError(errorEl, facing);
  return facing;
}

export function clearFormAlert(containerEl) {
  if (containerEl) {
    containerEl.innerHTML = "";
  }
}
