/**

 * 予選対戦表ページ

 */

import { EntryStatus } from "../../domain/constants.js";

import { isValidTournamentId } from "../../domain/validators.js";

import { buildQualifyingScheduleFromBlockDraw } from "../../domain/qualifying-schedule.js";

import { normalizeQualifyingScheduleForDisplay } from "../../domain/qualifying-schedule-persist.js";

import {

  mergeMatchResultsIntoSchedule,

  formatMatchResultSummary,

  buildMatchResultInitialValues,

} from "../../domain/qualifying-match-result.js";

import { getTournament } from "../../services/tournament-service.js";

import { listEntries } from "../../services/entry-service.js";

import { getBlockDraw } from "../../services/block-draw-service.js";

import { getFinalsAdvancement } from "../../services/finals-advancement-service.js";

import { isQualifyingResultsLocked } from "../../lib/qualifying-results-lock.js";

import {

  getQualifyingSchedule,

  saveQualifyingSchedule,

} from "../../services/qualifying-schedule-service.js";

import {
  getQualifyingMatchResults,
  saveQualifyingMatchResult,
} from "../../services/qualifying-match-result-service.js";
import {
  listMatchReconciliations,
  markReconciliationOperatorResolved,
} from "../../services/player-qualifying-result-service.js";
import {
  getOperatorReconciliationLabel,
  MatchReconciliationState,
} from "../../domain/player-qualifying-submission.js";
import { initTournamentManageGuard } from "../../lib/operator-guard.js";
import {

  classifyError,

  InvalidTournamentIdError,

} from "../../lib/errors.js";

import { showErrorToast, showToast } from "../components/toast.js";

import { confirmDialog } from "../components/confirm-dialog.js";

import { matchResultDialog } from "../components/match-result-dialog.js";

import { showFormAlert } from "../components/form-errors.js";
import { warnSnapshotRebuildFailure } from "../../lib/public-snapshot-ui.js";



const views = {

  loading: document.getElementById("viewLoading"),

  config: document.getElementById("viewConfig"),

  operatorDenied: document.getElementById("viewOperatorDenied"),

  error: document.getElementById("viewError"),

  empty: document.getElementById("viewEmpty"),

  schedule: document.getElementById("viewSchedule"),

};



const headerActions = document.getElementById("headerActions");

const backToDashboardBtn = document.getElementById("backToDashboardBtn");

const openStandingsBtn = document.getElementById("openStandingsBtn");

const emptyBackBtn = document.getElementById("emptyBackBtn");

const schedulePageTitleEl = document.getElementById("schedulePageTitle");

const scheduleMetaEl = document.getElementById("scheduleMeta");

const finalizedBadgeEl = document.getElementById("finalizedBadge");

const scheduleUnsupportedAlertEl = document.getElementById("scheduleUnsupportedAlert");

const scheduleResultsLockedAlertEl = document.getElementById("scheduleResultsLockedAlert");

const scheduleBlocksEl = document.getElementById("scheduleBlocks");

const finalizePanelEl = document.getElementById("finalizePanel");

const finalizeScheduleBtn = document.getElementById("finalizeScheduleBtn");



let tournamentId = null;

let currentTournament = null;

let currentBlockDraw = null;

let previewSchedule = null;

let currentDisplaySchedule = null;

let currentBaseSchedule = null;

let matchResultsMap = new Map();

let reconciliationByMatchId = new Map();

let isScheduleFinalized = false;

let qualifyingResultsLocked = false;



