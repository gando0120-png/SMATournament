/**
 * 決勝トーナメント表ページ（進行状況対応）
 */
import {
  FinalsMatchDisplayStatus,
  buildFinalsMatchProgressIndex,
  getFinalsBracketMatchAction,
  getFinalsChampionAndRunnerUp,
  getFinalsMatchDisplayStatusLabel,
  resolveFinalsMatchTeams,
} from "../../domain/finals-match-progress.js";
import { TournamentStatus } from "../../domain/constants.js";
import { getTournamentResultParticipants, canFinalizeTournament } from "../../domain/tournament-results.js";
import {
  resolveTournamentFormat,
  TournamentFormat,
  usesLegacyFinalsAdvancement,
} from "../../domain/tournament-format.js";
import { isSingleEliminationBracket } from "../../domain/single-elimination-bracket.js";
import { isValidTournamentId } from "../../domain/validators.js";
import { getTournament } from "../../services/tournament-service.js";
import { getFinalsAdvancement } from "../../services/finals-advancement-service.js";
import {
  getFinalsBracket,
  previewFinalsBracket,
  regenerateFinalsBracket,
  resolveFinalsAdvancementForBracketBuild,
  saveFinalsBracket,
} from "../../services/finals-bracket-service.js";
import {
  ensureFinalsByeResults,
  getFinalsMatchResults,
  loadFinalsMatchProgressData,
} from "../../services/finals-match-result-service.js";
import {
  startFinalsMatchSession,
} from "../../services/finals-match-session-service.js";
import { needsFinalsBracketTeamDataRepair } from "../../domain/finals-bracket.js";
import { assessFinalsBracketRegeneration } from "../../domain/finals-bracket-regeneration.js";
import { getTournamentResults } from "../../services/tournament-results-service.js";
import { initTournamentManageGuard } from "../../lib/operator-guard.js";
import {
  classifyError,
  InvalidTournamentIdError,
} from "../../lib/errors.js";
import { showErrorToast, showToast } from "../components/toast.js";
import { confirmDialog } from "../components/confirm-dialog.js";
import { showFormAlert } from "../components/form-errors.js";
import { warnSnapshotRebuildFailure } from "../../lib/public-snapshot-ui.js";
import { groupBracketMatchesByRound } from "../../domain/finals-bracket-display.js";
import { mountFinalsBracketView } from "../components/finals-bracket-view.js";
import { BracketKind } from "../../domain/bracket-collections.js";
import { assessConsolationEligibility } from "../../domain/consolation-participants.js";
import { hasCreatedConsolationBracket } from "../../domain/consolation-bracket.js";
import { ensureConsolationCourtNumbers } from "../../domain/finals-court-assignment.js";
import {
  createConsolationBracket,
  getConsolationBracket,
} from "../../services/consolation-bracket-service.js";
import { listEntries } from "../../services/entry-service.js";
import {
  buildConsolationCreateConfirmMessage,
  formatConsolationBracketMeta,
  formatConsolationTargetLine,
  getConsolationEligibilityHintMessage,
  getBracketViewParamFromSearch,
  resolveActiveBracketKindFromViewParam,
  shouldShowConsolationCreateButton,
  shouldShowConsolationEligibilityHint,
  syncBracketViewUrl,
  buildFinalsMatchPageHref,
} from "../consolation-bracket-ui.js";
import {
  resolveAdminBracketViewState,
  writeBracketViewStateToSession,
} from "../finals-bracket-view-state.js";

const views = {
  loading: document.getElementById("viewLoading"),
  config: document.getElementById("viewConfig"),
  operatorDenied: document.getElementById("viewOperatorDenied"),
  error: document.getElementById("viewError"),
  empty: document.getElementById("viewEmpty"),
  invalid: document.getElementById("viewInvalid"),
  bracket: document.getElementById("viewBracket"),
};

const headerActions = document.getElementById("headerActions");
const backToDashboardBtn = document.getElementById("backToDashboardBtn");
const openAdvancementBtn = document.getElementById("openAdvancementBtn");
const emptyAdvancementBtn = document.getElementById("emptyAdvancementBtn");
const invalidAdvancementBtn = document.getElementById("invalidAdvancementBtn");
const bracketPageTitleEl = document.getElementById("bracketPageTitle");
const bracketMetaEl = document.getElementById("bracketMeta");
const finalizedBadgeEl = document.getElementById("finalizedBadge");
const bracketRoundsEl = document.getElementById("bracketRounds");
const finalizePanelEl = document.getElementById("finalizePanel");
const finalizeBracketBtn = document.getElementById("finalizeBracketBtn");
const regeneratePanelEl = document.getElementById("regeneratePanel");
const regenerateBracketBtn = document.getElementById("regenerateBracketBtn");
const regeneratePanelDescEl = document.getElementById("regeneratePanelDesc");
const championPanelEl = document.getElementById("championPanel");
const championLineEl = document.getElementById("championLine");
const runnerUpLineEl = document.getElementById("runnerUpLine");
const finalizeResultsPanelEl = document.getElementById("finalizeResultsPanel");
const emptyViewTitleEl = document.querySelector("#viewEmpty .panel__title");
const emptyViewDescEl = document.querySelector("#viewEmpty .panel__desc");
const openResultsPageBtn = document.getElementById("openResultsPageBtn");
const bracketKindTabsEl = document.getElementById("bracketKindTabs");
const bracketKindTabButtons = bracketKindTabsEl
  ? [...bracketKindTabsEl.querySelectorAll("[data-bracket-kind]")]
  : [];
