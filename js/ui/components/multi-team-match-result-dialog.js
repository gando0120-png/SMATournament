/**
 * 複数チーム・2セット合計の結果入力ダイアログ
 */
import {
  hasBoundaryTie,
  rankByTotalScoreDesc,
  validateMultiTeamMatchResultInput,
} from "../../domain/multi-team-match-result.js";

/**
 * @param {object} options
 * @param {string} options.title
 * @param {object[]} options.participants { entryId, teamName }
 * @param {number} options.qualifiersCount
 * @param {Record<string, number[]>|null} [options.initialScores]
 * @param {string[]|null} [options.initialManualRanking]
 * @param {string} [options.submitLabel]
 * @param {(payload: { scores: Record<string, number[]>, manualRankingEntryIds: string[]|null }) => Promise<void>} options.onSubmit
 */
export function multiTeamMatchResultDialog({
  title,
  participants = [],
  qualifiersCount = 1,
  initialScores = null,
  initialManualRanking = null,
  submitLabel = "結果を確定",
  onSubmit,
}) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "confirm-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");

    /** @type {string[]} */
    let manualOrder = initialManualRanking
      ? [...initialManualRanking]
      : participants.map((p) => p.entryId);

    const rowsHtml = participants
      .map((p) => {
        const scores = initialScores?.[p.entryId] || ["", ""];
        return `
          <tr data-entry-id="${escapeAttr(p.entryId)}">
            <th scope="row">${escapeHtml(p.teamName || "—")}</th>
            <td>
              <input type="number" class="field__input match-result-dialog__score-input" name="s1-${escapeAttr(p.entryId)}" min="0" max="50" step="1" inputmode="numeric" value="${escapeAttr(scores[0] ?? "")}" aria-label="${escapeAttr(p.teamName)} セット1">
            </td>
            <td>
              <input type="number" class="field__input match-result-dialog__score-input" name="s2-${escapeAttr(p.entryId)}" min="0" max="50" step="1" inputmode="numeric" value="${escapeAttr(scores[1] ?? "")}" aria-label="${escapeAttr(p.teamName)} セット2">
            </td>
            <td class="multi-team-result-dialog__total" data-total-for="${escapeAttr(p.entryId)}">—</td>
          </tr>
        `;
      })
      .join("");

    overlay.innerHTML = `
      <div class="confirm-dialog match-result-dialog multi-team-result-dialog">
        <h2 class="confirm-dialog__title"></h2>
        <form class="match-result-dialog__form">
          <p class="match-result-dialog__hint">各チーム2セット（0〜50）。合計降順で順位。上位${qualifiersCount}チームが勝ち抜け。境界同点時は手動で並べ替えます。</p>
          <div class="multi-team-result-dialog__table-wrap">
            <table class="multi-team-result-dialog__table">
              <thead>
                <tr>
                  <th scope="col">チーム</th>
                  <th scope="col">セット1</th>
                  <th scope="col">セット2</th>
                  <th scope="col">合計</th>
                </tr>
              </thead>
              <tbody>${rowsHtml}</tbody>
            </table>
          </div>
          <div class="multi-team-result-dialog__ranking hidden" data-ranking-panel>
            <p class="field__label">暫定順位（境界同点を並べ替え）</p>
            <ol class="multi-team-result-dialog__rank-list" data-rank-list></ol>
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
    overlay.querySelector('[data-action="submit"]').textContent = submitLabel;

    const form = overlay.querySelector("form");
    const errorEl = overlay.querySelector(".match-result-dialog__error");
    const submitBtn = overlay.querySelector('[data-action="submit"]');
    const cancelBtn = overlay.querySelector('[data-action="cancel"]');
    const rankingPanel = overlay.querySelector("[data-ranking-panel]");
    const rankList = overlay.querySelector("[data-rank-list]");

    function collectScores() {
      /** @type {Record<string, number[]>} */
      const scores = {};
      for (const p of participants) {
        const s1 = form.elements.namedItem(`s1-${p.entryId}`)?.value ?? "";
        const s2 = form.elements.namedItem(`s2-${p.entryId}`)?.value ?? "";
        scores[p.entryId] = [s1 === "" ? "" : Number(s1), s2 === "" ? "" : Number(s2)];
      }
      return scores;
    }

    function refreshTotalsAndRanking() {
      const scores = collectScores();
      /** @type {Record<string, number>} */
      const totals = {};
      let allFilled = true;
      for (const p of participants) {
        const row = scores[p.entryId];
        const a = row[0];
        const b = row[1];
        const el = overlay.querySelector(`[data-total-for="${CSS.escape(p.entryId)}"]`);
        if (Number.isInteger(a) && Number.isInteger(b)) {
          totals[p.entryId] = a + b;
          if (el) el.textContent = String(totals[p.entryId]);
        } else {
          allFilled = false;
          if (el) el.textContent = "—";
        }
      }

      if (!allFilled) {
        rankingPanel.classList.add("hidden");
        return;
      }

      const ids = participants.map((p) => p.entryId);
      const auto = rankByTotalScoreDesc(ids, totals);
      const needsTie = hasBoundaryTie(auto, totals, qualifiersCount);
      if (!needsTie) {
        manualOrder = auto;
        rankingPanel.classList.add("hidden");
        return;
      }

      // 同点帯の相対順を維持しつつ、manualOrder を totals に整合
      const inAuto = new Set(auto);
      manualOrder = [
        ...manualOrder.filter((id) => inAuto.has(id)),
        ...auto.filter((id) => !manualOrder.includes(id)),
      ];
      // 合計順を優先し、同点帯のみ manual 順を使う
      manualOrder = mergeManualWithTotals(auto, totals, manualOrder, qualifiersCount);

      rankingPanel.classList.remove("hidden");
      renderRankList(totals);
    }

    function renderRankList(totals) {
      rankList.innerHTML = manualOrder
        .map((entryId, index) => {
          const p = participants.find((x) => x.entryId === entryId);
          const total = totals[entryId] ?? 0;
          const isCut = index === qualifiersCount - 1;
          return `
            <li class="multi-team-result-dialog__rank-item${isCut ? " multi-team-result-dialog__rank-item--cut" : ""}" data-rank-entry="${escapeAttr(entryId)}">
              <span class="multi-team-result-dialog__rank-pos">${index + 1}</span>
              <span class="multi-team-result-dialog__rank-name">${escapeHtml(p?.teamName || "—")}（${total}）</span>
              <span class="multi-team-result-dialog__rank-actions">
                <button type="button" class="btn btn--ghost btn--compact" data-move-up="${escapeAttr(entryId)}" ${index === 0 ? "disabled" : ""}>上へ</button>
                <button type="button" class="btn btn--ghost btn--compact" data-move-down="${escapeAttr(entryId)}" ${index === manualOrder.length - 1 ? "disabled" : ""}>下へ</button>
              </span>
            </li>
          `;
        })
        .join("");
    }

    function close(value) {
      document.removeEventListener("keydown", onKeyDown);
      overlay.remove();
      resolve(value);
    }

    function onKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        close(null);
      }
    }

    form.addEventListener("input", () => {
      errorEl.classList.add("hidden");
      refreshTotalsAndRanking();
    });

    rankList.addEventListener("click", (event) => {
      const up = event.target.closest("[data-move-up]");
      const down = event.target.closest("[data-move-down]");
      const entryId = up?.dataset.moveUp || down?.dataset.moveDown;
      if (!entryId) return;
      const idx = manualOrder.indexOf(entryId);
      if (idx < 0) return;
      const swapWith = up ? idx - 1 : idx + 1;
      if (swapWith < 0 || swapWith >= manualOrder.length) return;
      [manualOrder[idx], manualOrder[swapWith]] = [manualOrder[swapWith], manualOrder[idx]];
      const scores = collectScores();
      const totals = Object.fromEntries(
        participants.map((p) => {
          const [a, b] = scores[p.entryId];
          return [p.entryId, Number(a) + Number(b)];
        })
      );
      renderRankList(totals);
    });

    cancelBtn.addEventListener("click", () => close(null));
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close(null);
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      errorEl.classList.add("hidden");
      const scores = collectScores();
      const ids = participants.map((p) => p.entryId);
      const preview = validateMultiTeamMatchResultInput({
        participantEntryIds: ids,
        scores,
        qualifiersCount,
        manualRankingEntryIds: null,
      });

      let manualRankingEntryIds = null;
      if (!preview.valid && preview.needsManualTieBreak) {
        const withManual = validateMultiTeamMatchResultInput({
          participantEntryIds: ids,
          scores,
          qualifiersCount,
          manualRankingEntryIds: manualOrder,
        });
        if (!withManual.valid) {
          errorEl.textContent = withManual.message || "入力内容を確認してください。";
          errorEl.classList.remove("hidden");
          return;
        }
        manualRankingEntryIds = manualOrder;
      } else if (!preview.valid) {
        errorEl.textContent = preview.message || "入力内容を確認してください。";
        errorEl.classList.remove("hidden");
        return;
      }

      submitBtn.disabled = true;
      try {
        await onSubmit({ scores, manualRankingEntryIds });
        close(true);
      } catch (error) {
        errorEl.textContent = error?.message || "保存に失敗しました。";
        errorEl.classList.remove("hidden");
        submitBtn.disabled = false;
      }
    });

    document.body.appendChild(overlay);
    document.addEventListener("keydown", onKeyDown);
    refreshTotalsAndRanking();
    form.querySelector("input")?.focus();
  });
}

function mergeManualWithTotals(autoRanked, totals, manual, qualifiersCount) {
  const cutTotal = totals[autoRanked[qualifiersCount - 1]];
  const tiedBand = autoRanked.filter((id) => totals[id] === cutTotal);
  const tiedSet = new Set(tiedBand);
  const manualBand = manual.filter((id) => tiedSet.has(id));
  const orderedBand = [
    ...manualBand,
    ...tiedBand.filter((id) => !manualBand.includes(id)),
  ];
  let bandIdx = 0;
  return autoRanked.map((id) => {
    if (!tiedSet.has(id)) return id;
    const next = orderedBand[bandIdx];
    bandIdx += 1;
    return next;
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}