function showView(name) {

  Object.entries(views).forEach(([key, el]) => {

    if (el) {

      el.classList.toggle("hidden", key !== name);

    }

  });

  if (headerActions) {

    headerActions.classList.toggle("hidden", name !== "schedule" && name !== "empty");

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



function buildTournamentStandingsHref(id) {

  return `tournament-standings.html?id=${encodeURIComponent(id)}`;

}



function buildTournamentMatchHref(id, matchId) {

  return `tournament-match.html?id=${encodeURIComponent(id)}&matchId=${encodeURIComponent(matchId)}`;

}



function renderTeamLegend(teams) {

  return teams

    .map((team) => `<li><strong>${escapeHtml(team.symbol)}</strong>：${escapeHtml(team.teamName)}</li>`)

    .join("");

}



function renderMatchOpenLink(match) {

  return `<a href="${buildTournamentMatchHref(tournamentId, match.matchId)}" class="btn btn--ghost btn--compact">試合を開く</a>`;

}



function renderMatchResultSection(match, { qualifyingResultsLocked: locked }) {

  const result = match.result;

  const openLink = renderMatchOpenLink(match);

  const reconciliation = reconciliationByMatchId.get(match.matchId);

  const submissionLabel = reconciliation
    ? getOperatorReconciliationLabel(reconciliation.state, {
        team1Submitted: reconciliation.team1Submitted,
        team2Submitted: reconciliation.team2Submitted,
        team1Name: reconciliation.team1?.teamName,
        team2Name: reconciliation.team2?.teamName,
      })
    : null;

  const submissionBadge = submissionLabel
    ? `<p class="panel__desc" style="margin-top: var(--space-xs);">提出: ${escapeHtml(submissionLabel)}</p>`
    : "";

  const conflictDetail =
    reconciliation?.state === MatchReconciliationState.CONFLICT &&
    reconciliation.team1Scores &&
    reconciliation.team2Scores
      ? `<p class="form-alert form-alert--warning">A提出: ${escapeHtml(JSON.stringify(reconciliation.team1Scores))} / B提出: ${escapeHtml(JSON.stringify(reconciliation.team2Scores))}</p>`
      : "";

  if (result?.status === "finished") {

    const { team1Line, team2Line } = formatMatchResultSummary(match, result);

    const editButton = locked
      ? ""
      : `<button type="button" class="btn btn--ghost btn--compact" data-action="edit-result" data-match-id="${escapeHtml(match.matchId)}">結果を修正</button>`;

    return `

      <div class="schedule-match__result">

        ${openLink}

        <span class="status-badge" data-status="confirmed">終了</span>

        <div class="schedule-match__stats">

          <p class="schedule-match__team-stats">${escapeHtml(team1Line)}</p>

          <p class="schedule-match__team-stats">${escapeHtml(team2Line)}</p>

        </div>

        ${submissionBadge}

        ${editButton}

      </div>

    `;

  }



  if (locked) {

    return `

      <div class="schedule-match__result">

        ${openLink}

        <span class="status-badge" data-status="draft">未入力</span>

        ${submissionBadge}

      </div>

    `;

  }



  return `

    <div class="schedule-match__result">

      ${openLink}

      <button type="button" class="btn btn--primary btn--compact" data-action="enter-result" data-match-id="${escapeHtml(match.matchId)}">結果入力</button>

      ${submissionBadge}

      ${conflictDetail}

    </div>

  `;

}



function renderRound(round, { showResultControls, qualifyingResultsLocked: locked }) {

  const matchLines = round.matches

    .map((match) => {

      const resultSection = showResultControls
        ? renderMatchResultSection(match, { qualifyingResultsLocked: locked })
        : "";

      return `

        <li class="schedule-match" data-match-id="${escapeHtml(match.matchId)}">

          <span class="schedule-match__court">${match.court}コート</span>

          <span class="schedule-match__teams">${escapeHtml(match.homeTeamName)} - ${escapeHtml(match.awayTeamName)}</span>

          ${resultSection}

        </li>

      `;

    })

    .join("");



  const byeLines = round.byes

    .map((bye) => `<li class="schedule-bye">休み：${escapeHtml(bye.teamName)}</li>`)

    .join("");



  return `

    <article class="schedule-round">

      <h4 class="schedule-round__title">第${round.roundNumber}節</h4>

      <ul class="schedule-round__list">

        ${matchLines}

        ${byeLines}

      </ul>

    </article>

  `;

}



function renderBlockSchedule(block, { showResultControls, qualifyingResultsLocked: locked }) {

  if (!block.supported) {

    return `

      <section class="panel schedule-block" style="margin-bottom: var(--space-lg);">

        <h3 class="panel__title">${escapeHtml(block.blockName)}</h3>

        <p class="panel__desc">${block.teamCount}チーム — 3〜8チームの範囲外のため対戦表を生成できません。</p>

      </section>

    `;

  }



  const courtLabel = block.courtNumbers.join("・");



  return `

    <section class="panel schedule-block" style="margin-bottom: var(--space-lg);">

      <h3 class="panel__title">${escapeHtml(block.blockName)}</h3>

      <p class="panel__desc schedule-block__courts">使用コート：${escapeHtml(courtLabel)}</p>

      <div class="schedule-legend">

        <p class="schedule-legend__title">チーム記号</p>

        <ul class="schedule-legend__list">${renderTeamLegend(block.teams)}</ul>

      </div>

      <div class="schedule-rounds">

        ${block.rounds.map((round) => renderRound(round, { showResultControls, qualifyingResultsLocked: locked })).join("")}

      </div>

    </section>

  `;

}



function countScheduleMatches(schedule) {

  return schedule.blocks.reduce(

    (total, block) =>

      total +

      block.rounds.reduce((roundTotal, round) => roundTotal + round.matches.length, 0),

    0

  );

}



function findMatchInSchedule(schedule, matchId) {

  for (const block of schedule.blocks) {

    for (const round of block.rounds) {

      const match = round.matches.find((item) => item.matchId === matchId);

      if (match) {

        return match;

      }

    }

  }

  return null;

}



function renderScheduleView(schedule, { finalized, qualifyingResultsLocked: locked = false }) {

  isScheduleFinalized = finalized;

  qualifyingResultsLocked = locked;

  currentDisplaySchedule = schedule;



  schedulePageTitleEl.textContent = finalized ? "予選対戦表" : "対戦表プレビュー";

  finalizedBadgeEl.classList.toggle("hidden", !finalized);

  finalizePanelEl.classList.toggle("hidden", finalized);

  if (scheduleResultsLockedAlertEl) {
    scheduleResultsLockedAlertEl.classList.toggle("hidden", !finalized || !locked);
  }

  if (openStandingsBtn) {
    openStandingsBtn.classList.toggle("hidden", !finalized);
    if (finalized && tournamentId) {
      openStandingsBtn.href = buildTournamentStandingsHref(tournamentId);
    }
  }



  const tournamentName = currentTournament?.name || "（名称未設定）";

  const totalMatchCount = schedule.totalMatchCount ?? countScheduleMatches(schedule);

  const matchInfo = totalMatchCount ? ` / 試合数 ${totalMatchCount}` : "";

  scheduleMetaEl.textContent = `${tournamentName} / 予選総当たり / ${schedule.blocks.length} ブロック / 使用コート数 ${schedule.totalCourtsUsed}${matchInfo}`;



  scheduleUnsupportedAlertEl.classList.toggle("hidden", !schedule.hasUnsupportedBlock);

  scheduleBlocksEl.innerHTML = schedule.blocks

    .map((block) =>
      renderBlockSchedule(block, {
        showResultControls: finalized,
        qualifyingResultsLocked: locked,
      })
    )

    .join("");

}



function showPageError(message) {

  showFormAlert(document.getElementById("errorAlert"), message, "error");

  showView("error");

}



async function openMatchResultInput(matchId) {

  if (!currentDisplaySchedule || !isScheduleFinalized) {

    return;

  }

  if (qualifyingResultsLocked) {

    showErrorToast("決勝進出チームが確定済みのため、予選結果は修正できません。");

    return;

  }



  const match = findMatchInSchedule(currentDisplaySchedule, matchId);

  if (!match) {

    showErrorToast("試合が見つかりません。");

    return;

  }



  const existingResult = match.result;

  const isEdit = existingResult?.status === "finished";



  await matchResultDialog({

    title: isEdit ? "試合結果の修正" : "試合結果の入力",

    team1Name: match.homeTeamName,

    team2Name: match.awayTeamName,

    initialValues: isEdit ? buildMatchResultInitialValues(existingResult) : {},

    submitLabel: isEdit ? "結果を更新" : "結果を保存",

    onSubmit: async (values) => {

      try {

        const saved = await saveQualifyingMatchResult(tournamentId, matchId, values);

        warnSnapshotRebuildFailure(saved);

        try {
          await markReconciliationOperatorResolved(tournamentId, matchId);
        } catch (markError) {
          console.warn("[schedule] mark reconciliation failed", markError);
        }

        matchResultsMap.set(matchId, saved);

        await refreshReconciliations();

        const merged = mergeMatchResultsIntoSchedule(currentBaseSchedule, matchResultsMap);

        renderScheduleView(merged, {
          finalized: true,
          qualifyingResultsLocked,
        });

        showToast(isEdit ? "試合結果を更新しました。" : "試合結果を保存しました。");

      } catch (error) {

        const { message } = classifyError(error);

        throw new Error(message);

      }

    },

  });

}



function handleScheduleBlocksClick(event) {

  const button = event.target.closest("[data-action]");

  if (!button) {

    return;

  }



  const action = button.dataset.action;

  if (action !== "enter-result" && action !== "edit-result") {

    return;

  }



  if (qualifyingResultsLocked) {

    showErrorToast("決勝進出チームが確定済みのため、予選結果は修正できません。");

    return;

  }



  const matchId = button.dataset.matchId;

  if (!matchId) {

    return;

  }



  openMatchResultInput(matchId);

}



async function refreshReconciliations() {
  reconciliationByMatchId = new Map();
  if (!currentTournament?.participantResultEntryEnabled) {
    return;
  }
  try {
    const data = await listMatchReconciliations(tournamentId);
    for (const match of data.matches || []) {
      reconciliationByMatchId.set(match.matchId, match);
    }
  } catch (error) {
    console.warn("[schedule] listMatchReconciliations failed", error);
  }
}

async function loadPage() {

  showView("loading");



  if (!isValidTournamentId(tournamentId)) {

    const { message } = classifyError(new InvalidTournamentIdError());

    showPageError(message);

    return;

  }



  const dashboardHref = buildTournamentDashboardHref(tournamentId);

  backToDashboardBtn.href = dashboardHref;

  emptyBackBtn.href = dashboardHref;



  try {

    const [tournament, blockDraw, entries, savedSchedule, finalsAdvancement] =
      await Promise.all([
      getTournament(tournamentId),

      getBlockDraw(tournamentId),

      listEntries(tournamentId),

      getQualifyingSchedule(tournamentId),

      getFinalsAdvancement(tournamentId),

    ]);



    currentTournament = tournament;

    currentBlockDraw = blockDraw;

    const resultsLocked = isQualifyingResultsLocked(finalsAdvancement);



    if (!blockDraw || !Array.isArray(blockDraw.blocks) || blockDraw.blocks.length === 0) {

      showView("empty");

      return;

    }



    if (savedSchedule?.finalized) {

      matchResultsMap = await getQualifyingMatchResults(tournamentId);

      await refreshReconciliations();

      currentBaseSchedule = normalizeQualifyingScheduleForDisplay(savedSchedule);

      const schedule = mergeMatchResultsIntoSchedule(currentBaseSchedule, matchResultsMap);

      renderScheduleView(schedule, {
        finalized: true,
        qualifyingResultsLocked: resultsLocked,
      });

      showView("schedule");

      return;

    }



    matchResultsMap = new Map();

    currentBaseSchedule = null;

    const confirmedEntries = entries.filter((entry) => entry.status === EntryStatus.CONFIRMED);

    previewSchedule = buildQualifyingScheduleFromBlockDraw(blockDraw, confirmedEntries);

    renderScheduleView(previewSchedule, {
      finalized: false,
      qualifyingResultsLocked: resultsLocked,
    });

    showView("schedule");

  } catch (error) {

    const { message } = classifyError(error);

    showPageError(message);

  }

}



async function handleFinalizeSchedule() {

  if (!previewSchedule) {

    return;

  }



  const confirmed = await confirmDialog({

    title: "対戦表の確定",

    message: "この対戦表を確定しますか？\n\n確定後は今回のSprintでは組み直しできません。",

    confirmLabel: "対戦表を確定する",

    cancelLabel: "キャンセル",

  });



  if (!confirmed) {

    return;

  }



  finalizeScheduleBtn.disabled = true;



  try {

    const saved = await saveQualifyingSchedule(tournamentId);
    warnSnapshotRebuildFailure(saved);

    matchResultsMap = await getQualifyingMatchResults(tournamentId);

    currentBaseSchedule = normalizeQualifyingScheduleForDisplay(saved);

    const schedule = mergeMatchResultsIntoSchedule(currentBaseSchedule, matchResultsMap);

    previewSchedule = null;

    const finalsAdvancement = await getFinalsAdvancement(tournamentId);

    renderScheduleView(schedule, {
      finalized: true,
      qualifyingResultsLocked: isQualifyingResultsLocked(finalsAdvancement),
    });

    showToast("予選対戦表を確定しました。");

  } catch (error) {

    const { message } = classifyError(error);

    showErrorToast(message);

    finalizeScheduleBtn.disabled = false;

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



function initSchedulePage() {

  tournamentId = new URLSearchParams(window.location.search).get("id");

  finalizeScheduleBtn.addEventListener("click", handleFinalizeSchedule);

  scheduleBlocksEl.addEventListener("click", handleScheduleBlocksClick);



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

  document.addEventListener("DOMContentLoaded", initSchedulePage);

} else {

  initSchedulePage();

}