const consolationCreatePanelEl = document.getElementById("consolationCreatePanel");
const consolationTargetLineEl = document.getElementById("consolationTargetLine");
const consolationHintLineEl = document.getElementById("consolationHintLine");
const createConsolationBtn = document.getElementById("createConsolationBtn");

let tournamentId = null;
/** @type {ReturnType<typeof mountFinalsBracketView> | null} */
let bracketViewController = null;
const pendingStartMatchIds = new Set();
/** @type {string} */
let activeBracketKind = BracketKind.MAIN;
let createConsolationPending = false;
let matchActionsEnabled = true;
/** @type {object|null} */
let pageContext = null;

function showView(name) {
  Object.entries(views).forEach(([key, el]) => {
    if (el) {
      el.classList.toggle("hidden", key !== name);
    }
  });
  if (headerActions) {
    headerActions.classList.toggle(
      "hidden",
      name !== "bracket" && name !== "empty" && name !== "invalid"
    );
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

function buildTournamentFinalsAdvancementHref(id) {
  return `tournament-finals-advancement.html?id=${encodeURIComponent(id)}`;
}

function buildFinalsMatchHref(matchId, { enterResult = false } = {}) {
  const displayState = bracketViewController?.getViewState?.() ?? null;
  return buildFinalsMatchPageHref(tournamentId, matchId, {
    enterResult,
    bracketKind: activeBracketKind,
    viewMode: displayState?.viewMode ?? null,
    roundNumber: displayState?.roundNumber ?? null,
  });
}

function persistBracketViewState(state) {
  if (!tournamentId || !state?.viewMode) {
    return;
  }
  writeBracketViewStateToSession(tournamentId, activeBracketKind, state);
  syncBracketViewUrl(tournamentId, activeBracketKind, state);
}

function destroyBracketViewController() {
  bracketViewController?.destroy?.();
  bracketViewController = null;
}

function buildTournamentResultsHref(id) {
  return `tournament-results.html?id=${encodeURIComponent(id)}`;
}

function setNavigationLinks() {
  const dashboardHref = buildTournamentDashboardHref(tournamentId);
  const advancementHref = buildTournamentFinalsAdvancementHref(tournamentId);
  backToDashboardBtn.href = dashboardHref;
  openAdvancementBtn.href = advancementHref;
  emptyAdvancementBtn.href = advancementHref;
  invalidAdvancementBtn.href = advancementHref;
}

function formatTeamLine(
  team,
  { highlightWinner = false, isWinner = false, isLoser = false, hideSeed = false, displayStatus = null } = {}
) {
  if (!team) {
    return `<span class="finals-bracket__pending">対戦相手未定</span>`;
  }
  if (team.isBye) {
    return `<span class="finals-bracket__bye">BYE</span>`;
  }
  const winnerClass =
    highlightWinner && isWinner ? " finals-bracket__team--winner" : "";
  const loserClass =
    highlightWinner && isLoser ? " finals-bracket__team--loser" : "";
  const winnerMark =
    highlightWinner && isWinner ? `<span class="finals-bracket__winner-mark" aria-hidden="true">✓ </span>` : "";
  const seedPrefix = hideSeed
    ? ""
    : `<span class="finals-bracket__seed">seed ${team.seed ?? "—"}</span>`;
  const nameClass = `${winnerClass}${loserClass}`.trim();
  return `${seedPrefix}${winnerMark}<span class="${nameClass}">${escapeHtml(team.teamName ?? "—")}</span>`;
}

/**
 * 進出チーム一覧テーブル HTML を構築する。
 * ブラケット画面では対戦表と重複するため通常は描画しない。
 * 将来の折りたたみ表示で再利用できるようロジックは残す。
 *
 * @param {Array<object>|null|undefined} qualifiers
 * @param {{ hideSeed?: boolean }} [options]
 * @returns {string}
 */
function buildQualifiersTableHtml(qualifiers, options = {}) {
  const { hideSeed = false } = options;

  if (!qualifiers?.length) {
    return "";
  }

  const thead = hideSeed
    ? `
          <th scope="col">チーム</th>
          <th scope="col">ブロック</th>
          <th scope="col">順位</th>
        `
    : `
          <th scope="col">Seed</th>
          <th scope="col">チーム</th>
          <th scope="col">ブロック</th>
        `;

  const sorted = hideSeed
    ? [...qualifiers].sort((a, b) => {
        const blockCompare = String(a.blockId ?? "").localeCompare(String(b.blockId ?? ""), "ja");
        if (blockCompare !== 0) {
          return blockCompare;
        }
        return (a.blockRank ?? 0) - (b.blockRank ?? 0);
      })
    : [...qualifiers].sort((a, b) => (a.seed ?? 0) - (b.seed ?? 0));

  const rows = sorted
    .map((entry) =>
      hideSeed
        ? `
        <tr>
          <td class="standings-table__team">${escapeHtml(entry.teamName ?? "—")}</td>
          <td>${escapeHtml(entry.blockName ?? entry.blockId ?? "—")}</td>
          <td class="standings-table__num">${entry.blockRank ?? "—"}</td>
        </tr>
      `
        : `
        <tr>
          <td class="standings-table__rank">${entry.seed ?? "—"}</td>
          <td class="standings-table__team">${escapeHtml(entry.teamName ?? "—")}</td>
          <td>${escapeHtml(entry.blockName ?? entry.blockId ?? "—")}</td>
        </tr>
      `
    )
    .join("");

  return `
    <div class="standings-table-wrap">
      <table class="standings-table">
        <thead><tr>${thead}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function getMatchTeamsForDisplay(matchEntry) {
  const { match, result, session, resolvedTeams } = matchEntry;

  if (result?.winner) {
    const team1 = result.team1 ?? resolvedTeams.team1;
    const team2 = result.team2 ?? resolvedTeams.team2;
    return {
      team1,
      team2,
      winnerEntryId: result.winner.entryId,
    };
  }

  if (session?.team1 && session?.team2) {
    return {
      team1: session.team1,
      team2: session.team2,
      winnerEntryId: null,
    };
  }

  if (match.roundNumber === 1) {
    return {
      team1: match.team1?.isBye ? null : match.team1,
      team2: match.team2?.isBye ? null : match.team2,
      winnerEntryId: null,
    };
  }

  return {
    team1: resolvedTeams.team1,
    team2: resolvedTeams.team2,
    winnerEntryId: null,
  };
}

function renderMatchActions(matchEntry) {
  if (!matchActionsEnabled) {
    return "";
  }

  const { match, displayStatus } = matchEntry;
  const action = getFinalsBracketMatchAction(displayStatus);

  if (action.kind === "none") {
    return "";
  }

  if (action.kind === "start") {
    return `<button type="button" class="btn btn--primary btn--block finals-bracket__action" data-finals-start-match="${escapeHtml(match.matchId)}">${escapeHtml(action.label)}</button>`;
  }

  return `<a href="${buildFinalsMatchHref(match.matchId)}" class="btn btn--ghost btn--block finals-bracket__action">${escapeHtml(action.label)}</a>`;
}

async function handleBracketStartMatch(matchId, button) {
  if (!matchId || pendingStartMatchIds.has(matchId)) {
    return;
  }

  pendingStartMatchIds.add(matchId);
  if (button) {
    button.disabled = true;
  }

  try {
    await startFinalsMatchSession(tournamentId, matchId, { bracketKind: activeBracketKind });
    window.location.href = buildFinalsMatchHref(matchId, { enterResult: true });
  } catch (error) {
    pendingStartMatchIds.delete(matchId);
    if (button) {
      button.disabled = false;
    }
    const { message } = classifyError(error);
    showErrorToast(message);
  }
}

function handleBracketMatchActionClick(event) {
  const button = event.target.closest("[data-finals-start-match]");
  if (!button || button.disabled) {
    return;
  }

  const matchId = button.dataset.finalsStartMatch;
  if (!matchId) {
    return;
  }

  event.preventDefault();
  handleBracketStartMatch(matchId, button);
}

function initBracketMatchActions() {
  if (!bracketRoundsEl || bracketRoundsEl.dataset.matchActionsBound === "true") {
    return;
  }

  bracketRoundsEl.dataset.matchActionsBound = "true";
  bracketRoundsEl.addEventListener("click", handleBracketMatchActionClick);
}

function buildBracketDisplayRounds(bracket, progressIndex) {
  return groupBracketMatchesByRound(bracket).map((round) => ({
    ...round,
    matches: round.matches.map((match) => {
      const entry = progressIndex.get(match.matchId);
      const displayStatus = entry?.displayStatus ?? FinalsMatchDisplayStatus.WAITING_OPPONENT;
      const teams = getMatchTeamsForDisplay(
        entry ?? {
          match,
          resolvedTeams: resolveFinalsMatchTeams({ match, bracket, resultsMap: new Map() }),
        }
      );

      return {
        match,
        entry,
        displayStatus,
        statusLabel: getFinalsMatchDisplayStatusLabel(displayStatus),
        teams,
      };
    }),
  }));
}

function renderBracketRounds(bracket, progressIndex, options = {}) {
  const hideSeed = options.hideSeed === true;
  matchActionsEnabled = options.allowMatchActions !== false;
  const rounds = buildBracketDisplayRounds(bracket, progressIndex);
  const displayState = resolveAdminBracketViewState({
    tournamentId,
    bracketKind: activeBracketKind,
    search: window.location.search,
    rounds,
  });

  const viewOptions = {
    surface: "admin",
    hideSeed,
    escapeHtml,
    rounds,
    initialViewMode: displayState.viewMode,
    initialRoundNumber: displayState.roundNumber,
    onViewStateChange: persistBracketViewState,
    renderAdminTeamLine: ({ team, highlightWinner, isWinner, isLoser, hideSeed: hideSeedOption, displayStatus }) =>
      formatTeamLine(team, {
        highlightWinner,
        isWinner,
        isLoser,
        hideSeed: hideSeedOption,
        displayStatus,
      }),
    renderAdminMatchActions: (matchContext) => renderMatchActions(matchContext.entry ?? matchContext),
    getAdminDisplayStatus: (matchContext) => matchContext.displayStatus,
  };

  if (!bracketViewController) {
    bracketViewController = mountFinalsBracketView(bracketRoundsEl, viewOptions);
    return;
  }

  // 同一ブラケット内の再描画では選択状態を維持（initial は渡さない）
  bracketViewController.update({
    rounds: viewOptions.rounds,
    hideSeed: viewOptions.hideSeed,
    onViewStateChange: persistBracketViewState,
  });
}

function renderFinalizeResultsPanel(
  tournament,
  advancement,
  bracket,
  resultsMap,
  savedResults,
  { consolationBracket = null, consolationResultsMap = new Map() } = {}
) {
  if (!finalizeResultsPanelEl || !openResultsPageBtn) {
    return;
  }

  const isClosed =
    tournament?.status === TournamentStatus.CLOSED || savedResults?.finalized;

  if (isClosed) {
    finalizeResultsPanelEl.classList.add("hidden");
    return;
  }

  const completionPreview = canFinalizeTournament({
    tournament,
    bracket,
    resultsMap,
    qualifiers: getTournamentResultParticipants(bracket, advancement),
    advancement,
    existingResults: savedResults,
    consolationBracket,
    consolationResultsMap,
  });

  const showPanel =
    tournament?.status === TournamentStatus.OPEN && bracket?.finalized === true;
  finalizeResultsPanelEl.classList.toggle("hidden", !showPanel);

  if (!showPanel) {
    return;
  }

  const descEl = finalizeResultsPanelEl.querySelector(".panel__desc");
  if (completionPreview.canFinalize) {
    if (descEl) {
      descEl.textContent = "決勝戦が終了しました。大会結果を確定してください。";
    }
    openResultsPageBtn.classList.remove("hidden");
    openResultsPageBtn.href = buildTournamentResultsHref(tournamentId);
    return;
  }

  if (descEl) {
    descEl.textContent = completionPreview.message ?? "大会を終了できる状態ではありません。";
  }
  openResultsPageBtn.classList.add("hidden");
}

function renderChampionPanel(bracket, resultsMap, hideSeed = false) {
  const { champion, runnerUp, complete } = getFinalsChampionAndRunnerUp(bracket, resultsMap);

  if (!complete || !champion) {
    championPanelEl.classList.add("hidden");
    return;
  }

  championPanelEl.classList.remove("hidden");
  const championSeed = hideSeed || champion.seed == null ? "" : ` (seed ${champion.seed})`;
  const runnerUpSeed = hideSeed || runnerUp?.seed == null ? "" : ` (seed ${runnerUp.seed})`;
  championLineEl.innerHTML = `<strong>優勝：</strong>${escapeHtml(champion.teamName ?? "—")}${championSeed}`;
  runnerUpLineEl.innerHTML = runnerUp
    ? `<strong>準優勝：</strong>${escapeHtml(runnerUp.teamName ?? "—")}${runnerUpSeed}`
    : "";
}

function resolveActiveBracketKindFromPageState() {
  const hasConsolation = hasCreatedConsolationBracket(pageContext?.consolationBracket);
  const viewParam = getBracketViewParamFromSearch(window.location.search);
  const requestedKind = resolveActiveBracketKindFromViewParam(viewParam, hasConsolation);
  activeBracketKind = requestedKind;
  if (viewParam === "consolation" && !hasConsolation) {
    syncBracketViewUrl(tournamentId, BracketKind.MAIN);
  }
}

function renderBracketKindTabs() {
  if (!bracketKindTabsEl) {
    return;
  }

  const hasConsolation = hasCreatedConsolationBracket(pageContext?.consolationBracket);
  bracketKindTabsEl.classList.toggle("hidden", !hasConsolation);

  for (const button of bracketKindTabButtons) {
    const kind =
      button.dataset.bracketKind === "consolation" ? BracketKind.CONSOLATION : BracketKind.MAIN;
    const selected = kind === activeBracketKind;
    button.classList.toggle("bracket-kind-tabs__btn--active", selected);
    button.setAttribute("aria-selected", selected ? "true" : "false");
  }
}

function renderConsolationCreatePanel() {
  if (!consolationCreatePanelEl) {
    return;
  }

  const eligibility = pageContext?.eligibility;
  const hasConsolation = hasCreatedConsolationBracket(pageContext?.consolationBracket);
  const mainFinalized = pageContext?.savedBracket?.finalized === true;
  const showCreate = shouldShowConsolationCreateButton(
    eligibility,
    hasConsolation,
    activeBracketKind,
    mainFinalized
  );
  const showHint =
    activeBracketKind === BracketKind.MAIN &&
    !showCreate &&
    shouldShowConsolationEligibilityHint(eligibility?.reasonCode);

  consolationCreatePanelEl.classList.toggle("hidden", !showCreate && !showHint);

  if (consolationTargetLineEl) {
    if (showCreate && eligibility?.participantCount != null) {
      consolationTargetLineEl.textContent = formatConsolationTargetLine(eligibility.participantCount);
      consolationTargetLineEl.classList.remove("hidden");
    } else {
      consolationTargetLineEl.classList.add("hidden");
    }
  }

  if (consolationHintLineEl) {
    const hint = showHint ? getConsolationEligibilityHintMessage(eligibility?.reasonCode) : null;
    consolationHintLineEl.textContent = hint ?? "";
    consolationHintLineEl.classList.toggle("hidden", !hint);
  }

  if (createConsolationBtn) {
    createConsolationBtn.classList.toggle("hidden", !showCreate);
    if (!createConsolationPending) {
      createConsolationBtn.disabled = false;
      createConsolationBtn.textContent = "下位トーナメントを作成";
    }
  }
}

function renderConsolationBracketView(tournament, { bracket, progressIndex, resultsMap }) {
  const tournamentName = tournament?.name || "（名称未設定）";

  bracketPageTitleEl.textContent = "下位トーナメント";
  bracketMetaEl.textContent = `${tournamentName} / ${formatConsolationBracketMeta(bracket)}`;
  finalizedBadgeEl.classList.remove("hidden");

  openAdvancementBtn?.classList.remove("hidden");
  championPanelEl?.classList.add("hidden");
  finalizeResultsPanelEl?.classList.add("hidden");
  finalizePanelEl?.classList.add("hidden");
  regeneratePanelEl?.classList.add("hidden");

  renderBracketRounds(bracket, progressIndex, { hideSeed: true });
}

function renderActiveBracketView() {
  if (!pageContext) {
    return;
  }

  renderBracketKindTabs();
  renderConsolationCreatePanel();

  if (activeBracketKind === BracketKind.CONSOLATION && pageContext.consolationBracket) {
    renderConsolationBracketView(pageContext.tournament, {
      bracket: pageContext.consolationBracket,
      progressIndex: pageContext.consolationProgressIndex,
      resultsMap: pageContext.consolationResultsMap,
    });
    return;
  }

  renderBracketView(pageContext.tournament, {
    bracket: pageContext.displayBracket,
    advancement: pageContext.advancement,
    finalized: pageContext.displayFinalized,
    progressIndex: pageContext.mainProgressIndex,
    resultsMap: pageContext.mainResultsMap,
    savedResults: pageContext.savedResults,
    consolationBracket: pageContext.consolationBracket,
    consolationResultsMap: pageContext.consolationResultsMap,
  });
}

function setActiveBracketKind(nextKind, { updateUrl = true } = {}) {
  if (nextKind === activeBracketKind) {
    return;
  }

  activeBracketKind = nextKind;
  destroyBracketViewController();
  if (updateUrl) {
    // タブ切替時は URL の旧ラウンドを引き継がず、種別ごとの session を優先
    const restored = resolveAdminBracketViewState({
      tournamentId,
      bracketKind: activeBracketKind,
      search: "",
      rounds: [],
    });
    syncBracketViewUrl(tournamentId, activeBracketKind, {
      viewMode: restored.viewMode,
      roundNumber: restored.roundNumber,
    });
  }
  renderActiveBracketView();
}

async function handleCreateConsolationBracket() {
  if (createConsolationPending || !pageContext?.eligibility?.eligible) {
    return;
  }

  const participantCount = pageContext.eligibility.participantCount ?? 0;
  const confirmed = await confirmDialog({
    title: "下位トーナメントの作成",
    message: buildConsolationCreateConfirmMessage(participantCount),
    confirmLabel: "作成する",
    cancelLabel: "キャンセル",
  });

  if (!confirmed) {
    return;
  }

  createConsolationPending = true;
  if (createConsolationBtn) {
    createConsolationBtn.disabled = true;
    createConsolationBtn.textContent = "作成中…";
  }

  try {
    await createConsolationBracket(tournamentId);
    showToast("下位トーナメントを作成しました。");
    activeBracketKind = BracketKind.CONSOLATION;
    destroyBracketViewController();
    syncBracketViewUrl(tournamentId, BracketKind.CONSOLATION, {
      viewMode: resolveAdminBracketViewState({
        tournamentId,
        bracketKind: BracketKind.CONSOLATION,
        search: "",
        rounds: [],
      }).viewMode,
      roundNumber: null,
    });
    await loadPage();
  } catch (error) {
    console.error("[finals-bracket] create consolation failed", error);
    const { code, message } = classifyError(error);
    if (code === "consolation-bracket/already-created") {
      showToast("下位トーナメントはすでに作成されています。");
      activeBracketKind = BracketKind.CONSOLATION;
      destroyBracketViewController();
      syncBracketViewUrl(tournamentId, BracketKind.CONSOLATION, {
        viewMode: resolveAdminBracketViewState({
          tournamentId,
          bracketKind: BracketKind.CONSOLATION,
          search: "",
          rounds: [],
        }).viewMode,
        roundNumber: null,
      });
      await loadPage();
      return;
    }
    showErrorToast(message);
  } finally {
    createConsolationPending = false;
    renderConsolationCreatePanel();
  }
}

function handleBracketKindTabClick(event) {
  const button = event.target.closest("[data-bracket-kind]");
  if (!button || button.disabled) {
    return;
  }

  const nextKind =
    button.dataset.bracketKind === "consolation" ? BracketKind.CONSOLATION : BracketKind.MAIN;
  setActiveBracketKind(nextKind);
}

function initBracketKindTabs() {
  if (!bracketKindTabsEl || bracketKindTabsEl.dataset.bound === "true") {
    return;
  }
  bracketKindTabsEl.dataset.bound = "true";
  bracketKindTabsEl.addEventListener("click", handleBracketKindTabClick);
}

async function loadConsolationPageData(tournament, rawAdvancement, savedBracket, savedResults) {
  const [entries, consolationBracket] = await Promise.all([
    listEntries(tournamentId),
    getConsolationBracket(tournamentId),
  ]);

  const eligibility = assessConsolationEligibility({
    tournament,
    entries,
    advancement: rawAdvancement,
    mainBracket: savedBracket,
    tournamentResults: savedResults,
    consolationBracket,
  });

  let consolationResultsMap = new Map();
  let consolationSessionsMap = new Map();
  let consolationProgressIndex = new Map();

  if (hasCreatedConsolationBracket(consolationBracket)) {
    const enrichedConsolationBracket = ensureConsolationCourtNumbers(consolationBracket, {
      mainBracket: savedBracket,
      tournamentCourtCount: tournament?.courtCount,
    });
    const progress = await loadFinalsMatchProgressData(tournamentId, {
      bracketKind: BracketKind.CONSOLATION,
    });
    consolationResultsMap = progress.resultsMap;
    consolationSessionsMap = progress.sessionsMap;
    consolationProgressIndex = buildFinalsMatchProgressIndex(
      enrichedConsolationBracket,
      consolationResultsMap,
      consolationSessionsMap
    );

    return {
      entries,
      consolationBracket: enrichedConsolationBracket,
      eligibility,
      consolationResultsMap,
      consolationSessionsMap,
      consolationProgressIndex,
    };
  }

  return {
    entries,
    consolationBracket,
    eligibility,
    consolationResultsMap,
    consolationSessionsMap,
    consolationProgressIndex,
  };
}

function renderBracketView(
  tournament,
  {
    bracket,
    advancement,
    finalized,
    progressIndex,
    resultsMap,
    savedResults,
    consolationBracket = null,
    consolationResultsMap = new Map(),
  }
) {
  const tournamentName = tournament?.name || "（名称未設定）";
  const isSingleElim =
    isSingleEliminationBracket(bracket) ||
    resolveTournamentFormat(tournament) === TournamentFormat.SINGLE_ELIMINATION;
  const hideSeed = isSingleElim || !usesLegacyFinalsAdvancement(tournament);
  const participantCount =
    bracket?.teamCount ?? bracket?.qualifierCount ?? advancement?.qualifiers?.length ?? 0;
  const bracketSize = bracket?.bracketSize ?? "—";
  const titleBase = isSingleElim ? "一発トーナメント" : "決勝トーナメント";

  bracketPageTitleEl.textContent = finalized ? `${titleBase}（確定済み）` : `${titleBase}（プレビュー）`;
  bracketMetaEl.textContent = `${tournamentName} / ${participantCount} チーム / ${bracketSize} 枠`;
  finalizedBadgeEl.classList.toggle("hidden", !finalized);

  openAdvancementBtn?.classList.toggle("hidden", isSingleElim);

  renderChampionPanel(bracket, resultsMap, hideSeed);
  renderFinalizeResultsPanel(tournament, advancement, bracket, resultsMap, savedResults, {
    consolationBracket,
    consolationResultsMap,
  });
  renderBracketRounds(bracket, progressIndex, { hideSeed, allowMatchActions: true });
  finalizePanelEl.classList.toggle("hidden", finalized || isSingleElim);
  renderRegeneratePanel({
    tournament,
    bracket,
    finalized,
    isSingleElim,
    resultsMap,
    sessionsMap: pageContext?.mainSessionsMap ?? new Map(),
    consolationBracket,
  });
}

function renderRegeneratePanel({
  tournament,
  bracket,
  finalized,
  isSingleElim,
  resultsMap,
  sessionsMap,
  consolationBracket,
}) {
  if (!regeneratePanelEl || !regenerateBracketBtn) {
    return;
  }

  if (!finalized || isSingleElim || activeBracketKind !== BracketKind.MAIN) {
    regeneratePanelEl.classList.add("hidden");
    return;
  }

  const assessment = assessFinalsBracketRegeneration({
    tournament,
    bracket,
    resultsMap,
    sessionsMap,
    consolationBracket,
  });

  if (!assessment.canRegenerate) {
    regeneratePanelEl.classList.add("hidden");
    return;
  }

  if (regeneratePanelDescEl) {
    regeneratePanelDescEl.textContent =
      "試合結果が未登録の場合のみ、組み合わせを再抽選できます。進出チームはそのままです。";
  }
  regenerateBracketBtn.disabled = false;
  regenerateBracketBtn.textContent = "トーナメントを再生成する";
  regeneratePanelEl.classList.remove("hidden");
}

function showPageError(message) {
  showFormAlert(document.getElementById("errorAlert"), message, "error");
  showView("error");
}

function configureEmptyView(isSingleElim) {
  if (isSingleElim) {
    if (emptyViewTitleEl) {
      emptyViewTitleEl.textContent = "トーナメント表が未作成です";
    }
    if (emptyViewDescEl) {
      emptyViewDescEl.textContent =
        "大会管理ダッシュボードからトーナメント表を作成してください。";
    }
    emptyAdvancementBtn?.classList.add("hidden");
    return;
  }

  if (emptyViewTitleEl) {
    emptyViewTitleEl.textContent = "決勝進出が未確定です";
  }
  if (emptyViewDescEl) {
    emptyViewDescEl.textContent = "先に決勝進出チームを確定してください。";
  }
  emptyAdvancementBtn?.classList.remove("hidden");
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
    const [tournament, rawAdvancement, savedBracket, savedResults] = await Promise.all([
      getTournament(tournamentId),
      getFinalsAdvancement(tournamentId),
      getFinalsBracket(tournamentId),
      getTournamentResults(tournamentId),
    ]);
    let advancement = rawAdvancement;

    const isSingleElim = resolveTournamentFormat(tournament) === TournamentFormat.SINGLE_ELIMINATION;
    configureEmptyView(isSingleElim);

    if (!isSingleElim && advancement?.finalized) {
      advancement = (await resolveFinalsAdvancementForBracketBuild(tournamentId, advancement)) ?? advancement;
    }

    if (isSingleElim) {
      if (!savedBracket?.finalized) {
        showView("empty");
        return;
      }

      await ensureFinalsByeResults(tournamentId);
      const { resultsMap, sessionsMap } = await loadFinalsMatchProgressData(tournamentId);
      const progressIndex = buildFinalsMatchProgressIndex(
        savedBracket,
        resultsMap,
        sessionsMap
      );

      pageContext = {
        tournament,
        advancement: null,
        savedBracket,
        savedResults,
        displayBracket: savedBracket,
        displayFinalized: true,
        mainProgressIndex: progressIndex,
        mainResultsMap: resultsMap,
        mainSessionsMap: sessionsMap,
        entries: [],
        consolationBracket: null,
        eligibility: { eligible: false, reasonCode: "UNSUPPORTED_FORMAT", participantCount: 0 },
        consolationResultsMap: new Map(),
        consolationSessionsMap: new Map(),
        consolationProgressIndex: new Map(),
      };
      activeBracketKind = BracketKind.MAIN;
      renderActiveBracketView();
      showView("bracket");
      return;
    }

    if (!advancement?.finalized) {
      showView("empty");
      return;
    }

    if (savedBracket?.finalized) {
      if (needsFinalsBracketTeamDataRepair(savedBracket)) {
        const resultsMap = await getFinalsMatchResults(tournamentId);
        if (resultsMap.size === 0) {
          const confirmed = await confirmDialog({
            title: "トーナメント表の再生成",
            message:
              "保存済みのトーナメント表にチーム情報が欠落しています。\n\n試合未開始のため、決勝進出データから再生成できます。",
            confirmLabel: "再生成する",
            cancelLabel: "キャンセル",
          });
          if (confirmed) {
            const result = await saveFinalsBracket(tournamentId);
            warnSnapshotRebuildFailure(result);
            showToast("トーナメント表を再生成しました。");
            await loadPage();
            return;
          }
        }
      }

      await ensureFinalsByeResults(tournamentId);
      const { resultsMap, sessionsMap } = await loadFinalsMatchProgressData(tournamentId);
      const progressIndex = buildFinalsMatchProgressIndex(
        savedBracket,
        resultsMap,
        sessionsMap
      );

      const consolationData = await loadConsolationPageData(
        tournament,
        advancement,
        savedBracket,
        savedResults
      );

      pageContext = {
        tournament,
        advancement,
        savedBracket,
        savedResults,
        displayBracket: savedBracket,
        displayFinalized: true,
        mainProgressIndex: progressIndex,
        mainResultsMap: resultsMap,
        mainSessionsMap: sessionsMap,
        ...consolationData,
      };
      resolveActiveBracketKindFromPageState();
      renderActiveBracketView();
      showView("bracket");
      return;
    }

    const preview = await previewFinalsBracket(tournamentId);
    if (!preview.canFinalize || !preview.bracket) {
      showFormAlert(
        document.getElementById("invalidAlert"),
        preview.message || "トーナメント表を生成できません。",
        "error"
      );
      showView("invalid");
      return;
    }

    advancement = preview.advancement ?? advancement;

    const consolationData = await loadConsolationPageData(
      tournament,
      advancement,
      null,
      savedResults
    );

    pageContext = {
      tournament,
      advancement,
      savedBracket: null,
      savedResults: null,
      displayBracket: preview.bracket,
      displayFinalized: false,
      mainProgressIndex: new Map(),
      mainResultsMap: new Map(),
      mainSessionsMap: new Map(),
      ...consolationData,
    };
    activeBracketKind = BracketKind.MAIN;
    renderActiveBracketView();
    showView("bracket");
  } catch (error) {
    console.error("[finals-bracket] loadPage failed", error);
    const { message } = classifyError(error);
    showPageError(message);
  }
}

async function handleFinalizeBracket() {
  const confirmed = await confirmDialog({
    title: "決勝トーナメントの確定",
    message:
      "このシード配置で決勝トーナメントを確定します。\n確定後は変更できません。",
    confirmLabel: "トーナメントを確定する",
    cancelLabel: "キャンセル",
  });

  if (!confirmed) {
    return;
  }

  finalizeBracketBtn.disabled = true;

  try {
    const result = await saveFinalsBracket(tournamentId);
    warnSnapshotRebuildFailure(result);
    showToast("決勝トーナメント表を確定しました。");
    await loadPage();
  } catch (error) {
    console.error("[finals-bracket] finalize failed", error);
    const { message } = classifyError(error);
    showErrorToast(message);
  } finally {
    finalizeBracketBtn.disabled = false;
  }
}

async function handleRegenerateBracket() {
  if (!regenerateBracketBtn || regenerateBracketBtn.disabled) {
    return;
  }

  const confirmed = await confirmDialog({
    title: "トーナメントの再生成",
    message:
      "組み合わせを再抽選します。\n進出チームは変更されません。\n\n試合結果が未登録の場合のみ実行できます。",
    confirmLabel: "再生成する",
    cancelLabel: "キャンセル",
  });

  if (!confirmed) {
    return;
  }

  regenerateBracketBtn.disabled = true;
  regenerateBracketBtn.textContent = "再生成中…";

  try {
    const result = await regenerateFinalsBracket(tournamentId);
    warnSnapshotRebuildFailure(result);
    showToast("トーナメントを再生成しました。");
    await loadPage();
  } catch (error) {
    console.error("[finals-bracket] regenerate failed", error);
    const { message } = classifyError(error);
    showErrorToast(message);
    regenerateBracketBtn.disabled = false;
    regenerateBracketBtn.textContent = "トーナメントを再生成する";
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

function initBracketPage() {
  try {
    tournamentId = new URLSearchParams(window.location.search).get("id");

    if (!isValidTournamentId(tournamentId)) {
      const { message } = classifyError(new InvalidTournamentIdError());
      showPageError(message);
      return;
    }

    finalizeBracketBtn?.addEventListener("click", handleFinalizeBracket);
    regenerateBracketBtn?.addEventListener("click", handleRegenerateBracket);
    createConsolationBtn?.addEventListener("click", handleCreateConsolationBracket);
    initBracketMatchActions();
    initBracketKindTabs();

    initTournamentManageGuard({
      tournamentId,
      onConfigRequired: initConfigView,
      onAccessDenied: initAccessDeniedView,
      onReady: () => {
        loadPage();
      },
    });
  } catch (error) {
    console.error("[finals-bracket] init failed", error);
    const { message } = classifyError(error);
    showPageError(message || "決勝トーナメントを読み込めませんでした。再読み込みしてください。");
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initBracketPage);
} else {
  initBracketPage();
}
