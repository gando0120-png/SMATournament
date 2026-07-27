/**
 * 予選自動進行ドメインテスト
 */
import assert from "node:assert/strict";
import { EntryStatus, TournamentStatus } from "../../js/domain/constants.js";
import { distributeEntriesToFixedBlocks } from "../../js/domain/fixed-block-draw.js";
import { buildQualifyingScheduleFromBlockDraw } from "../../js/domain/qualifying-schedule.js";
import { buildPersistedQualifyingSchedule } from "../../js/domain/qualifying-schedule-persist.js";
import { validateMatchResultInput } from "../../js/domain/qualifying-match-result.js";
import {
  generateQualifyingMatchResults,
  QualifyingSimulationMode,
} from "../../js/domain/qualifying-match-result-generator.js";
import {
  areAllConfirmedEntriesDummy,
  buildQualifyingAutoProgressPlan,
  validateQualifyingAutoProgress,
} from "../../js/domain/qualifying-auto-progress.js";
import { buildQualifyingStandings } from "../../js/domain/qualifying-standings.js";
import { TournamentFormat } from "../../js/domain/tournament-format.js";
import { createSeededRandom, deriveDefaultSimulationSeed } from "../../js/domain/seeded-random.js";
import { buildTournamentStructureState } from "../../js/domain/tournament-structure-state.js";

function makeDummyEntries(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `entry-${index + 1}`,
    teamName: `ダミーチーム${String(index + 1).padStart(2, "0")}`,
    status: EntryStatus.CONFIRMED,
    isDummy: true,
  }));
}

function buildSingleBlockSchedule(teamCount) {
  const entries = makeDummyEntries(teamCount);
  const blockDraw = {
    status: "finalized",
    blockCount: 1,
    blocks: [
      {
        id: "A",
        name: "Aブロック",
        entryIds: entries.map((entry) => entry.id),
      },
    ],
  };
  const preview = buildQualifyingScheduleFromBlockDraw(blockDraw, entries);
  const schedule = buildPersistedQualifyingSchedule(preview, blockDraw);
  return { entries, blockDraw, schedule };
}

function buildScheduleFixture(teamCount, blockCount = 4, random = () => 0) {
  const entries = makeDummyEntries(teamCount);
  const blockDraw = distributeEntriesToFixedBlocks({
    entries,
    blockCount,
    random,
  });
  blockDraw.status = "finalized";
  const preview = buildQualifyingScheduleFromBlockDraw(blockDraw, entries);
  const schedule = buildPersistedQualifyingSchedule(preview, blockDraw);
  return { entries, blockDraw, schedule };
}

const testTournament = {
  id: "tournament-test-1",
  name: "[E2E] Qualifying Auto",
  status: TournamentStatus.OPEN,
  tournamentFormat: TournamentFormat.QUALIFYING_AND_FINALS,
  blockCount: 4,
  qualifiersPerBlock: 2,
  maxTeams: 64,
};

{
  const random = createSeededRandom(12345);
  const first = random();
  const second = random();
  const replay = createSeededRandom(12345);
  assert.equal(replay(), first);
  assert.equal(replay(), second);
  assert.notEqual(first, second);
}

assert.equal(typeof deriveDefaultSimulationSeed("abc"), "number");

{
  const { entries, blockDraw, schedule } = buildScheduleFixture(16, 4);
  const generatedA = generateQualifyingMatchResults({
    schedule,
    simulationSeed: 12345,
    mode: QualifyingSimulationMode.STANDARD,
  });
  const generatedB = generateQualifyingMatchResults({
    schedule,
    simulationSeed: 12345,
    mode: QualifyingSimulationMode.STANDARD,
  });
  assert.equal(generatedA.errors.length, 0);
  assert.equal(generatedA.results.size, generatedA.matchCount);
  assert.equal(generatedA.results.size, generatedB.results.size);

  for (const [matchId, itemA] of generatedA.results) {
    const itemB = generatedB.results.get(matchId);
    assert.deepEqual(itemA.input, itemB.input);
  }
}

{
  const { schedule } = buildScheduleFixture(16, 4);
  const generatedA = generateQualifyingMatchResults({
    schedule,
    simulationSeed: 111,
    mode: QualifyingSimulationMode.STANDARD,
  });
  const generatedB = generateQualifyingMatchResults({
    schedule,
    simulationSeed: 222,
    mode: QualifyingSimulationMode.STANDARD,
  });
  assert.ok(generatedA.results.size > 0);
  const firstMatchId = [...generatedA.results.keys()][0];
  assert.notDeepEqual(
    generatedA.results.get(firstMatchId).input,
    generatedB.results.get(firstMatchId).input
  );
}

for (const teamCount of [12, 13, 16]) {
  const { schedule } = buildScheduleFixture(teamCount, 4);
  const generated = generateQualifyingMatchResults({
    schedule,
    simulationSeed: 999,
    mode: QualifyingSimulationMode.STANDARD,
  });
  assert.equal(generated.errors.length, 0, `teamCount=${teamCount}`);
  assert.equal(generated.results.size, generated.matchCount, `teamCount=${teamCount}`);

  for (const [, item] of generated.results) {
    const validation = validateMatchResultInput(item.input);
    assert.equal(validation.valid, true, `teamCount=${teamCount}`);
  }
}

