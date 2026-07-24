/**
 * プレイヤー向け公開大会閲覧ページ（読み取り専用）
 */
import { isFirebaseConfigured } from "../../lib/firebase-app.js";
import { isValidTournamentId } from "../../domain/validators.js";
import { buildPublicTournamentViewFromSnapshot } from "../../domain/public-tournament-snapshot.js";
import { loadPublicSnapshot } from "../../services/public-tournament-service.js";
import {
  classifyError,
  InvalidTournamentIdError,
} from "../../lib/errors.js";
import { showFormAlert } from "../components/form-errors.js";
import { showToast } from "../components/toast.js";

const views = {
  loading: document.getElementById("viewLoading"),
  config: document.getElementById("viewConfig"),
  error: document.getElementById("viewError"),
  notReady: document.getElementById("viewNotReady"),
  notPublic: document.getElementById("viewNotPublic"),
  content: document.getElementById("viewContent"),
};

const tournamentNameEl = document.getElementById("tournamentName");
const tournamentMetaEl = document.getElementById("tournamentMeta");
const statusBadgeEl = document.getElementById("statusBadge");
const tournamentInfoEl = document.getElementById("tournamentInfo");
const teamSelectEl = document.getElementById("teamSelect");
const clearTeamSelectBtn = document.getElementById("clearTeamSelectBtn");
const refreshBtn = document.getElementById("refreshBtn");
const lastUpdatedTextEl = document.getElementById("lastUpdatedText");
const publicSectionsEl = document.getElementById("publicSections");

let tournamentId = null;
let highlightEntryId = null;

