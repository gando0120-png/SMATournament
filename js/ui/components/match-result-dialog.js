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

const FINISH_HINT_TEXT =
  "制限時間終了時点の得点を入力してください。得点の高いチームがこのセットの勝者になります。";

/**
 * @param {number} setNumber
 * @param {string} [fieldName]
 */
function buildFinishReasonFieldHtml(setNumber, fieldName = `set${setNumber}FinishReason`) {
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
 * @param {HTMLElement} root
 * @param {number[]} setNumbers
 */
function wireFinishReasonHints(root, setNumbers) {
  for (const setNumber of setNumbers) {
    const fieldName = `set${setNumber}FinishReason`;
    const hint = root.querySelector(`[data-finish-hint="${setNumber}"]`);
    const update = () => {
      const checked = root.querySelector(`input[name="${fieldName}"]:checked`);
      hint?.classList.toggle("hidden", checked?.value !== "time_limit");
    };
    root.querySelectorAll(`input[name="${fieldName}"]`).forEach((input) => {
      input.addEventListener("change", update);
    });
    update();
  }
}

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
      <div class="confirm-dialog match-result-dialog match-result-dialog--h2h">
        <h2 class="confirm-dialog__title"></h2>
        <form class="match-result-dialog__form">
          <p class="match-result-dialog__hint">各セットの得点と終了理由を入力してください（2セット制）。</p>
          <div class="match-result-dialog__scoreboard" role="group" aria-label="セット得点">
            <div class="match-result-dialog__scoreboard-teams" aria-hidden="true"></div>
            <div class="match-result-dialog__scoreboard-team-name result-team-column--left" data-team="1" data-side="left"></div>
            <div class="match-result-dialog__scoreboard-team-name result-team-column--right" data-team="2" data-side="right"></div>

            <div class="match-result-dialog__scoreboard-rule" aria-hidden="true"></div>

            <div class="match-result-dialog__scoreboard-set">第1セット</div>
            <input type="number" name="set1Team1Score" class="field__input match-result-dialog__score-input result-score-input--left" data-side="left" min="0" step="1" required inputmode="numeric" aria-label="第1セット チーム1">
            <input type="number" name="set1Team2Score" class="field__input match-result-dialog__score-input result-score-input--right" data-side="right" min="0" step="1" required inputmode="numeric" aria-label="第1セット チーム2">
            ${buildFinishReasonFieldHtml(1)}

            <div class="match-result-dialog__scoreboard-set">第2セット</div>
            <input type="number" name="set2Team1Score" class="field__input match-result-dialog__score-input result-score-input--left" data-side="left" min="0" step="1" required inputmode="numeric" aria-label="第2セット チーム1">
            <input type="number" name="set2Team2Score" class="field__input match-result-dialog__score-input result-score-input--right" data-side="right" min="0" step="1" required inputmode="numeric" aria-label="第2セット チーム2">
            ${buildFinishReasonFieldHtml(2)}
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

    const scoreFieldNames = ["set1Team1Score", "set1Team2Score", "set2Team1Score", "set2Team2Score"];
    const finishFieldNames = ["set1FinishReason", "set2FinishReason"];

    scoreFieldNames.forEach((name) => {
      const input = form.elements.namedItem(name);
      if (input && initialValues[name] !== undefined && initialValues[name] !== null) {
        input.value = String(initialValues[name]);
      }
    });
    finishFieldNames.forEach((name) => {
      applyFinishReasonValue(form, name, initialValues[name]);
    });
    wireFinishReasonHints(overlay, [1, 2]);

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
      for (const name of scoreFieldNames) {
        values[name] = form.elements.namedItem(name)?.value ?? "";
      }
      for (const name of finishFieldNames) {
        values[name] = readFinishReasonValue(form, name);
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

/**
 * プレイヤー用: 自チーム側のセット得点だけ入力
 * @param {object} options
 * @param {string} options.title
 * @param {string} options.teamName
 * @param {string} [options.opponentName]
 * @param {object} [options.initialValues] { set1OwnScore, set2OwnScore, set1FinishReason, set2FinishReason }
 * @param {string} [options.submitLabel]
 * @param {(values: object) => Promise<void>} [options.onSubmit]
 */
export function playerOwnSideResultDialog({
  title,
  teamName,
  opponentName = "",
  initialValues = {},
  submitLabel = "送信する",
  onSubmit,
}) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "confirm-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");

    const vsLine = opponentName ? `（対戦: ${opponentName}）` : "";
    overlay.innerHTML = `
      <div class="confirm-dialog match-result-dialog">
        <h2 class="confirm-dialog__title"></h2>
        <form class="match-result-dialog__form">
          <p class="match-result-dialog__hint">自チーム（<strong data-own-name></strong>）${vsLine} の各セット得点と終了理由を入力してください。相手得点は入力しません。終了理由は相手チームと一致する必要があります。</p>
          <label class="field">
            <span class="field__label">第1セット（自チーム）</span>
            <input type="number" name="set1OwnScore" class="field__input" min="0" step="1" required inputmode="numeric">
          </label>
          ${buildFinishReasonFieldHtml(1)}
          <label class="field">
            <span class="field__label">第2セット（自チーム）</span>
            <input type="number" name="set2OwnScore" class="field__input" min="0" step="1" required inputmode="numeric">
          </label>
          ${buildFinishReasonFieldHtml(2)}
          <p class="match-result-dialog__error hidden" role="alert"></p>
          <div class="confirm-dialog__actions">
            <button type="button" class="btn btn--ghost" data-action="cancel">キャンセル</button>
            <button type="submit" class="btn btn--primary" data-action="submit"></button>
          </div>
        </form>
      </div>
    `;

    overlay.querySelector(".confirm-dialog__title").textContent = title;
    overlay.querySelector("[data-own-name]").textContent = teamName;
    overlay.querySelector('[data-action="submit"]').textContent = submitLabel;

    const form = overlay.querySelector("form");
    const errorEl = overlay.querySelector(".match-result-dialog__error");
    const submitBtn = overlay.querySelector('[data-action="submit"]');
    const cancelBtn = overlay.querySelector('[data-action="cancel"]');
    const scoreFieldNames = ["set1OwnScore", "set2OwnScore"];
    const finishFieldNames = ["set1FinishReason", "set2FinishReason"];

    scoreFieldNames.forEach((name) => {
      const input = form.elements.namedItem(name);
      if (input && initialValues[name] !== undefined && initialValues[name] !== null) {
        input.value = String(initialValues[name]);
      }
    });
    finishFieldNames.forEach((name) => {
      applyFinishReasonValue(form, name, initialValues[name]);
    });
    wireFinishReasonHints(overlay, [1, 2]);

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
      for (const name of scoreFieldNames) {
        values[name] = form.elements.namedItem(name)?.value ?? "";
      }
      for (const name of finishFieldNames) {
        values[name] = readFinishReasonValue(form, name);
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
    form.elements.namedItem("set1OwnScore")?.focus();
  });
}
