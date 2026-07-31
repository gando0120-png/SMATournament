/**
 * モルックアウト順位指定 UI（並べ替えリスト）
 */

/**
 * @param {object} options
 * @param {string} options.groupKey
 * @param {string} options.title
 * @param {string} [options.description]
 * @param {Array<{ entryId: string, teamName?: string, blockName?: string }>} options.entries
 * @param {number} [options.slotsNeeded] - WC で上位何チームが進出するか（表示用）
 * @param {boolean} [options.disabled]
 */
export function renderMolkkyOutOrderPanel({
  groupKey,
  title,
  description = "モルックアウト実施後、上位から順に並べて確定してください。",
  entries,
  slotsNeeded = null,
  disabled = false,
}) {
  const rows = entries
    .map(
      (entry, index) => `
      <li class="molkky-out-order__item" data-entry-id="${escapeAttr(entry.entryId)}">
        <span class="molkky-out-order__rank">${index + 1}</span>
        <span class="molkky-out-order__team">
          ${escapeHtml(entry.teamName || entry.entryId)}
          ${entry.blockName ? `<span class="molkky-out-order__meta">（${escapeHtml(entry.blockName)}）</span>` : ""}
        </span>
        <span class="molkky-out-order__actions">
          <button type="button" class="btn btn--ghost" data-molkky-move="up" data-group-key="${escapeAttr(groupKey)}" ${disabled || index === 0 ? "disabled" : ""}>上へ</button>
          <button type="button" class="btn btn--ghost" data-molkky-move="down" data-group-key="${escapeAttr(groupKey)}" ${disabled || index === entries.length - 1 ? "disabled" : ""}>下へ</button>
        </span>
      </li>
    `
    )
    .join("");

  const slotsLine =
    slotsNeeded != null
      ? `<p class="panel__desc">この同順位グループから上位 ${slotsNeeded} チームが進出します。</p>`
      : "";

  return `
    <div class="panel molkky-out-order" data-molkky-group="${escapeAttr(groupKey)}" style="margin-bottom: var(--space-md);">
      <h4 class="panel__title">${escapeHtml(title)}</h4>
      <p class="panel__desc">${escapeHtml(description)}</p>
      ${slotsLine}
      <ol class="molkky-out-order__list">${rows}</ol>
      <button type="button" class="btn btn--primary" data-molkky-save="${escapeAttr(groupKey)}" ${disabled ? "disabled" : ""}>
        モルックアウト結果を確定
      </button>
    </div>
  `;
}

/**
 * @param {HTMLElement} root
 * @param {string} groupKey
 * @returns {string[]}
 */
export function readMolkkyOutOrder(root, groupKey) {
  const panel = root.querySelector(`[data-molkky-group="${cssEscape(groupKey)}"]`);
  if (!panel) {
    return [];
  }
  return [...panel.querySelectorAll(".molkky-out-order__item")].map(
    (item) => item.getAttribute("data-entry-id")
  );
}

/**
 * @param {HTMLElement} root
 * @param {string} groupKey
 * @param {"up"|"down"} direction
 * @param {string} entryId
 */
export function moveMolkkyOutOrderItem(root, groupKey, direction, entryId) {
  const panel = root.querySelector(`[data-molkky-group="${cssEscape(groupKey)}"]`);
  const list = panel?.querySelector(".molkky-out-order__list");
  if (!list) {
    return;
  }
  const items = [...list.querySelectorAll(".molkky-out-order__item")];
  const index = items.findIndex((item) => item.getAttribute("data-entry-id") === entryId);
  if (index < 0) {
    return;
  }
  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (swapWith < 0 || swapWith >= items.length) {
    return;
  }
  const a = items[index];
  const b = items[swapWith];
  if (direction === "up") {
    list.insertBefore(a, b);
  } else {
    list.insertBefore(b, a);
  }
  renumberMolkkyOutOrder(list);
}

function renumberMolkkyOutOrder(list) {
  const items = [...list.querySelectorAll(".molkky-out-order__item")];
  items.forEach((item, index) => {
    const rankEl = item.querySelector(".molkky-out-order__rank");
    if (rankEl) {
      rankEl.textContent = String(index + 1);
    }
    const upBtn = item.querySelector('[data-molkky-move="up"]');
    const downBtn = item.querySelector('[data-molkky-move="down"]');
    if (upBtn) {
      upBtn.disabled = index === 0;
    }
    if (downBtn) {
      downBtn.disabled = index === items.length - 1;
    }
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/'/g, "&#39;");
}

function cssEscape(value) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return String(value).replace(/"/g, '\\"');
}