{
  const { entries, blockDraw, schedule } = buildScheduleFixture(13, 4);
  const blockSizes = blockDraw.blocks.map((block) => block.entryIds.length).sort((a, b) => a - b);
  assert.ok(blockSizes.includes(3));
  assert.ok(blockSizes.includes(4));

  const generated = generateQualifyingMatchResults({
    schedule,
    simulationSeed: 54321,
    mode: QualifyingSimulationMode.INCLUDE_DRAWS,
  });
  assert.equal(generated.errors.length, 0);
  assert.equal(generated.results.size, generated.matchCount);
}

{
  const { schedule } = buildSingleBlockSchedule(4);
  const generated = generateQualifyingMatchResults({
    schedule,
    simulationSeed: 42,
    mode: QualifyingSimulationMode.STANDARD,
  });
  assert.equal(generated.errors.length, 0);
  assert.equal(generated.results.size, 6);
}

{
  const { schedule } = buildSingleBlockSchedule(3);
  const generated = generateQualifyingMatchResults({
    schedule,
    simulationSeed: 7,
    mode: QualifyingSimulationMode.STANDARD,
  });
  assert.equal(generated.errors.length, 0);
  assert.equal(generated.results.size, 3);
}

{
  const { schedule } = buildScheduleFixture(16, 4);
  const generated = generateQualifyingMatchResults({
    schedule,
    simulationSeed: 12345,
    mode: QualifyingSimulationMode.STANDARD,
  });
  assert.equal(generated.strengthCache.size > 0, true);
  for (const entryId of generated.strengthCache.keys()) {
    assert.match(entryId, /^entry-/);
  }
}

{
  const entries = [
    ...makeDummyEntries(3),
    { id: "real-1", teamName: "実チーム", status: EntryStatus.CONFIRMED, isDummy: false },
  ];
  assert.equal(areAllConfirmedEntriesDummy(entries), false);

  const validation = validateQualifyingAutoProgress({
    tournament: testTournament,
    canManage: true,
    entries,
    blockDraw: { status: "finalized", blocks: [{ id: "A", entryIds: [] }] },
    schedule: { finalized: true, blocks: [] },
    structureState: buildTournamentStructureState({}),
    existingResults: new Map(),
  });
  assert.equal(validation.allowed, false);
  assert.match(validation.reason, /実参加者/);
}

{
  const { entries, blockDraw, schedule } = buildScheduleFixture(12, 4);
  const existingResults = new Map([
    ["qualifying-A-R1-M1", { status: "finished" }],
  ]);
  const validation = validateQualifyingAutoProgress({
    tournament: testTournament,
    canManage: true,
    entries,
    blockDraw,
    schedule,
    structureState: buildTournamentStructureState({ blockDraw, qualifyingSchedule: schedule }),
    existingResults,
  });
  assert.equal(validation.allowed, false);
  assert.match(validation.reason, /すでに入力/);
}

{
  const { entries, blockDraw, schedule } = buildScheduleFixture(12, 4);
  const validation = validateQualifyingAutoProgress({
    tournament: testTournament,
    canManage: true,
    entries,
    blockDraw,
    schedule,
    structureState: buildTournamentStructureState({
      blockDraw,
      qualifyingSchedule: schedule,
      finalsAdvancement: { finalized: true },
    }),
    existingResults: new Map(),
  });
  assert.equal(validation.allowed, false);
  assert.match(validation.reason, /決勝進出/);
}

{
  const { entries, blockDraw, schedule } = buildScheduleFixture(12, 4);
  const plan = buildQualifyingAutoProgressPlan({
    tournament: testTournament,
    canManage: true,
    entries,
    blockDraw,
    schedule,
    structureState: buildTournamentStructureState({ blockDraw, qualifyingSchedule: schedule }),
    existingResults: new Map(),
    simulationSeed: 12345,
    mode: QualifyingSimulationMode.STANDARD,
    tournamentId: testTournament.id,
  });
  assert.equal(plan.valid, true);

  const resultsMap = new Map(
    [...plan.generated.results.entries()].map(([matchId, item]) => [
      matchId,
      {
        ...item.validated,
        status: "finished",
        team1: item.scheduleMatch.team1,
        team2: item.scheduleMatch.team2,
      },
    ])
  );
  const standings = buildQualifyingStandings(schedule, resultsMap);
  assert.equal(standings.blocks.length, 4);
  assert.equal(standings.blocks.every((block) => block.standings.length > 0), true);
}

{
  const { entries, blockDraw, schedule } = buildScheduleFixture(12, 4);
  const closedValidation = validateQualifyingAutoProgress({
    tournament: { ...testTournament, status: "closed" },
    canManage: true,
    entries,
    blockDraw,
    schedule,
    structureState: buildTournamentStructureState({ blockDraw, qualifyingSchedule: schedule }),
    existingResults: new Map(),
  });
  assert.equal(closedValidation.allowed, false);
}

console.log("qualifying-auto-progress.test.mjs: all passed");
