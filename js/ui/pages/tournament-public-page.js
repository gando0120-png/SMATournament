/**
 * プレイヤー向け公開大会閲覧ページ（読み取り専用）
 */
import { isFirebaseConfigured } from "../../lib/firebase-app.js";
import { isValidTournamentId } from "../../domain/validators.js";
import { buildPublicTournamentViewFromSnapshot } from "../../domain/public-tournament-snapshot.js";
import { hasPublicConsolationBracket } from "../../domain/public-tournament-view.js";
import { BracketKind } from "../../domain/bracket-collections.js";
import {
  getBracketViewParamFromSearch,
  resolveActiveBracketKindFromViewParam,
  syncPublicBracketViewUrl,
} from "../consolation-bracket-ui.js";
import { loadPublicSnapshot } from "../../services/public-tournament-service.js";
import {
  classifyError,
  InvalidTournamentIdError,
} from "../../lib/errors.js";
import { showFormAlert } from "../components/form-errors.js";
import { showToast } from "../components/toast.js";
import { FinalsMatchDisplayStatus } from "../../domain/finals-match-progress.js";
import { mountFinalsBracketView } from "../components/finals-bracket-view.js";

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
const publicBracketKindTabsEl = document.getElementById("publicBracketKindTabs");
const publicBracketKindTabButtons = publicBracketKindTabsEl
  ? [...publicBracketKindTabsEl.querySelectorAll("[data-bracket-kind]")]
  : [];

let tournamentId = null;
let highlightEntryId = null;
/** @type {string} */
let activeBracketKind = BracketKind.MAIN;
/** @type {object|null} */
let pageView = null;
/** @type {ReturnType<typeof mountFinalsBracketView> | null} */
let publicBracketViewController = null;

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

function buildPublicPageUrl(id, entryId, bracketKind = BracketKind.MAIN) {
  const url = new URL("tournament-public.html", window.location.href);
  url.searchParams.set("id", id);
  if (entryId) {
    url.searchParams.set("entry", entryId);
  }
  if (bracketKind === BracketKind.CONSOLATION) {
    url.searchParams.set("view", "consolation");
  }
  return url;
}

function updateUrlEntry(entryId) {
  syncPublicBracketViewUrl(tournamentId, activeBracketKind, {
    entryId: entryId || null,
  });
}

function resolveActivePublicBracketKind(view) {
  const hasConsolation = hasPublicConsolationBracket(view.sections?.consolationBracket);
  const viewParam = getBracketViewParamFromSearch(window.location.search);
  activeBracketKind = resolveActiveBracketKindFromViewParam(viewParam, hasConsolation);
  if (viewParam === "consolation" && !hasConsolation) {
    syncPublicBracketViewUrl(tournamentId, BracketKind.MAIN, { entryId: highlightEntryId });
  }
}

function renderPublicBracketKindTabs(view) {
  if (!publicBracketKindTabsEl) {
    return;
  }

  const showTabs = hasPublicConsolationBracket(view.sections?.consolationBracket);
  publicBracketKindTabsEl.classList.toggle("hidden", !showTabs);

  for (const button of publicBracketKindTabButtons) {
    const kind =
      button.dataset.bracketKind === "consolation" ? BracketKind.CONSOLATION : BracketKind.MAIN;
    const selected = kind === activeBracketKind;
    button.classList.toggle("bracket-kind-tabs__btn--active", selected);
    button.setAttribute("aria-selected", selected ? "true" : "false");
  }
}

function getActivePublicBracketSection(view) {
  if (
    activeBracketKind === BracketKind.CONSOLATION &&
    hasPublicConsolationBracket(view.sections?.consolationBracket)
  ) {
    return view.sections.consolationBracket;
  }
  return view.sections?.bracket ?? view.finalsBracket;
}

function setActivePublicBracketKind(nextKind) {
  if (nextKind === activeBracketKind || !pageView) {
    return;
  }
  activeBracketKind = nextKind;
  syncPublicBracketViewUrl(tournamentId, activeBracketKind, { entryId: highlightEntryId });
  renderPublicView(pageView);
}

function handlePublicBracketKindTabClick(event) {
  const button = event.target.closest("[data-bracket-kind]");
  if (!button) {
    return;
  }
  const nextKind =
    button.dataset.bracketKind === "consolation" ? BracketKind.CONSOLATION : BracketKind.MAIN;
  setActivePublicBracketKind(nextKind);
}

function highlightClass(isHighlighted) {
  return isHighlighted ? " public-highlight" : "";
}

