/**
 * 決勝進出ページ
 */
import {
  DEFAULT_FINAL_TEAM_COUNT,
  FinalsQualifierSource,
  FinalsAdvancementMode,
} from "../../domain/constants.js";
import { usesLegacyFinalsAdvancement, resolveFinalQualifierCount, usesRankBandWildcards, resolveAutoPassCount } from "../../domain/tournament-format.js";
import { entryIdsGroupKey } from "../../domain/qualifying-standings.js";
import { isValidTournamentId } from "../../domain/validators.js";
import { getTournament } from "../../services/tournament-service.js";
import { getQualifyingSchedule } from "../../services/qualifying-schedule-service.js";
import {
  getFinalsAdvancement,
  previewFinalsAdvancement,
  saveFinalsAdvancement,
} from "../../services/finals-advancement-service.js";
import { upsertMolkkyOutResolution } from "../../services/molkky-out-resolution-service.js";
import { getFinalsBracket } from "../../services/finals-bracket-service.js";
import { initTournamentManageGuard } from "../../lib/operator-guard.js";
import {
  classifyError,
  InvalidTournamentIdError,
} from "../../lib/errors.js";
import { showErrorToast, showToast } from "../components/toast.js";
import { showFormAlert } from "../components/form-errors.js";
import { warnSnapshotRebuildFailure } from "../../lib/public-snapshot-ui.js";
import {
  moveMolkkyOutOrderItem,
  readMolkkyOutOrder,
  renderMolkkyOutOrderPanel,
} from "../components/molkky-out-order-panel.js";

const FINALIZE_BUTTON_LABEL = "決勝進出を確定する";
const FINALIZE_BUTTON_BUSY_LABEL = "保存中…";

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
const molkkyOutAlertEl = document.getElementById("molkkyOutAlert");
const advancementRulesListEl = document.getElementById("advancementRulesList");
const newFormatPreviewPanelEl = document.getElementById("newFormatPreviewPanel");
const newFormatPreviewDescEl = document.getElementById("newFormatPreviewDesc");
const newFormatBlockPreviewEl = document.getElementById("newFormatBlockPreview");
const qualifiersEmptyEl = document.getElementById("qualifiersEmpty");
const qualifiersBodyEl = document.getElementById("qualifiersBody");
const qualifiersTableEl = document.getElementById("qualifiersTable");
const finalizePanelEl = document.getElementById("finalizePanel");
const finalizePanelTopEl = document.getElementById("finalizePanelTop");
const finalizeAdvancementBtn = document.getElementById("finalizeAdvancementBtn");
const finalizeAdvancementTopBtn = document.getElementById("finalizeAdvancementTopBtn");
const bracketLinkPanelEl = document.getElementById("bracketLinkPanel");
const bracketLinkPanelTopEl = document.getElementById("bracketLinkPanelTop");
const bracketLinkDescEl = document.getElementById("bracketLinkDesc");
const bracketLinkDescTopEl = document.getElementById("bracketLinkDescTop");
const openFinalsBracketBtn = document.getElementById("openFinalsBracketBtn");
const openFinalsBracketTopBtn = document.getElementById("openFinalsBracketTopBtn");

let tournamentId = null;
let currentTournament = null;
let currentPreview = null;
let isFinalizingAdvancement = false;
let isSavingMolkkyOut = false;

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
  if (source === FinalsQualifierSource.FIXED_BLOCK) {
    return "自動通過";
  }
  if (source === FinalsQualifierSource.WILDCARD) {
    return "ワイルドカード";
  }
  return source ?? "—";
}

function resolveQualifierCount(tournament, preview, saved) {
  if (saved?.qualifierCount != null) {
    return saved.qualifierCount;
  }
  if (saved?.finalTeamCount != null) {
    return saved.finalTeamCount;
  }
  if (preview?.selection?.qualifierCount != null) {
    return preview.selection.qualifierCount;
  }
  if (preview?.selection?.finalTeamCount != null) {
    return preview.selection.finalTeamCount;
  }
  return resolveFinalQualifierCount({ tournament }) ?? DEFAULT_FINAL_TEAM_COUNT;
}

