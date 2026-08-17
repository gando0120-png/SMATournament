/**
 * 運営向けエントリー編集ダイアログ
 */
import {
  getAdditionalMemberFieldKeys,
  getMemberFieldLabel,
  resolveTeamSizeFromTournament,
} from "../../domain/entry-members.js";
import { validateEntryProfileInput } from "../../domain/entry-profile.js";
import { clearFormErrors, setFieldError } from "./form-errors.js";
import { classifyError } from "../../lib/errors.js";

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
 * @param {object} options.entry
 * @param {object} options.tournament
 * @param {(values: object) => Promise<void>} options.onSave
 * @returns {Promise<boolean>} true if saved
 */
export function openEntryEditDialog({ entry, tournament, onSave }) {
  const teamSize = resolveTeamSizeFromTournament(tournament);
  const memberKeys = getAdditionalMemberFieldKeys(teamSize);

  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "confirm-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "entryEditDialogTitle");

    const memberFieldsHtml = memberKeys
      .map(
        (key) => `
      <label class="field" for="entryEdit_${key}">
        <span class="field__label">${getMemberFieldLabel(key)}</span>
        <input class="field__input" type="text" id="entryEdit_${key}" name="${key}" required />
      </label>`
      )
      .join("");

    overlay.innerHTML = `
      <div class="confirm-dialog entry-edit-dialog">
        <h2 class="confirm-dialog__title" id="entryEditDialogTitle">エントリー編集</h2>
        <p class="confirm-dialog__message">チーム名・代表者・メンバー・メール・コメントを修正できます。参加状態は変更されません。</p>
        <form id="entryEditForm" class="entry-edit-dialog__form">
          <div id="entryEditAlert"></div>
          <label class="field" for="entryEdit_teamName">
            <span class="field__label">チーム名</span>
            <input class="field__input" type="text" id="entryEdit_teamName" name="teamName" required />
          </label>
          <label class="field" for="entryEdit_representativeName">
            <span class="field__label">代表者名</span>
            <input class="field__input" type="text" id="entryEdit_representativeName" name="representativeName" required />
          </label>
          ${memberFieldsHtml}
          <label class="field" for="entryEdit_email">
            <span class="field__label">メールアドレス</span>
            <input class="field__input" type="email" id="entryEdit_email" name="email" required />
          </label>
          <label class="field" for="entryEdit_comment">
            <span class="field__label">コメント（任意）</span>
            <textarea class="field__input" id="entryEdit_comment" name="comment" rows="3"></textarea>
          </label>
          <div class="confirm-dialog__actions">
            <button type="button" class="btn btn--ghost" data-action="cancel">キャンセル</button>
            <button type="submit" class="btn btn--primary" data-action="save">保存</button>
          </div>
        </form>
      </div>
    `;

    const form = overlay.querySelector("#entryEditForm");
    const alertEl = overlay.querySelector("#entryEditAlert");
    const saveBtn = overlay.querySelector('[data-action="save"]');

    form.elements.teamName.value = entry.teamName ?? "";
    form.elements.representativeName.value = entry.representativeName ?? "";
    form.elements.email.value = entry.email ?? "";
    form.elements.comment.value = entry.comment ?? "";
    for (const key of memberKeys) {
      form.elements[key].value = entry[key] ?? "";
    }

    function close(saved) {
      overlay.remove();
      unlockBodyScroll();
      resolve(saved);
    }

    function readInput() {
      const input = {
        teamName: form.elements.teamName.value,
        representativeName: form.elements.representativeName.value,
        email: form.elements.email.value,
        comment: form.elements.comment.value,
      };
      for (const key of memberKeys) {
        input[key] = form.elements[key].value;
      }
      return input;
    }

    function applyValidationErrors(errors) {
      clearFormErrors(form);
      for (const [field, message] of Object.entries(errors)) {
        const inputEl = form.elements[field];
        if (inputEl) {
          setFieldError(inputEl, message);
        }
      }
    }

    overlay.querySelector('[data-action="cancel"]').addEventListener("click", () => close(false));
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        close(false);
      }
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      clearFormErrors(form);
      alertEl.innerHTML = "";

      const validation = validateEntryProfileInput(readInput(), teamSize);
      if (!validation.valid) {
        applyValidationErrors(validation.errors);
        return;
      }

      saveBtn.disabled = true;
      try {
        await onSave(validation.values);
        close(true);
      } catch (error) {
        saveBtn.disabled = false;
        if (error?.validationErrors) {
          applyValidationErrors(error.validationErrors);
          return;
        }
        const { message } = classifyError(error);
        alertEl.innerHTML = `<div class="alert alert--error" role="alert"></div>`;
        alertEl.querySelector(".alert").textContent = message;
      }
    });

    lockBodyScroll();
    document.body.appendChild(overlay);
    form.elements.teamName.focus();
  });
}
