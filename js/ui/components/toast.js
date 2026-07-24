let container = null;

function ensureContainer() {
  if (container) {
    return container;
  }
  container = document.createElement("div");
  container.className = "toast-container";
  container.setAttribute("aria-live", "polite");
  document.body.appendChild(container);
  return container;
}

export function showToast(message, type = "success", durationMs = 4000) {
  const root = ensureContainer();
  const el = document.createElement("div");
  el.className = `toast toast--${type}`;
  el.textContent = message;
  root.appendChild(el);

  window.setTimeout(() => {
    el.remove();
    if (root.childElementCount === 0) {
      root.remove();
      container = null;
    }
  }, durationMs);
}

export function showErrorToast(message) {
  showToast(message, "error", 6000);
}
