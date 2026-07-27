/**
 * 大会管理ダッシュボード
 */
import {
  TournamentStatus,
  EntryStatus,
  getTournamentStatusLabel,
} from "../../domain/constants.js";
import {
  resolveTournamentFormat,
  TournamentFormat,
  resolveFinalQualifierCount,
  usesNewFixedBlockDraw,
} from "../../domain/tournament-format.js";
import { buildBlockDrawPreviewMessage } from "../../domain/fixed-block-draw.js";
import {
  moveEntryBetweenBlocks,
  swapEntriesBetweenBlocks,
  formatBlockSizeImbalanceWarning,
  formatBlockSizeImbalanceConfirmMessage,
  validateEditableBlockDraw,
} from "../../domain/block-draw-edit.js";
import {
  isBlockDrawDraft,
  isBlockDrawFinalized,
} from "../../domain/block-draw-state.js";
import { blockCountChangeRequiresDraftDiscard } from "../../domain/block-count-lock.js";
import {
  updateTournamentStatus,
  updateTournamentPublicView,
} from "../../services/tournament-service.js";
import { rebuildPublicTournamentSnapshot } from "../../services/public-tournament-snapshot-service.js";
import { warnSnapshotRebuildFailure } from "../../lib/public-snapshot-ui.js";
import { listEntries } from "../../services/entry-service.js";
import {
  getBlockDraw,
  runBlockDraw,
  redrawBlockDrawDraft,
  updateBlockDrawDraftBlocks,
  finalizeBlockDraw,
  changeBlockCountDiscardingDraft,
  updateQualifiersPerBlockSetting,
} from "../../services/block-draw-service.js";
import { getQualifyingSchedule, saveQualifyingSchedule } from "../../services/qualifying-schedule-service.js";
import { getFinalsAdvancement } from "../../services/finals-advancement-service.js";
import { getFinalsBracket } from "../../services/finals-bracket-service.js";
import { getFinalsMatchResults } from "../../services/finals-match-result-service.js";
import {
  getTournamentResults,
} from "../../services/tournament-results-service.js";
import { validateTournamentCompletion, getTournamentResultParticipants } from "../../domain/tournament-results.js";
import {
  resolveSingleEliminationBracketSize,
} from "../../domain/single-elimination-bracket.js";
import { createSingleEliminationBracket } from "../../services/single-elimination-bracket-service.js";
import { isPublicViewEnabled } from "../../domain/public-tournament-view.js";
import { initTournamentManageGuard } from "../../lib/operator-guard.js";
import {
  classifyError,
  InvalidTournamentIdError,
} from "../../lib/errors.js";
import { showErrorToast, showToast } from "../components/toast.js";
import { confirmDialog } from "../components/confirm-dialog.js";
import { showFormAlert } from "../components/form-errors.js";
import {
  runDashboardFirestoreProbe,
  logDashboardFailureContext,
} from "../../lib/dashboard-load-probe.js";

const views = {
  loading: document.getElementById("viewLoading"),
  config: document.getElementById("viewConfig"),
  operatorDenied: document.getElementById("viewOperatorDenied"),
  error: document.getElementById("viewError"),
  deleted: document.getElementById("viewDeleted"),
  dashboard: document.getElementById("viewDashboard"),
};

const headerActions = document.getElementById("headerActions");
const tournamentNameEl = document.getElementById("tournamentName");
const tournamentMetaEl = document.getElementById("tournamentMeta");
const statusBadgeEl = document.getElementById("statusBadge");
const tournamentInfoEl = document.getElementById("tournamentInfo");
const entryUrlEl = document.getElementById("entryUrl");
const copyUrlBtn = document.getElementById("copyUrlBtn");
const publicPageUrlEl = document.getElementById("publicPageUrl");
const copyPublicUrlBtn = document.getElementById("copyPublicUrlBtn");
const openPublicPageBtn = document.getElementById("openPublicPageBtn");
const publicPageDescEl = document.getElementById("publicPageDesc");
const publicViewSelectEl = document.getElementById("publicViewSelect");
const rebuildPublicSnapshotBtn = document.getElementById("rebuildPublicSnapshotBtn");
const openEntryBtn = document.getElementById("openEntryBtn");
const openEntryDescEl = document.getElementById("openEntryDesc");
const entryTotalCountEl = document.getElementById("entryTotalCount");
const entryPendingCountEl = document.getElementById("entryPendingCount");
const entryConfirmedCountEl = document.getElementById("entryConfirmedCount");
const entryMaxTeamsEl = document.getElementById("entryMaxTeams");
const openEntriesManageBtn = document.getElementById("openEntriesManageBtn");
const blockDrawBtn = document.getElementById("blockDrawBtn");
const blockDrawDescEl = document.getElementById("blockDrawDesc");
const blockDrawEmptyEl = document.getElementById("blockDrawEmpty");
const blockDrawDraftBannerEl = document.getElementById("blockDrawDraftBanner");
const qualifyingScheduleRecoveryPanelEl = document.getElementById("qualifyingScheduleRecoveryPanel");
const retryQualifyingScheduleBtn = document.getElementById("retryQualifyingScheduleBtn");
const blockDrawDraftWarningEl = document.getElementById("blockDrawDraftWarning");
const blockDrawResultsEl = document.getElementById("blockDrawResults");
const blockDrawDraftControlsEl = document.getElementById("blockDrawDraftControls");
const moveEntrySelectEl = document.getElementById("moveEntrySelect");
const moveTargetBlockSelectEl = document.getElementById("moveTargetBlockSelect");
const moveEntryBtn = document.getElementById("moveEntryBtn");
const swapEntryASelectEl = document.getElementById("swapEntryASelect");
const swapEntryBSelectEl = document.getElementById("swapEntryBSelect");
const swapEntriesBtn = document.getElementById("swapEntriesBtn");
const blockDrawFinalizeBtn = document.getElementById("blockDrawFinalizeBtn");
const newFormatSettingsPanelEl = document.getElementById("newFormatSettingsPanel");
const newFormatBlockCountSelectEl = document.getElementById("newFormatBlockCountSelect");
const newFormatQualifiersSelectEl = document.getElementById("newFormatQualifiersSelect");
const saveNewFormatSettingsBtn = document.getElementById("saveNewFormatSettingsBtn");
const qualifyingFlowPanelEl = document.getElementById("qualifyingFlowPanel");
const finalsAdvancementPanelEl = document.getElementById("finalsAdvancementPanel");
const newFormatNoticePanelEl = document.getElementById("newFormatNoticePanel");
const newFormatNoticeDescEl = document.getElementById("newFormatNoticeDesc");
const openScheduleBtn = document.getElementById("openScheduleBtn");
const openStandingsBtn = document.getElementById("openStandingsBtn");
const openFinalsAdvancementBtn = document.getElementById("openFinalsAdvancementBtn");
const openFinalsAdvancementPrimaryBtn = document.getElementById("openFinalsAdvancementPrimaryBtn");
const finalsBracketDescEl = document.getElementById("finalsBracketDesc");
const finalsBracketPanelEl = document.getElementById("finalsBracketPanel");
const openFinalsBracketPrimaryBtn = document.getElementById("openFinalsBracketPrimaryBtn");
const singleElimPanelEl = document.getElementById("singleElimPanel");
const singleElimDescEl = document.getElementById("singleElimDesc");
const singleElimStatsEl = document.getElementById("singleElimStats");
const singleElimErrorEl = document.getElementById("singleElimError");
const createSingleElimBracketBtn = document.getElementById("createSingleElimBracketBtn");
const openSingleElimBracketBtn = document.getElementById("openSingleElimBracketBtn");
const closedSummaryPanelEl = document.getElementById("closedSummaryPanel");
const closedSummaryLineEl = document.getElementById("closedSummaryLine");
const openTournamentResultsBtn = document.getElementById("openTournamentResultsBtn");
const finalizeResultsPanelEl = document.getElementById("finalizeResultsPanel");
const openFinalizeResultsBtn = document.getElementById("openFinalizeResultsBtn");
const dashboardOperationsEl = document.getElementById("dashboardOperations");
const closedViewLinksPanelEl = document.getElementById("closedViewLinksPanel");
const closedEntriesBtn = document.getElementById("closedEntriesBtn");
const closedScheduleBtn = document.getElementById("closedScheduleBtn");
const closedStandingsBtn = document.getElementById("closedStandingsBtn");
const closedFinalsBracketBtn = document.getElementById("closedFinalsBracketBtn");
const closedResultsBtn = document.getElementById("closedResultsBtn");

