/**
 * 試合結果入力ダイアログ（Promise ベース）
 * @param {object} options
 * @param {string} options.title
 * @param {string} options.team1Name
 * @param {string} options.team2Name
 * @param {object} [options.initialValues]
 * @param {string} [options.submitLabel]
 * @param {(values: object) => Promise<void>} [options.onSubmit] - 指定時は保存完了までダイアログを開いたままにする
 * @returns {Promise<object|null|true>}
 */
export function matchResultDialog({
  title,
  team1Name,
  team2Name,
  initialValues = {},
  submitLabel = "結果を保存",
  onSubmit,
}) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "confirm-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");

    overlay.innerHTML = `
      <div class="confirm-dialog match-result-dialog">
        <h2 class="confirm-dialog__title"></h2>
        <form class="match-result-dialog__form">
          <div class="match-result-dialog__teams">
            <p class="match-result-dialog__team"><span class="match-result-dialog__team-label">チーム1</span> <strong data-team="1"></strong></p>
            <p class="match-result-dialog__team"><span class="match-result-dialog__team-label">チーム2</span> <strong data-team="2"></strong></p>
          </div>
          <p class="match-result-dialog__hint">各セットの得点を入力してください（2セット制）。セット結果は得点から自動判定されます。</p>
          <div class="match-result-dialog__sets">
            <section class="match-result-dialog__set">
              <h3 class="match-result-dialog__set-title">第1セット</h3>
              <div class="match-result-dialog__fields">
                <label class="field">
                  <span class="field__label">チーム1 得点</span>
                  <input type="number" name="set1Team1Score" class="field__input" min="0" step="1" required inputmode="numeric">
                </label>
                <label class="field">
                  <span class="field__label">チーム2 得点</span>
                  <input type="number" name="set1Team2Score" class="field__input" min="0" step="1" required inputmode="numeric">
                </label>
              </div>
            </section>
            <section class="match-result-dialog__set">
              <h3 class="match-result-dialog__set-title">第2セット</h3>
              <div class="match-result-dialog__fields">
                <label class="field">
                  <span class="field__label">チーム1 得点</span>
                  <input type="number" name="set2Team1Score" class="field__input" min="0" step="1" required inputmode="numeric">
                </label>
                <label class="field">
                  <span class="field__label">チーム2 得点</span>
                  <input type="number" name="set2Team2Score" class="field__input" min="0" step="1" required inputmode="numeric">
                </label>
              </div>
            </section>
          </div>
          <p class="match-result-dialog__error hidden" role="alert"></p>
          <div class="confirm-dialog__actions">
            <button type="button" class="btn btn--ghost" data-action="cancel">キャンセル</button>
            <button type="submit" class="btn btn--primary" data-action="submit"></button>
          </div>
        </form>
      </div>
    `;

    overlay.querySelector(".confirm-dialog__title").textContent = title;
    overlay.querySelector('[data-team="1"]').textContent = team1Name;
    overlay.querySelector('[data-team="2"]').textContent = team2Name;
    overlay.querySelector('[data-action="submit"]').textContent = submitLabel;

    const form = overlay.querySelector("form");
    const errorEl = overlay.querySelector(".match-result-dialog__error");
    const submitBtn = overlay.querySelector('[data-action="submit"]');
    const cancelBtn = overlay.querySelector('[data-action="cancel"]');

    const fieldNames = ["set1Team1Score", "set1Team2Score", "set2Team1Score", "set2Team2Score"];
    fieldNames.forEach((name) => {
      const input = form.elements.namedItem(name);
      if (input && initialValues[name] !== undefined && initialValues[name] !== null) {
        input.value = String(initialValues[name]);
      }
    });

    function setSaving(isSaving) {
      submitBtn.disabled = isSaving;
      cancelBtn.disabled = isSaving;
      fieldNames.forEach((name) => {
        const input = form.elements.namedItem(name);
        if (input) {
          input.disabled = isSaving;
        }
      });
    }

    function showError(message) {
      errorEl.textContent = message;
      errorEl.classList.remove("hidden");
    }

    function close(result) {
      overlay.remove();
      resolve(result);
    }

    cancelBtn.addEventListener("click", () => close(null));
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        close(null);
      }
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      errorEl.classList.add("hidden");
      errorEl.textContent = "";

      const values = {};
      for (const name of fieldNames) {
        values[name] = form.elements.namedItem(name)?.value ?? "";
      }

      if (typeof onSubmit === "function") {
        setSaving(true);
        try {
          await onSubmit(values);
          close(true);
        } catch (error) {
          showError(error.message || "保存に失敗しました。");
          setSaving(false);
        }
        return;
      }

      close(values);
    });

    document.body.appendChild(overlay);
    form.elements.namedItem("set1Team1Score")?.focus();
  });
}
