/**
 * ダミー参加者ドメインテスト
 */
import assert from "node:assert/strict";
import { EntryStatus } from "../../js/domain/constants.js";
import {
  allocateDummyTeamNames,
  buildDummyEntryPayload,
  calculateDummyFillPlan,
  findLatestDummyBatchId,
  formatDummyTeamName,
  validateDummyEntryDeletion,
  validateDummyEntryFill,
} from "../../js/domain/dummy-entries.js";
import { buildTournamentStructureState } from "../../js/domain/tournament-structure-state.js";
import { isTestTournamentName, canUseTournamentTestTools } from "../../js/domain/test-tournament-access.js";
import { sanitizeEntryForPublic } from "../../js/domain/public-tournament-view.js";
import { findForbiddenSnapshotFields } from "../../js/domain/public-tournament-snapshot.js";

assert.equal(isTestTournamentName("[E2E] Sample"), true);
assert.equal(isTestTournamentName("[TEST] Sample"), true);
assert.equal(isTestTournamentName("通常大会"), false);

const openTestTournament = { name: "[E2E] Demo", status: "open", maxTeams: 64 };
const closedTestTournament = { name: "[E2E] Demo", status: "closed", maxTeams: 64 };

assert.equal(canUseTournamentTestTools({ tournament: openTestTournament, canManage: true }).allowed, true);
assert.equal(canUseTournamentTestTools({ tournament: closedTestTournament, canManage: true }).allowed, false);
assert.equal(canUseTournamentTestTools({ tournament: openTestTournament, canManage: false }).allowed, false);

const emptyStructure = buildTournamentStructureState({});
assert.equal(emptyStructure.hasStructure, false);

const lockedStructure = buildTournamentStructureState({ blockDraw: { id: "current" } });
assert.equal(lockedStructure.hasStructure, true);

const fillZero = calculateDummyFillPlan({
  targetCount: 8,
  confirmedCount: 8,
  maxTeams: 64,
  existingEntries: [],
});
assert.equal(fillZero.valid, true);
assert.equal(fillZero.toAdd, 0);

const fillPlan = calculateDummyFillPlan({
  targetCount: 16,
  confirmedCount: 3,
  maxTeams: 64,
  existingEntries: [{ teamName: "ダミーチーム01" }],
});
assert.equal(fillPlan.valid, true);
assert.equal(fillPlan.toAdd, 13);
assert.equal(fillPlan.teamNames.length, 13);
assert.equal(fillPlan.teamNames.includes("ダミーチーム01"), false);

const overMax = calculateDummyFillPlan({
  targetCount: 65,
  confirmedCount: 0,
  maxTeams: 64,
});
assert.equal(overMax.valid, false);

const overLimit = calculateDummyFillPlan({
  targetCount: 20,
  confirmedCount: 0,
  maxTeams: 16,
});
assert.equal(overLimit.valid, false);

const names = allocateDummyTeamNames(new Set(["ダミーチーム01", "ダミーチーム02"]), 2);
assert.equal(names.valid, true);
assert.deepEqual(names.names, ["ダミーチーム03", "ダミーチーム04"]);

const payload = buildDummyEntryPayload({
  teamName: formatDummyTeamName(1),
  dummyBatchId: "batch-1",
  dummyIndex: 1,
  teamSize: 1,
});
assert.equal(payload.status, EntryStatus.CONFIRMED);
assert.equal(payload.isDummy, true);
assert.match(payload.email, /@example\.invalid$/);

const entries = [
  { id: "real-1", isDummy: false, status: EntryStatus.CONFIRMED, teamName: "Real Team" },
  {
    id: "d1",
    isDummy: true,
    dummyBatchId: "batch-a",
    createdAt: 100,
    status: EntryStatus.CONFIRMED,
    teamName: "ダミーチーム01",
  },
  {
    id: "d2",
    isDummy: true,
    dummyBatchId: "batch-b",
    createdAt: 200,
    status: EntryStatus.CONFIRMED,
    teamName: "ダミーチーム02",
  },
];

assert.equal(findLatestDummyBatchId(entries), "batch-b");

const deleteLatest = validateDummyEntryDeletion({
  tournament: openTestTournament,
  canManage: true,
  structureState: emptyStructure,
  entries,
  mode: "latest-batch",
});
assert.equal(deleteLatest.valid, true);
assert.equal(deleteLatest.targets.length, 1);
assert.equal(deleteLatest.targets[0].id, "d2");

const deleteAll = validateDummyEntryDeletion({
  tournament: openTestTournament,
  canManage: true,
  structureState: emptyStructure,
  entries,
  mode: "all",
});
assert.equal(deleteAll.valid, true);
assert.equal(deleteAll.targets.length, 2);
assert.equal(deleteAll.targets.every((entry) => entry.isDummy === true), true);

const blockedFill = validateDummyEntryFill({
  tournament: openTestTournament,
  canManage: true,
  structureState: lockedStructure,
  targetCount: 8,
  confirmedCount: 0,
  maxTeams: 64,
  existingEntries: [],
});
assert.equal(blockedFill.valid, false);

const publicEntry = sanitizeEntryForPublic({
  id: "e1",
  teamName: "ダミーチーム01",
  status: EntryStatus.CONFIRMED,
  representativeName: "ダミー代表01",
  email: "dummy-001@example.invalid",
  isDummy: true,
  dummyBatchId: "batch-a",
  dummyIndex: 1,
});
assert.equal(publicEntry.teamName, "ダミーチーム01");
assert.equal("isDummy" in publicEntry, false);
assert.equal("dummyBatchId" in publicEntry, false);
assert.equal("email" in publicEntry, false);

const snapshotProbe = {
  registration: {
    items: [{ entryId: "e1", teamName: "A", isDummy: true, dummyBatchId: "x", dummyIndex: 1 }],
  },
};
assert.ok(findForbiddenSnapshotFields(snapshotProbe).length > 0);

console.log("dummy-entries.test.mjs: all passed");
