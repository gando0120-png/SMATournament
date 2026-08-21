/**
 * 敗戦帯（loss_band）運営進行ページ
 * 既存 SE ブラケット画面は使わない。ラウンド全試合完了時に service が次ラウンドを自動生成。
 */
import {
  resolveMainRankingMode,
  formatLossBandTournamentStatusLabel,
} from "../../domain/loss-band/config.js";
import { LossBandMatchPurpose, RankingMode } from "../../domain/loss-band/constants.js";
import {
  bracketSizeFromState,
  rankingRoundCountFromState,
} from "../../domain/loss-band/bracket.js";
import { formatLossBandPlacementLabel, buildPlacementRecords } from "../../domain/loss-band/placements.js";
import {
  listLossBandRounds,
  getLossBandState,
  getLossBandRound,
  getLossBandPlacements,
  getLossBandMatchResults,
  getLossBandMatchSessions,
  listLossBandExchangeRounds,
  getLossBandExchangeMatchSessions,
  startLossBandMatchSession,
  saveLossBandMatchResult,
  saveLossBandExchangeMatchResult,
} from "../../services/loss-band-service.js";
import { correctLossBandRankingResult } from "../../services/loss-band-ranking-result-correction-service.js";
import {
  pairingsFromRoundDoc,
  rebuildDomainStateFromCompletedRounds,
  resolveLossBandMatchSessionDisplay,
  assessLossBandRankingResultCorrection,
  buildLossBandRoundId,
  isLossBandRankingRoundDoc,
  LOSS_BAND_RESULT_EDIT_LOCKED_MESSAGE,
} from "../../domain/loss-band/persistence.js";
import { isValidTournamentId } from "../../domain/validators.js";
import { getTournament } from "../../services/tournament-service.js";
import { listEntries } from "../../services/entry-service.js";
import { initTournamentManageGuard } from "../../lib/operator-guard.js";
import {
  classifyError,
  InvalidTournamentIdError,
} from "../../lib/errors.js";
import { showErrorToast, showToast } from "../components/toast.js";
import { showFormAlert } from "../components/form-errors.js";
import { finalsMatchResultDialog } from "../components/finals-match-result-dialog.js";
import { buildFinalsMatchResultInitialValues } from "../../domain/finals-match-result.js";
import { resolveFinalsWinsRequired } from "../../domain/finals-match-format.js";
import { resolveBracketMatchConfig } from "../../domain/bracket-match-config.js";
import { getTournamentResults } from "../../services/tournament-results-service.js";

const views = {
  loading: document.getElementById("viewLoading"),
  config: document.getElementById("viewConfig"),
  operatorDenied: document.getElementById("viewOperatorDenied"),
  error: document.getElementById("viewError"),
  empty: document.getElementById("viewEmpty"),
  main: document.getElementById("viewMain"),
};

const headerActions = document.getElementById("headerActions");
const backToDashboardBtn = document.getElementById("backToDashboardBtn");
const emptyDashboardBtn = document.getElementById("emptyDashboardBtn");
const tournamentNameEl = document.getElementById("tournamentNameEl");
const statusLineEl = document.getElementById("statusLineEl");
const metaListEl = document.getElementById("metaListEl");
const progressLineEl = document.getElementById("progressLineEl");
const roundTitleEl = document.getElementById("roundTitleEl");
const bandsRoot = document.getElementById("bandsRoot");
const editRoundPanel = document.getElementById("editRoundPanel");
const editRoundTitleEl = document.getElementById("editRoundTitleEl");
const editRoundHintEl = document.getElementById("editRoundHintEl");
const editBandsRoot = document.getElementById("editBandsRoot");
const placementsPanel = document.getElementById("placementsPanel");
const placementsRoot = document.getElementById("placementsRoot");
const exchangePanel = document.getElementById("exchangePanel");
const exchangeRoot = document.getElementById("exchangeRoot");

