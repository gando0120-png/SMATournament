/**
 * 決勝進出ページ
 */
import { DEFAULT_FINAL_TEAM_COUNT, FinalsQualifierSource } from "../../domain/constants.js";
import { isValidTournamentId } from "../../domain/validators.js";
import { getTournament } from "../../services/tournament-service.js";
import { getQualifyingSchedule } from "../../services/qualifying-schedule-service.js";
import {
  getFinalsAdvancement,
  previewFinalsAdvancement,
  saveFinalsAdvancement,
} from "../../services/finals-advancement-service.js";
import { getFinalsBracket } from "../../services/finals-bracket-service.js";
import { initOperatorGuard } from "../../lib/operator-guard.js";
import {
  classifyError,
  InvalidTournamentIdError,
} from "../../lib/errors.js";
import { showErrorToast, showToast } from "../components/toast.js";
import { confirmDialog } from "../components/confirm-dialog.js";
import { showFormAlert } from "../components/form-errors.js";
import { warnSnapshotRebuildFailure } from "../../lib/public-snapshot-ui.js";

const views = {
  loading: document.getElementById("viewLoading"),
  config: document.getElementById("viewConfig"),
  operatorDenied: document.getElementById("viewOperatorDenied"),
  error: document.getElementById("viewError"),
  empty: document.getElementById("viewEmpty"),
  advancement: document.getElementById("viewAdvancement"),
};

const headerActions = document.getElementById("headerActions");
const backToDashboardBtn = document.getElementById("backToDashboardBtn");
const openStandingsBtn = document.getElementById("openStandingsBtn");
const openFinalsBracketHeaderBtn = document.getElementById("openFinalsBracketHeaderBtn");
const emptyScheduleBtn = document.getElementById("emptyScheduleBtn");
const advancementPageTitleEl = document.getElementById("advancementPageTitle");
const advancementMetaEl = document.getElementById("advancementMeta");
const finalizedBadgeEl = document.getElementById("finalizedBadge");
const completionAlertEl = document.getElementById("completionAlert");
const finalTeamCountLabelEl = document.getElementById("finalTeamCountLabel");
const qualifiersEmptyEl = document.getElementById("qualifiersEmpty");
const qualifiersBodyEl = document.getElementById("qualifiersBody");
const finalizePanelEl = document.getElementById("finalizePanel");
const finalizeAdvancementBtn = document.getElementById("finalizeAdvancementBtn");
const bracketLinkPanelEl = document.getElementById("bracketLinkPanel");
const bracketLinkDescEl = document.getElementById("bracketLinkDesc");
const openFinalsBracketBtn = document.getElementById("openFinalsBracketBtn");

let tournamentId = null;

