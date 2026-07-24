/**
 * フォームエラー表示
 */

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
  alert.className = `alert alert--${type}`;
  alert.setAttribute("role", "alert");
  alert.textContent = message;
  containerEl.appendChild(alert);
  return alert;
}

export function clearFormAlert(containerEl) {
  if (containerEl) {
    containerEl.innerHTML = "";
  }
}