function showView(name) {
  Object.entries(views).forEach(([key, el]) => {
    if (el) {
      el.classList.toggle("hidden", key !== name);
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

function readQueryParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    tournamentId: params.get("id")?.trim() ?? "",
    entryId: params.get("entry")?.trim() ?? "",
  };
}

function buildPublicPageUrl(id, entryId) {
  const url = new URL("tournament-public.html", window.location.href);
  url.searchParams.set("id", id);
  if (entryId) {
    url.searchParams.set("entry", entryId);
  }
  return url;
}

function updateUrlEntry(entryId) {
  const url = buildPublicPageUrl(tournamentId, entryId || null);
  window.history.replaceState({}, "", url.pathname + url.search);
}

function highlightClass(isHighlighted) {
  return isHighlighted ? " public-highlight" : "";
}

function renderInfoList(view) {
  const rows = [
    view.tournament.eventDate ? `<div><dt>開催日</dt><dd>${escapeHtml(view.tournament.eventDate)}</dd></div>` : "",
    view.tournament.venue ? `<div><dt>会場</dt><dd>${escapeHtml(view.tournament.venue)}</dd></div>` : "",
    `<div><dt>参加チーム数</dt><dd>${view.tournament.entryCount}</dd></div>`,
    view.tournament.maxTeams != null
      ? `<div><dt>募集チーム数</dt><dd>${view.tournament.maxTeams}</dd></div>`
      : "",
    view.tournament.courtCount != null
      ? `<div><dt>コート数</dt><dd>${view.tournament.courtCount}</dd></div>`
      : "",
  ].filter(Boolean);

  tournamentInfoEl.innerHTML = rows.join("");
}

function renderTeamSelect(view) {
  const previous = teamSelectEl.value;
  teamSelectEl.innerHTML = `<option value="">（選択なし）</option>`;
  for (const entry of view.entries.items) {
    const option = document.createElement("option");
    option.value = entry.entryId;
    option.textContent = entry.teamName;
    if (entry.entryId === highlightEntryId) {
      option.selected = true;
    }
    teamSelectEl.appendChild(option);
  }
  if (!highlightEntryId && previous) {
    teamSelectEl.value = previous;
  }
}

function renderEntriesSection(section) {
  if (!section.ready) {
    return `
      <section class="panel public-section">
        <h3 class="panel__title">参加チーム</h3>
        <p class="empty-state">${escapeHtml(section.emptyMessage)}</p>
      </section>
    `;
  }

  const items = section.items
    .map(
      (entry) => `
        <li class="public-team-item${highlightClass(entry.highlighted)}">
          <span class="public-team-item__name">${escapeHtml(entry.teamName)}</span>
          ${entry.highlighted ? '<span class="public-highlight-badge">選択チーム</span>' : ""}
          ${
            entry.members.length
              ? `<span class="public-team-item__members">${escapeHtml(entry.members.join(" / "))}</span>`
              : ""
          }
        </li>
      `
    )
    .join("");

  return `
    <section class="panel public-section">
      <h3 class="panel__title">参加チーム</h3>
      <ul class="public-team-list">${items}</ul>
    </section>
  `;
}

function renderBlocksSection(section) {
  if (!section.ready) {
    return `
      <section class="panel public-section">
        <h3 class="panel__title">ブロック分け</h3>
        <p class="empty-state">${escapeHtml(section.emptyMessage)}</p>
      </section>
    `;
  }

  const blocks = section.blocks
    .map(
      (block) => `
        <div class="public-block">
          <h4 class="public-block__title">${escapeHtml(block.blockName)}</h4>
          <ul class="public-team-list">
            ${block.teams
              .map(
                (team) => `
                  <li class="public-team-item${highlightClass(team.highlighted)}">
                    <span class="public-team-item__name">${escapeHtml(team.teamName)}</span>
                    ${team.highlighted ? '<span class="public-highlight-badge">選択チーム</span>' : ""}
                  </li>
                `
              )
              .join("")}
          </ul>
        </div>
      `
    )
    .join("");

  return `
    <section class="panel public-section">
      <h3 class="panel__title">ブロック分け</h3>
      ${blocks}
    </section>
  `;
}

function renderScheduleSection(section) {
  if (!section.ready) {
    return `
      <section class="panel public-section">
        <h3 class="panel__title">予選対戦表</h3>
        <p class="empty-state">${escapeHtml(section.emptyMessage)}</p>
      </section>
    `;
  }

  const blocks = section.blocks
    .map((block) => {
      const rounds = block.rounds
        .map((round) => {
          const matches = round.matches
            .map((match) => {
              const setLines = match.result.setLines
                .map((line) => `<li>${escapeHtml(line.label)}　${escapeHtml(line.score)}</li>`)
                .join("");
              return `
                <article class="public-match-card${highlightClass(match.team1.highlighted || match.team2.highlighted)}">
                  <p class="public-match-card__meta">${escapeHtml(round.roundLabel)}　${match.courtNumber}コート</p>
                  <p class="public-match-card__teams">
                    <span class="${match.team1.highlighted ? "public-highlight-text" : ""}">${escapeHtml(match.team1.teamName)}</span>
                    vs
                    <span class="${match.team2.highlighted ? "public-highlight-text" : ""}">${escapeHtml(match.team2.teamName)}</span>
                  </p>
                  <p class="public-match-card__status">状態：${escapeHtml(match.statusLabel)}</p>
                  <p class="public-match-card__result">結果：${escapeHtml(match.result.summary)}</p>
                  ${setLines ? `<ul class="public-set-list">${setLines}</ul>` : ""}
                </article>
              `;
            })
            .join("");
          return `
            <div class="public-round">
              <h5 class="public-round__title">${escapeHtml(block.blockName)} / ${escapeHtml(round.roundLabel)}</h5>
              <div class="public-match-list">${matches}</div>
            </div>
          `;
        })
        .join("");
      return `<div class="public-block">${rounds}</div>`;
    })
    .join("");

  return `
    <section class="panel public-section">
      <h3 class="panel__title">予選対戦表</h3>
      ${blocks}
    </section>
  `;
}

function renderStandingsSection(section) {
  if (!section.ready) {
    return `
      <section class="panel public-section">
        <h3 class="panel__title">予選順位</h3>
        <p class="empty-state">${escapeHtml(section.emptyMessage)}</p>
      </section>
    `;
  }

  const blocks = section.blocks
    .map((block) => {
      const rows = block.rows
        .map(
          (row) => `
            <tr class="${row.highlighted ? "public-highlight-row" : ""}">
              <td>${row.rank}</td>
              <td>
                ${escapeHtml(row.teamName)}
                ${row.highlighted ? '<span class="public-highlight-badge">選択チーム</span>' : ""}
              </td>
              <td>${row.setWins}</td>
              <td>${row.setDraws}</td>
              <td>${row.totalScore}</td>
              <td>${row.playedMatches}</td>
            </tr>
          `
        )
        .join("");

      return `
        <div class="public-block">
          <h4 class="public-block__title">${escapeHtml(block.blockName)}</h4>
          <div class="standings-table-wrap">
            <table class="standings-table">
              <thead>
                <tr>
                  <th>順位</th>
                  <th>チーム</th>
                  <th>勝セット</th>
                  <th>引分</th>
                  <th>総得点</th>
                  <th>試合</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>
      `;
    })
    .join("");

  return `
    <section class="panel public-section">
      <h3 class="panel__title">予選順位 <span class="public-section__label">${escapeHtml(section.label)}</span></h3>
      ${blocks}
    </section>
  `;
}

function renderFinalsAdvancementSection(section) {
  if (!section.ready) {
    return `
      <section class="panel public-section">
        <h3 class="panel__title">決勝進出チーム</h3>
        <p class="empty-state">${escapeHtml(section.emptyMessage)}</p>
      </section>
    `;
  }

  const groups = section.groups
    .map(
      (group) => `
        <div class="public-block">
          <h4 class="public-block__title">${escapeHtml(group.label)}</h4>
          <ul class="public-team-list">
            ${group.teams
              .map(
                (team) => `
                  <li class="public-team-item${highlightClass(team.highlighted)}">
                    <span class="public-team-item__name">${escapeHtml(team.teamName)}</span>
                    ${team.highlighted ? '<span class="public-highlight-badge">選択チーム</span>' : ""}
                  </li>
                `
              )
              .join("")}
          </ul>
        </div>
      `
    )
    .join("");

  return `
    <section class="panel public-section">
      <h3 class="panel__title">決勝進出チーム</h3>
      ${groups}
    </section>
  `;
}

function renderFinalsTeamLine(teamLine) {
  if (!teamLine) {
    return `<span class="finals-bracket__pending">前ラウンド結果待ち</span>`;
  }
  if (teamLine.type === "pending") {
    return `<span class="finals-bracket__pending">${escapeHtml(teamLine.label)}</span>`;
  }
  if (teamLine.type === "bye") {
    return `<span class="finals-bracket__bye">${escapeHtml(teamLine.label)}</span>`;
  }
  const highlight = teamLine.highlighted ? " public-highlight-text" : "";
  const seed = teamLine.seed != null ? `<span class="finals-bracket__seed">seed ${teamLine.seed}</span>` : "";
  return `${seed}<span class="${highlight.trim()}">${escapeHtml(teamLine.teamName)}</span>`;
}

function renderFinalsBracketSection(section) {
  if (!section.ready) {
    return `
      <section class="panel public-section">
        <h3 class="panel__title">決勝トーナメント</h3>
        <p class="empty-state">${escapeHtml(section.emptyMessage)}</p>
      </section>
    `;
  }

  const rounds = section.rounds
    .map((round) => {
      const matches = round.matches
        .map(
          (match) => `
            <article class="finals-bracket__match public-finals-match${highlightClass(match.team1?.highlighted || match.team2?.highlighted)}">
              <div class="finals-bracket__match-head">
                <p class="finals-bracket__match-title">第${match.matchNumber}試合</p>
                <span class="status-badge finals-bracket__status">${escapeHtml(match.statusLabel)}</span>
              </div>
              <div class="finals-bracket__team">${renderFinalsTeamLine(match.team1)}</div>
              <p class="finals-bracket__vs">vs</p>
              <div class="finals-bracket__team">${renderFinalsTeamLine(match.team2)}</div>
              ${
                match.resultSummary
                  ? `<p class="public-match-card__result">結果：${escapeHtml(match.resultSummary)}</p>`
                  : ""
              }
            </article>
          `
        )
        .join("");

      return `
        <section class="panel finals-bracket__round">
          <h4 class="panel__title">${escapeHtml(round.roundLabel)}</h4>
          <div class="finals-bracket__matches">${matches}</div>
        </section>
      `;
    })
    .join("");

  const championBlock =
    section.champion || section.runnerUp
      ? `
        <div class="panel public-champion-panel">
          ${
            section.champion
              ? `<p><strong>優勝：</strong><span class="${section.champion.highlighted ? "public-highlight-text" : ""}">${escapeHtml(section.champion.teamName)}</span></p>`
              : ""
          }
          ${
            section.runnerUp
              ? `<p><strong>準優勝：</strong><span class="${section.runnerUp.highlighted ? "public-highlight-text" : ""}">${escapeHtml(section.runnerUp.teamName)}</span></p>`
              : ""
          }
        </div>
      `
      : "";

  return `
    <section class="public-section">
      <h3 class="panel__title" style="margin-bottom: var(--space-md);">決勝トーナメント</h3>
      ${championBlock}
      ${rounds}
    </section>
  `;
}

function renderFinalResultsSection(section) {
  if (!section.ready) {
    return `
      <section class="panel public-section">
        <h3 class="panel__title">大会結果</h3>
        <p class="empty-state">${escapeHtml(section.emptyMessage)}</p>
      </section>
    `;
  }

  const headline = [
    section.champion
      ? `<p><strong>優勝</strong>　<span class="${section.champion.highlighted ? "public-highlight-text" : ""}">${escapeHtml(section.champion.teamName)}</span></p>`
      : "",
    section.runnerUp
      ? `<p><strong>準優勝</strong>　<span class="${section.runnerUp.highlighted ? "public-highlight-text" : ""}">${escapeHtml(section.runnerUp.teamName)}</span></p>`
      : "",
  ]
    .filter(Boolean)
    .join("");

  const placements = section.placements
    .map(
      (placement) => `
        <li class="public-team-item${highlightClass(placement.highlighted)}">
          <span class="public-team-item__name">${escapeHtml(placement.placementLabel)}　${escapeHtml(placement.teamName)}</span>
          ${placement.highlighted ? '<span class="public-highlight-badge">選択チーム</span>' : ""}
        </li>
      `
    )
    .join("");

  return `
    <section class="panel public-section">
      <h3 class="panel__title">大会結果</h3>
      ${headline}
      <ul class="public-team-list">${placements}</ul>
    </section>
  `;
}

function renderPublicView(view) {
  tournamentNameEl.textContent = view.tournament.name;
  tournamentMetaEl.textContent = [
    view.tournament.eventDate ? `開催日: ${view.tournament.eventDate}` : null,
    view.tournament.venue ? `会場: ${view.tournament.venue}` : null,
  ]
    .filter(Boolean)
    .join(" / ");
  statusBadgeEl.textContent = view.tournament.statusLabel;
  renderInfoList(view);
  renderTeamSelect(view);

  publicSectionsEl.innerHTML = [
    renderEntriesSection(view.entries),
    renderBlocksSection(view.blocks),
    renderScheduleSection(view.schedule),
    renderStandingsSection(view.standings),
    renderFinalsAdvancementSection(view.finalsAdvancement),
    renderFinalsBracketSection(view.finalsBracket),
    renderFinalResultsSection(view.finalResults),
  ].join("");
}

function updateLastUpdatedText() {
  const now = new Date();
  lastUpdatedTextEl.textContent = `最終更新：${now.toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

async function loadPage() {
  showView("loading");

  if (!isFirebaseConfigured()) {
    showFormAlert(document.getElementById("configAlert"), "Firebase 設定が必要です。", "error");
    showView("config");
    return;
  }

  if (!isValidTournamentId(tournamentId)) {
    const { message } = classifyError(new InvalidTournamentIdError());
    showFormAlert(document.getElementById("errorAlert"), message, "error");
    showView("error");
    return;
  }

  try {
    const snapshot = await loadPublicSnapshot(tournamentId);
    const view = buildPublicTournamentViewFromSnapshot(snapshot, highlightEntryId);
    renderPublicView(view);
    updateLastUpdatedText();
    showView("content");
  } catch (error) {
    console.error("[tournament-public-page] load failed", error);
    const { code, message } = classifyError(error);
    if (code === "tournament/public-view-disabled") {
      showFormAlert(document.getElementById("notPublicAlert"), message, "error");
      showView("notPublic");
      return;
    }
    if (code === "tournament/public-snapshot-not-ready") {
      showFormAlert(document.getElementById("notReadyAlert"), message, "warning");
      showView("notReady");
      return;
    }
    if (
      error.code === "permission-denied" ||
      error.code === "firestore/permission-denied"
    ) {
      showFormAlert(
        document.getElementById("notPublicAlert"),
        "この大会は現在公開されていません。",
        "error"
      );
      showView("notPublic");
      return;
    }
    showFormAlert(
      document.getElementById("errorAlert"),
      message || "大会情報を読み込めませんでした。時間をおいて再度お試しください。",
      "error"
    );
    showView("error");
  }
}

function handleTeamSelectChange() {
  highlightEntryId = teamSelectEl.value || null;
  updateUrlEntry(highlightEntryId);
  loadPage();
}

function init() {
  const params = readQueryParams();
  tournamentId = params.tournamentId;
  highlightEntryId = params.entryId || null;

  if (!tournamentId) {
    showFormAlert(
      document.getElementById("errorAlert"),
      "大会 ID が指定されていません。",
      "error"
    );
    showView("error");
    return;
  }

  teamSelectEl.addEventListener("change", handleTeamSelectChange);
  clearTeamSelectBtn.addEventListener("click", () => {
    teamSelectEl.value = "";
    handleTeamSelectChange();
  });
  refreshBtn.addEventListener("click", () => {
    loadPage();
  });

  loadPage();
}

init();