function showView(name) {
  Object.entries(views).forEach(([key, el]) => {
    if (el) {
      el.classList.toggle("hidden", key !== name);
    }
  });
  if (headerActions) {
    headerActions.classList.toggle("hidden", name !== "advancement" && name !== "empty");
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

function buildTournamentScheduleHref(id) {
  return `tournament-schedule.html?id=${encodeURIComponent(id)}`;
}

function buildTournamentFinalsBracketHref(id) {
  return `tournament-finals-bracket.html?id=${encodeURIComponent(id)}`;
}

function formatSetWinRate(rate) {
  if (typeof rate !== "number" || Number.isNaN(rate)) {
    return "—";
  }
  return `${Math.round(rate * 1000) / 10}%`;
}

function formatQualifierSource(source) {
  if (source === FinalsQualifierSource.BLOCK_WINNER) {
    return "ブロック1位";
  }
  if (source === FinalsQualifierSource.WILDCARD) {
    return "成績上位";
  }
  return source ?? "—";
}

function renderQualifiersTable(qualifiers) {
  if (!qualifiers?.length) {
    qualifiersEmptyEl.classList.remove("hidden");
    qualifiersBodyEl.innerHTML = "";
    return;
  }

  qualifiersEmptyEl.classList.add("hidden");
  qualifiersBodyEl.innerHTML = qualifiers
    .map(
      (entry) => `
        <tr>
          <td class="standings-table__rank">${entry.seed}</td>
          <td class="standings-table__team">${escapeHtml(entry.teamName)}</td>
          <td>${escapeHtml(entry.blockName)}</td>
          <td class="standings-table__num">${entry.blockRank}</td>
          <td>${escapeHtml(formatQualifierSource(entry.source))}</td>
          <td class="standings-table__num">${entry.setWins}</td>
          <td class="standings-table__num">${entry.setDraws}</td>
          <td class="standings-table__num">${entry.setLosses}</td>
          <td class="standings-table__num">${formatSetWinRate(entry.setWinRate)}</td>
          <td class="standings-table__num">${entry.totalScore}</td>
        </tr>
      `
    )
    .join("");
}

function renderCompletionAlert(preview, { finalized }) {
  if (finalized || !preview) {
    completionAlertEl.classList.add("hidden");
    completionAlertEl.innerHTML = "";
    return;
  }

  if (preview.canFinalize) {
    completionAlertEl.classList.add("hidden");
    completionAlertEl.innerHTML = "";
    return;
  }

  const completion = preview.completion;
  const incompleteList = (completion.incompleteMatches ?? [])
    .slice(0, 5)
    .map(
      (match) =>
        `<li>${escapeHtml(match.blockName)} 第${match.roundNumber}節 ${match.courtNumber}コート：${escapeHtml(match.team1Name)} - ${escapeHtml(match.team2Name)}</li>`
    )
    .join("");

  const moreCount = Math.max(0, (completion.incompleteMatches?.length ?? 0) - 5);
  const moreLine = moreCount > 0 ? `<li>他 ${moreCount} 試合…</li>` : "";

  completionAlertEl.innerHTML = `
    <h3 class="panel__title">予選結果が未完了です</h3>
    <p class="panel__desc">${escapeHtml(preview.message ?? "")}</p>
    <p class="panel__desc">進捗：${completion.finishedMatches} / ${completion.totalMatches} 試合入力済み</p>
    ${incompleteList ? `<ul class="advancement-incomplete-list">${incompleteList}${moreLine}</ul>` : ""}
  `;
  completionAlertEl.classList.remove("hidden");
}

function renderAdvancementView(tournament, { preview, saved, finalized, bracket }) {
  const tournamentName = tournament?.name || "（名称未設定）";
  const finalTeamCount = saved?.finalTeamCount ?? preview?.selection?.finalTeamCount ?? DEFAULT_FINAL_TEAM_COUNT;

  advancementPageTitleEl.textContent = finalized ? "決勝進出（確定済み）" : "決勝進出（プレビュー）";
  advancementMetaEl.textContent = tournamentName;
  finalTeamCountLabelEl.textContent = String(finalTeamCount);
  finalizedBadgeEl.classList.toggle("hidden", !finalized);

  const qualifiers = saved?.qualifiers ?? preview?.selection?.qualifiers ?? [];
  renderQualifiersTable(qualifiers);
  renderCompletionAlert(preview, { finalized });

  finalizePanelEl.classList.toggle("hidden", finalized || !preview?.canFinalize);
  renderBracketLinkPanel(finalized, bracket);
}

function renderBracketLinkPanel(finalized, bracket) {
  if (!finalized) {
    bracketLinkPanelEl.classList.add("hidden");
    openFinalsBracketHeaderBtn.classList.add("hidden");
    return;
  }

  bracketLinkPanelEl.classList.remove("hidden");
  openFinalsBracketHeaderBtn.classList.remove("hidden");

  if (bracket?.finalized) {
    bracketLinkDescEl.textContent = "決勝トーナメント表は確定済みです。";
    openFinalsBracketBtn.textContent = "決勝トーナメントを見る";
    openFinalsBracketHeaderBtn.textContent = "決勝トーナメントを見る";
    return;
  }

  bracketLinkDescEl.textContent = "決勝進出確定後、シード配置でトーナメント表を作成できます。";
  openFinalsBracketBtn.textContent = "決勝トーナメントを作成";
  openFinalsBracketHeaderBtn.textContent = "決勝トーナメントを作成";
}

function showPageError(message) {
  showFormAlert(document.getElementById("errorAlert"), message, "error");
  showView("error");
}

function setNavigationLinks() {
  backToDashboardBtn.href = buildTournamentDashboardHref(tournamentId);
  openStandingsBtn.href = buildTournamentStandingsHref(tournamentId);
  emptyScheduleBtn.href = buildTournamentScheduleHref(tournamentId);
  const bracketHref = buildTournamentFinalsBracketHref(tournamentId);
  openFinalsBracketBtn.href = bracketHref;
  openFinalsBracketHeaderBtn.href = bracketHref;
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
    const [tournament, savedSchedule, savedAdvancement, savedBracket] = await Promise.all([
      getTournament(tournamentId),
      getQualifyingSchedule(tournamentId),
      getFinalsAdvancement(tournamentId),
      getFinalsBracket(tournamentId),
    ]);

    if (!savedSchedule?.finalized) {
      showView("empty");
      return;
    }

    const preview = await previewFinalsAdvancement(tournamentId, DEFAULT_FINAL_TEAM_COUNT);
    renderAdvancementView(tournament, {
      preview,
      saved: savedAdvancement,
      finalized: savedAdvancement?.finalized === true,
      bracket: savedBracket,
    });
    showView("advancement");
  } catch (error) {
    const { message } = classifyError(error);
    showPageError(message);
  }
}

async function handleFinalizeAdvancement() {
  const confirmed = await confirmDialog({
    title: "決勝進出の確定",
    message: `決勝進出 ${DEFAULT_FINAL_TEAM_COUNT} チームを確定しますか？\n\n確定後は今回のMVPでは組み直しできません。`,
    confirmLabel: "決勝進出を確定する",
    cancelLabel: "キャンセル",
  });

  if (!confirmed) {
    return;
  }

  finalizeAdvancementBtn.disabled = true;

  try {
    const result = await saveFinalsAdvancement(tournamentId, DEFAULT_FINAL_TEAM_COUNT);
    warnSnapshotRebuildFailure(result);
    showToast("決勝進出を確定しました。");
    await loadPage();
  } catch (error) {
    const { message } = classifyError(error);
    showErrorToast(message);
  } finally {
    finalizeAdvancementBtn.disabled = false;
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

function initOperatorDeniedView() {
  showFormAlert(
    document.getElementById("operatorDeniedAlert"),
    "運営者として登録されていません。",
    "warning"
  );
  showView("operatorDenied");
}

function initAdvancementPage() {
  tournamentId = new URLSearchParams(window.location.search).get("id");
  finalizeAdvancementBtn.addEventListener("click", handleFinalizeAdvancement);

  initOperatorGuard({
    onConfigRequired: initConfigView,
    onOperatorDenied: initOperatorDeniedView,
    onReady: () => {
      loadPage();
    },
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initAdvancementPage);
} else {
  initAdvancementPage();
}