function renderInfoList(view) {
  const tournament = view.tournament;
  const rows = [];

  if (tournament.showFormatLabel !== false && tournament.formatLabel) {
    rows.push(
      `<div><dt>大会形式</dt><dd>${escapeHtml(tournament.formatLabel)}</dd></div>`
    );
  }

  if (tournament.tournamentFormat === "qualifying_and_finals") {
    if (tournament.blockCount != null) {
      rows.push(`<div><dt>ブロック数</dt><dd>${tournament.blockCount}</dd></div>`);
    }
    if (tournament.qualifiersPerBlock != null) {
      rows.push(
        `<div><dt>各ブロック通過</dt><dd>各ブロック上位${tournament.qualifiersPerBlock}チーム</dd></div>`
      );
    }
    if (tournament.finalQualifierCount != null) {
      rows.push(
        `<div><dt>決勝進出予定</dt><dd>${tournament.finalQualifierCount}チーム</dd></div>`
      );
    }
  }

  if (tournament.tournamentFormat === "single_elimination") {
    rows.push(
      `<div><dt>確定参加</dt><dd>${tournament.teamCount ?? tournament.confirmedCount ?? "—"}チーム</dd></div>`
    );
    if (tournament.bracketSize != null) {
      rows.push(`<div><dt>トーナメント枠</dt><dd>${tournament.bracketSize}</dd></div>`);
    }
    if (tournament.byeCount != null) {
      rows.push(`<div><dt>BYE</dt><dd>${tournament.byeCount}</dd></div>`);
    }
  }

  if (tournament.eventDate) {
    rows.push(`<div><dt>開催日</dt><dd>${escapeHtml(tournament.eventDate)}</dd></div>`);
  }
  if (tournament.venue) {
    rows.push(`<div><dt>会場</dt><dd>${escapeHtml(tournament.venue)}</dd></div>`);
  }

  rows.push(`<div><dt>参加チーム数</dt><dd>${tournament.entryCount}</dd></div>`);

  if (tournament.maxTeams != null) {
    rows.push(`<div><dt>募集チーム数</dt><dd>${tournament.maxTeams}</dd></div>`);
  }
  if (tournament.courtCount != null) {
    rows.push(`<div><dt>コート数</dt><dd>${tournament.courtCount}</dd></div>`);
  }

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
  if (section.visible === false) {
    return "";
  }
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
          <h4 class="public-block__title">${escapeHtml(block.blockName)}　${block.teamCount ?? block.teams.length}チーム</h4>
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
      <div class="public-block-grid">${blocks}</div>
    </section>
  `;
}

function renderScheduleSection(section) {
  if (section.visible === false) {
    return "";
  }
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
  if (section.visible === false) {
    return "";
  }
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
                ${
                  row.advancementNote
                    ? `<span class="public-advancement-note">${escapeHtml(row.advancementNote)}</span>`
                    : ""
                }
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
  if (section.visible === false) {
    return "";
  }
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
                    <span class="public-team-item__name">
                      ${team.rankLabel ? `<span class="public-rank-label">${escapeHtml(team.rankLabel)}</span> ` : ""}${escapeHtml(team.teamName)}
                    </span>
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

function renderFinalsTeamLine(
  teamLine,
  showSeed = true,
  { displayStatus = null, isWinner = false, hasWinner = false } = {}
) {
  if (!teamLine) {
    return `<span class="finals-bracket__pending">前ラウンド結果待ち</span>`;
  }
  if (teamLine.type === "pending") {
    return `<span class="finals-bracket__pending">${escapeHtml(teamLine.label)}</span>`;
  }
  if (teamLine.type === "bye") {
    return `<span class="finals-bracket__bye">${escapeHtml(teamLine.label)}</span>`;
  }
  const finished = displayStatus === FinalsMatchDisplayStatus.FINISHED;
  const winnerClass = finished && isWinner ? " finals-bracket__team--winner" : "";
  const loserClass =
    finished && hasWinner && !isWinner && teamLine.type === "team"
      ? " finals-bracket__team--loser"
      : "";
  const highlight = teamLine.highlighted ? " public-highlight-text" : "";
  const winnerMark = finished && isWinner ? `<span class="finals-bracket__winner-mark" aria-hidden="true">✓ </span>` : "";
  const seed =
    showSeed && teamLine.seed != null
      ? `<span class="finals-bracket__seed">seed ${teamLine.seed}</span>`
      : "";
  const nameClass = `${winnerClass}${loserClass}${highlight}`.trim();
  return `${seed}${winnerMark}<span class="${nameClass}">${escapeHtml(teamLine.teamName)}</span>`;
}

function renderFinalsBracketSection(section, options = {}) {
  if (section.visible === false) {
    return "";
  }

  const title = section.title ?? "決勝トーナメント";
  const showSeed = section.showSeed !== false;
  const championLabel = options.championLabel ?? "優勝";
  const runnerUpLabel = options.runnerUpLabel ?? "準優勝";
  const showRunnerUp = options.showRunnerUp !== false;
  const metaLine =
    section.teamCount != null && section.bracketSize != null
      ? `<p class="panel__desc">${section.teamCount} チーム / ${section.bracketSize} 枠 / BYE ${section.byeCount ?? 0} / ランダム抽選</p>`
      : "";

  if (!section.ready) {
    return `
      <section class="panel public-section">
        <h3 class="panel__title">${escapeHtml(title)}</h3>
        <p class="empty-state">${escapeHtml(section.emptyMessage)}</p>
      </section>
    `;
  }

  const championBlock =
    section.champion || (showRunnerUp && section.runnerUp)
      ? `
        <div class="panel public-champion-panel">
          ${
            section.champion
              ? `<p><strong>${escapeHtml(championLabel)}：</strong><span class="${section.champion.highlighted ? "public-highlight-text" : ""}">${escapeHtml(section.champion.teamName ?? "チーム名未設定")}</span></p>`
              : ""
          }
          ${
            showRunnerUp && section.runnerUp
              ? `<p><strong>${escapeHtml(runnerUpLabel)}：</strong><span class="${section.runnerUp.highlighted ? "public-highlight-text" : ""}">${escapeHtml(section.runnerUp.teamName ?? "チーム名未設定")}</span></p>`
              : ""
          }
        </div>
      `
      : "";

  return `
    <section class="public-section" data-public-finals-bracket-section>
      <h3 class="panel__title" style="margin-bottom: var(--space-md);">${escapeHtml(title)}</h3>
      ${metaLine}
      ${championBlock}
      <div class="finals-bracket-view-host" data-public-finals-bracket-host data-show-seed="${showSeed ? "true" : "false"}"></div>
    </section>
  `;
}

function renderPublicPlacementGroups(groups) {
  return (groups ?? [])
    .map(
      (group) => `
        <div class="public-results-group">
          <h4 class="public-results-group__title">${escapeHtml(group.label)}</h4>
          <ul class="public-team-list">
            ${group.items
              .map(
                (placement) => `
                  <li class="public-team-item${highlightClass(placement.highlighted)}">
                    <span class="public-team-item__name">${escapeHtml(placement.teamName)}</span>
                    ${placement.highlighted ? '<span class="public-highlight-badge">選択チーム</span>' : ""}
                  </li>
                `
              )
              .join("")}
          </ul>
        </div>
      `
    )
    .join("");
}

function renderConsolationResultsBlock(consolation) {
  if (!consolation?.visible) {
    return "";
  }

  if (consolation.status === "in_progress" && !(consolation.placements ?? []).length) {
    return `
      <div class="public-results-consolation">
        <h4 class="public-results-group__title">下位トーナメント</h4>
        <p class="empty-state">${escapeHtml(consolation.emptyMessage ?? "下位トーナメントは進行中です")}</p>
      </div>
    `;
  }

  const headline = [
    consolation.champion
      ? `<p class="public-results-headline"><strong>下位トーナメント優勝</strong>　<span class="${consolation.champion.highlighted ? "public-highlight-text" : ""}">${escapeHtml(consolation.champion.teamName)}</span></p>`
      : "",
    consolation.runnerUp
      ? `<p class="public-results-headline"><strong>下位トーナメント準優勝</strong>　<span class="${consolation.runnerUp.highlighted ? "public-highlight-text" : ""}">${escapeHtml(consolation.runnerUp.teamName)}</span></p>`
      : "",
  ]
    .filter(Boolean)
    .join("");

  const statusNote =
    consolation.status === "in_progress" && consolation.emptyMessage
      ? `<p class="panel__desc">${escapeHtml(consolation.emptyMessage)}</p>`
      : "";

  return `
    <div class="public-results-consolation">
      <h4 class="public-results-group__title">下位トーナメント</h4>
      ${statusNote}
      ${headline}
      ${renderPublicPlacementGroups(consolation.placementGroups)}
    </div>
  `;
}

function renderFinalResultsSection(section) {
  if (section.visible === false) {
    return "";
  }
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
      ? `<p class="public-results-headline"><strong>優勝</strong>　<span class="${section.champion.highlighted ? "public-highlight-text" : ""}">${escapeHtml(section.champion.teamName)}</span></p>`
      : "",
    section.runnerUp
      ? `<p class="public-results-headline"><strong>準優勝</strong>　<span class="${section.runnerUp.highlighted ? "public-highlight-text" : ""}">${escapeHtml(section.runnerUp.teamName)}</span></p>`
      : "",
  ]
    .filter(Boolean)
    .join("");

  const placementGroups = renderPublicPlacementGroups(section.placementGroups);
  const consolationBlock = renderConsolationResultsBlock(section.consolation);

  return `
    <section class="panel public-section">
      <h3 class="panel__title">大会結果</h3>
      <h4 class="public-results-group__title">上位トーナメント</h4>
      ${headline}
      ${placementGroups}
      ${consolationBlock}
    </section>
  `;
}

function initPublicFinalsBracketView(section) {
  const host = publicSectionsEl.querySelector("[data-public-finals-bracket-host]");
  if (!host || !section?.ready || !section.rounds?.length) {
    publicBracketViewController?.destroy();
    publicBracketViewController = null;
    return;
  }

  const hideSeed = section.showSeed === false;
  const viewOptions = {
    surface: "public",
    hideSeed,
    escapeHtml,
    rounds: section.rounds,
    renderPublicTeamLine: (teamLine, showSeed, context) =>
      renderFinalsTeamLine(teamLine, showSeed, context),
  };

  if (!publicBracketViewController) {
    publicBracketViewController = mountFinalsBracketView(host, viewOptions);
    return;
  }

  publicBracketViewController.update(viewOptions);
}

function renderPublicView(view) {
  pageView = view;
  resolveActivePublicBracketKind(view);
  renderPublicBracketKindTabs(view);

  publicBracketViewController?.destroy();
  publicBracketViewController = null;

  tournamentNameEl.textContent = view.tournament.name;
  tournamentMetaEl.textContent = [
    view.tournament.eventDate ? `開催日: ${view.tournament.eventDate}` : null,
    view.tournament.venue ? `会場: ${view.tournament.venue}` : null,
  ]
    .filter(Boolean)
    .join(" / ");
  statusBadgeEl.textContent =
    view.tournament.progressStatusLabel ?? view.tournament.statusLabel;
  renderInfoList(view);
  renderTeamSelect(view);

  const sections = view.sections ?? {
    registration: view.entries,
    qualifying: { blocks: view.blocks, schedule: view.schedule, standings: view.standings },
    advancement: view.finalsAdvancement,
    bracket: view.finalsBracket,
    results: view.finalResults,
  };

  const activeBracketSection = getActivePublicBracketSection(view);
  const isConsolationTab =
    activeBracketKind === BracketKind.CONSOLATION &&
    hasPublicConsolationBracket(view.sections?.consolationBracket);

  const advancementSection = sections.advancement ?? view.finalsAdvancement;
  const mainBracketReady = (sections.bracket ?? view.finalsBracket)?.ready === true;
  const showAdvancementList =
    advancementSection?.visible !== false && !mainBracketReady;

  publicSectionsEl.innerHTML = [
    renderEntriesSection(sections.registration),
    renderBlocksSection(sections.qualifying?.blocks ?? view.blocks),
    renderScheduleSection(sections.qualifying?.schedule ?? view.schedule),
    renderStandingsSection(sections.qualifying?.standings ?? view.standings),
    // 本戦ブラケット作成済みなら進出一覧は非表示（対戦表と重複）
    showAdvancementList ? renderFinalsAdvancementSection(advancementSection) : "",
    renderFinalsBracketSection(activeBracketSection, {
      championLabel: isConsolationTab ? "下位トーナメント優勝" : "優勝",
      runnerUpLabel: isConsolationTab ? "下位トーナメント準優勝" : "準優勝",
      showRunnerUp: !isConsolationTab,
    }),
    renderFinalResultsSection(sections.results ?? view.finalResults),
  ]
    .filter(Boolean)
    .join("");

  initPublicFinalsBracketView(activeBracketSection);
}

function updateLastUpdatedText(snapshot) {
  const updatedAt = snapshot?.updatedAt;
  if (updatedAt && typeof updatedAt.toDate === "function") {
    lastUpdatedTextEl.textContent = `最終更新：${updatedAt.toDate().toLocaleString("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })}`;
    return;
  }
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
    if (snapshot.tournament?.isDeleted === true) {
      showFormAlert(document.getElementById("errorAlert"), "この大会は削除されています。", "error");
      showView("error");
      return;
    }
    const view = buildPublicTournamentViewFromSnapshot(snapshot, highlightEntryId);
    renderPublicView(view);
    updateLastUpdatedText(snapshot);
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

  if (publicBracketKindTabsEl && publicBracketKindTabsEl.dataset.bound !== "true") {
    publicBracketKindTabsEl.dataset.bound = "true";
    publicBracketKindTabsEl.addEventListener("click", handlePublicBracketKindTabClick);
  }

  loadPage();
}

init();
