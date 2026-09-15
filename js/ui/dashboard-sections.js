/**
 * 大会ダッシュボード アコーディオン（開閉保存・状態ラベル・初期展開）
 * Firestore 非依存。既存パネルの表示条件は変更しない。
 */
import { EntryStatus, TournamentStatus } from "../domain/constants.js";
import { TournamentFormat } from "../domain/tournament-format.js";

export const DASHBOARD_SECTION_STORAGE_PREFIX = "sma.dashboard.sections.";
export const DASHBOARD_SECTION_STORAGE_VERSION = 1;

export const DashboardSectionId = Object.freeze({
  ENTRIES: "entries",
  INFO: "info",
  PUBLIC_ENTRY: "public-entry",
  PUBLIC: "public",
  PLAYER_RESULTS: "player-results",
  QUALIFYING: "qualifying",
  ADVANCEMENT: "advancement",
  SE: "se",
  FINALS: "finals",
  ENTRY_OPEN: "entry-open",
  BROWSE: "browse",
});

const SECTION_IDS = new Set(Object.values(DashboardSectionId));

let applyingDashboardSectionOpenState = false;

export function dashboardSectionStorageKey(tournamentId) {
  return `${DASHBOARD_SECTION_STORAGE_PREFIX}${String(tournamentId || "").trim()}`;
}

