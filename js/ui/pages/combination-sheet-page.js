/**
 * 組み合わせ帳票の印刷専用ページ
 */
import { isValidTournamentId } from "../../domain/validators.js";
import { isTournamentDeleted } from "../../domain/tournament-deletion.js";
import {
  CombinationSheetUrlType,
  buildQualifyingBlocksCombinationSheet,
  buildSingleEliminationCombinationSheet,
  parseCombinationSheetUrlType,
} from "../../domain/combination-sheet.js";
import { getTournament } from "../../services/tournament-service.js";
import { listEntries } from "../../services/entry-service.js";
import { getBlockDraw } from "../../services/block-draw-service.js";
import { getFinalsBracket } from "../../services/finals-bracket-service.js";
import { initTournamentManageGuard } from "../../lib/operator-guard.js";
import {
  classifyError,
  InvalidTournamentIdError,
} from "../../lib/errors.js";
import { showFormAlert } from "../components/form-errors.js";
import {
  combinationSheetDocumentTitle,
  renderCombinationSheetHtml,
} from "../combination-sheet-render.js";

const views = {
  loading: document.getElementById("viewLoading"),
  config: document.getElementById("viewConfig"),
  operatorDenied: document.getElementById("viewOperatorDenied"),
  error: document.getElementById("viewError"),
  sheet: document.getElementById("viewSheet"),
};

const backBtn = document.getElementById("backBtn");
const errorBackBtn = document.getElementById("errorBackBtn");
const printBtn = document.getElementById("printBtn");
const sheetRoot = document.getElementById("sheetRoot");
const errorMessageEl = document.getElementById("errorMessage");

let tournamentId = null;
let sheetType = null;

function showView(name) {
  Object.entries(views).forEach(([key, el]) => {
    if (el) {
      el.classList.toggle("hidden", key !== name);
    }
  });
  printBtn?.classList.toggle("hidden", name !== "sheet");
}

function buildTournamentDashboardHref(id) {
  if (!isValidTournamentId(id)) {
    return "index.html";
  }
  return `tournament-dashboard.html?id=${encodeURIComponent(id)}`;
}

function showPageError(message) {
  if (errorMessageEl) {
    errorMessageEl.textContent = message || "組み合わせ表を表示できません。";
  }
  document.title = "組み合わせ表を表示できません";
  document.documentElement.removeAttribute("data-sheet-orientation");
  showView("error");
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

function bindToolbar() {
  const href = buildTournamentDashboardHref(tournamentId);
  if (backBtn) backBtn.href = href;
  if (errorBackBtn) errorBackBtn.href = href;
  printBtn?.addEventListener("click", () => {
    window.print();
  });
}

function applyPrintPageSize(orientation) {
  let styleEl = document.getElementById("combinationSheetPageSize");
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = "combinationSheetPageSize";
    document.head.appendChild(styleEl);
  }
  const landscape = orientation === "landscape";
  const size = landscape ? "A4 landscape" : "A4 portrait";
  const margin = landscape ? "10mm" : "12mm";
  styleEl.textContent = `@page { size: ${size}; margin: ${margin}; }`;
}

function renderSheet(sheet) {
  if (!sheetRoot) {
    showPageError("帳票画面を初期化できませんでした。");
    return;
  }
  sheetRoot.innerHTML = renderCombinationSheetHtml(sheet);
  document.title = combinationSheetDocumentTitle(sheet);
  const orientation = sheet.page?.orientation || "portrait";
  document.documentElement.dataset.sheetOrientation = orientation;
  applyPrintPageSize(orientation);
  showView("sheet");
}

async function loadSheet() {
  showView("loading");

  try {
    const tournament = await getTournament(tournamentId);
    if (!tournament) {
      showPageError("大会が見つかりません。");
      return;
    }
    if (isTournamentDeleted(tournament)) {
      showPageError("この大会は削除されています。");
      return;
    }

    let entries;
    try {
      entries = await listEntries(tournamentId);
    } catch (error) {
      console.error("[combination-sheet] entries load failed", error);
      showPageError("エントリー情報を読み込めませんでした。");
      return;
    }

    let result;
    if (sheetType === CombinationSheetUrlType.QUALIFYING) {
      const blockDraw = await getBlockDraw(tournamentId);
      result = buildQualifyingBlocksCombinationSheet({
        tournament,
        blockDraw,
        entries,
      });
    } else {
      const bracket = await getFinalsBracket(tournamentId);
      result = buildSingleEliminationCombinationSheet({
        tournament,
        bracket,
        entries,
      });
    }

    if (!result.ok) {
      showPageError(result.message);
      return;
    }

    renderSheet(result.sheet);
  } catch (error) {
    console.error("[combination-sheet] load failed", error);
    const { message } = classifyError(error);
    showPageError(message || "組み合わせ表を表示できません。");
  }
}

function initCombinationSheetPage() {
  tournamentId = new URLSearchParams(window.location.search).get("id");
  sheetType = parseCombinationSheetUrlType(
    new URLSearchParams(window.location.search).get("type")
  );
  bindToolbar();

  if (!isValidTournamentId(tournamentId)) {
    const { message } = classifyError(new InvalidTournamentIdError());
    showPageError(message);
    return;
  }

  if (!sheetType) {
    showPageError("帳票の種類が不正です。大会管理から組み合わせ表を出力してください。");
    return;
  }

  initTournamentManageGuard({
    tournamentId,
    onConfigRequired: initConfigView,
    onAccessDenied: initAccessDeniedView,
    onReady: () => {
      loadSheet();
    },
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initCombinationSheetPage);
} else {
  initCombinationSheetPage();
}
