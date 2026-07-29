/**
 * 確認ダイアログ（Promise ベース）
 */

let bodyScrollLockCount = 0;
let lockedScrollY = 0;

function lockBodyScroll() {
  if (bodyScrollLockCount === 0) {
    lockedScrollY = window.scrollY || document.scrollingElement?.scrollTop || 0;
    document.body.style.position = "fixed";
    document.body.style.top = `-${lockedScrollY}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.width = "100%";
  }
  bodyScrollLockCount += 1;
}

function unlockBodyScroll() {
  bodyScrollLockCount = Math.max(0, bodyScrollLockCount - 1);
  if (bodyScrollLockCount > 0) {
    return;
  }
  document.body.style.position = "";
  document.body.style.top = "";
  document.body.style.left = "";
  document.body.style.right = "";
  document.body.style.width = "";
  window.scrollTo(0, lockedScrollY);
}

/**
 * @param {object} options
 * @param {string} options.title
 * @param {string} options.message
 * @param {string} [options.confirmLabel]
 * @param {string} [options.cancelLabel]
 * @returns {Promise<boolean>}
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
      unlockBodyScroll();
      resolve(result);
    }

    overlay.querySelector('[data-action="cancel"]').addEventListener("click", () => close(false));
    overlay.querySelector('[data-action="confirm"]').addEventListener("click", () => close(true));
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        close(false);
      }
    });

    lockBodyScroll();
    document.body.appendChild(overlay);
    overlay.querySelector('[data-action="confirm"]').focus();
  });
}
