/**
 * 大会ダッシュボード アコーディオン（状態ラベル・初期展開・sessionStorage）
 */
import assert from "node:assert/strict";
import {
  DashboardSectionId,
  applyDashboardSectionOpenState,
  applyDashboardSectionStatuses,
  bindDashboardSectionPersistence,
  collectOpenDashboardSectionIds,
  dashboardSectionStorageKey,
  readDashboardSectionState,
  resolveDashboardSectionStatuses,
  resolveInitialOpenDashboardSections,
  syncDashboardSectionUi,
  writeDashboardSectionState,
} from "../../js/ui/dashboard-sections.js";
import { EntryStatus, TournamentStatus } from "../../js/domain/constants.js";
import { TournamentFormat } from "../../js/domain/tournament-format.js";

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

function throwingStorage() {
  return {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
  };
}

function makeSection(id, { open = true, status = "" } = {}) {
  const classSet = new Set(["dashboard-section"]);
  const statusEl = {
    getAttribute(name) {
      return name === "data-section-status" ? id : null;
    },
    textContent: status,
  };
  return {
    open,
    classList: {
      contains(name) {
        return classSet.has(name);
      },
    },
    getAttribute(name) {
      return name === "data-section" ? id : null;
    },
    statusEl,
  };
}

function makeRoot(ids, openIds = ids) {
  const open = new Set(openIds);
  const sections = ids.map((id) => makeSection(id, { open: open.has(id) }));
  const listeners = [];
  return {
    sections,
    querySelectorAll(selector) {
      if (String(selector).includes("data-section-status")) {
        return sections.map((section) => section.statusEl);
      }
      return sections;
    },
    addEventListener(type, fn, capture) {
      listeners.push({ type, fn, capture });
    },
    dispatchToggle(section) {
      for (const listener of listeners) {
        if (listener.type === "toggle") {
          listener.fn({ target: section });
        }
      }
    },
  };
}

const qf = TournamentFormat.QUALIFYING_AND_FINALS;
const se = TournamentFormat.SINGLE_ELIMINATION;

{
  const statuses = resolveDashboardSectionStatuses({
    tournament: {
      maxTeams: 16,
      eventDate: "2026-09-20",
      participantResultEntryEnabled: false,
    },
    entries: [
      { status: EntryStatus.CONFIRMED },
      { status: EntryStatus.CONFIRMED },
      { status: EntryStatus.PENDING },
    ],
    format: qf,
    isPublicViewEnabled: true,
  });
  assert.equal(statuses[DashboardSectionId.ENTRIES], "確定 2/16・申込中 1");
  assert.equal(statuses[DashboardSectionId.INFO], "2026-09-20");
  assert.equal(statuses[DashboardSectionId.PUBLIC], "公開中");
  assert.equal(statuses[DashboardSectionId.PLAYER_RESULTS], "OFF");
  assert.equal(statuses[DashboardSectionId.QUALIFYING], "未抽選");
  assert.equal(statuses[DashboardSectionId.ADVANCEMENT], "未確定");
  assert.equal(statuses[DashboardSectionId.FINALS], "未開始");
  assert.equal(statuses[DashboardSectionId.SE], undefined);
}

{
  const statuses = resolveDashboardSectionStatuses({
    tournament: { maxTeams: 8 },
    entries: Array.from({ length: 8 }, () => ({ status: EntryStatus.CONFIRMED })),
    format: qf,
    blockDraw: { blocks: [{ entryIds: ["a"] }] },
    isBlockDrawDraft: true,
  });
  assert.equal(statuses[DashboardSectionId.ENTRIES], "確定 8/8");
  assert.equal(statuses[DashboardSectionId.QUALIFYING], "配置確認中");
}

{
  const statuses = resolveDashboardSectionStatuses({
    format: qf,
    blockDraw: { blocks: [{ entryIds: ["a"] }] },
    isBlockDrawFinalized: true,
    qualifyingSchedule: { finalized: false },
  });
  assert.equal(statuses[DashboardSectionId.QUALIFYING], "対戦表未生成");
}

{
  const statuses = resolveDashboardSectionStatuses({
    format: qf,
    blockDraw: { blocks: [{ entryIds: ["a"] }] },
    isBlockDrawFinalized: true,
    qualifyingSchedule: { finalized: true },
    signals: { hasStartedQualifyingMatchSessions: true },
  });
  assert.equal(statuses[DashboardSectionId.QUALIFYING], "予選開始済");
}