const LOG_PREFIX = "[dashboard]";

let tournamentId = null;
let currentTournament = null;
let currentEntries = [];
let currentBlockDraw = null;
let currentQualifyingSchedule = null;

function showView(name) {
  Object.entries(views).forEach(([key, el]) => {
    if (el) {
      el.classList.toggle("hidden", key !== name);
    }
  });
  if (headerActions) {
    headerActions.classList.toggle("hidden", name !== "dashboard");
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatTimestamp(value) {
  if (!value) {
    return "—";
  }
  const date = typeof value.toDate === "function" ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return date.toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildPublicPageUrl(id) {
  const url = new URL("tournament-public.html", window.location.href);
  url.searchParams.set("id", id);
  return url.href;
}

function buildEntryUrl(id) {
  const url = new URL("entry.html", window.location.href);
  url.searchParams.set("id", id);
  return url.href;
}

function renderInfoRow(label, value) {
  return `
    <div class="info-list__row">
      <dt>${escapeHtml(label)}</dt>
      <dd>${escapeHtml(value)}</dd>
    </div>
  `;
}

function getTournamentFormatLabel(tournament) {
  const format = resolveTournamentFormat(tournament);
  if (format === TournamentFormat.SINGLE_ELIMINATION) {
    return "一発トーナメント";
  }
  if (tournament?.tournamentFormat === TournamentFormat.QUALIFYING_AND_FINALS) {
    return "予選＋決勝";
  }
  return "予選＋決勝（従来形式）";
}

function isLegacyTournament(tournament) {
  return !tournament?.tournamentFormat;
}

function updateFormatSpecificPanels(tournament) {
  const format = resolveTournamentFormat(tournament);
  const isNewQualifying = tournament?.tournamentFormat === TournamentFormat.QUALIFYING_AND_FINALS;
  const isSingleElim = format === TournamentFormat.SINGLE_ELIMINATION;

  qualifyingFlowPanelEl?.classList.toggle("hidden", isSingleElim);
  finalsAdvancementPanelEl?.classList.toggle("hidden", isSingleElim);
  finalsBracketPanelEl?.classList.toggle("hidden", isSingleElim);
  singleElimPanelEl?.classList.toggle("hidden", !isSingleElim);

  if (newFormatNoticePanelEl) {
    newFormatNoticePanelEl.classList.toggle("hidden", isLegacyTournament(tournament));
  }

  if (newFormatNoticeDescEl) {
    if (isSingleElim) {
      newFormatNoticeDescEl.textContent =
        "一発トーナメント形式です。確定エントリーから直接トーナメント表を作成し、試合を進行できます。";
    } else if (isNewQualifying) {
      newFormatNoticeDescEl.textContent =
        "新しい予選＋決勝形式です。ブロック抽選後、配置を確認してブロック確定すると予選対戦表を作成できます。";
    }
  }

  if (blockDrawBtn && (isNewQualifying || isSingleElim)) {
    blockDrawBtn.disabled = isSingleElim;
  }
}

function renderTournament(tournament) {
  currentTournament = tournament;
  const statusLabel = getTournamentStatusLabel(tournament.status);

  tournamentNameEl.textContent = tournament.name || "（名称未設定）";
  tournamentMetaEl.textContent = `開催日: ${tournament.eventDate || "—"} / 会場: ${tournament.venue || "—"}`;
  statusBadgeEl.textContent = statusLabel;
  statusBadgeEl.dataset.status = tournament.status || "";

  const infoRows = [
    renderInfoRow("大会名", tournament.name || "—"),
    renderInfoRow("開催日", tournament.eventDate || "—"),
    renderInfoRow("会場", tournament.venue || "—"),
    renderInfoRow("エントリー締切", formatTimestamp(tournament.entryDeadline)),
    renderInfoRow("募集チーム数", String(tournament.maxTeams ?? "—")),
    renderInfoRow("1チームの人数", String(tournament.teamSize ?? "—")),
    renderInfoRow("使用コート数", String(tournament.courtCount ?? "—")),
    renderInfoRow("大会形式", getTournamentFormatLabel(tournament)),
  ];

  if (tournament.tournamentFormat === TournamentFormat.QUALIFYING_AND_FINALS) {
    infoRows.push(renderInfoRow("ブロック数", String(tournament.blockCount ?? "—")));
    infoRows.push(
      renderInfoRow("各ブロック通過数", String(tournament.qualifiersPerBlock ?? "—"))
    );
    const qualifierCount = resolveFinalQualifierCount({
      tournament,
      teamCount: tournament.maxTeams,
    });
    infoRows.push(renderInfoRow("決勝進出予定数", String(qualifierCount ?? "—")));
  } else if (isLegacyTournament(tournament)) {
    infoRows.push(renderInfoRow("ブロック基本人数", String(tournament.preferredBlockSize ?? "—")));
  }

  infoRows.push(renderInfoRow("状態", statusLabel));

  if (tournament.status === TournamentStatus.CLOSED && tournament.closedAt) {
    infoRows.push(renderInfoRow("終了日時", formatTimestamp(tournament.closedAt)));
  }

  tournamentInfoEl.innerHTML = infoRows.join("");

  entryUrlEl.value = buildEntryUrl(tournament.id);

  if (publicPageUrlEl) {
    publicPageUrlEl.value = buildPublicPageUrl(tournament.id);
  }
  if (openPublicPageBtn) {
    openPublicPageBtn.href = buildPublicPageUrl(tournament.id);
  }
  if (publicPageDescEl) {
    publicPageDescEl.textContent = isPublicViewEnabled(tournament)
      ? "プレイヤー向けの大会閲覧ページ URL です。ログイン不要で閲覧できます。"
      : "現在、公開ページは停止中です。";
  }
  if (publicViewSelectEl) {
    publicViewSelectEl.value = isPublicViewEnabled(tournament) ? "true" : "false";
  }
  if (openPublicPageBtn) {
    openPublicPageBtn.classList.toggle("hidden", !isPublicViewEnabled(tournament));
  }

  const isDraft = tournament.status === TournamentStatus.DRAFT;
  const isOpen = tournament.status === TournamentStatus.OPEN;

  if (isDraft) {
    openEntryBtn?.classList.remove("hidden");
    if (openEntryBtn) openEntryBtn.disabled = false;
    if (openEntryDescEl) {
      openEntryDescEl.textContent =
        "下書き状態です。「エントリー受付を開始」で公開受付を開始します。";
    }
  } else if (isOpen) {
    openEntryBtn?.classList.add("hidden");
    if (openEntryDescEl) {
      openEntryDescEl.textContent = "エントリー受付中です。公開 URL から申込を受け付けられます。";
    }
  } else {
    openEntryBtn?.classList.add("hidden");
    if (openEntryDescEl) {
      openEntryDescEl.textContent = `現在の状態: ${statusLabel}`;
    }
  }

  updateFormatSpecificPanels(tournament);
}

function buildTournamentEntriesHref(id) {
  return `tournament-entries.html?id=${encodeURIComponent(id)}`;
}

function buildTournamentScheduleHref(id) {
  return `tournament-schedule.html?id=${encodeURIComponent(id)}`;
}

function buildTournamentStandingsHref(id) {
  return `tournament-standings.html?id=${encodeURIComponent(id)}`;
}

function buildTournamentResultsHref(id) {
  return `tournament-results.html?id=${encodeURIComponent(id)}`;
}

function buildTournamentFinalsAdvancementHref(id) {
  return `tournament-finals-advancement.html?id=${encodeURIComponent(id)}`;
}

function buildTournamentFinalsBracketHref(id) {
  return `tournament-finals-bracket.html?id=${encodeURIComponent(id)}`;
}

function setTournamentNavigationLinks() {
  if (!isValidTournamentId(tournamentId)) {
    return;
  }
  const scheduleHref = buildTournamentScheduleHref(tournamentId);
  const standingsHref = buildTournamentStandingsHref(tournamentId);
  const finalsHref = buildTournamentFinalsAdvancementHref(tournamentId);
  const bracketHref = buildTournamentFinalsBracketHref(tournamentId);
  if (openScheduleBtn) openScheduleBtn.href = scheduleHref;
  if (openStandingsBtn) openStandingsBtn.href = standingsHref;
  if (openFinalsAdvancementBtn) openFinalsAdvancementBtn.href = finalsHref;
  if (openFinalsAdvancementPrimaryBtn) openFinalsAdvancementPrimaryBtn.href = finalsHref;
  if (openFinalsBracketPrimaryBtn) openFinalsBracketPrimaryBtn.href = bracketHref;
}

function setClosedViewLinks() {
  if (!isValidTournamentId(tournamentId)) {
    return;
  }
  closedEntriesBtn.href = buildTournamentEntriesHref(tournamentId);
  closedScheduleBtn.href = buildTournamentScheduleHref(tournamentId);
  closedStandingsBtn.href = buildTournamentStandingsHref(tournamentId);
  closedFinalsBracketBtn.href = buildTournamentFinalsBracketHref(tournamentId);
  closedResultsBtn.href = buildTournamentResultsHref(tournamentId);
  openTournamentResultsBtn.href = buildTournamentResultsHref(tournamentId);
  openFinalizeResultsBtn.href = buildTournamentResultsHref(tournamentId);
}

function renderDashboardLifecycle(tournament, savedResults, completionPreview) {
  const isClosed = tournament.status === TournamentStatus.CLOSED;
  const isOpen = tournament.status === TournamentStatus.OPEN;
  const canFinalize = isOpen && completionPreview?.canFinalize && !savedResults?.finalized;

  closedSummaryPanelEl.classList.toggle("hidden", !isClosed);
  finalizeResultsPanelEl.classList.toggle("hidden", !canFinalize);
  dashboardOperationsEl.classList.toggle("hidden", isClosed);
  document.querySelectorAll("[data-hide-when-closed]").forEach((el) => {
    el.classList.toggle("hidden", isClosed);
  });
  closedViewLinksPanelEl.classList.toggle("hidden", !isClosed);

  if (isClosed) {
    const championName =
      savedResults?.champion?.teamName ??
      completionPreview?.champion?.teamName ??
      "—";
    closedSummaryLineEl.textContent = `優勝：${championName}`;
    setClosedViewLinks();
    return;
  }

  if (canFinalize) {
    const championName = completionPreview.champion?.teamName ?? "—";
    const runnerUpName = completionPreview.runnerUp?.teamName ?? "—";
    document.getElementById("finalizeResultsDesc").textContent =
      `決勝戦が終了しました（優勝：${championName} / 準優勝：${runnerUpName}）。大会結果を確定してください。`;
    openFinalizeResultsBtn.href = buildTournamentResultsHref(tournamentId);
  }
}

function renderSingleElimPanel(tournament, entries, bracket) {
  if (!singleElimPanelEl) {
    return;
  }

  const confirmedCount = getConfirmedEntries(entries).length;
  const sizeResult = resolveSingleEliminationBracketSize(confirmedCount);
  const bracketHref = buildTournamentFinalsBracketHref(tournamentId);

  if (openSingleElimBracketBtn) {
    openSingleElimBracketBtn.href = bracketHref;
  }

  if (singleElimErrorEl) {
    singleElimErrorEl.classList.add("hidden");
    singleElimErrorEl.textContent = "";
  }

  if (bracket?.finalized) {
    singleElimDescEl.textContent = "トーナメント表は作成済みです。試合を進行できます。";
    singleElimStatsEl.innerHTML = [
      renderInfoRow("確定チーム数", String(bracket.teamCount ?? confirmedCount)),
      renderInfoRow("トーナメント枠", String(bracket.bracketSize ?? "—")),
      renderInfoRow("BYE", String(bracket.byeCount ?? 0)),
    ].join("");
    createSingleElimBracketBtn?.classList.add("hidden");
    openSingleElimBracketBtn?.classList.remove("hidden");
    return;
  }

  if (!sizeResult.valid) {
    singleElimDescEl.textContent = sizeResult.errors[0] ?? "参加数が不正です。";
    singleElimStatsEl.innerHTML = renderInfoRow("確定チーム数", String(confirmedCount));
    createSingleElimBracketBtn?.classList.add("hidden");
    openSingleElimBracketBtn?.classList.add("hidden");
    if (singleElimErrorEl) {
      singleElimErrorEl.textContent = sizeResult.errors[0] ?? "";
      singleElimErrorEl.classList.remove("hidden");
    }
    return;
  }

  singleElimDescEl.textContent = "確定チーム数を確認してトーナメント表を作成できます。";
  singleElimStatsEl.innerHTML = [
    renderInfoRow("確定チーム数", String(confirmedCount)),
    renderInfoRow("トーナメント枠", String(sizeResult.bracketSize)),
    renderInfoRow("BYE", String(sizeResult.byeCount)),
  ].join("");
  createSingleElimBracketBtn?.classList.remove("hidden");
  openSingleElimBracketBtn?.classList.add("hidden");
}

function renderFinalsBracketPanel(advancement, bracket) {
  if (!openFinalsBracketPrimaryBtn || !finalsBracketDescEl) {
    return;
  }

  if (!advancement?.finalized) {
    finalsBracketDescEl.textContent = "先に決勝進出チームを確定してください。";
    openFinalsBracketPrimaryBtn.classList.add("hidden");
    return;
  }

  openFinalsBracketPrimaryBtn.classList.remove("hidden");

  if (bracket?.finalized) {
    finalsBracketDescEl.textContent = "決勝トーナメント表は確定済みです。";
    openFinalsBracketPrimaryBtn.textContent = "決勝トーナメントを見る";
    return;
  }

  finalsBracketDescEl.textContent = "決勝進出チームをもとに、シード配置でトーナメント表を作成できます。";
  openFinalsBracketPrimaryBtn.textContent = "決勝トーナメントを作成";
}

function countEntriesByStatus(entries) {
  return {
    total: entries.length,
    pending: entries.filter((entry) => entry.status === EntryStatus.PENDING).length,
    confirmed: entries.filter((entry) => entry.status === EntryStatus.CONFIRMED).length,
  };
}

function renderEntrySummary(tournament, entries) {
  const counts = countEntriesByStatus(entries);
  entryTotalCountEl.textContent = String(counts.total);
  entryPendingCountEl.textContent = String(counts.pending);
  entryConfirmedCountEl.textContent = String(counts.confirmed);
  entryMaxTeamsEl.textContent = String(tournament.maxTeams ?? "—");
  openEntriesManageBtn.href = buildTournamentEntriesHref(tournament.id);
}

async function loadEntries() {
  const entries = await listEntries(tournamentId);
  currentEntries = entries;
  if (currentTournament) {
    renderEntrySummary(currentTournament, entries);
    updateBlockDrawDesc(currentTournament, entries);
  }
  return entries;
}

function getConfirmedEntries(entries) {
  return entries.filter((entry) => entry.status === EntryStatus.CONFIRMED);
}

function buildEntryLookup(entries) {
  return new Map(entries.map((entry) => [entry.id, entry]));
}

function updateBlockDrawDesc(tournament, entries) {
  const confirmedEntries = getConfirmedEntries(entries);
  const confirmedCount = confirmedEntries.length;

  if (tournament.tournamentFormat === TournamentFormat.SINGLE_ELIMINATION) {
    return;
  }

  if (usesNewFixedBlockDraw(tournament)) {
    const preview = buildBlockDrawPreviewMessage({
      teamCount: confirmedCount,
      blockCount: tournament.blockCount,
      qualifiersPerBlock: tournament.qualifiersPerBlock,
    });
    blockDrawDescEl.textContent = preview ?? "ブロック抽選の条件を満たしていません。";
    if (blockDrawBtn) {
      blockDrawBtn.disabled = preview == null && !isBlockDrawDraft(currentBlockDraw);
    }
    return;
  }

  const preferredBlockSize = tournament.preferredBlockSize ?? "—";
  blockDrawDescEl.textContent =
    `参加承認済み ${confirmedCount} チーム / ブロック基本人数 ${preferredBlockSize}。ランダムにシャッフルし、均等に各ブロックへ振り分けます。`;
  if (blockDrawBtn) {
    blockDrawBtn.disabled = false;
  }
}

function updateNewFormatSettingsPanel(tournament, blockDraw, entries) {
  if (!newFormatSettingsPanelEl || !usesNewFixedBlockDraw(tournament)) {
    newFormatSettingsPanelEl?.classList.add("hidden");
    return;
  }

  const isFinalized = isBlockDrawFinalized(blockDraw);
  newFormatSettingsPanelEl.classList.toggle("hidden", isFinalized);

  if (newFormatBlockCountSelectEl) {
    newFormatBlockCountSelectEl.value = String(tournament.blockCount ?? 16);
    newFormatBlockCountSelectEl.disabled = isFinalized;
  }

  if (newFormatQualifiersSelectEl) {
    newFormatQualifiersSelectEl.value = String(tournament.qualifiersPerBlock ?? 1);
    newFormatQualifiersSelectEl.disabled = isFinalized;
  }

  if (saveNewFormatSettingsBtn) {
    saveNewFormatSettingsBtn.disabled = isFinalized;
  }
}

function populateDraftEditControls(blockDraw, entries) {
  if (!isBlockDrawDraft(blockDraw)) {
    blockDrawDraftControlsEl?.classList.add("hidden");
    return;
  }

  blockDrawDraftControlsEl?.classList.remove("hidden");
  const entryLookup = buildEntryLookup(entries);
  const blocks = blockDraw.blocks || [];

  const entryOptions = [];
  for (const block of blocks) {
    for (const entryId of block.entryIds || []) {
      const entry = entryLookup.get(entryId);
      const label = `${entry?.teamName || entryId}（${block.name || block.id}）`;
      entryOptions.push({ entryId, blockId: block.id, label });
    }
  }

  const blockOptions = blocks.map((block) => ({
    id: block.id,
    label: block.name || block.id,
  }));

  if (moveEntrySelectEl) {
    moveEntrySelectEl.innerHTML = entryOptions
      .map(
        (option) =>
          `<option value="${escapeHtml(option.entryId)}" data-block-id="${escapeHtml(option.blockId)}">${escapeHtml(option.label)}</option>`
      )
      .join("");
  }

  if (moveTargetBlockSelectEl) {
    moveTargetBlockSelectEl.innerHTML = blockOptions
      .map((option) => `<option value="${escapeHtml(option.id)}">${escapeHtml(option.label)}</option>`)
      .join("");
  }

  if (swapEntryASelectEl) {
    swapEntryASelectEl.innerHTML = entryOptions
      .map(
        (option) =>
          `<option value="${escapeHtml(option.entryId)}" data-block-id="${escapeHtml(option.blockId)}">${escapeHtml(option.label)}</option>`
      )
      .join("");
  }

  if (swapEntryBSelectEl) {
    swapEntryBSelectEl.innerHTML = entryOptions
      .map(
        (option) =>
          `<option value="${escapeHtml(option.entryId)}" data-block-id="${escapeHtml(option.blockId)}">${escapeHtml(option.label)}</option>`
      )
      .join("");
  }
}

function renderBlockDrawDraftWarning(blockDraw, entries) {
  if (!blockDrawDraftWarningEl) {
    return;
  }

  if (!isBlockDrawDraft(blockDraw)) {
    blockDrawDraftWarningEl.classList.add("hidden");
    blockDrawDraftWarningEl.textContent = "";
    return;
  }

  const confirmedEntries = getConfirmedEntries(entries);
  const validation = validateEditableBlockDraw({
    confirmedEntryIds: confirmedEntries.map((entry) => entry.id),
    blocks: blockDraw.blocks,
    expectedBlockCount: currentTournament?.blockCount ?? blockDraw.blockCount,
  });

  const warningMessage = formatBlockSizeImbalanceWarning(validation.warnings);
  if (warningMessage) {
    blockDrawDraftWarningEl.textContent = warningMessage;
    blockDrawDraftWarningEl.classList.remove("hidden");
  } else {
    blockDrawDraftWarningEl.classList.add("hidden");
    blockDrawDraftWarningEl.textContent = "";
  }
}

function renderQualifyingScheduleRecovery(blockDraw, schedule) {
  if (!qualifyingScheduleRecoveryPanelEl) {
    return;
  }

  const isSingleElim = currentTournament?.tournamentFormat === TournamentFormat.SINGLE_ELIMINATION;
  const needsRecovery =
    !isSingleElim && isBlockDrawFinalized(blockDraw) && !schedule?.finalized;

  qualifyingScheduleRecoveryPanelEl.classList.toggle("hidden", !needsRecovery);
}

function renderBlockDraw(blockDraw, entries, schedule = currentQualifyingSchedule) {
  currentBlockDraw = blockDraw;
  currentQualifyingSchedule = schedule ?? null;
  setTournamentNavigationLinks();

  const hasDraw =
    blockDraw && Array.isArray(blockDraw.blocks) && blockDraw.blocks.length > 0;
  const isSingleElim = currentTournament?.tournamentFormat === TournamentFormat.SINGLE_ELIMINATION;
  const isNewFormat = usesNewFixedBlockDraw(currentTournament);
  const isDraft = isBlockDrawDraft(blockDraw);
  const isFinalized = isBlockDrawFinalized(blockDraw);

  if (blockDrawBtn) {
    if (isSingleElim) {
      blockDrawBtn.classList.add("hidden");
    } else if (isNewFormat) {
      blockDrawBtn.classList.toggle("hidden", isFinalized);
      blockDrawBtn.textContent = isDraft ? "再抽選" : "ブロック抽選";
      blockDrawBtn.disabled = false;
    } else {
      blockDrawBtn.classList.toggle("hidden", Boolean(hasDraw));
      blockDrawBtn.textContent = "ブロック抽選";
    }
  }

  blockDrawEmptyEl.classList.toggle("hidden", Boolean(hasDraw));
  blockDrawDraftBannerEl?.classList.toggle("hidden", !isDraft || !isNewFormat);

  const showQualifyingLinks = hasDraw && (!isNewFormat || isFinalized);
  openScheduleBtn?.classList.toggle("hidden", !showQualifyingLinks);
  openStandingsBtn?.classList.toggle("hidden", !showQualifyingLinks);
  openFinalsAdvancementBtn?.classList.toggle("hidden", !showQualifyingLinks);

  updateNewFormatSettingsPanel(currentTournament, blockDraw, entries);

  if (!hasDraw) {
    blockDrawResultsEl.classList.add("hidden");
    blockDrawResultsEl.innerHTML = "";
    blockDrawDraftControlsEl?.classList.add("hidden");
    renderBlockDrawDraftWarning(null, entries);
    return;
  }

  const entryLookup = buildEntryLookup(entries);
  blockDrawEmptyEl.classList.add("hidden");
  blockDrawResultsEl.classList.remove("hidden");
  blockDrawResultsEl.innerHTML = blockDraw.blocks
    .map((block) => {
      const teamCount = (block.entryIds || []).length;
      const teams = (block.entryIds || [])
        .map((entryId) => {
          const entry = entryLookup.get(entryId);
          const name = entry?.teamName || "（名称未設定）";
          return `<li>${escapeHtml(name)}</li>`;
        })
        .join("");

      return `
        <article class="block-group">
          <h4 class="block-group__title">${escapeHtml(block.name || block.id || "ブロック")}　${teamCount}チーム</h4>
          <ul class="block-group__list">${teams || "<li>—</li>"}</ul>
        </article>
      `;
    })
    .join("");

  populateDraftEditControls(blockDraw, entries);
  renderBlockDrawDraftWarning(blockDraw, entries);
  renderQualifyingScheduleRecovery(blockDraw, schedule);
}

async function handleRetryQualifyingSchedule() {
  if (!currentBlockDraw || !isBlockDrawFinalized(currentBlockDraw)) {
    return;
  }

  retryQualifyingScheduleBtn.disabled = true;

  try {
    const schedule = await saveQualifyingSchedule(tournamentId);
    currentQualifyingSchedule = schedule;
    renderBlockDraw(currentBlockDraw, currentEntries, schedule);
    warnSnapshotRebuildFailure(schedule);
    showToast("予選対戦表を生成しました。");
  } catch (error) {
    if (error.code === "qualifying-schedule/already-finalized") {
      const schedule = await getQualifyingSchedule(tournamentId);
      currentQualifyingSchedule = schedule;
      renderBlockDraw(currentBlockDraw, currentEntries, schedule);
      showToast("予選対戦表はすでに存在します。");
    } else {
      const { message } = classifyError(error);
      showErrorToast(message);
    }
  } finally {
    retryQualifyingScheduleBtn.disabled = false;
  }
}

async function loadBlockDraw(entries) {
  const [blockDraw, schedule] = await Promise.all([
    getBlockDraw(tournamentId),
    getQualifyingSchedule(tournamentId),
  ]);
  renderBlockDraw(blockDraw, entries, schedule);
}

async function handleBlockDraw() {
  if (!currentTournament) {
    return;
  }

  if (currentTournament.tournamentFormat === TournamentFormat.SINGLE_ELIMINATION) {
    return;
  }

  const confirmedEntries = getConfirmedEntries(currentEntries);
  if (confirmedEntries.length === 0) {
    showErrorToast("参加承認済みのチームがありません。");
    return;
  }

  const isRedraw = isBlockDrawDraft(currentBlockDraw);
  let confirmMessage;
  let confirmLabel = isRedraw ? "再抽選する" : "抽選する";

  if (usesNewFixedBlockDraw(currentTournament)) {
    const preview = buildBlockDrawPreviewMessage({
      teamCount: confirmedEntries.length,
      blockCount: currentTournament.blockCount,
      qualifiersPerBlock: currentTournament.qualifiersPerBlock,
    });
    if (!preview) {
      showErrorToast("ブロック抽選の条件を満たしていません。");
      return;
    }
    confirmMessage = isRedraw
      ? `${preview}\n\n現在の配置を破棄して再抽選します。実行しますか？`
      : `${preview}\n\n実行しますか？`;
  } else {
    const preferredBlockSize = currentTournament.preferredBlockSize;
    const blockCount = Math.max(
      1,
      Math.ceil(confirmedEntries.length / preferredBlockSize)
    );
    confirmMessage = `参加承認済み ${confirmedEntries.length} チームを ${blockCount} ブロック（基本人数 ${preferredBlockSize}）にランダム振り分けします。実行しますか？`;
  }

  const confirmed = await confirmDialog({
    title: isRedraw ? "再抽選" : "ブロック抽選",
    message: confirmMessage,
    confirmLabel,
    cancelLabel: "キャンセル",
  });

  if (!confirmed) {
    return;
  }

  blockDrawBtn.disabled = true;

  try {
    const blockDraw = isRedraw
      ? await redrawBlockDrawDraft(tournamentId, confirmedEntries, currentTournament)
      : await runBlockDraw(tournamentId, confirmedEntries, currentTournament);
    renderBlockDraw(blockDraw, currentEntries);
    updateBlockDrawDesc(currentTournament, currentEntries);
    warnSnapshotRebuildFailure(blockDraw);
    showToast(isRedraw ? "再抽選が完了しました。" : "ブロック抽選が完了しました（draft）。");
  } catch (error) {
    const { message } = classifyError(error);
    showErrorToast(message);
  } finally {
    blockDrawBtn.disabled = false;
  }
}

function getSelectedEntryBlockId(selectEl) {
  const option = selectEl?.selectedOptions?.[0];
  return option?.dataset?.blockId ?? null;
}

async function handleMoveEntry() {
  if (!currentBlockDraw || !isBlockDrawDraft(currentBlockDraw) || !currentTournament) {
    return;
  }

  const entryId = moveEntrySelectEl?.value;
  const fromBlockId = getSelectedEntryBlockId(moveEntrySelectEl);
  const toBlockId = moveTargetBlockSelectEl?.value;

  if (!entryId || !fromBlockId || !toBlockId) {
    showErrorToast("移動するチームと移動先を選択してください。");
    return;
  }

  moveEntryBtn.disabled = true;

  try {
    const nextBlocks = moveEntryBetweenBlocks(
      currentBlockDraw.blocks,
      fromBlockId,
      entryId,
      toBlockId
    );
    const confirmedEntries = getConfirmedEntries(currentEntries);
    const blockDraw = await updateBlockDrawDraftBlocks(
      tournamentId,
      nextBlocks,
      currentTournament,
      confirmedEntries
    );
    renderBlockDraw(blockDraw, currentEntries);
    showToast("チームを移動しました。");
  } catch (error) {
    const { message } = classifyError(error);
    showErrorToast(message);
  } finally {
    moveEntryBtn.disabled = false;
  }
}

async function handleSwapEntries() {
  if (!currentBlockDraw || !isBlockDrawDraft(currentBlockDraw) || !currentTournament) {
    return;
  }

  const entryIdA = swapEntryASelectEl?.value;
  const blockIdA = getSelectedEntryBlockId(swapEntryASelectEl);
  const entryIdB = swapEntryBSelectEl?.value;
  const blockIdB = getSelectedEntryBlockId(swapEntryBSelectEl);

  if (!entryIdA || !blockIdA || !entryIdB || !blockIdB) {
    showErrorToast("入替する2チームを選択してください。");
    return;
  }

  swapEntriesBtn.disabled = true;

  try {
    const nextBlocks = swapEntriesBetweenBlocks(
      currentBlockDraw.blocks,
      blockIdA,
      entryIdA,
      blockIdB,
      entryIdB
    );
    const confirmedEntries = getConfirmedEntries(currentEntries);
    const blockDraw = await updateBlockDrawDraftBlocks(
      tournamentId,
      nextBlocks,
      currentTournament,
      confirmedEntries
    );
    renderBlockDraw(blockDraw, currentEntries);
    showToast("チームを入替しました。");
  } catch (error) {
    const { message } = classifyError(error);
    showErrorToast(message);
  } finally {
    swapEntriesBtn.disabled = false;
  }
}

async function handleFinalizeBlockDraw() {
  if (!currentBlockDraw || !isBlockDrawDraft(currentBlockDraw) || !currentTournament) {
    return;
  }

  const confirmedEntries = getConfirmedEntries(currentEntries);
  const validation = validateEditableBlockDraw({
    confirmedEntryIds: confirmedEntries.map((entry) => entry.id),
    blocks: currentBlockDraw.blocks,
    expectedBlockCount: currentTournament.blockCount,
  });

  if (!validation.valid) {
    showErrorToast(validation.errors[0] ?? "配置が不正です。");
    return;
  }

  const imbalanceConfirm = formatBlockSizeImbalanceConfirmMessage(validation.warnings);
  if (imbalanceConfirm) {
    const confirmed = await confirmDialog({
      title: "ブロック確定",
      message: imbalanceConfirm,
      confirmLabel: "確定する",
      cancelLabel: "キャンセル",
    });
    if (!confirmed) {
      return;
    }
  } else {
    const confirmed = await confirmDialog({
      title: "ブロック確定",
      message: "この配置でブロックを確定しますか？確定後に予選対戦表が生成されます。",
      confirmLabel: "確定する",
      cancelLabel: "キャンセル",
    });
    if (!confirmed) {
      return;
    }
  }

  blockDrawFinalizeBtn.disabled = true;

  try {
    const result = await finalizeBlockDraw(
      tournamentId,
      currentTournament,
      confirmedEntries,
      { skipImbalanceConfirm: true }
    );
    renderBlockDraw(result.blockDraw ?? result, currentEntries);
    updateBlockDrawDesc(currentTournament, currentEntries);
    warnSnapshotRebuildFailure(result);
    showToast("ブロックを確定し、予選対戦表を生成しました。");
  } catch (error) {
    const { message } = classifyError(error);
    showErrorToast(message);
  } finally {
    blockDrawFinalizeBtn.disabled = false;
  }
}

async function handleSaveNewFormatSettings() {
  if (!currentTournament || !usesNewFixedBlockDraw(currentTournament)) {
    return;
  }

  const confirmedEntries = getConfirmedEntries(currentEntries);
  const newBlockCount = Number(newFormatBlockCountSelectEl?.value);
  const newQualifiersPerBlock = Number(newFormatQualifiersSelectEl?.value);
  const blockCountChanged = newBlockCount !== currentTournament.blockCount;
  const qualifiersChanged = newQualifiersPerBlock !== currentTournament.qualifiersPerBlock;

  if (!blockCountChanged && !qualifiersChanged) {
    showToast("変更はありません。");
    return;
  }

  if (blockCountChanged && blockCountChangeRequiresDraftDiscard(currentBlockDraw)) {
    const confirmed = await confirmDialog({
      title: "ブロック数の変更",
      message:
        "ブロック数を変更すると、現在の抽選結果は破棄されます。\n\n変更後に再抽選が必要です。\n\n続行しますか？",
      confirmLabel: "変更する",
      cancelLabel: "キャンセル",
    });
    if (!confirmed) {
      return;
    }
  }

  saveNewFormatSettingsBtn.disabled = true;

  try {
    if (blockCountChanged) {
      const updated = await changeBlockCountDiscardingDraft(
        tournamentId,
        newBlockCount,
        confirmedEntries.length,
        newQualifiersPerBlock
      );
      currentTournament = updated;
      renderTournament(updated);
      currentBlockDraw = null;
      renderBlockDraw(null, currentEntries);
      updateBlockDrawDesc(updated, currentEntries);
      warnSnapshotRebuildFailure(updated);
      showToast("ブロック数を変更しました。再抽選してください。");
    } else {
      const updated = await updateQualifiersPerBlockSetting(
        tournamentId,
        newQualifiersPerBlock,
        confirmedEntries.length,
        currentTournament.blockCount
      );
      currentTournament = updated;
      renderTournament(updated);
      updateBlockDrawDesc(updated, currentEntries);
      warnSnapshotRebuildFailure(updated);
      showToast("各ブロック通過数を更新しました。");
    }
  } catch (error) {
    const { message } = classifyError(error);
    showErrorToast(message);
  } finally {
    saveNewFormatSettingsBtn.disabled = false;
  }
}

function showPageError(message) {
  showFormAlert(document.getElementById("errorAlert"), message, "error");
  showView("error");
}

async function loadTournamentCompletionStatus() {
  if (!currentTournament) {
    return;
  }

  let savedResults = null;
  try {
    console.info(`${LOG_PREFIX} tournamentResults get start tournaments/${tournamentId}/tournamentResults/current`);
    savedResults = await getTournamentResults(tournamentId);
    console.info(`${LOG_PREFIX} tournamentResults get ok`);
  } catch (error) {
    console.error(`${LOG_PREFIX} tournamentResults get failed`, error?.code, error);
    renderDashboardLifecycle(currentTournament, null, null);
    return;
  }

  if (
    currentTournament.status === TournamentStatus.CLOSED ||
    savedResults?.finalized
  ) {
    renderDashboardLifecycle(currentTournament, savedResults, null);
    return;
  }

  if (currentTournament.status !== TournamentStatus.OPEN) {
    renderDashboardLifecycle(currentTournament, savedResults, null);
    return;
  }

  try {
    const [advancement, bracket, resultsMap] = await Promise.all([
      getFinalsAdvancement(tournamentId),
      getFinalsBracket(tournamentId),
      getFinalsMatchResults(tournamentId),
    ]);

    const completionPreview = validateTournamentCompletion({
      bracket,
      resultsMap,
      qualifiers: getTournamentResultParticipants(bracket, advancement),
      advancement,
      existingResults: savedResults,
    });

    renderDashboardLifecycle(currentTournament, savedResults, completionPreview);
  } catch (error) {
    console.error(`${LOG_PREFIX} completion preview failed`, error?.code, error);
    renderDashboardLifecycle(currentTournament, savedResults, null);
  }
}

async function loadFinalsStatus() {
  const [advancement, bracket] = await Promise.all([
    getFinalsAdvancement(tournamentId),
    getFinalsBracket(tournamentId),
  ]);

  if (currentTournament?.tournamentFormat === TournamentFormat.SINGLE_ELIMINATION) {
    renderSingleElimPanel(currentTournament, currentEntries, bracket);
    return;
  }

  renderFinalsBracketPanel(advancement, bracket);
}

async function handleCreateSingleElimBracket() {
  if (!currentTournament) {
    return;
  }

  const confirmedCount = getConfirmedEntries(currentEntries).length;
  const sizeResult = resolveSingleEliminationBracketSize(confirmedCount);
  if (!sizeResult.valid) {
    showErrorToast(sizeResult.errors[0] ?? "参加数が不正です。");
    return;
  }

  const confirmed = await confirmDialog({
    title: "一発トーナメント表の作成",
    message: `確定${confirmedCount}チームで一発トーナメントを作成します。\n\nトーナメント表作成後は再抽選できません。\n作成してよろしいですか？`,
    confirmLabel: "作成する",
    cancelLabel: "キャンセル",
  });

  if (!confirmed) {
    return;
  }

  createSingleElimBracketBtn.disabled = true;

  try {
    const result = await createSingleEliminationBracket(tournamentId);
    warnSnapshotRebuildFailure(result);
    showToast("トーナメント表を作成しました。");
    await loadFinalsStatus();
    await loadTournamentCompletionStatus();
  } catch (error) {
    const { message } = classifyError(error);
    showErrorToast(message);
  } finally {
    createSingleElimBracketBtn.disabled = false;
  }
}

function getLoadStage() {
  const stage = new URLSearchParams(window.location.search).get("loadStage");
  return (stage || "G").toUpperCase();
}

function renderStageDebugPanel(probeSummary) {
  if (!tournamentNameEl || !tournamentMetaEl) {
    return;
  }
  tournamentNameEl.textContent = `診断モード (${probeSummary.loadStage})`;
  tournamentMetaEl.textContent = [
    `UID: ${probeSummary.uid ?? "—"}`,
    `大会ID: ${probeSummary.tournamentId ?? "—"}`,
    probeSummary.firstFailure
      ? `失敗: ${probeSummary.firstFailure.path} (${probeSummary.firstFailure.code})`
      : "Firestore 到達: OK",
  ].join(" / ");
}

async function loadOptionalSubcollections(loadStage) {
  const stageOrder = ["A", "B", "C", "D", "E", "F", "G"];
  const stageIndex = stageOrder.indexOf(loadStage);
  let partialFailure = false;

  if (stageIndex >= stageOrder.indexOf("C")) {
    try {
      console.info(`${LOG_PREFIX} entries get start tournaments/${tournamentId}/entries`);
      await loadEntries();
      console.info(`${LOG_PREFIX} entries get ok`);
    } catch (error) {
      partialFailure = true;
      console.error(`${LOG_PREFIX} entries get failed`, error?.code, error);
      if (currentTournament) {
        renderEntrySummary(currentTournament, []);
      }
    }
  }

  if (stageIndex >= stageOrder.indexOf("D")) {
    try {
      console.info(`${LOG_PREFIX} blockDraw get start tournaments/${tournamentId}/blockDraw/current`);
      await loadBlockDraw(currentEntries);
      console.info(`${LOG_PREFIX} blockDraw get ok`);
    } catch (error) {
      partialFailure = true;
      console.error(`${LOG_PREFIX} blockDraw get failed`, error?.code, error);
      renderBlockDraw(null, currentEntries);
    }
  }

  if (stageIndex >= stageOrder.indexOf("F")) {
    try {
      console.info(`${LOG_PREFIX} finals status get start`);
      await loadFinalsStatus();
      console.info(`${LOG_PREFIX} finals status get ok`);
    } catch (error) {
      partialFailure = true;
      console.error(`${LOG_PREFIX} finals status get failed`, error?.code, error);
      renderFinalsBracketPanel(null, null);
    }
  }

  if (stageIndex >= stageOrder.indexOf("G")) {
    try {
      console.info(`${LOG_PREFIX} completion status get start`);
      await loadTournamentCompletionStatus();
      console.info(`${LOG_PREFIX} completion status get ok`);
    } catch (error) {
      partialFailure = true;
      console.error(`${LOG_PREFIX} completion status get failed`, error?.code, error);
    }
  }

  if (partialFailure) {
    showErrorToast("一部の大会情報を読み込めませんでした。");
  }
}

async function loadTournament() {
  showView("loading");

  if (!isValidTournamentId(tournamentId)) {
    const { message } = classifyError(new InvalidTournamentIdError());
    showPageError(message);
    return;
  }

  const loadStage = getLoadStage();
  console.info(`${LOG_PREFIX} load start`, {
    href: window.location.href,
    search: window.location.search,
    tournamentId,
    loadStage,
    firestorePath: `tournaments/${tournamentId}`,
  });

  const probeSummary = await runDashboardFirestoreProbe(tournamentId, { loadStage });

  if (loadStage === "A") {
    renderStageDebugPanel(probeSummary);
    showView("dashboard");
    return;
  }

  const tournamentStep = probeSummary.steps.find((step) => step.step === "tournament");
  if (!tournamentStep?.ok) {
    logDashboardFailureContext(probeSummary, tournamentStep?.error);
    const { message } = classifyError(tournamentStep?.error ?? new Error("Tournament load failed"));
    showPageError(message);
    return;
  }

  const tournament = tournamentStep.result;
  currentTournament = tournament;
  renderTournament(tournament);
  showView("dashboard");

  if (loadStage === "B") {
    renderStageDebugPanel(probeSummary);
    return;
  }

  await loadOptionalSubcollections(loadStage);
}

async function handleRebuildPublicSnapshot() {
  if (!rebuildPublicSnapshotBtn) {
    return;
  }

  rebuildPublicSnapshotBtn.disabled = true;
  try {
    await rebuildPublicTournamentSnapshot(tournamentId);
    showToast("公開情報を更新しました");
  } catch (error) {
    console.error("[dashboard] public snapshot rebuild failed", error);
    showErrorToast("公開情報を更新できませんでした");
  } finally {
    rebuildPublicSnapshotBtn.disabled = false;
  }
}

async function handlePublicViewChange() {
  if (!publicViewSelectEl || !currentTournament) {
    return;
  }

  const enabled = publicViewSelectEl.value === "true";
  if (enabled === isPublicViewEnabled(currentTournament)) {
    return;
  }

  publicViewSelectEl.disabled = true;
  try {
    const result = await updateTournamentPublicView(tournamentId, enabled);
    warnSnapshotRebuildFailure(result);
    showToast(enabled ? "公開ページを有効にしました。" : "公開ページを停止しました。");
    await loadTournament();
  } catch (error) {
    const { message } = classifyError(error);
    showErrorToast(message);
    publicViewSelectEl.value = isPublicViewEnabled(currentTournament) ? "true" : "false";
  } finally {
    publicViewSelectEl.disabled = false;
  }
}

async function handleCopyPublicUrl() {
  const url = publicPageUrlEl?.value;
  if (!url) {
    return;
  }

  try {
    await navigator.clipboard.writeText(url);
    showToast("公開URLをコピーしました");
  } catch {
    publicPageUrlEl.select();
    document.execCommand("copy");
    showToast("公開URLをコピーしました");
  }
}

async function handleCopyUrl() {
  const url = entryUrlEl.value;
  if (!url) {
    return;
  }

  try {
    await navigator.clipboard.writeText(url);
    showToast("URL をコピーしました。");
  } catch {
    entryUrlEl.select();
    document.execCommand("copy");
    showToast("URL をコピーしました。");
  }
}

async function handleOpenEntry() {
  if (!currentTournament || currentTournament.status !== TournamentStatus.DRAFT) {
    return;
  }

  const confirmed = await confirmDialog({
    title: "エントリー受付を開始",
    message: "エントリー受付を開始しますか？公開 URL から申込を受け付けられるようになります。",
    confirmLabel: "開始する",
    cancelLabel: "キャンセル",
  });

  if (!confirmed) {
    return;
  }

  openEntryBtn.disabled = true;

  try {
    const result = await updateTournamentStatus(tournamentId, TournamentStatus.OPEN);
    warnSnapshotRebuildFailure(result);
    showToast("エントリー受付を開始しました。");
    await loadTournament();
  } catch (error) {
    const { message } = classifyError(error);
    showErrorToast(message);
    openEntryBtn.disabled = false;
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

function bindDashboardActions() {
  console.info(`${LOG_PREFIX} bind module actions`);

  copyUrlBtn?.addEventListener("click", handleCopyUrl);
  copyPublicUrlBtn?.addEventListener("click", handleCopyPublicUrl);
  rebuildPublicSnapshotBtn?.addEventListener("click", handleRebuildPublicSnapshot);
  publicViewSelectEl?.addEventListener("change", handlePublicViewChange);
  openEntryBtn?.addEventListener("click", handleOpenEntry);
  blockDrawBtn?.addEventListener("click", handleBlockDraw);
  moveEntryBtn?.addEventListener("click", handleMoveEntry);
  swapEntriesBtn?.addEventListener("click", handleSwapEntries);
  blockDrawFinalizeBtn?.addEventListener("click", handleFinalizeBlockDraw);
  saveNewFormatSettingsBtn?.addEventListener("click", handleSaveNewFormatSettings);
  retryQualifyingScheduleBtn?.addEventListener("click", handleRetryQualifyingSchedule);
  createSingleElimBracketBtn?.addEventListener("click", handleCreateSingleElimBracket);

  console.info(`${LOG_PREFIX} module event bind complete`);
}

function initDashboardPage() {
  console.info(`${LOG_PREFIX} init start`);
  try {
    tournamentId = new URLSearchParams(window.location.search).get("id");
    console.info(`${LOG_PREFIX} tournamentId`, tournamentId);
    setTournamentNavigationLinks();
    bindDashboardActions();

    initTournamentManageGuard({
      tournamentId,
      onConfigRequired: initConfigView,
      onAccessDenied: initAccessDeniedView,
      onReady: () => {
        loadTournament();
      },
    });
  } catch (error) {
    console.error(`${LOG_PREFIX} init failed`, error);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initDashboardPage);
} else {
  initDashboardPage();
}
