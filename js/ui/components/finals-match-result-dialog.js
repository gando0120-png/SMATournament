/**
 * 決勝試合結果入力ダイアログ（2セット先取・最大3セット）
 */
import { needsFinalsSet3Input } from "../../domain/finals-match-result.js";

/**
 * @param {object} options
 */
export function finalsMatchResultDialog({
  title,
  team1Name,
  team2Name,
  initialValues = {},
  submitLabel = "結果を確定",
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
          <p class="match-result-dialog__hint">2セット先取（最大3セット）。勝者側50点・敗者側50点未満。引分不可。</p>
          <div class="match-result-dialog__scoreboard" role="group" aria-label="セット得点">
            <div class="match-result-dialog__scoreboard-teams" aria-hidden="true"></div>
            <div class="match-result-dialog__scoreboard-team-name" data-team="1"></div>
            <div class="match-result-dialog__scoreboard-team-name" data-team="2"></div>

            <div class="match-result-dialog__scoreboard-rule" aria-hidden="true"></div>

            <div class="match-result-dialog__scoreboard-corner" aria-hidden="true"></div>
            <div class="match-result-dialog__scoreboard-col">チーム1</div>
            <div class="match-result-dialog__scoreboard-col">チーム2</div>

            <div class="match-result-dialog__scoreboard-set">第1セット</div>
            <input type="number" name="set1Team1Score" class="field__input match-result-dialog__score-input" min="0" max="50" step="1" required inputmode="numeric" aria-label="第1セット チーム1">
            <input type="number" name="set1Team2Score" class="field__input match-result-dialog__score-input" min="0" max="50" step="1" required inputmode="numeric" aria-label="第1セット チーム2">

            <div class="match-result-dialog__scoreboard-set">第2セット</div>
            <input type="number" name="set2Team1Score" class="field__input match-result-dialog__score-input" min="0" max="50" step="1" required inputmode="numeric" aria-label="第2セット チーム1">
            <input type="number" name="set2Team2Score" class="field__input match-result-dialog__score-input" min="0" max="50" step="1" required inputmode="numeric" aria-label="第2セット チーム2">

            <div class="match-result-dialog__scoreboard-set3-contents hidden" data-set3-panel>
              <div class="match-result-dialog__scoreboard-set">第3セット</div>
              <input type="number" name="set3Team1Score" class="field__input match-result-dialog__score-input" min="0" max="50" step="1" inputmode="numeric" aria-label="第3セット チーム1">
              <input type="number" name="set3Team2Score" class="field__input match-result-dialog__score-input" min="0" max="50" step="1" inputmode="numeric" aria-label="第3セット チーム2">
            </div>
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
    const set3Panel = overlay.querySelector("[data-set3-panel]");
    const set3Inputs = ["set3Team1Score", "set3Team2Score"];

    const fieldNames = [
      "set1Team1Score",
      "set1Team2Score",
      "set2Team1Score",
      "set2Team2Score",
      ...set3Inputs,
    ];

    fieldNames.forEach((name) => {
      const input = form.elements.namedItem(name);
      if (input && initialValues[name] !== undefined && initialValues[name] !== null) {
        input.value = String(initialValues[name]);
      }
    });

    function collectValues() {
      const values = {};
      for (const name of fieldNames) {
        values[name] = form.elements.namedItem(name)?.value ?? "";
      }
      return values;
    }

    function updateSet3Visibility() {
      const values = collectValues();
      const showSet3 =
        needsFinalsSet3Input(values) ||
        values.set3Team1Score !== "" ||
        values.set3Team2Score !== "";
      set3Panel.classList.toggle("hidden", !showSet3);
      set3Inputs.forEach((name) => {
        const input = form.elements.namedItem(name);
        if (input) {
          input.required = showSet3;
        }
      });
    }

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

    ["set1Team1Score", "set1Team2Score", "set2Team1Score", "set2Team2Score"].forEach((name) => {
      form.elements.namedItem(name)?.addEventListener("input", updateSet3Visibility);
    });

    updateSet3Visibility();

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

      const values = collectValues();

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
