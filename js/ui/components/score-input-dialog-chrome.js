/**
 * 結果入力ダイアログ共通: スマホ時の入力中サマリー / viewport / フォーカス補正
 * DOM 依存の接続と、Node でも使える要約組み立てを同居する。
 */

export function formatScoreDisplay(value) {
  const text = String(value ?? "").trim();
  return text === "" ? "—" : text;
}

/**
 * @param {unknown} name
 * @returns {{ kind: "h2h", setNumber: number, side: "team1"|"team2" } | { kind: "own", setNumber: number, side: "own" } | null}
 */
export function parseScoreInputField(name) {
  const raw = String(name || "");
  const h2h = /^set(\d+)Team([12])Score$/.exec(raw);
  if (h2h) {
    return {
      kind: "h2h",
      setNumber: Number(h2h[1]),
      side: h2h[2] === "1" ? "team1" : "team2",
    };
  }
  const own = /^set(\d+)OwnScore$/.exec(raw);
  if (own) {
    return {
      kind: "own",
      setNumber: Number(own[1]),
      side: "own",
    };
  }
  return null;
}

export function buildH2HScoreSummary({
  setNumber,
  team1Name,
  team2Name,
  team1Score,
  team2Score,
} = {}) {
  const n = Number(setNumber);
  if (!Number.isInteger(n) || n < 1) {
    return null;
  }
  return {
    setLabel: `第${n}セット`,
    line: `${team1Name || "チーム1"} ${formatScoreDisplay(team1Score)} - ${formatScoreDisplay(team2Score)} ${team2Name || "チーム2"}`,
  };
}

export function buildOwnSideScoreSummary({
  setNumber,
  teamName,
  opponentName = "",
  ownScore,
} = {}) {
  const n = Number(setNumber);
  if (!Number.isInteger(n) || n < 1) {
    return null;
  }
  const ownLine = `${teamName || "自チーム"} ${formatScoreDisplay(ownScore)}`;
  return {
    setLabel: `第${n}セット（自チーム）`,
    line: opponentName ? `${ownLine}　対戦: ${opponentName}` : ownLine,
  };
}

export function isScoreInputElement(el) {
  return Boolean(
    el &&
      el.tagName === "INPUT" &&
      (el.type === "number" || el.inputMode === "numeric") &&
      parseScoreInputField(el.name)
  );
}

/**
 * visualViewport が無い環境では何もしない。
 * @param {HTMLElement|null} target
 * @returns {() => void}
 */
export function applyVisualViewportHeight(target) {
  const vv = typeof window !== "undefined" ? window.visualViewport : null;
  if (!target || !vv || typeof vv.addEventListener !== "function") {
    return () => {};
  }

  const update = () => {
    const height = Number(vv.height);
    if (!Number.isFinite(height) || height <= 0) {
      return;
    }
    target.style.setProperty("--visual-viewport-height", `${Math.round(height)}px`);
  };

  update();
  vv.addEventListener("resize", update);
  vv.addEventListener("scroll", update);
  return () => {
    vv.removeEventListener("resize", update);
    vv.removeEventListener("scroll", update);
    target.style.removeProperty("--visual-viewport-height");
  };
}

/**
 * 既に見えている場合は動かさない。
 * @param {HTMLElement|null} input
 * @param {HTMLElement|null} scrollParent
 */
export function scrollScoreInputIntoView(input, scrollParent) {
  if (!input || typeof input.scrollIntoView !== "function") {
    return;
  }
  if (!scrollParent || typeof scrollParent.getBoundingClientRect !== "function") {
    return;
  }
  const parentRect = scrollParent.getBoundingClientRect();
  const inputRect = input.getBoundingClientRect();
  const pad = 12;
  const visible =
    inputRect.top >= parentRect.top + pad && inputRect.bottom <= parentRect.bottom - pad;
  if (visible) {
    return;
  }
  input.scrollIntoView({ block: "center", inline: "nearest" });
}

/**
 * @param {HTMLElement} overlay
 * @param {{
 *   form?: HTMLFormElement|null,
 *   buildSummary: (input: HTMLInputElement) => ({ setLabel: string, line: string }|null),
 * }} options
 * @returns {() => void}
 */
export function attachScoreInputDialogChrome(overlay, options) {
  const form = options?.form || overlay?.querySelector("form");
  const dialog = overlay?.querySelector(".match-result-dialog") || overlay;
  const title = dialog?.querySelector(".confirm-dialog__title");
  if (!overlay || !form || !title) {
    return () => {};
  }

  let summary = dialog.querySelector("[data-role='score-input-summary']");
  if (!summary) {
    summary = document.createElement("div");
    summary.className = "match-result-dialog__summary";
    summary.setAttribute("data-role", "score-input-summary");
    summary.setAttribute("aria-live", "polite");
    summary.hidden = true;
    summary.innerHTML = `
      <p class="match-result-dialog__summary-set" data-role="score-input-summary-set"></p>
      <p class="match-result-dialog__summary-score" data-role="score-input-summary-line"></p>
    `;
    title.after(summary);
  }

  const setEl = summary.querySelector("[data-role='score-input-summary-set']");
  const lineEl = summary.querySelector("[data-role='score-input-summary-line']");
  const scrollParent = form.querySelector(".match-result-dialog__body") || form;

  function renderSummary(input) {
    const built = options.buildSummary(input);
    if (!built) {
      summary.hidden = true;
      return;
    }
    setEl.textContent = built.setLabel;
    lineEl.textContent = built.line;
    summary.hidden = false;
  }

  function handleFocus(input) {
    if (!isScoreInputElement(input)) {
      return;
    }
    renderSummary(input);
    requestAnimationFrame(() => {
      scrollScoreInputIntoView(input, scrollParent);
    });
  }

  function onFocusIn(event) {
    handleFocus(event.target);
  }

  function onInput(event) {
    if (!isScoreInputElement(event.target)) {
      return;
    }
    if (document.activeElement === event.target) {
      renderSummary(event.target);
    }
  }

  function onFocusOut() {
    requestAnimationFrame(() => {
      if (!isScoreInputElement(document.activeElement)) {
        summary.hidden = true;
      }
    });
  }

  const scoreInputs = [...form.querySelectorAll("input")].filter(isScoreInputElement);
  const onDirectFocus = (event) => handleFocus(event.currentTarget);
  scoreInputs.forEach((input) => input.addEventListener("focus", onDirectFocus));

  form.addEventListener("focusin", onFocusIn);
  form.addEventListener("input", onInput);
  form.addEventListener("focusout", onFocusOut);
  const detachViewport = applyVisualViewportHeight(overlay);

  const syncFocused = () => {
    const active = document.activeElement;
    if (isScoreInputElement(active) && form.contains(active)) {
      renderSummary(active);
    }
  };
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(syncFocused);
  } else {
    syncFocused();
  }

  return () => {
    scoreInputs.forEach((input) => input.removeEventListener("focus", onDirectFocus));
    form.removeEventListener("focusin", onFocusIn);
    form.removeEventListener("input", onInput);
    form.removeEventListener("focusout", onFocusOut);
    detachViewport();
    summary.remove();
  };
}
