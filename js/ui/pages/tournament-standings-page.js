/**
 * 予選順位表ページ
 */
import { isValidTournamentId } from "../../domain/validators.js";
import {
  applyMolkkyOutResolutions,
  entryIdsGroupKey,
  listUnresolvedBlockMolkkyOutGroups,
  buildQualifyingStandings,
} from "../../domain/qualifying-standings.js";
import { getTournament } from "../../services/tournament-service.js";
import { getQualifyingSchedule } from "../../services/qualifying-schedule-service.js";
import { listEntries } from "../../services/entry-service.js";
import {
  buildEntryTeamNameLookup,
  overlayEntryTeamNames,
  overlayEntryTeamNamesInMap,
} from "../../domain/entry-team-name-overlay.js";
import { getQualifyingMatchResults } from "../../services/qualifying-match-result-service.js";
import { getFinalsAdvancement } from "../../services/finals-advancement-service.js";
import { getFinalsBracket } from "../../services/finals-bracket-service.js";
import {
  getMolkkyOutResolutions,
  upsertMolkkyOutResolution,
} from "../../services/molkky-out-resolution-service.js";
import { initTournamentManageGuard } from "../../lib/operator-guard.js";
import {
  classifyError,
  InvalidTournamentIdError,
} from "../../lib/errors.js";
import { showFormAlert } from "../components/form-errors.js";
import { showErrorToast, showToast } from "../components/toast.js";
import {
  moveMolkkyOutOrderItem,
  readMolkkyOutOrder,
  renderMolkkyOutOrderPanel,
} from "../components/molkky-out-order-panel.js";

const views = {
  loading: document.getElementById("viewLoading"),
  config: document.getElementById("viewConfig"),
  operatorDenied: document.getElementById("viewOperatorDenied"),
  error: document.getElementById("viewError"),
  empty: document.getElementById("viewEmpty"),
  standings: document.getElementById("viewStandings"),
};

const headerActions = document.getElementById("headerActions");
const backToDashboardBtn = document.getElementById("backToDashboardBtn");
const openScheduleBtn = document.getElementById("openScheduleBtn");
const openFinalsAdvancementBtn = document.getElementById("openFinalsAdvancementBtn");
const openFinalsBracketBtn = document.getElementById("openFinalsBracketBtn");
const emptyBackBtn = document.getElementById("emptyBackBtn");
const emptyScheduleBtn = document.getElementById("emptyScheduleBtn");
const standingsPageTitleEl = document.getElementById("standingsPageTitle");
const standingsMetaEl = document.getElementById("standingsMeta");
const standingsBlocksEl = document.getElementById("standingsBlocks");

let tournamentId = null;
let currentStandings = null;
let currentResolutions = null;
let advancementFinalized = false;
let isSavingMolkkyOut = false;

