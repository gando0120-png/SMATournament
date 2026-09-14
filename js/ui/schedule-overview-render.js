/**
 * 大会スケジュール一覧: ViewModel → 画面 / 印刷 HTML
 * Firestore 非依存。
 */
import {
  REST_LABEL,
  ScheduleOverviewSlotKind,
  ScheduleOverviewTeamRowKind,
  ScheduleOverviewTeamStatus,
  buildScheduleOverviewPrintModel,
  buildTeamSchedule,
  formatScheduleCourtLabel,
} from "../domain/schedule-overview.js";

export function escapeScheduleOverviewHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function scheduleOverviewDocumentTitle(overview, options = {}) {
  const name = overview?.tournament?.name || "大会";
  if (options.mode === "team" && options.teamName) {
    return `${name} ${options.teamName} のスケジュール`;
  }
  return `${name} 大会スケジュール`;
}

function courtBadge(court) {
  const label = formatScheduleCourtLabel(court);
  if (!label) {
    return "";
  }
  return `<span class="schedule-overview__court">${escapeScheduleOverviewHtml(label)}</span>`;
}

function timeLabel(slotOrRow) {
  return slotOrRow?.startTimeDisplay || "";
}

function renderMatchTeams(match) {
  const team1 = match?.team1?.teamName || "—";
  const team2 = match?.team2?.teamName || "—";
  return `
    <p class="schedule-overview__vs">
      <span class="schedule-overview__team">${escapeScheduleOverviewHtml(team1)}</span>
      <span class="schedule-overview__vs-mark">vs</span>
      <span class="schedule-overview__team">${escapeScheduleOverviewHtml(team2)}</span>
    </p>
  `;
}

function renderSlot(slot) {
  if (slot.kind === ScheduleOverviewSlotKind.MARKER) {
    return `
      <article class="schedule-overview-slot schedule-overview-slot--marker">
        <header class="schedule-overview-slot__head">
          ${
            timeLabel(slot)
              ? `<p class="schedule-overview-slot__time">${escapeScheduleOverviewHtml(
                  timeLabel(slot)
                )}</p>`
              : ""
          }
          <h3 class="schedule-overview-slot__label">${escapeScheduleOverviewHtml(slot.label)}</h3>
        </header>
      </article>
    `;
  }

  const groups = (slot.groups ?? [])
    .map((group) => {
      const heading = group.label
        ? `<h4 class="schedule-overview-group__label">${escapeScheduleOverviewHtml(
            group.label
          )}</h4>`
        : "";
      const matches = (group.matches ?? [])
        .map(
          (match) => `
            <li class="schedule-overview-match">
              ${courtBadge(match.court)}
              ${renderMatchTeams(match)}
            </li>`
        )
        .join("");
      return `
        <section class="schedule-overview-group">
          ${heading}
          <ul class="schedule-overview-match-list">${matches}</ul>
        </section>
      `;
    })
    .join("");

  return `
    <article class="schedule-overview-slot">
      <header class="schedule-overview-slot__head">
        ${
          timeLabel(slot)
            ? `<p class="schedule-overview-slot__time">${escapeScheduleOverviewHtml(
                timeLabel(slot)
              )}</p>`
            : ""
        }
        <h3 class="schedule-overview-slot__label">${escapeScheduleOverviewHtml(slot.label)}</h3>
      </header>
      <div class="schedule-overview-slot__body">${groups}</div>
    </article>
  `;
}

function renderTeamRow(row) {
  if (row.kind === ScheduleOverviewTeamRowKind.REST) {
    return `
      <article class="schedule-overview-slot">
        <header class="schedule-overview-slot__head">
          ${
            timeLabel(row)
              ? `<p class="schedule-overview-slot__time">${escapeScheduleOverviewHtml(
                  timeLabel(row)
                )}</p>`
              : ""
          }
          <h3 class="schedule-overview-slot__label">${escapeScheduleOverviewHtml(row.label || "")}</h3>
        </header>
        <p class="schedule-overview-rest">${escapeScheduleOverviewHtml(REST_LABEL)}</p>
      </article>
    `;
  }

  const opponentName = row.opponent?.teamName || "—";
  const note = row.note
    ? `<p class="schedule-overview-note">${escapeScheduleOverviewHtml(row.note)}</p>`
    : "";
  return `
    <article class="schedule-overview-slot">
      <header class="schedule-overview-slot__head">
        ${
          timeLabel(row)
            ? `<p class="schedule-overview-slot__time">${escapeScheduleOverviewHtml(
                timeLabel(row)
              )}</p>`
            : ""
        }
        <h3 class="schedule-overview-slot__label">${escapeScheduleOverviewHtml(row.label || "")}</h3>
      </header>
      <div class="schedule-overview-slot__body">
        ${courtBadge(row.court)}
        <p class="schedule-overview__vs">
          <span class="schedule-overview__vs-mark">vs</span>
          <span class="schedule-overview__team">${escapeScheduleOverviewHtml(opponentName)}</span>
        </p>
        ${note}
      </div>
    </article>
  `;
}

export function renderAllMatchesHtml(overview) {
  if (!overview?.slots?.length) {
    return `<p class="schedule-overview-empty">${escapeScheduleOverviewHtml(
      overview?.empty || "表示できる試合がありません。"
    )}</p>`;
  }
  return `<div class="schedule-overview-list">${overview.slots.map(renderSlot).join("")}</div>`;
}

