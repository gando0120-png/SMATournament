/**
 * 大会スケジュール一覧 ViewModel
 */
import assert from "node:assert/strict";
import {
  PENDING_OPPONENT_LABEL,
  REST_LABEL,
  SCHEDULE_OVERVIEW_SCHEMA_VERSION,
  ScheduleOverviewPhase,
  ScheduleOverviewSlotKind,
  ScheduleOverviewTeamRowKind,
  ScheduleOverviewTeamStatus,
  buildScheduleOverview,
  buildScheduleOverviewFromSnapshot,
  buildScheduleOverviewPrintModel,
  buildTeamSchedule,
  formatScheduleCourtLabel,
  paginateWeightedItems,
} from "../../js/domain/schedule-overview.js";
import { buildQualifyingScheduleFromBlockDraw } from "../../js/domain/qualifying-schedule.js";
import { buildPersistedQualifyingSchedule } from "../../js/domain/qualifying-schedule-persist.js";
import {
  buildTimeScheduleDoc,
  setTimeScheduleOverride,
  TimeScheduleOverrideBuckets,
} from "../../js/domain/time-schedule.js";
import {
  buildFinalsBracket,
  buildPersistedFinalsBracket,
} from "../../js/domain/finals-bracket.js";
import {
  buildPersistedSingleEliminationBracket,
  buildSingleEliminationBracket,
} from "../../js/domain/single-elimination-bracket.js";
import { TournamentFormat } from "../../js/domain/tournament-format.js";
import {
  buildPublicTournamentSnapshot,
  buildPublicTournamentViewFromSnapshot,
} from "../../js/domain/public-tournament-snapshot.js";
import { TournamentStatus, EntryStatus } from "../../js/domain/constants.js";

function makeEntries(count, nameFor = (index) => `チーム${index + 1}`) {
  return Array.from({ length: count }, (_, index) => ({
    id: `e${index + 1}`,
    teamName: nameFor(index),
    status: EntryStatus.CONFIRMED,
  }));
}

function makeMixedSixBlockDraw(entries) {
  const sizes = [4, 4, 4, 3, 3, 4];
  const blocks = [];
  let cursor = 0;
  for (let index = 0; index < sizes.length; index += 1) {
    const id = String.fromCharCode(65 + index);
    const size = sizes[index];
    blocks.push({
      id,
      name: `${id}ブロック`,
      entryIds: entries.slice(cursor, cursor + size).map((entry) => entry.id),
    });
    cursor += size;
  }
  return { status: "finalized", blocks };
}

function persistedQualifying(entries = makeEntries(22)) {
  const blockDraw = makeMixedSixBlockDraw(entries);
  const preview = buildQualifyingScheduleFromBlockDraw(blockDraw, entries);
  const schedule = buildPersistedQualifyingSchedule(preview, blockDraw);
  return { entries, blockDraw, schedule };
}

function timeDoc(overrides = {}) {
  return {
    ...buildTimeScheduleDoc({
      dayStartTime: "09:00",
      matchDurationMinutes: 20,
      matchIntervalMinutes: 5,
      qualifyingToFinalsIntervalMinutes: 70,
    }),
    ...overrides,
  };
}

function makeFinalsBracket(count = 8) {
  const qualifiers = Array.from({ length: count }, (_, index) => ({
    entryId: `e${index + 1}`,
    teamName: `チーム${index + 1}`,
    seed: index + 1,
    blockId: "A",
    blockName: "A",
    source: "block_winner",
  }));
  return buildPersistedFinalsBracket(buildFinalsBracket(qualifiers));
}

{
  assert.equal(formatScheduleCourtLabel(1), "1コート");
  assert.equal(formatScheduleCourtLabel(12), "12コート");
  assert.equal(formatScheduleCourtLabel(null), null);
  assert.equal(formatScheduleCourtLabel(0), null);
}