function showView(name) {
  Object.entries(views).forEach(([key, el]) => {
    if (el) {
      el.classList.toggle("hidden", key !== name);
    }
  });
  if (headerActions) {
    headerActions.classList.toggle("hidden", name !== "standings" && name !== "empty");
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildTournamentDashboardHref(id) {
  return `tournament-dashboard.html?id=${encodeURIComponent(id)}`;
}

function buildTournamentScheduleHref(id) {
  return `tournament-schedule.html?id=${encodeURIComponent(id)}`;
}

function buildTournamentFinalsAdvancementHref(id) {
  return `tournament-finals-advancement.html?id=${encodeURIComponent(id)}`;
}

function buildTournamentFinalsBracketHref(id) {
  return `tournament-finals-bracket.html?id=${encodeURIComponent(id)}`;
}

function updateFinalsNavigation(advancement, bracket) {
  if (!openFinalsBracketBtn) {
    return;
  }

  if (!advancement?.finalized) {
    openFinalsBracketBtn.classList.add("hidden");
    return;
  }

  openFinalsBracketBtn.classList.remove("hidden");
  openFinalsBracketBtn.href = buildTournamentFinalsBracketHref(tournamentId);
  openFinalsBracketBtn.textContent = bracket?.finalized
    ? "決勝トーナメントを見る"
    : "決勝トーナメントを作成";
}

function blockGroupKey(blockId, entryIds) {
  return `block:${blockId}:${entryIdsGroupKey(entryIds)}`;
}

function renderStandingsRow(entry) {
  const badge = entry.needsMolkkyOut
    ? `<span class="standings-badge--molkky-out">モルックアウト対象</span>`
    : "";
  return `
    <tr>
      <td class="standings-table__rank">${entry.rank}</td>
      <td class="standings-table__team">
        <div class="standings-table__team-cell">
          <span>${escapeHtml(entry.teamName)}</span>
          ${badge}
        </div>
      </td>
      <td class="standings-table__num">${entry.playedMatches}</td>
      <td class="standings-table__num">${entry.setWins}</td>
      <td class="standings-table__num">${entry.setDraws}</td>
      <td class="standings-table__num">${entry.setLosses}</td>
      <td class="standings-table__num">${entry.totalScore}</td>
      <td class="standings-table__num">${entry.remainingMatches}</td>
    </tr>
  `;
}

function renderBlockStandings(block) {
  const rows = block.standings.map((entry) => renderStandingsRow(entry)).join("");

  return `
    <section class="panel standings-block" style="margin-bottom: var(--space-lg);">
      <h3 class="panel__title">${escapeHtml(block.blockName)}</h3>
      <div class="standings-table-wrap">
        <table class="standings-table">
          <thead>
            <tr>
              <th scope="col">順位</th>
              <th scope="col">チーム</th>
              <th scope="col">試合</th>
              <th scope="col">セット勝</th>
              <th scope="col">分</th>
              <th scope="col">敗</th>
              <th scope="col">総得点</th>
              <th scope="col">残り</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderMolkkyOutPanels(standings) {
  const groups = listUnresolvedBlockMolkkyOutGroups(standings);
  if (!groups.length) {
    return "";
  }

  const panels = groups
    .map((group) =>
      renderMolkkyOutOrderPanel({
        groupKey: blockGroupKey(group.blockId, group.entryIds),
        title: `${group.blockName || group.blockId} — ${group.rank}位相当の同順位`,
        description:
          "セット勝・分・総得点が同数のためモルックアウト対象です。実施後、上位から順に並べて確定してください。",
        entries: group.entries.map((entry) => ({
          entryId: entry.entryId,
          teamName: entry.teamName,
        })),
        disabled: advancementFinalized || isSavingMolkkyOut,
      })
    )
    .join("");

  return `
    <div class="panel" style="margin-bottom: var(--space-lg);">
      <h3 class="panel__title">モルックアウト対象</h3>
      <p class="panel__desc">完全同値のチームは自動では順位を決めません。モルックアウト後に運営が順位を確定します。</p>
      ${panels}
    </div>
  `;
}

function renderStandingsView(standings, tournament) {
  currentStandings = standings;
  const tournamentName = tournament?.name || "（名称未設定）";
  standingsPageTitleEl.textContent = "予選順位表";
  standingsMetaEl.textContent = `${tournamentName} / ${standings.blocks.length} ブロック`;
  standingsBlocksEl.innerHTML = `
    ${renderMolkkyOutPanels(standings)}
    ${standings.blocks.map((block) => renderBlockStandings(block)).join("")}
  `;
}

function showPageError(message) {
  showFormAlert(document.getElementById("errorAlert"), message, "error");
  showView("error");
}

function setNavigationLinks() {
  const dashboardHref = buildTournamentDashboardHref(tournamentId);
  const scheduleHref = buildTournamentScheduleHref(tournamentId);
  const finalsHref = buildTournamentFinalsAdvancementHref(tournamentId);
  backToDashboardBtn.href = dashboardHref;
  openScheduleBtn.href = scheduleHref;
  if (openFinalsAdvancementBtn) {
    openFinalsAdvancementBtn.href = finalsHref;
  }
  emptyBackBtn.href = dashboardHref;
  emptyScheduleBtn.href = scheduleHref;
}

async function loadPage() {
  showView("loading");

  if (!isValidTournamentId(tournamentId)) {
    const { message } = classifyError(new InvalidTournamentIdError());
    showPageError(message);
    return;
  }

  setNavigationLinks();

  try {
    const [tournament, savedSchedule, advancement, bracket, resolutions, entries] =
      await Promise.all([
        getTournament(tournamentId),
        getQualifyingSchedule(tournamentId),
        getFinalsAdvancement(tournamentId),
        getFinalsBracket(tournamentId),
        getMolkkyOutResolutions(tournamentId),
        listEntries(tournamentId),
      ]);

    if (!savedSchedule?.finalized) {
      showView("empty");
      return;
    }

    advancementFinalized = advancement?.finalized === true;
    currentResolutions = resolutions;

    const teamNameLookup = buildEntryTeamNameLookup(entries);
    const liveSchedule = overlayEntryTeamNames(savedSchedule, teamNameLookup);
    const resultsMap = overlayEntryTeamNamesInMap(
      await getQualifyingMatchResults(tournamentId),
      teamNameLookup
    );
    const baseStandings = buildQualifyingStandings(liveSchedule, resultsMap);

    if (!baseStandings) {
      showView("empty");
      return;
    }

    const standings = applyMolkkyOutResolutions(baseStandings, resolutions);
    renderStandingsView(standings, tournament);
    updateFinalsNavigation(advancement, bracket);
    showView("standings");
  } catch (error) {
    const { message } = classifyError(error);
    showPageError(message);
  }
}

async function handleSaveBlockMolkkyOut(groupKey) {
  if (isSavingMolkkyOut || advancementFinalized) {
    return;
  }

  const groups = listUnresolvedBlockMolkkyOutGroups(currentStandings);
  const group = groups.find(
    (item) => blockGroupKey(item.blockId, item.entryIds) === groupKey
  );
  if (!group) {
    showErrorToast("対象の同順位グループが見つかりません。");
    return;
  }

  const orderedEntryIds = readMolkkyOutOrder(standingsBlocksEl, groupKey);
  isSavingMolkkyOut = true;

  try {
    currentResolutions = await upsertMolkkyOutResolution(tournamentId, {
      blockGroup: {
        blockId: group.blockId,
        entryIds: group.entryIds,
        orderedEntryIds,
      },
    });
    showToast("モルックアウト結果を保存しました。");
    await loadPage();
  } catch (error) {
    const { message } = classifyError(error);
    showErrorToast(message);
  } finally {
    isSavingMolkkyOut = false;
  }
}

function initConfigView() {
  showFormAlert(
    document.getElementById("configAlert"),
    "Firebase 設定が未入力です。js/firebase-config.js を設定してください。",
    "error"
  );
  showView("config");
}

function initAccessDeniedView() {
  showFormAlert(
    document.getElementById("operatorDeniedAlert"),
    "この大会を管理する権限がありません。",
    "warning"
  );
  showView("operatorDenied");
}

function initStandingsPage() {
  tournamentId = new URLSearchParams(window.location.search).get("id");

  standingsBlocksEl?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const moveBtn = target.closest("[data-molkky-move]");
    if (moveBtn instanceof HTMLElement) {
      const groupKey = moveBtn.getAttribute("data-group-key");
      const direction = moveBtn.getAttribute("data-molkky-move");
      const item = moveBtn.closest(".molkky-out-order__item");
      const entryId = item?.getAttribute("data-entry-id");
      if (groupKey && (direction === "up" || direction === "down") && entryId) {
        moveMolkkyOutOrderItem(standingsBlocksEl, groupKey, direction, entryId);
      }
      return;
    }

    const saveBtn = target.closest("[data-molkky-save]");
    if (saveBtn instanceof HTMLElement) {
      const groupKey = saveBtn.getAttribute("data-molkky-save");
      if (groupKey) {
        handleSaveBlockMolkkyOut(groupKey);
      }
    }
  });

  initTournamentManageGuard({
    tournamentId,
    onConfigRequired: initConfigView,
    onAccessDenied: initAccessDeniedView,
    onReady: () => {
      loadPage();
    },
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initStandingsPage);
} else {
  initStandingsPage();
}
