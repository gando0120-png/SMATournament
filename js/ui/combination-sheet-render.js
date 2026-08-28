/**
 * 組み合わせ帳票の HTML 生成（ViewModel → 印刷専用マークアップ）
 * Firestore 非依存。管理画面のブラケット UI は使わない。
 */
import {
  CombinationSheetLayout,
  CombinationSheetType,
} from "../domain/combination-sheet.js";

/**
 * @param {unknown} value
 */
export function escapeCombinationSheetHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * @param {object} sheet
 */
export function combinationSheetDocumentTitle(sheet) {
  const name = sheet?.tournament?.name || "大会";
  const title = sheet?.summary?.title || "組み合わせ";
  return `${name} ${title}`;
}

/**
 * @param {object} sheet
 * @param {object} page
 */
function renderSheetHeader(sheet, page) {
  const tournament = sheet.tournament ?? {};
  const summary = sheet.summary ?? {};
  const heading = page.heading
    ? `<p class="sheet-header__section">${escapeCombinationSheetHtml(page.heading)}</p>`
    : "";
  const continuation = page.isContinuation
    ? `<p class="sheet-header__continuation">続き</p>`
    : "";
  const pageLabel =
    page.pageCount > 1
      ? `<p class="sheet-header__page">${escapeCombinationSheetHtml(
          `${page.pageNumber} / ${page.pageCount}`
        )}</p>`
      : "";

  const metaRows = [
    ["開催日", tournament.eventDateLabel || "—"],
    ["会場", tournament.venue || "—"],
    ["参加", `${summary.teamCount ?? "—"}チーム`],
  ];
  if (sheet.type === CombinationSheetType.QUALIFYING_BLOCKS) {
    metaRows.push(["ブロック", `${summary.blockCount ?? "—"}`]);
  }

  const meta = metaRows
    .map(
      ([label, value]) => `
        <div class="sheet-meta__row">
          <dt>${escapeCombinationSheetHtml(label)}</dt>
          <dd>${escapeCombinationSheetHtml(value)}</dd>
        </div>`
    )
    .join("");

  return `
    <header class="sheet-header">
      <p class="sheet-header__event">${escapeCombinationSheetHtml(tournament.name || "（名称未設定）")}</p>
      <h1 class="sheet-header__title">${escapeCombinationSheetHtml(summary.title || "組み合わせ")}</h1>
      ${heading}
      ${continuation}
      ${pageLabel}
      <dl class="sheet-meta">${meta}</dl>
    </header>
  `;
}

/**
 * @param {object} block
 */
function renderBlockCard(block) {
  const teams = (block.teams ?? [])
    .map(
      (team) => `
        <li class="sheet-block__team">
          <span class="sheet-block__pos">${escapeCombinationSheetHtml(team.position)}.</span>
          <span class="sheet-block__name">${escapeCombinationSheetHtml(team.name)}</span>
        </li>`
    )
    .join("");

  return `
    <section class="sheet-block">
      <h2 class="sheet-block__title">${escapeCombinationSheetHtml(block.label || "ブロック")}</h2>
      <ol class="sheet-block__list">${teams || `<li class="sheet-block__team sheet-block__team--empty">—</li>`}</ol>
    </section>
  `;
}

/**
 * @param {object} team
 */
function renderMatchTeam(team) {
  const display = team?.displayName || team?.name || "—";
  const modifiers = [];
  if (team?.isBye) modifiers.push("sheet-match__team--bye");
  if (team?.isPending) modifiers.push("sheet-match__team--pending");
  return `<div class="sheet-match__team ${modifiers.join(" ")}">${escapeCombinationSheetHtml(
    display
  )}</div>`;
}

/**
 * @param {object} match
 */
function renderMatchCard(match) {
  return `
    <article class="sheet-match">
      ${renderMatchTeam(match.team1)}
      <p class="sheet-match__vs">−</p>
      ${renderMatchTeam(match.team2)}
    </article>
  `;
}

/**
 * @param {object[]} rounds
 * @param {string} layout
 */
function renderRounds(rounds, layout) {
  const roundClass =
    layout === CombinationSheetLayout.BRACKET
      ? "sheet-bracket"
      : "sheet-round-list";

  const columns = (rounds ?? [])
    .map((round) => {
      const matches = (round.matches ?? []).map(renderMatchCard).join("");
      return `
        <section class="sheet-round">
          <h2 class="sheet-round__title">${escapeCombinationSheetHtml(round.roundLabel || "")}</h2>
          <div class="sheet-round__matches">${matches}</div>
        </section>
      `;
    })
    .join("");

  return `<div class="${roundClass}">${columns}</div>`;
}

/**
 * @param {object} sheet
 * @param {object} page
 */
function renderPageBody(sheet, page) {
  if (page.layout === CombinationSheetLayout.BLOCKS) {
    const cards = (page.blocks ?? []).map(renderBlockCard).join("");
    return `<div class="sheet-blocks">${cards}</div>`;
  }
  return renderRounds(page.rounds ?? [], page.layout);
}

/**
 * @param {object} sheet
 * @returns {string}
 */
export function renderCombinationSheetHtml(sheet) {
  if (!sheet) {
    return "";
  }
  const pages = Array.isArray(sheet.pages) && sheet.pages.length > 0 ? sheet.pages : [];
  const pageHtml = pages
    .map(
      (page) => `
        <article class="sheet-page" data-layout="${escapeCombinationSheetHtml(page.layout || "")}">
          ${renderSheetHeader(sheet, page)}
          ${renderPageBody(sheet, page)}
        </article>`
    )
    .join("");

  return `
    <div class="sheet-document" data-type="${escapeCombinationSheetHtml(sheet.type || "")}" data-orientation="${escapeCombinationSheetHtml(
      sheet.page?.orientation || "portrait"
    )}">
      ${pageHtml}
    </div>
  `;
}
