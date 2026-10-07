/**
 * 抽選前の参加辞退（confirmed → cancelled）
 */
import assert from "node:assert/strict";
import { EntryStatus, TournamentStatus, getEntryStatusLabel } from "../../js/domain/constants.js";
import {
  assertEntryCancellationAllowed,
  countConfirmedEntries,
  evaluateEntryCancellation,
  filterConfirmedEntries,
  hasFormalDrawOrQualifyingSchedule,
  ENTRY_CANCEL_AFTER_DRAW_MESSAGE,
} from "../../js/domain/entry-cancellation.js";
import { buildPublicTournamentView } from "../../js/domain/public-tournament-view.js";
import { buildEmergencyExport } from "../../js/domain/emergency-export.js";
import { buildEmergencyOpsExcelModel } from "../../js/domain/emergency-ops-excel.js";
import { classifyError, ErrorCodes } from "../../js/lib/errors.js";

const openTournament = { id: "t1", name: "Test", status: TournamentStatus.OPEN };
const confirmedEntry = { id: "e1", teamName: "確定チーム", status: EntryStatus.CONFIRMED };
const pendingEntry = { id: "e2", teamName: "申込チーム", status: EntryStatus.PENDING };
const cancelledEntry = { id: "e3", teamName: "辞退チーム", status: EntryStatus.CANCELLED };

{
  assert.equal(hasFormalDrawOrQualifyingSchedule({}), false);
  assert.equal(hasFormalDrawOrQualifyingSchedule({ blockDraw: null, qualifyingSchedule: null }), false);
  assert.equal(hasFormalDrawOrQualifyingSchedule({ blockDraw: { status: "draft" } }), true);
  assert.equal(hasFormalDrawOrQualifyingSchedule({ blockDraw: { status: "finalized" } }), true);
  assert.equal(
    hasFormalDrawOrQualifyingSchedule({ qualifyingSchedule: { finalized: true } }),
    true
  );
}

{
  const allowed = evaluateEntryCancellation({
    entry: confirmedEntry,
    tournament: openTournament,
  });
  assert.equal(allowed.allowed, true);
}

{
  const pending = evaluateEntryCancellation({
    entry: pendingEntry,
    tournament: openTournament,
  });
  assert.equal(pending.allowed, false);
  assert.equal(pending.code, "entry/not-confirmed");
}

{
  const alreadyCancelled = evaluateEntryCancellation({
    entry: cancelledEntry,
    tournament: openTournament,
  });
  assert.equal(alreadyCancelled.allowed, false);
  assert.equal(alreadyCancelled.code, "entry/not-confirmed");
}

{
  const closed = evaluateEntryCancellation({
    entry: confirmedEntry,
    tournament: { ...openTournament, status: TournamentStatus.CLOSED },
  });
  assert.equal(closed.allowed, false);
  assert.equal(closed.code, "tournament/not-open");
}

{
  const afterDraw = evaluateEntryCancellation({
    entry: confirmedEntry,
    tournament: openTournament,
    blockDraw: { status: "finalized", blocks: [{ entryIds: ["e1"] }] },
  });
  assert.equal(afterDraw.allowed, false);
  assert.equal(afterDraw.code, "entry/cancel-after-draw");
  assert.equal(afterDraw.message, ENTRY_CANCEL_AFTER_DRAW_MESSAGE);
}

{
  const afterDraft = evaluateEntryCancellation({
    entry: confirmedEntry,
    tournament: openTournament,
    blockDraw: { status: "draft", blocks: [{ entryIds: ["e1"] }] },
  });
  assert.equal(afterDraft.allowed, false);
  assert.equal(afterDraft.code, "entry/cancel-after-draw");
}

{
  const afterSchedule = evaluateEntryCancellation({
    entry: confirmedEntry,
    tournament: openTournament,
    qualifyingSchedule: { finalized: true },
  });
  assert.equal(afterSchedule.allowed, false);
  assert.equal(afterSchedule.code, "entry/cancel-after-draw");
}

{
  assert.throws(
    () =>
      assertEntryCancellationAllowed({
        entry: confirmedEntry,
        tournament: openTournament,
        blockDraw: { status: "finalized" },
      }),
    (error) => error.code === "entry/cancel-after-draw"
  );
  assert.doesNotThrow(() =>
    assertEntryCancellationAllowed({
      entry: confirmedEntry,
      tournament: openTournament,
    })
  );
}

{
  const entries = [confirmedEntry, pendingEntry, cancelledEntry, { id: "e4", status: EntryStatus.CONFIRMED }];
  assert.equal(countConfirmedEntries(entries), 2);
  assert.deepEqual(
    filterConfirmedEntries(entries).map((entry) => entry.id),
    ["e1", "e4"]
  );
  assert.equal(filterConfirmedEntries(entries).some((entry) => entry.id === "e3"), false);
}

{
  assert.equal(getEntryStatusLabel(EntryStatus.CANCELLED), "キャンセル / 辞退済み");
}

{
  const classified = classifyError({
    code: ErrorCodes.ENTRY_CANCEL_AFTER_DRAW,
    message: ENTRY_CANCEL_AFTER_DRAW_MESSAGE,
  });
  assert.equal(classified.code, ErrorCodes.ENTRY_CANCEL_AFTER_DRAW);
  assert.equal(classified.message, ENTRY_CANCEL_AFTER_DRAW_MESSAGE);
}

{
  const view = buildPublicTournamentView({
    tournament: {
      id: "t1",
      name: "公開辞退",
      status: TournamentStatus.OPEN,
      tournamentFormat: "qualifying_and_finals",
      publicViewEnabled: true,
      teamSize: 1,
      courtCount: 2,
    },
    entries: [confirmedEntry, pendingEntry, cancelledEntry],
  });
  assert.equal(view.tournament.confirmedCount, 1);
  assert.equal(
    view.sections.registration.items.some((item) => item.entryId === "e3"),
    false
  );
  assert.equal(
    view.sections.registration.items.some((item) => item.entryId === "e1"),
    true
  );
}

{
  const exported = buildEmergencyExport({
    tournamentId: "t-cancel",
    projectId: "demo",
    exportedAt: new Date("2026-10-07T00:00:00.000Z"),
    tournament: {
      id: "t-cancel",
      name: "辞退確認",
      status: "open",
      eventDate: "2099-12-31",
    },
    entries: [
      { id: "stay", teamName: "残るチーム", status: "confirmed", teamNumber: 1 },
      {
        id: "gone",
        teamName: "辞退チーム",
        status: "cancelled",
        email: "gone@example.com",
        representativeName: "代表辞退",
      },
    ],
  });

  const sourceGone = exported.source.entries.find((entry) => entry.entryId === "gone");
  assert.equal(sourceGone.status, "cancelled");
  assert.equal(sourceGone.teamName, "辞退チーム");
  assert.equal(sourceGone.email, undefined);
  assert.equal(
    exported.derived.confirmedEntries.some((entry) => entry.entryId === "gone"),
    false
  );
  assert.equal(exported.derived.confirmedEntries.length, 1);
  assert.equal(exported.derived.confirmedEntries[0].entryId, "stay");

  const excel = buildEmergencyOpsExcelModel(exported);
  const situation = Object.fromEntries(
    excel.sheets.find((sheet) => sheet.name === "大会状況").rows.filter((row) => row[0])
  );
  assert.equal(Number(situation["確定参加チーム数"]), 1);
}

console.log("entry-cancellation.test.mjs: all passed");