function buildDisplayQualifiers(preview, saved) {
  const previewQualifiers =
    preview?.selection?.qualifiers ?? preview?.selection?.partialQualifiers ?? [];
  const nameLookup = new Map(previewQualifiers.map((entry) => [entry.entryId, entry.teamName]));
  const blockNameLookup = new Map(
    previewQualifiers.map((entry) => [entry.entryId, entry.blockName])
  );
  const statsLookup = new Map(previewQualifiers.map((entry) => [entry.entryId, entry]));

  const sourceQualifiers = saved?.qualifiers?.length ? saved.qualifiers : previewQualifiers;

  return sourceQualifiers.map((entry, index) => {
    const stats = statsLookup.get(entry.entryId) ?? entry;
    return {
      ...entry,
      teamName: entry.teamName ?? nameLookup.get(entry.entryId) ?? entry.entryId,
      blockName: entry.blockName ?? blockNameLookup.get(entry.entryId) ?? entry.blockId ?? "—",
      seed: entry.seed ?? index + 1,
      setWins: stats.setWins ?? "—",
      setDraws: stats.setDraws ?? "—",
      setLosses: stats.setLosses ?? "—",
      setWinRate: stats.setWinRate,
      totalScore: stats.totalScore ?? "—",
    };
  });
}

function renderAdvancementRules(tournament) {
  if (!advancementRulesListEl) {
    return;
  }

  const qualifierCount = resolveFinalQualifierCount({ tournament }) ?? DEFAULT_FINAL_TEAM_COUNT;
  const autoPass = resolveAutoPassCount({ tournament });
  const wildcard =
    Number.isInteger(qualifierCount) && Number.isInteger(autoPass)
      ? Math.max(0, qualifierCount - autoPass)
      : null;

  if (usesLegacyFinalsAdvancement(tournament) || usesRankBandWildcards(tournament)) {
    advancementRulesListEl.innerHTML = `
      <li>自動通過：${autoPass ?? "—"} チーム</li>
      <li>ワイルドカード：${wildcard ?? "—"} チーム（順位帯ごとに補充）</li>
      <li>決勝進出合計：${qualifierCount} チーム</li>
      <li>各ブロック上位 ${tournament.qualifiersPerBlock ?? 1} 位までを自動通過</li>
      <li>比較はブロック順位と同じ（セット勝数 → 分 → 総得点）。完全同値はモルックアウト対象</li>
    `;
    return;
  }

  advancementRulesListEl.innerHTML = `
    <li>自動通過：${autoPass ?? qualifierCount} チーム</li>
    <li>ワイルドカード：0 チーム</li>
    <li>決勝進出合計：${qualifierCount} チーム</li>
    <li>各ブロック上位 ${tournament.qualifiersPerBlock} チームが決勝進出</li>
  `;
}

function renderNewFormatBlockPreview(tournament, preview, saved, finalized) {
  const isFixedBlockOnly =
    !usesLegacyFinalsAdvancement(tournament) && !usesRankBandWildcards(tournament);
  newFormatPreviewPanelEl?.classList.toggle("hidden", !isFixedBlockOnly);

  if (!isFixedBlockOnly || !newFormatBlockPreviewEl) {
    return;
  }

  const blockGroups =
    saved?.mode === FinalsAdvancementMode.FIXED_BLOCK_QUALIFIERS
      ? groupSavedQualifiersByBlock(saved.qualifiers, preview)
      : preview?.selection?.blockGroups ?? [];

  const qualifierCount = resolveQualifierCount(tournament, preview, saved);
  const perBlock = tournament.qualifiersPerBlock ?? 1;

  newFormatPreviewDescEl.textContent = finalized
    ? `各ブロック上位${perBlock}チームが決勝進出しました（${qualifierCount}チーム）。`
    : `各ブロック上位${perBlock}チームが決勝進出します（予定 ${qualifierCount}チーム）。`;

  if (!blockGroups.length) {
    newFormatBlockPreviewEl.innerHTML = "<p>—</p>";
    return;
  }

  newFormatBlockPreviewEl.innerHTML = blockGroups
    .map((group) => {
      const teams = group.qualifiers
        .map(
          (qualifier) =>
            `<li>${qualifier.blockRank}位 ${escapeHtml(qualifier.teamName || qualifier.entryId)}</li>`
        )
        .join("");
      return `
        <article class="block-group">
          <h4 class="block-group__title">${escapeHtml(group.blockName || group.blockId)}</h4>
          <ul class="block-group__list">${teams}</ul>
        </article>
      `;
    })
    .join("");
}

