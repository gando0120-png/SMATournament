/**
 * 開始予定時刻の手動修正ダイアログ
 */
import { normalizeDayStartTime } from "../../domain/time-schedule.js";

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
 * @param {string} [options.initialHm] "HH:mm"
 * @param {boolean} [options.showReset]
 * @returns {Promise<{ action: "save", value: string }|{ action: "reset" }|null>}
 */
export function scheduledTimeDialog({ title, initialHm = "", showReset = false }) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "confirm-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "scheduledTimeDialogTitle");

    const resetButton = showReset
      ? `<button type="button" class="btn btn--ghost" data-action="reset">自動に戻す</button>`
      : "";

    overlay.innerHTML = `
      <div class="confirm-dialog scheduled-time-dialog">
        <form>
          <h2 class="confirm-dialog__title" id="scheduledTimeDialogTitle"></h2>
          <label class="field" for="scheduledTimeInput">
            <span class="field__label">開始予定時刻</span>
            <input
              class="field__input"
              id="scheduledTimeInput"
              name="scheduledTime"
              type="time"
              required
            >
          </label>
          <p class="field__error hidden" data-scheduled-time-error></p>
          <div class="confirm-dialog__actions">
            <button type="button" class="btn btn--ghost" data-action="cancel">キャンセル</button>
            ${resetButton}
            <button type="submit" class="btn btn--primary">保存</button>
          </div>
        </form>
      </div>
    `;

    overlay.querySelector(".confirm-dialog__title").textContent = title;
    const form = overlay.querySelector("form");
    const input = overlay.querySelector("#scheduledTimeInput");
    const errorEl = overlay.querySelector("[data-scheduled-time-error]");
    const normalizedInitial = normalizeDayStartTime(initialHm);
    input.value = normalizedInitial || "";

    function close(result) {
      overlay.remove();
      unlockBodyScroll();
      resolve(result);
    }

    function showError(message) {
      errorEl.textContent = message;
      errorEl.classList.toggle("hidden", !message);
    }

    overlay.querySelector('[data-action="cancel"]').addEventListener("click", () => close(null));
    overlay.querySelector('[data-action="reset"]')?.addEventListener("click", () =>
      close({ action: "reset" })
    );
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        close(null);
      }
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const value = normalizeDayStartTime(input.value);
      if (!value) {
        showError("開始予定時刻は HH:mm 形式で入力してください。");
        input.focus();
        return;
      }
      close({ action: "save", value });
    });

    lockBodyScroll();
    document.body.appendChild(overlay);
    input.focus();
  });
}