let tournamentId = null;
/** @type {object|null} */
let currentTournament = null;
/** @type {object|null} */
let currentState = null;
/** @type {Map<string, object>} */
let teamNameByEntryId = new Map();
/** @type {Map<string, object>} */
let cachedSessions = new Map();
/** @type {Map<string, object>} */
let cachedResults = new Map();
/** @type {object|null} */
let cachedEditRound = null;
/** @type {object|null} */
let cachedNextRoundForEdit = null;
/** @type {boolean} */
let hasTournamentResultsCache = false;
/** @type {boolean} */
let hasPlacementsCache = false;
let savingMatchId = null;

function showView(name) {
  Object.entries(views).forEach(([key, el]) => {
    if (el) el.classList.toggle("hidden", key !== name);
  });
  if (headerActions) {
    headerActions.classList.toggle("hidden", name !== "main" && name !== "empty");
  }
}

function buildDashboardHref(id) {
  return `tournament-dashboard.html?id=${encodeURIComponent(id)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function teamName(entryId) {
  return teamNameByEntryId.get(entryId) || entryId || "—";
}

function winsRequiredForTournament() {
  const side = resolveBracketMatchConfig(currentTournament, "main");
  return resolveFinalsWinsRequired(
    side?.finalsMatchRules?.defaultWinsRequired ?? currentTournament?.winsRequired ?? 2
  );
}

function roundLabel(round) {
  if (!round) return "—";
  if (round.matchPurpose === LossBandMatchPurpose.FINAL || round.roundId === "final") {
    return "決勝";
  }
  if (
    round.matchPurpose === LossBandMatchPurpose.THIRD_PLACE ||
    round.roundId === "third_place"
  ) {
    return "3位決定戦";
  }
  return `R${round.roundNumber ?? "?"}`;
}

function infoRow(label, value) {
  return `<div class="info-list__row"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(
    value
  )}</dd></div>`;
}

/**
 * @param {object} round
 * @param {Map<string, object>} sessions
 * @param {Map<string, object>} results
 * @param {{ exchange?: boolean, editMode?: boolean, rootEl?: HTMLElement|null }} [options]
 */
function renderBands(round, sessions, results, options = {}) {
  const root = options.rootEl || bandsRoot;
  if (!root) return;
  if (!round) {
    root.innerHTML = `<p class="panel__desc">ラウンドがありません。</p>`;
    return;
  }

  const isSpecial =
    round.matchPurpose === LossBandMatchPurpose.FINAL ||
    round.matchPurpose === LossBandMatchPurpose.THIRD_PLACE ||
    round.roundId === "final" ||
    round.roundId === "third_place";

  if (isSpecial) {
    const pair = (round.pairs || [])[0];
    const matchId = pair?.matchId || (round.matchIds || [])[0];
    root.innerHTML = `
      <div class="loss-band-ops__band">
        <h4 class="loss-band-ops__band-title">${escapeHtml(roundLabel(round))}</h4>
        ${renderMatchCard(matchId, pair?.team1EntryId, pair?.team2EntryId, sessions, results, {
          exchange: options.exchange === true,
          purpose: round.matchPurpose,
          editMode: options.editMode === true,
        })}
      </div>
    `;
    return;
  }

  const bandKeys = Object.keys(round.bands || {})
    .map(Number)
    .sort((a, b) => a - b);

  if (bandKeys.length === 0) {
    root.innerHTML = `<p class="panel__desc">試合がありません。</p>`;
    return;
  }

  root.innerHTML = bandKeys
    .map((lossCount) => {
      const band = round.bands[String(lossCount)];
      const pairs = band?.pairs || [];
      const byeEntryId = band?.byeEntryId ?? null;
      const byeHtml = byeEntryId
        ? `<article class="loss-band-ops__match loss-band-ops__match--done">
            <p class="loss-band-ops__match-id">BYE · ${lossCount}敗帯</p>
            <p class="loss-band-ops__match-teams"><strong>${escapeHtml(teamName(byeEntryId))}</strong> — 不戦勝</p>
            <p class="loss-band-ops__match-status">状態: 不戦勝</p>
          </article>`
        : "";
      return `
        <div class="loss-band-ops__band">
          <h4 class="loss-band-ops__band-title">${lossCount}敗帯（${pairs.length}試合${byeEntryId ? " + BYE1" : ""}）</h4>
          <div class="loss-band-ops__matches">
            ${byeHtml}
            ${pairs
              .map((pair) =>
                renderMatchCard(
                  pair.matchId,
                  pair.team1EntryId,
                  pair.team2EntryId,
                  sessions,
                  results,
                  {
                    exchange: false,
                    lossCount,
                    editMode: options.editMode === true,
                  }
                )
              )
              .join("")}
          </div>
        </div>
      `;
    })
    .join("");
}

function assessEditForMatch(matchId) {
  if (!cachedEditRound || !currentState) {
    return { ok: false, message: LOSS_BAND_RESULT_EDIT_LOCKED_MESSAGE };
  }
  return assessLossBandRankingResultCorrection({
    tournamentStatus: currentTournament?.status,
    hasTournamentResults: hasTournamentResultsCache,
    hasPlacements: hasPlacementsCache,
    stateDoc: currentState,
    targetRoundDoc: cachedEditRound,
    matchId,
    existingResult: cachedResults.get(matchId) || null,
    nextRoundDoc: cachedNextRoundForEdit,
    nextRoundSessionsMap: cachedSessions,
    nextRoundResultsMap: cachedResults,
    expectedRevision: currentState.revision ?? 0,
  });
}

function renderMatchCard(
  matchId,
  team1EntryId,
  team2EntryId,
  sessions,
  results,
  { exchange = false, lossCount = null, purpose = null, editMode = false } = {}
) {
  const session = sessions.get(matchId);
  const result = results.get(matchId);
  const t1 = teamName(team1EntryId || session?.team1EntryId || session?.team1?.entryId);
  const t2 = teamName(team2EntryId || session?.team2EntryId || session?.team2?.entryId);
  const display = resolveLossBandMatchSessionDisplay(session, result);
  const done = Boolean(result);
  // exchange は今回 Start 実状態化の対象外（従来どおり結果入力）
  const canStart = !exchange && !editMode && display.canStart;
  const canEnter = exchange
    ? !done && currentState?.status !== "completed"
    : !editMode && display.canEnterResult && currentState?.status !== "completed";

  let editButtonHtml = "";
  if (editMode && done && !exchange) {
    const gate = assessEditForMatch(matchId);
    const canEdit = gate.ok === true;
    const title = canEdit ? "" : escapeHtml(gate.message || LOSS_BAND_RESULT_EDIT_LOCKED_MESSAGE);
    editButtonHtml = `
      <button type="button" class="btn btn--primary btn--compact" data-action="edit-result" ${
        canEdit ? "" : "disabled"
      } ${title ? `title="${title}"` : ""}>結果を修正</button>
      ${
        canEdit
          ? ""
          : `<p class="field__hint loss-band-ops__edit-lock">${escapeHtml(
              gate.message || LOSS_BAND_RESULT_EDIT_LOCKED_MESSAGE
            )}</p>`
      }
    `;
  }

  return `
    <article class="loss-band-ops__match ${
      done ? "loss-band-ops__match--done" : "loss-band-ops__match--open"
    }" data-match-id="${escapeHtml(matchId)}" data-exchange="${
      exchange ? "1" : "0"
    }" data-edit-mode="${editMode ? "1" : "0"}">
      <p class="loss-band-ops__match-id">${escapeHtml(matchId)}${
        lossCount != null ? ` · ${lossCount}敗帯` : ""
      }${purpose ? ` · ${escapeHtml(purpose)}` : ""}</p>
      <p class="loss-band-ops__match-teams"><strong>${escapeHtml(t1)}</strong> vs <strong>${escapeHtml(
        t2
      )}</strong></p>
      <p class="loss-band-ops__match-status">状態: ${escapeHtml(display.label)}</p>
      <div class="loss-band-ops__match-actions">
        ${
          exchange || editMode
            ? ""
            : `<button type="button" class="btn btn--ghost btn--compact" data-action="start" ${
                canStart ? "" : "disabled"
              }>試合開始</button>`
        }
        ${
          editMode
            ? editButtonHtml
            : `<button type="button" class="btn btn--primary btn--compact" data-action="result" ${
                canEnter ? "" : "disabled"
              }>${done ? "結果表示" : "結果入力"}</button>`
        }
      </div>
    </article>
  `;
}

function renderPlacements(placements, interimRecords = null) {
  const records = placements?.placements || interimRecords;
  if (!records || records.length === 0) {
    placementsPanel?.classList.add("hidden");
    return;
  }
  placementsPanel?.classList.remove("hidden");

  /** @type {Map<number, string[]>} */
  const byPlacement = new Map();
  for (const row of records) {
    const p = row.placement;
    if (!Number.isInteger(p)) continue;
    if (!byPlacement.has(p)) byPlacement.set(p, []);
    byPlacement.get(p).push(row.entryId);
  }

  const keys = [...byPlacement.keys()].sort((a, b) => a - b);
  placementsRoot.innerHTML = `
    <dl class="info-list">
      ${keys
        .map((placement) => {
          const entryIds = byPlacement.get(placement) || [];
          const label = formatLossBandPlacementLabel(placement, entryIds.length > 1);
          const names = entryIds.map((id) => teamName(id)).join("、");
          return infoRow(label, `${names}（${entryIds.length}）`);
        })
        .join("")}
    </dl>
    <p class="field__hint">表示 ${records.length} チーム${
      placements
        ? ` / 合計 ${currentState?.teamCount ?? records.length}`
        : `（最終順位決定ラウンド時点の確定分・決勝待ち）`
    }</p>
  `;
}

function renderExchange(exchangeRounds, sessions, results) {
  const hasMatches = (exchangeRounds || []).some(
    (r) => (r.matchIds || []).length > 0 && r.status !== "complete"
  );
  const openRound =
    (exchangeRounds || []).find((r) => r.status !== "complete") ||
    (exchangeRounds || [])[exchangeRounds.length - 1];

  if (!openRound || (openRound.matchIds || []).length === 0) {
    exchangePanel?.classList.add("hidden");
    return;
  }

  // 保証未達が無い標準設定では通常非表示（0試合）
  if (!hasMatches && currentState?.status !== "exchange_pending") {
    exchangePanel?.classList.add("hidden");
    return;
  }

  exchangePanel?.classList.remove("hidden");
  const pairs = openRound.pairs || [];
  exchangeRoot.innerHTML = `
    <p class="panel__desc">${escapeHtml(openRound.roundId || "exchange")} · ${
      (openRound.completedMatchIds || []).length
    } / ${(openRound.matchIds || []).length} 完了</p>
    <div class="loss-band-ops__matches">
      ${pairs
        .map((pair) =>
          renderMatchCard(
            pair.matchId,
            pair.team1EntryId,
            pair.team2EntryId,
            sessions,
            results,
            { exchange: true, purpose: LossBandMatchPurpose.EXCHANGE }
          )
        )
        .join("")}
    </div>
  `;
}

async function handleMatchAction(event) {
  const button = event.target.closest("[data-action]");
  if (!(button instanceof HTMLButtonElement) || button.disabled) return;
  const card = button.closest("[data-match-id]");
  if (!card) return;
  const matchId = card.getAttribute("data-match-id");
  const isExchange = card.getAttribute("data-exchange") === "1";
  const action = button.getAttribute("data-action");

  if (action === "start") {
    if (isExchange) {
      showToast("交流戦は結果入力から進めてください。");
      return;
    }
    if (savingMatchId) return;
    savingMatchId = matchId;
    button.disabled = true;
    try {
      await startLossBandMatchSession(tournamentId, matchId);
      showToast("試合を開始しました。");
      await loadMain();
    } catch (error) {
      console.error("[loss-band] start failed", error);
      const { message } = classifyError(error);
      showErrorToast(message || error.message || "試合を開始できませんでした。");
    } finally {
      savingMatchId = null;
    }
    return;
  }

  if (action === "edit-result") {
    if (!matchId || savingMatchId) return;
    const gate = assessEditForMatch(matchId);
    if (!gate.ok) {
      showErrorToast(gate.message || LOSS_BAND_RESULT_EDIT_LOCKED_MESSAGE);
      return;
    }
    const existingResult = cachedResults.get(matchId);
    const session = cachedSessions.get(matchId);
    const team1Name =
      session?.team1?.teamName ||
      teamName(session?.team1EntryId || existingResult?.team1EntryId);
    const team2Name =
      session?.team2?.teamName ||
      teamName(session?.team2EntryId || existingResult?.team2EntryId);

    const values = await finalsMatchResultDialog({
      title: "結果を修正",
      team1Name,
      team2Name,
      winsRequired: winsRequiredForTournament(),
      submitLabel: "修正を保存",
      initialValues: buildFinalsMatchResultInitialValues(existingResult),
    });
    if (!values) return;

    savingMatchId = matchId;
    button.disabled = true;
    try {
      const saved = await correctLossBandRankingResult(
        tournamentId,
        matchId,
        values,
        {
          winsRequired: winsRequiredForTournament(),
          expectedRevision: currentState?.revision ?? 0,
        }
      );
      showToast(
        saved?.nextRoundId
          ? `結果を修正し、${saved.nextRoundId} を再生成しました。`
          : "結果を修正しました。"
      );
      await loadMain();
    } catch (error) {
      console.error("[loss-band] correct failed", error);
      const { message } = classifyError(error);
      showErrorToast(message || error.message || "結果を修正できませんでした。");
    } finally {
      savingMatchId = null;
    }
    return;
  }

  if (action !== "result" || !matchId) return;
  if (savingMatchId) return;

  if (!isExchange) {
    const sessions = await getLossBandMatchSessions(tournamentId);
    const results = await getLossBandMatchResults(tournamentId);
    const display = resolveLossBandMatchSessionDisplay(
      sessions.get(matchId),
      results.get(matchId)
    );
    if (results.get(matchId)) {
      showToast("この試合は完了済みです。");
      return;
    }
    if (!display.canEnterResult) {
      showErrorToast("試合を開始してから結果を入力してください。");
      return;
    }
  }

  const sessions = await getLossBandMatchSessions(tournamentId);
  const exchangeSessions = isExchange
    ? await getLossBandExchangeMatchSessions(tournamentId)
    : new Map();
  const session = (isExchange ? exchangeSessions : sessions).get(matchId);
  const team1Name = session?.team1?.teamName || teamName(session?.team1EntryId);
  const team2Name = session?.team2?.teamName || teamName(session?.team2EntryId);

  const values = await finalsMatchResultDialog({
    title: isExchange ? "交流戦 結果入力" : "試合結果入力",
    team1Name,
    team2Name,
    winsRequired: winsRequiredForTournament(),
    submitLabel: "結果を確定",
  });
  if (!values) return;

  savingMatchId = matchId;
  try {
    const save = isExchange ? saveLossBandExchangeMatchResult : saveLossBandMatchResult;
    const saved = await save(tournamentId, matchId, values, {
      winsRequired: winsRequiredForTournament(),
    });
    if (saved.roundComplete && saved.nextRound) {
      showToast(`ラウンド完了。${roundLabel(saved.nextRound)} を生成しました。`);
    } else if (saved.roundComplete && saved.placements) {
      showToast("順位決定ラウンドが完了しました。");
    } else if (saved.state?.status === "completed") {
      showToast("順位決定戦が完了しました。");
    } else {
      showToast("結果を保存しました。");
    }
    await loadMain();
  } catch (error) {
    const { message } = classifyError(error);
    showErrorToast(message);
  } finally {
    savingMatchId = null;
  }
}

async function loadMain() {
  currentState = await getLossBandState(tournamentId);
  if (!currentState) {
    showView("empty");
    return;
  }

  const [
    round,
    sessions,
    results,
    placements,
    exchangeRounds,
    exchangeSessions,
    tournamentResults,
    allRounds,
  ] = await Promise.all([
    getLossBandRound(
      tournamentId,
      currentState.currentRoundId || currentState.currentRound
    ),
    getLossBandMatchSessions(tournamentId),
    getLossBandMatchResults(tournamentId),
    getLossBandPlacements(tournamentId),
    listLossBandExchangeRounds(tournamentId),
    getLossBandExchangeMatchSessions(tournamentId),
    getTournamentResults(tournamentId).catch(() => null),
    listLossBandRounds(tournamentId),
  ]);

  cachedSessions = sessions;
  cachedResults = results;
  hasPlacementsCache = Boolean(placements);
  hasTournamentResultsCache = Boolean(tournamentResults);

  // 直前の完了 ranking ラウンドを修正パネルに表示
  cachedEditRound = null;
  cachedNextRoundForEdit = null;
  const completedRanking = currentState.completedRankingRound ?? 0;
  if (
    currentState.status === "active" &&
    completedRanking >= 1 &&
    Number.isInteger(completedRanking)
  ) {
    const editRoundId = buildLossBandRoundId(completedRanking);
    const editRound =
      allRounds.find((r) => r.roundId === editRoundId) ||
      (await getLossBandRound(tournamentId, editRoundId));
    if (editRound && isLossBandRankingRoundDoc(editRound)) {
      cachedEditRound = editRound;
      const nextId = buildLossBandRoundId(completedRanking + 1);
      cachedNextRoundForEdit =
        allRounds.find((r) => r.roundId === nextId) ||
        (round?.roundId === nextId ? round : null) ||
        null;
    }
  }

  tournamentNameEl.textContent = currentTournament?.name || "大会";
  statusLineEl.textContent = formatLossBandTournamentStatusLabel(currentState.status);

  const rankingRoundsTotal = rankingRoundCountFromState(currentState);
  const rematchLabel = currentState.rematchAvoidance === true ? "ON" : "OFF";
  const thirdLabel = currentState.thirdPlaceMatch === true ? "ON" : "OFF";
  const exchangeLabel = currentState.exchangeMatches === true ? "ON" : "OFF";
  metaListEl.innerHTML = [
    infoRow("枠サイズ", String(bracketSizeFromState(currentState))),
    infoRow("現在ラウンド", roundLabel(round)),
    infoRow("再戦回避", rematchLabel),
    infoRow("3位決定戦", thirdLabel),
    infoRow("交流戦設定", exchangeLabel),
    infoRow("最低保証試合数", String(currentState.guaranteedMatchCount ?? "—")),
    infoRow(
      "完了順位ラウンド",
      `${currentState.completedRankingRound ?? 0} / ${rankingRoundsTotal}`
    ),
  ].join("");

  const matchIds = round?.matchIds || [];
  const completed = (round?.completedMatchIds || []).length;
  const total = matchIds.length;
  const allDone = total > 0 && completed >= total;
  let progressText = `${completed} / ${total} 試合完了`;
  if (allDone && currentState.status === "active") {
    progressText += " · 次ラウンド生成済み（最終試合保存時）";
  } else if (!allDone && total > 0) {
    progressText += " · 全試合完了まで次ラウンドは生成されません";
  } else if (currentState.status === "finals_pending") {
    progressText = "決勝待ち";
  } else if (currentState.status === "third_place_pending") {
    progressText = "3位決定戦待ち";
  } else if (currentState.status === "completed") {
    progressText = "完了";
  }
  if (round?.rematchCount != null && round.rematchAvoidance) {
    progressText += ` · 再戦 ${round.rematchCount} 件`;
  }
  progressLineEl.textContent = progressText;
  roundTitleEl.textContent = roundLabel(round);

  if (cachedEditRound && editRoundPanel && editBandsRoot) {
    editRoundPanel.classList.remove("hidden");
    if (editRoundTitleEl) {
      editRoundTitleEl.textContent = `${roundLabel(cachedEditRound)}（結果修正）`;
    }
    if (editRoundHintEl) {
      const sampleId = (cachedEditRound.matchIds || [])[0];
      const gate = sampleId
        ? assessEditForMatch(sampleId)
        : { ok: false, message: LOSS_BAND_RESULT_EDIT_LOCKED_MESSAGE };
      editRoundHintEl.textContent = gate.ok
        ? "次ラウンドが未開始のため、このラウンドの結果を修正できます。修正すると次ラウンドは再生成されます。"
        : gate.message || LOSS_BAND_RESULT_EDIT_LOCKED_MESSAGE;
    }
    renderBands(cachedEditRound, sessions, results, {
      editMode: true,
      rootEl: editBandsRoot,
    });
  } else {
    editRoundPanel?.classList.add("hidden");
    if (editBandsRoot) editBandsRoot.innerHTML = "";
  }

  renderBands(round, sessions, results);

  let interimRecords = null;
  if (
    !placements &&
    (currentState.status === "finals_pending" ||
      currentState.status === "third_place_pending")
  ) {
    const rankingRoundLimit = rankingRoundCountFromState(currentState);
    const rankingRounds = allRounds.filter(
      (r) =>
        typeof r.roundNumber === "number" &&
        r.roundNumber >= 1 &&
        r.roundNumber <= rankingRoundLimit
    );
    const priorCompleted = [];
    for (const r of rankingRounds) {
      if (r.status !== "complete") continue;
      const roundResults = (r.matchIds || [])
        .map((id) => results.get(id))
        .filter(Boolean);
      if (roundResults.length === (r.matchIds || []).length) {
        priorCompleted.push({ roundDoc: r, results: roundResults });
      }
    }
    if (priorCompleted.length >= rankingRoundLimit) {
      const domain = rebuildDomainStateFromCompletedRounds(
        currentState.entryIds,
        priorCompleted,
        {
          thirdPlaceMatch: currentState.thirdPlaceMatch === true,
          rematchAvoidance: currentState.rematchAvoidance === true,
        }
      );
      interimRecords = buildPlacementRecords(domain);
      if (domain.finalists?.length) {
        progressLineEl.textContent = `${progressLineEl.textContent} · 決勝進出: ${domain.finalists
          .map((id) => teamName(id))
          .join(" / ")}`;
      }
    }
  }
  renderPlacements(placements, interimRecords);
  void pairingsFromRoundDoc;

  if (
    currentState.exchangeMatches === true &&
    (currentState.status === "exchange_pending" ||
      exchangeRounds.some((r) => (r.matchIds || []).length > 0))
  ) {
    await renderExchangeWithResults(exchangeRounds, exchangeSessions);
  } else {
    exchangePanel?.classList.add("hidden");
  }

  showView("main");
}

async function renderExchangeWithResults(exchangeRounds, exchangeSessions) {
  const openRound =
    (exchangeRounds || []).find((r) => r.status !== "complete") || null;
  if (!openRound || (openRound.matchIds || []).length === 0) {
    exchangePanel?.classList.add("hidden");
    return;
  }
  const fakeResults = new Map();
  for (const id of openRound.completedMatchIds || []) {
    fakeResults.set(id, { matchId: id });
  }
  renderExchange([openRound], exchangeSessions, fakeResults);
}

async function bootstrap() {
  const params = new URLSearchParams(window.location.search);
  tournamentId = params.get("id");
  if (!isValidTournamentId(tournamentId)) {
    throw new InvalidTournamentIdError();
  }

  if (backToDashboardBtn) {
    backToDashboardBtn.href = buildDashboardHref(tournamentId);
  }
  if (emptyDashboardBtn) {
    emptyDashboardBtn.href = buildDashboardHref(tournamentId);
  }

  bandsRoot?.addEventListener("click", handleMatchAction);
  editBandsRoot?.addEventListener("click", handleMatchAction);
  exchangeRoot?.addEventListener("click", handleMatchAction);

  currentTournament = await getTournament(tournamentId);
  if (resolveMainRankingMode(currentTournament) !== RankingMode.LOSS_BAND) {
    showFormAlert(
      document.getElementById("errorAlert"),
      "この大会は順位決定方式ではありません。",
      "error"
    );
    showView("error");
    return;
  }

  const entries = await listEntries(tournamentId);
  teamNameByEntryId = new Map(
    entries.map((e) => [e.id, e.teamName || e.id])
  );

  await loadMain();
}

initTournamentManageGuard({
  onReady: async () => {
    try {
      showView("loading");
      await bootstrap();
    } catch (error) {
      const { message } = classifyError(error);
      showFormAlert(document.getElementById("errorAlert"), message, "error");
      showView("error");
    }
  },
  onConfigMissing: () => {
    showFormAlert(
      document.getElementById("configAlert"),
      "Firebase 設定が未入力です。",
      "error"
    );
    showView("config");
  },
  onOperatorDenied: () => {
    showFormAlert(
      document.getElementById("operatorDeniedAlert"),
      "運営者として登録されていません。",
      "warning"
    );
    showView("operatorDenied");
  },
});
