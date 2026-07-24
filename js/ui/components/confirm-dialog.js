/**
 * 確認ダイアログ（Promise ベース）
 */
export function confirmDialog({ title, message, confirmLabel = "OK", cancelLabel = "キャンセル" }) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "confirm-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");

    overlay.innerHTML = `
      <div class="confirm-dialog">
        <h2 class="confirm-dialog__title"></h2>
        <p class="confirm-dialog__message"></p>
        <div class="confirm-dialog__actions">
          <button type="button" class="btn btn--ghost" data-action="cancel"></button>
          <button type="button" class="btn btn--primary" data-action="confirm"></button>
        </div>
      </div>
    `;

    overlay.querySelector(".confirm-dialog__title").textContent = title;
    overlay.querySelector(".confirm-dialog__message").textContent = message;
    overlay.querySelector('[data-action="cancel"]').textContent = cancelLabel;
    overlay.querySelector('[data-action="confirm"]').textContent = confirmLabel;

    function close(result) {
      overlay.remove();
      resolve(result);
    }

    overlay.querySelector('[data-action="cancel"]').addEventListener("click", () => close(false));
    overlay.querySelector('[data-action="confirm"]').addEventListener("click", () => close(true));
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        close(false);
      }
    });

    document.body.appendChild(overlay);
    overlay.querySelector('[data-action="confirm"]').focus();
  });
}