function getSessionStorage(storage) {
  if (storage) {
    return storage;
  }
  try {
    return globalThis.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * @param {string} tournamentId
 * @param {Storage|null} [storage]
 * @returns {string[]|null}
 */
export function readDashboardSectionState(tournamentId, storage) {
  const store = getSessionStorage(storage);
  if (!store || !tournamentId) {
    return null;
  }
  try {
    const raw = store.getItem(dashboardSectionStorageKey(tournamentId));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.v !== DASHBOARD_SECTION_STORAGE_VERSION || !Array.isArray(parsed.open)) {
      return null;
    }
    const open = parsed.open.filter((id) => SECTION_IDS.has(id));
    return open;
  } catch {
    return null;
  }
}

/**
 * @param {string} tournamentId
 * @param {string[]} openIds
 * @param {Storage|null} [storage]
 */
export function writeDashboardSectionState(tournamentId, openIds, storage) {
  const store = getSessionStorage(storage);
  if (!store || !tournamentId) {
    return false;
  }
  try {
    const open = (Array.isArray(openIds) ? openIds : []).filter((id) => SECTION_IDS.has(id));
    store.setItem(
      dashboardSectionStorageKey(tournamentId),
      JSON.stringify({ v: DASHBOARD_SECTION_STORAGE_VERSION, open })
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {ParentNode} root
 * @returns {string[]}
 */
export function collectOpenDashboardSectionIds(root) {
  if (!root?.querySelectorAll) {
    return [];
  }
  return [...root.querySelectorAll("details.dashboard-section[data-section]")]
    .filter((el) => el.open)
    .map((el) => el.getAttribute("data-section"))
    .filter((id) => SECTION_IDS.has(id));
}

/**
 * @param {ParentNode} root
 * @param {string[]} openIds
 */
export function applyDashboardSectionOpenState(root, openIds) {
  if (!root?.querySelectorAll) {
    return;
  }
  const open = new Set(Array.isArray(openIds) ? openIds : []);
  applyingDashboardSectionOpenState = true;
  try {
    root.querySelectorAll("details.dashboard-section[data-section]").forEach((el) => {
      const id = el.getAttribute("data-section");
      el.open = open.has(id);
    });
  } finally {
    applyingDashboardSectionOpenState = false;
  }
}

function hasDrawBlocks(blockDraw) {
  return Boolean(blockDraw && Array.isArray(blockDraw.blocks) && blockDraw.blocks.length > 0);
}

/**
 * @param {object} snapshot
 * @returns {Record<string, string>}
 */
export function resolveDashboardSectionStatuses(snapshot = {}) {
  const tournament = snapshot.tournament || {};
  const entries = Array.isArray(snapshot.entries) ? snapshot.entries : [];
  const blockDraw = snapshot.blockDraw;
  const schedule = snapshot.qualifyingSchedule;
  const signals = snapshot.signals || {};
  const bracket = snapshot.finalsBracket;
  const lossBandState = snapshot.lossBandState;
  const format = snapshot.format;
  const isBlockDrawDraft = snapshot.isBlockDrawDraft === true;
  const isBlockDrawFinalized = snapshot.isBlockDrawFinalized === true;
  const hasSeBracket = snapshot.hasCreatedSingleEliminationBracket === true;
  const isPublic = snapshot.isPublicViewEnabled === true;
  const confirmed = entries.filter((entry) => entry.status === EntryStatus.CONFIRMED).length;
  const pending = entries.filter((entry) => entry.status === EntryStatus.PENDING).length;
  const maxTeams = tournament.maxTeams;
  const eventDate = String(tournament.eventDate || "").trim();

  const statuses = {
    [DashboardSectionId.INFO]: eventDate || "",
    [DashboardSectionId.PUBLIC]: isPublic ? "公開中" : "非公開",
    [DashboardSectionId.PLAYER_RESULTS]:
      tournament.participantResultEntryEnabled === true ? "ON" : "OFF",
    [DashboardSectionId.BROWSE]: "",
    [DashboardSectionId.ENTRY_OPEN]: "",
    [DashboardSectionId.PUBLIC_ENTRY]: "",
  };

  if (maxTeams != null && maxTeams !== "") {
    statuses[DashboardSectionId.ENTRIES] =
      pending > 0 ? `確定 ${confirmed}/${maxTeams}・申込中 ${pending}` : `確定 ${confirmed}/${maxTeams}`;
  } else if (entries.length > 0) {
    statuses[DashboardSectionId.ENTRIES] = `確定 ${confirmed}`;
  }

  if (format !== TournamentFormat.SINGLE_ELIMINATION) {
    if (!hasDrawBlocks(blockDraw)) {
      statuses[DashboardSectionId.QUALIFYING] = "未抽選";
    } else if (isBlockDrawDraft) {
      statuses[DashboardSectionId.QUALIFYING] = "配置確認中";
    } else if (isBlockDrawFinalized && !schedule?.finalized) {
      statuses[DashboardSectionId.QUALIFYING] = "対戦表未生成";
    } else if (signals.hasQualifyingMatchResults || signals.hasStartedQualifyingMatchSessions) {
      statuses[DashboardSectionId.QUALIFYING] = "予選開始済";
    } else if (isBlockDrawFinalized) {
      statuses[DashboardSectionId.QUALIFYING] = "抽選済み";
    }

    if (signals.hasFinalsAdvancement === true) {
      statuses[DashboardSectionId.ADVANCEMENT] = "確定済";
    } else {
      statuses[DashboardSectionId.ADVANCEMENT] = "未確定";
    }

    if (signals.hasFinalsMatchResults === true) {
      statuses[DashboardSectionId.FINALS] = "試合あり";
    } else if (bracket?.finalized === true) {
      statuses[DashboardSectionId.FINALS] = "表作成済";
    } else {
      statuses[DashboardSectionId.FINALS] = "未開始";
    }
  }

  if (format === TournamentFormat.SINGLE_ELIMINATION) {
    if (lossBandState) {
      statuses[DashboardSectionId.SE] = "開始済";
    } else if (hasSeBracket) {
      statuses[DashboardSectionId.SE] = "作成済";
    } else {
      statuses[DashboardSectionId.SE] = "未作成";
    }
  }

  return statuses;
}

/**
 * 保存がない場合の初期オープン。取得済みデータだけで判定する。
 * @param {object} snapshot
 * @returns {string[]}
 */
export function resolveInitialOpenDashboardSections(snapshot = {}) {
  const tournament = snapshot.tournament || {};
  const status = tournament.status;
  const format = snapshot.format;
  const isSe = format === TournamentFormat.SINGLE_ELIMINATION;
  const blockDraw = snapshot.blockDraw;
  const signals = snapshot.signals || {};
  const bracket = snapshot.finalsBracket;
  const isBlockDrawDraft = snapshot.isBlockDrawDraft === true;
  const hasBlocks = hasDrawBlocks(blockDraw);
  const qualifyingStarted =
    signals.hasQualifyingMatchResults === true || signals.hasStartedQualifyingMatchSessions === true;

  if (status === TournamentStatus.CLOSED) {
    return [DashboardSectionId.BROWSE];
  }

  if (status === TournamentStatus.DRAFT) {
    return [DashboardSectionId.INFO, DashboardSectionId.ENTRY_OPEN];
  }

  if (isSe) {
    return [DashboardSectionId.SE];
  }

  if (!hasBlocks) {
    return [DashboardSectionId.ENTRIES, DashboardSectionId.QUALIFYING];
  }

  if (isBlockDrawDraft) {
    return [DashboardSectionId.QUALIFYING];
  }

  if (qualifyingStarted && signals.hasFinalsAdvancement !== true) {
    return [DashboardSectionId.QUALIFYING];
  }

  if (signals.hasFinalsAdvancement === true || bracket?.finalized === true) {
    return [DashboardSectionId.FINALS];
  }

  return [DashboardSectionId.QUALIFYING];
}

/**
 * @param {ParentNode} root
 * @param {Record<string, string>} statuses
 */
export function applyDashboardSectionStatuses(root, statuses = {}) {
  if (!root?.querySelectorAll) {
    return;
  }
  root.querySelectorAll("[data-section-status]").forEach((el) => {
    const id = el.getAttribute("data-section-status");
    el.textContent = statuses[id] || "";
  });
}

/**
 * @param {{
 *   root: ParentNode,
 *   tournamentId: string,
 *   snapshot: object,
 *   storage?: Storage|null,
 * }} params
 */
export function syncDashboardSectionUi({ root, tournamentId, snapshot, storage } = {}) {
  if (!root) {
    return;
  }
  applyDashboardSectionStatuses(root, resolveDashboardSectionStatuses(snapshot || {}));
  const saved = readDashboardSectionState(tournamentId, storage);
  const openIds = saved ?? resolveInitialOpenDashboardSections(snapshot || {});
  applyDashboardSectionOpenState(root, openIds);
}

/**
 * @param {ParentNode} root
 * @param {string} tournamentId
 * @param {Storage|null} [storage]
 */
export function bindDashboardSectionPersistence(root, tournamentId, storage) {
  if (!root?.addEventListener) {
    return;
  }
  root.__smaDashboardTournamentId = tournamentId;
  if (bindDashboardSectionPersistence._boundRoots?.has(root)) {
    return;
  }
  if (!bindDashboardSectionPersistence._boundRoots) {
    bindDashboardSectionPersistence._boundRoots = new WeakSet();
  }
  bindDashboardSectionPersistence._boundRoots.add(root);

  root.addEventListener(
    "toggle",
    (event) => {
      const target = event.target;
      if (applyingDashboardSectionOpenState) {
        return;
      }
      if (!target?.classList?.contains?.("dashboard-section") || !target.getAttribute?.("data-section")) {
        return;
      }
      writeDashboardSectionState(
        root.__smaDashboardTournamentId,
        collectOpenDashboardSectionIds(root),
        storage
      );
    },
    true
  );
}