function groupSavedQualifiersByBlock(savedQualifiers, preview) {
  const previewQualifiers = preview?.selection?.qualifiers ?? [];
  const nameLookup = new Map(previewQualifiers.map((entry) => [entry.entryId, entry.teamName]));
  const blockNameLookup = new Map(
    previewQualifiers.map((entry) => [entry.entryId, entry.blockName ?? entry.blockId])
  );

  const groups = new Map();
  for (const qualifier of savedQualifiers || []) {
    if (!groups.has(qualifier.blockId)) {
      groups.set(qualifier.blockId, {
        blockId: qualifier.blockId,
        blockName: blockNameLookup.get(qualifier.entryId) ?? qualifier.blockId,
        qualifiers: [],
      });
    }
    groups.get(qualifier.blockId).qualifiers.push({
      ...qualifier,
      teamName: nameLookup.get(qualifier.entryId) ?? qualifier.entryId,
    });
  }

  return [...groups.values()]
    .sort((a, b) => String(a.blockId).localeCompare(String(b.blockId), "ja"))
    .map((group) => ({
      ...group,
      qualifiers: [...group.qualifiers].sort((a, b) => a.blockRank - b.blockRank),
    }));
}

function renderQualifiersTable(tournament, preview, saved) {
  const qualifiers = buildDisplayQualifiers(preview, saved);
  const showWildcardTable =
    usesLegacyFinalsAdvancement(tournament) || usesRankBandWildcards(tournament);

  if (qualifiersTableEl) {
    qualifiersTableEl.querySelector("thead tr").innerHTML = showWildcardTable
      ? `
          <th scope="col">Seed</th>
          <th scope="col">チーム</th>
          <th scope="col">ブロック</th>
          <th scope="col">順位</th>
          <th scope="col">選出</th>
          <th scope="col">セット勝</th>
          <th scope="col">分</th>
          <th scope="col">敗</th>
          <th scope="col">勝率</th>
          <th scope="col">総得点</th>
        `
      : `
          <th scope="col">チーム</th>
          <th scope="col">ブロック</th>
          <th scope="col">順位</th>
        `;
  }

  if (!qualifiers.length) {
    qualifiersEmptyEl.classList.remove("hidden");
    qualifiersBodyEl.innerHTML = "";
    return;
  }

  qualifiersEmptyEl.classList.add("hidden");
  qualifiersBodyEl.innerHTML = qualifiers
    .map((entry) =>
      showWildcardTable
        ? `
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
        : `
        <tr>
          <td class="standings-table__team">${escapeHtml(entry.teamName)}</td>
          <td>${escapeHtml(entry.blockName)}</td>
          <td class="standings-table__num">${entry.blockRank}</td>
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

  const needsMolkky = preview.selection?.needsMolkkyOut;
  if (needsMolkky) {
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

function wildcardGroupKey(needs) {
  return `wildcard:${needs.rankBand}:${entryIdsGroupKey(needs.entryIds || [])}`;
}

function renderMolkkyOutAlert(preview, { finalized }) {
  if (!molkkyOutAlertEl) {
    return;
  }

  if (finalized || !preview?.selection?.needsMolkkyOut) {
    molkkyOutAlertEl.classList.add("hidden");
    molkkyOutAlertEl.innerHTML = "";
    return;
  }

  const needs = preview.selection.needsMolkkyOut;

  if (needs.scope === "block") {
    molkkyOutAlertEl.innerHTML = `
      <h3 class="panel__title">モルックアウト対象（ブロック内）</h3>
      <p class="panel__desc">${escapeHtml(preview.message ?? "")}</p>
      <p class="panel__desc">予選順位表でモルックアウト結果を確定してから、再度この画面を開いてください。</p>
      <a href="${buildTournamentStandingsHref(tournamentId)}" class="btn btn--primary">予選順位表を開く</a>
    `;
    molkkyOutAlertEl.classList.remove("hidden");
    return;
  }

  if (needs.scope === "wildcard") {
    const groupKey = wildcardGroupKey(needs);
    molkkyOutAlertEl.innerHTML = `
      <h3 class="panel__title">モルックアウト対象（ワイルドカード）</h3>
      <p class="panel__desc">${escapeHtml(preview.message ?? "")}</p>
      ${renderMolkkyOutOrderPanel({
        groupKey,
        title: `各ブロック${needs.rankBand}位の同順位`,
        description:
          "セット勝・分・総得点が同数のためモルックアウト対象です。実施後、上位から順に並べて確定してください。",
        entries: (needs.candidates || []).map((entry) => ({
          entryId: entry.entryId,
          teamName: entry.teamName,
          blockName: entry.blockName,
        })),
        slotsNeeded: needs.slotsNeeded,
        disabled: isSavingMolkkyOut,
      })}
    `;
    molkkyOutAlertEl.classList.remove("hidden");
    return;
  }

  molkkyOutAlertEl.classList.add("hidden");
  molkkyOutAlertEl.innerHTML = "";
}

function renderAdvancementView(tournament, { preview, saved, finalized, bracket }) {
  currentTournament = tournament;
  currentPreview = preview;

  const tournamentName = tournament?.name || "（名称未設定）";
  advancementPageTitleEl.textContent = finalized ? "決勝進出（確定済み）" : "決勝進出（プレビュー）";
  advancementMetaEl.textContent = tournamentName;
  finalizedBadgeEl.classList.toggle("hidden", !finalized);

  renderAdvancementRules(tournament);
  renderNewFormatBlockPreview(tournament, preview, saved, finalized);
  renderQualifiersTable(tournament, preview, saved);
  renderCompletionAlert(preview, { finalized });
  renderMolkkyOutAlert(preview, { finalized });

  const showFinalize = !finalized && Boolean(preview?.canFinalize);
  finalizePanelEl.classList.toggle("hidden", !showFinalize);
  finalizePanelTopEl?.classList.toggle("hidden", !showFinalize);
  renderBracketLinkPanel(tournament, finalized, bracket);
}

function setFinalizeButtonsDisabled(disabled) {
  finalizeAdvancementBtn.disabled = disabled;
  if (finalizeAdvancementTopBtn) {
    finalizeAdvancementTopBtn.disabled = disabled;
  }
}

function setFinalizeButtonsBusy(busy) {
  setFinalizeButtonsDisabled(busy);
  const label = busy ? FINALIZE_BUTTON_BUSY_LABEL : FINALIZE_BUTTON_LABEL;
  finalizeAdvancementBtn.textContent = label;
  if (finalizeAdvancementTopBtn) {
    finalizeAdvancementTopBtn.textContent = label;
  }
}

function renderBracketLinkPanel(tournament, finalized, bracket) {
  if (!finalized) {
    bracketLinkPanelEl.classList.add("hidden");
    bracketLinkPanelTopEl?.classList.add("hidden");
    openFinalsBracketHeaderBtn.classList.add("hidden");
    return;
  }

  bracketLinkPanelEl.classList.remove("hidden");
  bracketLinkPanelTopEl?.classList.remove("hidden");
  openFinalsBracketHeaderBtn.classList.remove("hidden");

  if (bracket?.finalized) {
    const desc = "決勝トーナメント表は確定済みです。";
    const label = "決勝トーナメントを見る";
    bracketLinkDescEl.textContent = desc;
    if (bracketLinkDescTopEl) {
      bracketLinkDescTopEl.textContent = desc;
    }
    openFinalsBracketBtn.textContent = label;
    if (openFinalsBracketTopBtn) {
      openFinalsBracketTopBtn.textContent = label;
    }
    openFinalsBracketHeaderBtn.textContent = label;
    return;
  }

  const desc = usesLegacyFinalsAdvancement(tournament)
    ? "決勝進出確定後、シード配置でトーナメント表を作成できます。"
    : "決勝進出確定後、トーナメント表を作成できます。";
  const label = "決勝トーナメントを作成";
  bracketLinkDescEl.textContent = desc;
  if (bracketLinkDescTopEl) {
    bracketLinkDescTopEl.textContent = desc;
  }
  openFinalsBracketBtn.textContent = label;
  if (openFinalsBracketTopBtn) {
    openFinalsBracketTopBtn.textContent = label;
  }
  openFinalsBracketHeaderBtn.textContent = label;
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
  if (openFinalsBracketTopBtn) {
    openFinalsBracketTopBtn.href = bracketHref;
  }
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

    const preview = await previewFinalsAdvancement(tournamentId, tournament);
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

async function handleSaveWildcardMolkkyOut(groupKey) {
  if (isSavingMolkkyOut) {
    return;
  }

  const needs = currentPreview?.selection?.needsMolkkyOut;
  if (!needs || needs.scope !== "wildcard") {
    showErrorToast("対象の同順位グループが見つかりません。");
    return;
  }

  const expectedKey = wildcardGroupKey(needs);
  if (groupKey !== expectedKey) {
    showErrorToast("対象の同順位グループが見つかりません。");
    return;
  }

  const orderedEntryIds = readMolkkyOutOrder(molkkyOutAlertEl, groupKey);
  isSavingMolkkyOut = true;

  try {
    await upsertMolkkyOutResolution(tournamentId, {
      wildcardGroup: {
        rankBand: needs.rankBand,
        entryIds: needs.entryIds,
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

async function handleFinalizeAdvancement() {
  if (isFinalizingAdvancement) {
    return;
  }

  isFinalizingAdvancement = true;
  setFinalizeButtonsBusy(true);

  try {
    const tournament = currentTournament ?? (await getTournament(tournamentId));
    const qualifierCount = resolveQualifierCount(tournament, currentPreview, null);

    const result = await saveFinalsAdvancement(tournamentId, tournament, qualifierCount);
    warnSnapshotRebuildFailure(result);
    // 成功後は再有効化せず、既存のトーナメント生成 UI がある決勝画面へ遷移する
    window.location.assign(buildTournamentFinalsBracketHref(tournamentId));
  } catch (error) {
    const { message } = classifyError(error);
    showErrorToast(message);
    isFinalizingAdvancement = false;
    setFinalizeButtonsBusy(false);
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

function initAdvancementPage() {
  tournamentId = new URLSearchParams(window.location.search).get("id");
  finalizeAdvancementBtn.addEventListener("click", handleFinalizeAdvancement);
  finalizeAdvancementTopBtn?.addEventListener("click", handleFinalizeAdvancement);

  molkkyOutAlertEl?.addEventListener("click", (event) => {
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
        moveMolkkyOutOrderItem(molkkyOutAlertEl, groupKey, direction, entryId);
      }
      return;
    }

    const saveBtn = target.closest("[data-molkky-save]");
    if (saveBtn instanceof HTMLElement) {
      const groupKey = saveBtn.getAttribute("data-molkky-save");
      if (groupKey) {
        handleSaveWildcardMolkkyOut(groupKey);
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
  document.addEventListener("DOMContentLoaded", initAdvancementPage);
} else {
  initAdvancementPage();
}