{
  const entries = makeEntries(22, (index) =>
    index === 0 ? "とても長いチーム名サンプルかるぱす連合A" : `チーム${index + 1}`
  );
  const { blockDraw, schedule } = persistedQualifying(entries);
  const overview = buildScheduleOverview({
    tournament: {
      id: "t1",
      name: "酒田テスト大会",
      eventDate: "2026-09-20",
      venue: "光ヶ丘",
      tournamentFormat: TournamentFormat.QUALIFYING_AND_FINALS,
    },
    entries,
    schedule,
    blockDraw,
    timeSchedule: timeDoc(),
  });

  assert.equal(overview.schemaVersion, SCHEDULE_OVERVIEW_SCHEMA_VERSION);
  assert.equal(overview.tournament.name, "酒田テスト大会");
  const qualifyingSlots = overview.slots.filter(
    (slot) => slot.phase === ScheduleOverviewPhase.QUALIFYING
  );
  assert.equal(qualifyingSlots.length, 3);
  assert.equal(qualifyingSlots[0].label, "第1節");
  assert.equal(qualifyingSlots[1].label, "第2節");
  assert.equal(qualifyingSlots[2].label, "第3節");
  assert.equal(qualifyingSlots[0].startTimeDisplay, "9:00");
  assert.equal(qualifyingSlots[1].startTimeDisplay, "9:25");
  assert.equal(qualifyingSlots[2].startTimeDisplay, "9:50");

  const round1Groups = qualifyingSlots[0].groups.map((group) => group.label);
  assert.deepEqual(round1Groups, [
    "Aブロック",
    "Bブロック",
    "Cブロック",
    "Dブロック",
    "Eブロック",
    "Fブロック",
  ]);

  const courts = qualifyingSlots[0].groups
    .flatMap((group) => group.matches)
    .map((match) => match.court);
  const sorted = [...courts].sort((a, b) => a - b);
  assert.deepEqual(courts, sorted);
  assert.ok(courts[0] >= 1);

  const longNameMatch = qualifyingSlots[0].groups
    .flatMap((group) => group.matches)
    .find(
      (match) =>
        match.team1.teamName.includes("とても長い") ||
        match.team2.teamName.includes("とても長い")
    );
  assert.ok(longNameMatch, "long team name should appear");

  const threeTeamRest = qualifyingSlots[0].rests.filter((rest) => rest.blockId === "D");
  assert.equal(threeTeamRest.length, 1);

  const fourTeamRest = qualifyingSlots[0].rests.filter((rest) => rest.blockId === "A");
  assert.equal(fourTeamRest.length, 0);
}

{
  const { entries, blockDraw, schedule } = persistedQualifying();
  const overview = buildScheduleOverview({
    tournament: {
      id: "t1",
      name: "テスト",
      tournamentFormat: TournamentFormat.QUALIFYING_AND_FINALS,
    },
    entries,
    schedule,
    blockDraw,
    timeSchedule: timeDoc(),
  });

  const unselected = buildTeamSchedule(overview, null);
  assert.equal(unselected.status, ScheduleOverviewTeamStatus.UNSELECTED);
  assert.equal(unselected.rows.length, 0);

  const missing = buildTeamSchedule(overview, "no-such-team");
  assert.equal(missing.status, ScheduleOverviewTeamStatus.NOT_FOUND);

  const fourTeamId = schedule.blocks.find((block) => block.blockId === "A").teams[0].entryId;
  const fourTeam = buildTeamSchedule(overview, fourTeamId);
  assert.equal(fourTeam.status, ScheduleOverviewTeamStatus.READY);
  assert.equal(fourTeam.rows.length, 3);
  assert.ok(fourTeam.rows.every((row) => row.kind === ScheduleOverviewTeamRowKind.MATCH));

  const threeTeamBlock = schedule.blocks.find((block) => block.blockId === "D");
  const threeTeamId = threeTeamBlock.teams[0].entryId;
  const threeTeam = buildTeamSchedule(overview, threeTeamId);
  assert.equal(threeTeam.rows.length, 3);
  const restRows = threeTeam.rows.filter((row) => row.kind === ScheduleOverviewTeamRowKind.REST);
  const matchRows = threeTeam.rows.filter((row) => row.kind === ScheduleOverviewTeamRowKind.MATCH);
  assert.equal(restRows.length, 1);
  assert.equal(matchRows.length, 2);
  assert.equal(restRows[0].note, REST_LABEL);
}