export function renderTeamSelectHtml(overview, selectedTeamId) {
  const options = [
    `<option value="">チームを選択</option>`,
    ...(overview?.teams ?? []).map((team) => {
      const selected = team.entryId === selectedTeamId ? " selected" : "";
      return `<option value="${escapeScheduleOverviewHtml(team.entryId)}"${selected}>${escapeScheduleOverviewHtml(
        team.teamName
      )}</option>`;
    }),
  ];
  return `
    <label class="schedule-overview-team-select">
      <span class="schedule-overview-team-select__label">チームを選択</span>
      <select class="field__input schedule-overview-team-select__input" id="teamSelect" name="teamId">
        ${options.join("")}
      </select>
    </label>
  `;
}

export function renderTeamScheduleHtml(overview, teamId) {
  const teamSchedule = buildTeamSchedule(overview, teamId);
  if (teamSchedule.status === ScheduleOverviewTeamStatus.UNSELECTED) {
    return `<p class="schedule-overview-empty">${escapeScheduleOverviewHtml(teamSchedule.empty)}</p>`;
  }
  if (teamSchedule.status === ScheduleOverviewTeamStatus.NOT_FOUND) {
    return `<p class="schedule-overview-empty">${escapeScheduleOverviewHtml(teamSchedule.empty)}</p>`;
  }
  const heading = `<h3 class="schedule-overview-team-title">${escapeScheduleOverviewHtml(
    teamSchedule.team.teamName
  )} のスケジュール</h3>`;
  if (!teamSchedule.rows.length) {
    return `${heading}<p class="schedule-overview-empty">${escapeScheduleOverviewHtml(
      teamSchedule.empty
    )}</p>`;
  }
  return `${heading}<div class="schedule-overview-list">${teamSchedule.rows
    .map(renderTeamRow)
    .join("")}</div>`;
}

function renderPrintHeader(model, page) {
  const tournament = model.tournament ?? {};
  const continuation = page.isContinuation ? `<p class="sheet-header__continuation">続き</p>` : "";
  const pageLabel =
    page.pageCount > 1
      ? `<p class="sheet-header__page">${escapeScheduleOverviewHtml(
          `${page.pageNumber} / ${page.pageCount}`
        )}</p>`
      : "";
  return `
    <header class="sheet-header">
      <p class="sheet-header__event">${escapeScheduleOverviewHtml(tournament.name || "（名称未設定）")}</p>
      <h1 class="sheet-header__title">${escapeScheduleOverviewHtml(model.title || "大会スケジュール")}</h1>
      ${continuation}
      ${pageLabel}
      <dl class="sheet-meta">
        <div class="sheet-meta__row"><dt>開催日</dt><dd>${escapeScheduleOverviewHtml(
          tournament.eventDateLabel || "—"
        )}</dd></div>
        <div class="sheet-meta__row"><dt>会場</dt><dd>${escapeScheduleOverviewHtml(
          tournament.venue || "—"
        )}</dd></div>
      </dl>
    </header>
  `;
}

function renderPrintMatch(match) {
  const court = formatScheduleCourtLabel(match.court);
  const courtHtml = court
    ? `<span class="sheet-schedule-court">${escapeScheduleOverviewHtml(court)}</span>`
    : "";
  return `
    <li class="sheet-schedule-match">
      ${courtHtml}
      <span class="sheet-schedule-teams">${escapeScheduleOverviewHtml(
        match.team1?.teamName || "—"
      )} vs ${escapeScheduleOverviewHtml(match.team2?.teamName || "—")}</span>
    </li>
  `;
}

function renderPrintSlot(slot) {
  if (slot.kind === ScheduleOverviewSlotKind.MARKER) {
    return `
      <section class="sheet-schedule-slot sheet-schedule-slot--marker">
        <h2>${escapeScheduleOverviewHtml(
          [slot.startTimeDisplay, slot.label].filter(Boolean).join("　")
        )}</h2>
      </section>
    `;
  }
  const groups = (slot.groups ?? [])
    .map((group) => {
      const label = group.label
        ? `<h3>${escapeScheduleOverviewHtml(group.label)}</h3>`
        : "";
      return `${label}<ul class="sheet-schedule-matches">${(group.matches ?? [])
        .map(renderPrintMatch)
        .join("")}</ul>`;
    })
    .join("");
  return `
    <section class="sheet-schedule-slot">
      <h2>${escapeScheduleOverviewHtml(
        [slot.startTimeDisplay, slot.label].filter(Boolean).join("　")
      )}</h2>
      ${groups}
    </section>
  `;
}

function renderPrintTeamRow(row) {
  if (row.kind === ScheduleOverviewTeamRowKind.REST) {
    return `<li class="sheet-schedule-team-row">${escapeScheduleOverviewHtml(
      [row.startTimeDisplay, row.label, REST_LABEL].filter(Boolean).join("　")
    )}</li>`;
  }
  const court = formatScheduleCourtLabel(row.court);
  const bits = [row.startTimeDisplay, row.label, court, `vs ${row.opponent?.teamName || "—"}`];
  if (row.note && row.kind === ScheduleOverviewTeamRowKind.CONDITIONAL) {
    bits.push(row.note);
  }
  return `<li class="sheet-schedule-team-row">${escapeScheduleOverviewHtml(
    bits.filter(Boolean).join("　")
  )}</li>`;
}

export function renderScheduleOverviewPrintHtml(overview, options = {}) {
  const model = buildScheduleOverviewPrintModel(overview, options);
  const pages = (model.pages ?? []).map((page) => {
    const body =
      model.mode === "team"
        ? `<ul class="sheet-schedule-team-list">${(page.rows ?? [])
            .map(renderPrintTeamRow)
            .join("")}</ul>`
        : (page.slots ?? []).map(renderPrintSlot).join("");
    return `
      <section class="sheet-page">
        ${renderPrintHeader(model, page)}
        ${body}
      </section>
    `;
  });
  return `<div class="sheet-document">${pages.join("")}</div>`;
}

export { buildScheduleOverviewPrintModel, buildTeamSchedule };