{
  const statuses = resolveDashboardSectionStatuses({
    format: qf,
    blockDraw: { blocks: [{ entryIds: ["a"] }] },
    isBlockDrawFinalized: true,
    qualifyingSchedule: { finalized: true },
    signals: { hasQualifyingMatchResults: true, hasFinalsAdvancement: true },
    finalsBracket: { finalized: true },
  });
  assert.equal(statuses[DashboardSectionId.QUALIFYING], "予選開始済");
  assert.equal(statuses[DashboardSectionId.ADVANCEMENT], "確定済");
  assert.equal(statuses[DashboardSectionId.FINALS], "表作成済");
}

{
  const statuses = resolveDashboardSectionStatuses({
    format: qf,
    blockDraw: { blocks: [{ entryIds: ["a"] }] },
    isBlockDrawFinalized: true,
    qualifyingSchedule: { finalized: true },
    signals: { hasFinalsMatchResults: true },
    finalsBracket: { finalized: true },
  });
  assert.equal(statuses[DashboardSectionId.FINALS], "試合あり");
}

{
  const statuses = resolveDashboardSectionStatuses({
    format: qf,
    blockDraw: { blocks: [{ entryIds: ["a"] }] },
    isBlockDrawFinalized: true,
    qualifyingSchedule: { finalized: true },
  });
  assert.equal(statuses[DashboardSectionId.QUALIFYING], "抽選済み");
}

{
  const statuses = resolveDashboardSectionStatuses({
    format: se,
    tournament: { participantResultEntryEnabled: true },
    isPublicViewEnabled: false,
  });
  assert.equal(statuses[DashboardSectionId.PUBLIC], "非公開");
  assert.equal(statuses[DashboardSectionId.PLAYER_RESULTS], "ON");
  assert.equal(statuses[DashboardSectionId.SE], "未作成");
  assert.equal(statuses[DashboardSectionId.QUALIFYING], undefined);
  assert.equal(statuses[DashboardSectionId.FINALS], undefined);
}

{
  assert.equal(
    resolveDashboardSectionStatuses({
      format: se,
      hasCreatedSingleEliminationBracket: true,
    })[DashboardSectionId.SE],
    "作成済"
  );
  assert.equal(
    resolveDashboardSectionStatuses({
      format: se,
      lossBandState: { status: "in_progress" },
    })[DashboardSectionId.SE],
    "開始済"
  );
}

{
  assert.deepEqual(
    resolveInitialOpenDashboardSections({
      tournament: { status: TournamentStatus.DRAFT },
      format: qf,
    }),
    [DashboardSectionId.INFO, DashboardSectionId.ENTRY_OPEN]
  );
  assert.deepEqual(
    resolveInitialOpenDashboardSections({
      tournament: { status: TournamentStatus.OPEN },
      format: qf,
    }),
    [DashboardSectionId.ENTRIES, DashboardSectionId.QUALIFYING]
  );
  assert.deepEqual(
    resolveInitialOpenDashboardSections({
      tournament: { status: TournamentStatus.OPEN },
      format: qf,
      blockDraw: { blocks: [{ entryIds: ["a"] }] },
      isBlockDrawDraft: true,
    }),
    [DashboardSectionId.QUALIFYING]
  );
  assert.deepEqual(
    resolveInitialOpenDashboardSections({
      tournament: { status: TournamentStatus.OPEN },
      format: qf,
      blockDraw: { blocks: [{ entryIds: ["a"] }] },
      isBlockDrawFinalized: true,
      signals: { hasQualifyingMatchResults: true },
    }),
    [DashboardSectionId.QUALIFYING]
  );
  assert.deepEqual(
    resolveInitialOpenDashboardSections({
      tournament: { status: TournamentStatus.OPEN },
      format: qf,
      blockDraw: { blocks: [{ entryIds: ["a"] }] },
      isBlockDrawFinalized: true,
      signals: { hasFinalsAdvancement: true },
    }),
    [DashboardSectionId.FINALS]
  );
  assert.deepEqual(
    resolveInitialOpenDashboardSections({
      tournament: { status: TournamentStatus.OPEN },
      format: se,
    }),
    [DashboardSectionId.SE]
  );
  assert.deepEqual(
    resolveInitialOpenDashboardSections({
      tournament: { status: TournamentStatus.CLOSED },
      format: qf,
    }),
    [DashboardSectionId.BROWSE]
  );
}