{
  const { entries, blockDraw, schedule } = persistedQualifying();
  const withOverride = timeDoc();
  const updated = setTimeScheduleOverride(
    withOverride.overrides,
    TimeScheduleOverrideBuckets.QUALIFYING_ROUNDS,
    "2",
    "10:05"
  );
  withOverride.overrides = updated.overrides;
  const overview = buildScheduleOverview({
    tournament: {
      id: "t1",
      name: "テスト",
      tournamentFormat: TournamentFormat.QUALIFYING_AND_FINALS,
    },
    entries,
    schedule,
    blockDraw,
    timeSchedule: withOverride,
  });
  const round2 = overview.slots.find(
    (slot) => slot.phase === ScheduleOverviewPhase.QUALIFYING && slot.roundNumber === 2
  );
  assert.equal(round2.startTimeDisplay, "10:05");
}

{
  const { entries, blockDraw, schedule } = persistedQualifying();
  const overview = buildScheduleOverview({
    tournament: {
      id: "t1",
      name: "テスト",
      tournamentFormat: TournamentFormat.QUALIFYING_AND_FINALS,
    },
    entries,
    schedule,
    blockDraw,
    timeSchedule: null,
  });
  const round1 = overview.slots.find(
    (slot) => slot.phase === ScheduleOverviewPhase.QUALIFYING && slot.roundNumber === 1
  );
  assert.equal(round1.label, "第1節");
  assert.equal(round1.startTime, null);
  assert.equal(round1.startTimeDisplay, null);
}

{
  const entries = makeEntries(8);
  const bracket = makeFinalsBracket(8);
  const two = buildScheduleOverview({
    tournament: {
      id: "t1",
      name: "決勝",
      tournamentFormat: TournamentFormat.QUALIFYING_AND_FINALS,
      winsRequired: 2,
    },
    entries,
    finalsBracket: bracket,
    timeSchedule: timeDoc(),
  });
  const three = buildScheduleOverview({
    tournament: {
      id: "t1",
      name: "決勝",
      tournamentFormat: TournamentFormat.QUALIFYING_AND_FINALS,
      winsRequired: 3,
    },
    entries,
    finalsBracket: bracket,
    timeSchedule: timeDoc(),
  });
  assert.deepEqual(
    two.slots.map((slot) => slot.label),
    three.slots.map((slot) => slot.label)
  );
  assert.ok(two.slots.some((slot) => slot.label === "1回戦"));
  assert.ok(two.slots.some((slot) => slot.label === "準決勝" || slot.label === "決勝"));
}

{
  const { entries, blockDraw, schedule } = persistedQualifying();
  const finals = makeFinalsBracket(8);
  const overview = buildScheduleOverview({
    tournament: {
      id: "t1",
      name: "予選+決勝",
      eventDate: "2026-09-20",
      venue: "会場",
      tournamentFormat: TournamentFormat.QUALIFYING_AND_FINALS,
    },
    entries,
    schedule,
    blockDraw,
    finalsBracket: finals,
    timeSchedule: timeDoc(),
  });
  const phases = overview.slots.map((slot) => slot.phase);
  const qualifyingIndex = phases.lastIndexOf(ScheduleOverviewPhase.QUALIFYING);
  const finalsIndex = phases.findIndex((phase) => phase === ScheduleOverviewPhase.FINALS);
  assert.ok(qualifyingIndex >= 0);
  assert.ok(finalsIndex > qualifyingIndex);
  assert.ok(
    overview.slots.some((slot) => slot.kind === ScheduleOverviewSlotKind.MARKER)
  );
  const team = buildTeamSchedule(overview, "e1");
  assert.ok(team.rows.some((row) => row.label.startsWith("第")));
  assert.ok(team.rows.some((row) => row.label === "1回戦" || row.label === "準決勝" || row.label === "決勝"));
}

