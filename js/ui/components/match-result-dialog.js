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
import {
  attachScoreInputDialogChrome,
  buildH2HScoreSummary,
  buildOwnSideScoreSummary,
  parseScoreInputField,
} from "./score-input-dialog-chrome.js";
import { showDialogUserFacingError } from "./form-errors.js";
import { UserFacingErrorContext } from "../../lib/user-facing-error.js";

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
          <div class="match-result-dialog__body">
            <p class="match-result-dialog__hint">各セットの得点を入力してください（2セット制）。</p>
            <div class="match-result-dialog__scoreboard" role="group" aria-label="セット得点">
              <div class="match-result-dialog__scoreboard-teams" aria-hidden="true"></div>
              <div class="match-result-dialog__scoreboard-team-name result-team-column--left" data-team="1" data-side="left"></div>
              <div class="match-result-dialog__scoreboard-team-name result-team-column--right" data-team="2" data-side="right"></div>

              <div class="match-result-dialog__scoreboard-rule" aria-hidden="true"></div>

              <div class="match-result-dialog__scoreboard-set">第1セット</div>
              <input type="number" name="set1Team1Score" class="field__input match-result-dialog__score-input result-score-input--left" data-side="left" min="0" max="50" step="1" required inputmode="numeric" aria-label="第1セット チーム1">
              <input type="number" name="set1Team2Score" class="field__input match-result-dialog__score-input result-score-input--right" data-side="right" min="0" max="50" step="1" required inputmode="numeric" aria-label="第1セット チーム2">

              <div class="match-result-dialog__scoreboard-set">第2セット</div>
              <input type="number" name="set2Team1Score" class="field__input match-result-dialog__score-input result-score-input--left" data-side="left" min="0" max="50" step="1" required inputmode="numeric" aria-label="第2セット チーム1">
              <input type="number" name="set2Team2Score" class="field__input match-result-dialog__score-input result-score-input--right" data-side="right" min="0" max="50" step="1" required inputmode="numeric" aria-label="第2セット チーム2">
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

    const scoreFieldNames = ["set1Team1Score", "set1Team2Score", "set2Team1Score", "set2Team2Score"];

    scoreFieldNames.forEach((name) => {
      const input = form.elements.namedItem(name);
      if (input && initialValues[name] !== undefined && initialValues[name] !== null) {
        input.value = String(initialValues[name]);
      }
    });

    function setSaving(isSaving) {
      submitBtn.disabled = isSaving;
      cancelBtn.disabled = isSaving;
      scoreFieldNames.forEach((name) => {
        const input = form.elements.namedItem(name);
        if (input) {
          input.disabled = isSaving;
        }
      });
    }

    let detachChrome = () => {};

    function close(result) {
      detachChrome();
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

      if (typeof onSubmit === "function") {
        setSaving(true);
        try {
          await onSubmit(values);
          close(true);
        } catch (error) {
          showDialogUserFacingError(
            errorEl,
            error,
            UserFacingErrorContext.RESULT_SAVE,
            "match-result-dialog"
          );
          setSaving(false);
        }
        return;
      }

      close(values);
    });

    document.body.appendChild(overlay);
    detachChrome = attachScoreInputDialogChrome(overlay, {
      form,
      buildSummary(input) {
        const parsed = parseScoreInputField(input.name);
        if (!parsed || parsed.kind !== "h2h") {
          return null;
        }
        return buildH2HScoreSummary({
          setNumber: parsed.setNumber,
          team1Name,
          team2Name,
          team1Score: form.elements.namedItem(`set${parsed.setNumber}Team1Score`)?.value,
          team2Score: form.elements.namedItem(`set${parsed.setNumber}Team2Score`)?.value,
        });
      },
    });
    form.elements.namedItem("set1Team1Score")?.focus();
  });
}

/**
 * プレイヤー用: 自チーム側のセット得点だけ入力
 * @param {object} options
 * @param {string} options.title
 * @param {string} options.teamName
 * @param {string} [options.opponentName]
 * @param {object} [options.initialValues] { set1OwnScore, set2OwnScore }
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
          <div class="match-result-dialog__body">
            <p class="match-result-dialog__hint">自チーム（<strong data-own-name></strong>）${vsLine} の各セット得点を入力してください。相手得点は入力しません。</p>
            <label class="field">
              <span class="field__label">第1セット（自チーム）</span>
              <input type="number" name="set1OwnScore" class="field__input" min="0" max="50" step="1" required inputmode="numeric" aria-label="第1セット（自チーム）">
            </label>
            <label class="field">
              <span class="field__label">第2セット（自チーム）</span>
              <input type="number" name="set2OwnScore" class="field__input" min="0" max="50" step="1" required inputmode="numeric" aria-label="第2セット（自チーム）">
            </label>
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
    overlay.querySelector("[data-own-name]").textContent = teamName;
    overlay.querySelector('[data-action="submit"]').textContent = submitLabel;

    const form = overlay.querySelector("form");
    const errorEl = overlay.querySelector(".match-result-dialog__error");
    const submitBtn = overlay.querySelector('[data-action="submit"]');
    const cancelBtn = overlay.querySelector('[data-action="cancel"]');
    const scoreFieldNames = ["set1OwnScore", "set2OwnScore"];

    scoreFieldNames.forEach((name) => {
      const input = form.elements.namedItem(name);
      if (input && initialValues[name] !== undefined && initialValues[name] !== null) {
        input.value = String(initialValues[name]);
      }
    });

    function setSaving(isSaving) {
      submitBtn.disabled = isSaving;
      cancelBtn.disabled = isSaving;
      scoreFieldNames.forEach((name) => {
        const input = form.elements.namedItem(name);
        if (input) {
          input.disabled = isSaving;
        }
      });
    }

    let detachChrome = () => {};

    function close(result) {
      detachChrome();
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

      if (typeof onSubmit === "function") {
        setSaving(true);
        try {
          await onSubmit(values);
          close(true);
        } catch (error) {
          showDialogUserFacingError(
            errorEl,
            error,
            UserFacingErrorContext.PLAYER_SUBMIT,
            "player-own-side-result-dialog"
          );
          setSaving(false);
        }
        return;
      }

      close(values);
    });

    document.body.appendChild(overlay);
    detachChrome = attachScoreInputDialogChrome(overlay, {
      form,
      buildSummary(input) {
        const parsed = parseScoreInputField(input.name);
        if (!parsed || parsed.kind !== "own") {
          return null;
        }
        return buildOwnSideScoreSummary({
          setNumber: parsed.setNumber,
          teamName,
          opponentName,
          ownScore: input.value,
        });
      },
    });
    form.elements.namedItem("set1OwnScore")?.focus();
  });
}