{
  const storage = memoryStorage();
  assert.equal(dashboardSectionStorageKey("tour-a"), "sma.dashboard.sections.tour-a");
  assert.equal(readDashboardSectionState("tour-a", storage), null);
  assert.equal(
    writeDashboardSectionState("tour-a", [DashboardSectionId.ENTRIES, DashboardSectionId.QUALIFYING], storage),
    true
  );
  assert.deepEqual(readDashboardSectionState("tour-a", storage), [
    DashboardSectionId.ENTRIES,
    DashboardSectionId.QUALIFYING,
  ]);
  writeDashboardSectionState("tour-b", [DashboardSectionId.FINALS], storage);
  assert.deepEqual(readDashboardSectionState("tour-a", storage), [
    DashboardSectionId.ENTRIES,
    DashboardSectionId.QUALIFYING,
  ]);
  assert.deepEqual(readDashboardSectionState("tour-b", storage), [DashboardSectionId.FINALS]);
}

{
  const storage = memoryStorage({
    "sma.dashboard.sections.broken": "{not-json",
  });
  assert.equal(readDashboardSectionState("broken", storage), null);
}

{
  const storage = memoryStorage({
    "sma.dashboard.sections.old": JSON.stringify({ v: 99, open: ["entries"] }),
  });
  assert.equal(readDashboardSectionState("old", storage), null);
}

{
  const storage = memoryStorage({
    "sma.dashboard.sections.weird": JSON.stringify({
      v: 1,
      open: ["entries", "not-a-section", 12],
    }),
  });
  assert.deepEqual(readDashboardSectionState("weird", storage), [DashboardSectionId.ENTRIES]);
}

{
  const storage = throwingStorage();
  assert.equal(readDashboardSectionState("tour-a", storage), null);
  assert.equal(writeDashboardSectionState("tour-a", [DashboardSectionId.INFO], storage), false);
}

{
  const root = makeRoot(
    [DashboardSectionId.ENTRIES, DashboardSectionId.QUALIFYING, DashboardSectionId.FINALS],
    [DashboardSectionId.ENTRIES, DashboardSectionId.QUALIFYING, DashboardSectionId.FINALS]
  );
  applyDashboardSectionOpenState(root, [DashboardSectionId.QUALIFYING]);
  assert.deepEqual(collectOpenDashboardSectionIds(root), [DashboardSectionId.QUALIFYING]);
}

{
  const root = makeRoot([DashboardSectionId.ENTRIES, DashboardSectionId.INFO]);
  const storage = memoryStorage();
  bindDashboardSectionPersistence(root, "tour-a", storage);
  root.sections[0].open = false;
  root.dispatchToggle(root.sections[0]);
  assert.deepEqual(readDashboardSectionState("tour-a", storage), [DashboardSectionId.INFO]);
}

{
  const root = makeRoot(
    [DashboardSectionId.ENTRIES, DashboardSectionId.QUALIFYING, DashboardSectionId.INFO],
    [DashboardSectionId.ENTRIES, DashboardSectionId.QUALIFYING, DashboardSectionId.INFO]
  );
  const storage = memoryStorage();
  writeDashboardSectionState("tour-a", [DashboardSectionId.INFO], storage);
  syncDashboardSectionUi({
    root,
    tournamentId: "tour-a",
    snapshot: {
      tournament: { status: TournamentStatus.OPEN, maxTeams: 16, eventDate: "2026-10-01" },
      format: qf,
      entries: [{ status: EntryStatus.CONFIRMED }],
    },
    storage,
  });
  assert.deepEqual(collectOpenDashboardSectionIds(root), [DashboardSectionId.INFO]);
  assert.equal(root.sections[0].statusEl.textContent, "確定 1/16");
  assert.equal(root.sections[2].statusEl.textContent, "2026-10-01");
}

{
  const root = makeRoot(
    [DashboardSectionId.INFO, DashboardSectionId.ENTRY_OPEN],
    []
  );
  syncDashboardSectionUi({
    root,
    tournamentId: "tour-draft",
    snapshot: { tournament: { status: TournamentStatus.DRAFT }, format: qf },
    storage: memoryStorage(),
  });
  assert.deepEqual(collectOpenDashboardSectionIds(root).sort(), [
    DashboardSectionId.ENTRY_OPEN,
    DashboardSectionId.INFO,
  ]);
}

{
  applyDashboardSectionOpenState(null, ["entries"]);
  applyDashboardSectionStatuses(null, { entries: "x" });
  assert.deepEqual(collectOpenDashboardSectionIds(null), []);
  syncDashboardSectionUi({});
}

console.log("dashboard-sections.test.mjs: all passed");
