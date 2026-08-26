/**
 * 決勝試合結果入力ダイアログ（2セット先取 / 3セット先取）
 */
import {
  formatFinalsWinsRequiredLabel,
  getFinalsSetScoreFieldNames,
  resolveFinalsMaxSets,
  resolveFinalsWinsRequired,
} from "../../domain/finals-match-format.js";
import { resolveVisibleFinalsSetCount } from "../../domain/finals-match-result.js";
import { getSetFinishReasonFieldName } from "../../domain/h2h-set-finish.js";

const FINISH_HINT_TEXT =
  "制限時間終了時点の得点を入力してください。得点の高いチームがこのセットの勝者になります。";

/**
 * @param {number} setNumber
 */
function buildFinishReasonFieldHtml(setNumber) {
  const fieldName = getSetFinishReasonFieldName(setNumber);
  return `
    <fieldset class="match-result-dialog__finish-reason" data-finish-reason-set="${setNumber}">
      <legend class="match-result-dialog__finish-reason-legend">終了</legend>
      <div class="match-result-dialog__finish-options">
        <label class="match-result-dialog__finish-option">
          <input type="radio" name="${fieldName}" value="normal">
          通常終了
        </label>
        <label class="match-result-dialog__finish-option">
          <input type="radio" name="${fieldName}" value="time_limit">
          時間切れ
        </label>
      </div>
      <p class="match-result-dialog__finish-hint hidden" data-finish-hint="${setNumber}">${FINISH_HINT_TEXT}</p>
    </fieldset>
  `;
}

/**
 * @param {HTMLFormElement} form
 * @param {string} name
 * @param {unknown} value
 */
function applyFinishReasonValue(form, name, value) {
  const reason = value === "time_limit" ? "time_limit" : "normal";
  const input = form.querySelector(`input[name="${name}"][value="${reason}"]`);
  if (input) {
    input.checked = true;
  }
}

/**
 * @param {HTMLFormElement} form
 * @param {string} name
 */
function readFinishReasonValue(form, name) {
  const checked = form.querySelector(`input[name="${name}"]:checked`);
  return checked?.value === "time_limit" ? "time_limit" : "normal";
}

/**
 * @param {object} options
 */
export function finalsMatchResultDialog({
  title,
  team1Name,
  team2Name,
  initialValues = {},
  submitLabel = "結果を確定",
  winsRequired: winsRequiredInput = 2,
  onSubmit,
}) {
  const winsRequired = resolveFinalsWinsRequired(winsRequiredInput);
  const maxSets = resolveFinalsMaxSets(winsRequired);

  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "confirm-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");

    const setRowsHtml = Array.from({ length: maxSets }, (_, index) => {
      const setNumber = index + 1;
      const fields = getFinalsSetScoreFieldNames(setNumber);
      return `
        <div class="match-result-dialog__set-row" data-set-row="${setNumber}">
          <div class="match-result-dialog__scoreboard-set">第${setNumber}セット</div>
          <input type="number" name="${fields.team1}" class="field__input match-result-dialog__score-input result-score-input--left" data-side="left" min="0" max="50" step="1" inputmode="numeric" aria-label="第${setNumber}セット チーム1">
          <input type="number" name="${fields.team2}" class="field__input match-result-dialog__score-input result-score-input--right" data-side="right" min="0" max="50" step="1" inputmode="numeric" aria-label="第${setNumber}セット チーム2">
          ${buildFinishReasonFieldHtml(setNumber)}
        </div>
      `;
    }).join("");

    overlay.innerHTML = `
      <div class="confirm-dialog match-result-dialog match-result-dialog--h2h">
        <h2 class="confirm-dialog__title"></h2>
        <form class="match-result-dialog__form">
          <p class="match-result-dialog__hint">${formatFinalsWinsRequiredLabel(winsRequired)}。通常終了は勝者側50点・敗者側50点未満。時間切れは高得点側の勝利。引分不可。</p>
          <div class="match-result-dialog__scoreboard" role="group" aria-label="セット得点" data-max-sets="${maxSets}">
            <div class="match-result-dialog__scoreboard-teams" aria-hidden="true"></div>
            <div class="match-result-dialog__scoreboard-team-name result-team-column--left" data-team="1" data-side="left"></div>
            <div class="match-result-dialog__scoreboard-team-name result-team-column--right" data-team="2" data-side="right"></div>

            <div class="match-result-dialog__scoreboard-rule" aria-hidden="true"></div>

            ${setRowsHtml}
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
    const setRows = [...overlay.querySelectorAll("[data-set-row]")];

    const scoreFieldNames = Array.from({ length: maxSets }, (_, index) => {
      const fields = getFinalsSetScoreFieldNames(index + 1);
      return [fields.team1, fields.team2];
    }).flat();
    const finishFieldNames = Array.from({ length: maxSets }, (_, index) =>
      getSetFinishReasonFieldName(index + 1)
    );

    scoreFieldNames.forEach((name) => {
      const input = form.elements.namedItem(name);
      if (input && initialValues[name] !== undefined && initialValues[name] !== null) {
        input.value = String(initialValues[name]);
      }
    });
    finishFieldNames.forEach((name) => {
      applyFinishReasonValue(form, name, initialValues[name]);
    });

    for (let setNumber = 1; setNumber <= maxSets; setNumber += 1) {
      const fieldName = getSetFinishReasonFieldName(setNumber);
      const hint = overlay.querySelector(`[data-finish-hint="${setNumber}"]`);
      const updateHint = () => {
        const checked = form.querySelector(`input[name="${fieldName}"]:checked`);
        hint?.classList.toggle("hidden", checked?.value !== "time_limit");
      };
      form.querySelectorAll(`input[name="${fieldName}"]`).forEach((input) => {
        input.addEventListener("change", () => {
          updateHint();
          updateSetVisibility();
        });
      });
      updateHint();
    }

    function collectValues() {
      const values = {};
      for (const name of scoreFieldNames) {
        values[name] = form.elements.namedItem(name)?.value ?? "";
      }
      for (const name of finishFieldNames) {
        values[name] = readFinishReasonValue(form, name);
      }
      return values;
    }

    function updateSetVisibility() {
      const values = collectValues();
      const visibleCount = resolveVisibleFinalsSetCount(values, { winsRequired });
      setRows.forEach((row) => {
        const setNumber = Number(row.dataset.setRow);
        const visible = setNumber <= visibleCount;
        row.classList.toggle("hidden", !visible);
        const fields = getFinalsSetScoreFieldNames(setNumber);
        [fields.team1, fields.team2].forEach((name) => {
          const input = form.elements.namedItem(name);
          if (input) {
            input.required = visible;
            if (!visible) {
              input.value = "";
            }
          }
        });
      });
    }

    function setSaving(isSaving) {
      submitBtn.disabled = isSaving;
      cancelBtn.disabled = isSaving;
      scoreFieldNames.forEach((name) => {
        const input = form.elements.namedItem(name);
        if (input) {
          input.disabled = isSaving;
        }
      });
      finishFieldNames.forEach((name) => {
        form.querySelectorAll(`input[name="${name}"]`).forEach((input) => {
          input.disabled = isSaving;
        });
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

    scoreFieldNames.forEach((name) => {
      form.elements.namedItem(name)?.addEventListener("input", updateSetVisibility);
    });

    updateSetVisibility();

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