{
  const seEntries = Array.from({ length: 5 }, (_, index) => ({
    id: `se-${index + 1}`,
    teamName: `Seed ${index + 1}`,
    status: EntryStatus.CONFIRMED,
  }));
  const preview = buildSingleEliminationBracket({
    entries: seEntries.map((entry) => ({
      entryId: entry.id,
      teamName: entry.teamName,
    })),
    random: () => 0.42,
  });
  const bracket = buildPersistedSingleEliminationBracket(preview);
  const overview = buildScheduleOverview({
    tournament: {
      id: "se1",
      name: "一発TN",
      tournamentFormat: TournamentFormat.SINGLE_ELIMINATION,
    },
    entries: seEntries,
    finalsBracket: bracket,
    timeSchedule: timeDoc(),
  });
  assert.equal(
    overview.slots.some((slot) => slot.phase === ScheduleOverviewPhase.QUALIFYING),
    false
  );
  assert.ok(overview.slots.some((slot) => slot.label === "1回戦" || slot.label.includes("回戦") || slot.label === "準決勝"));
  const byeMatch = overview.slots
    .flatMap((slot) => slot.groups.flatMap((group) => group.matches))
    .find((match) => match.team1.type === "bye" || match.team2.type === "bye");
  assert.ok(byeMatch, "SE BYE should appear");

  const pendingMatch = overview.slots
    .filter((slot) => slot.roundNumber > 1)
    .flatMap((slot) => slot.groups.flatMap((group) => group.matches))
    .find((match) => match.team1.type === "pending" || match.team2.type === "pending");
  assert.ok(pendingMatch);
  assert.equal(
    pendingMatch.team1.type === "pending" ? pendingMatch.team1.teamName : pendingMatch.team2.teamName,
    PENDING_OPPONENT_LABEL
  );

  const firstTeamId = seEntries[0].id;
  const team = buildTeamSchedule(overview, firstTeamId);
  assert.ok(
    team.rows.some((row) => row.kind === ScheduleOverviewTeamRowKind.CONDITIONAL),
    "later SE rounds should be shown as 勝ち上がった場合"
  );
}

{
  const { entries, blockDraw, schedule } = persistedQualifying();
  const snapshot = buildPublicTournamentSnapshot({
    tournament: {
      id: "t1",
      name: "公開大会",
      eventDate: "2026-09-20",
      venue: "会場",
      status: TournamentStatus.OPEN,
      tournamentFormat: TournamentFormat.QUALIFYING_AND_FINALS,
      publicViewEnabled: true,
      createdBy: "secret-operator",
    },
    entries,
    blockDraw,
    schedule,
    timeSchedule: timeDoc(),
    qualifyingResultsMap: new Map(),
    qualifyingSessionsMap: new Map(),
    finalsResultsMap: new Map(),
    finalsSessionsMap: new Map(),
  });
  assert.ok(snapshot.scheduleOverview);
  assert.equal(snapshot.qualifying.schedule.blocks[0].rounds[0].roundLabel, "第1節");
  assert.equal(snapshot.scheduleOverview.slots[0].label, "第1節");
  assert.equal(snapshot.scheduleOverview.slots[0].startTimeDisplay, "9:00");
  assert.ok(!JSON.stringify(snapshot.scheduleOverview).includes("secret-operator"));

  const fromField = buildScheduleOverviewFromSnapshot(snapshot);
  assert.equal(fromField.slots[0].label, "第1節");

  const withoutField = { ...snapshot };
  delete withoutField.scheduleOverview;
  const rebuilt = buildScheduleOverviewFromSnapshot(withoutField);
  assert.ok(rebuilt.slots.some((slot) => slot.label === "第1節"));
  assert.ok(rebuilt.slots[0].groups.length >= 1);

  const view = buildPublicTournamentViewFromSnapshot(snapshot);
  assert.ok(view.sections.qualifying.schedule.ready);
}

{
  const { entries, blockDraw, schedule } = persistedQualifying();
  const overview = buildScheduleOverview({
    tournament: { id: "t1", name: "印刷", tournamentFormat: TournamentFormat.QUALIFYING_AND_FINALS },
    entries,
    schedule,
    blockDraw,
    timeSchedule: timeDoc(),
  });
  const allPrint = buildScheduleOverviewPrintModel(overview, { mode: "all" });
  assert.equal(allPrint.title, "大会スケジュール");
  assert.ok(allPrint.pages.length >= 1);
  assert.equal(allPrint.pages[0].pageNumber, 1);
  const teamId = overview.teams[0].entryId;
  const teamPrint = buildScheduleOverviewPrintModel(overview, { mode: "team", teamId });
  assert.match(teamPrint.title, /のスケジュール/);
  assert.ok(teamPrint.teamSchedule.rows.length >= 1);
}

{
  const pages = paginateWeightedItems(
    [{ n: 1 }, { n: 2 }, { n: 3 }],
    () => 5,
    8
  );
  assert.equal(pages.length, 3);
}

console.log("schedule-overview.test.mjs: all passed");
