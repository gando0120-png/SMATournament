/**
 * 予選自動進行サービス層テスト（Firestore 非依存）
 */
import assert from "node:assert/strict";
import { EntryStatus } from "../../js/domain/constants.js";
import { distributeEntriesToFixedBlocks } from "../../js/domain/fixed-block-draw.js";
import { buildQualifyingScheduleFromBlockDraw } from "../../js/domain/qualifying-schedule.js";
import { buildPersistedQualifyingSchedule } from "../../js/domain/qualifying-schedule-persist.js";
import {
  generateQualifyingMatchResults,
  QualifyingSimulationMode,
} from "../../js/domain/qualifying-match-result-generator.js";
import { summarizeQualifyingAutoProgressOutcome } from "../../js/domain/qualifying-auto-progress.js";
import { buildQualifyingStandings } from "../../js/domain/qualifying-standings.js";
import {
  buildQualifyingMatchResultPayload,
  buildValidatedQualifyingMatchResultPayload,
} from "../../js/domain/qualifying-match-result-payload.js";
import { MatchResultStatus } from "../../js/domain/constants.js";

function makeDummyEntries(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `entry-${index + 1}`,
    teamName: `Team ${index + 1}`,
    status: EntryStatus.CONFIRMED,
    isDummy: true,
  }));
}

function buildScheduleFixture(teamCount, blockCount = 4) {
  const entries = makeDummyEntries(teamCount);
  const blockDraw = distributeEntriesToFixedBlocks({
    entries,
    blockCount,
    random: () => 0,
  });
  blockDraw.status = "finalized";
  const preview = buildQualifyingScheduleFromBlockDraw(blockDraw, entries);
  const schedule = buildPersistedQualifyingSchedule(preview, blockDraw);
  return { schedule, blockDraw };
}

function buildResultsMap(schedule, simulationSeed) {
  const generated = generateQualifyingMatchResults({
    schedule,
    simulationSeed,
    mode: QualifyingSimulationMode.STANDARD,
  });
  assert.equal(generated.errors.length, 0);

  const resultsMap = new Map();
  for (const [matchId, item] of generated.results) {
    const payload = buildQualifyingMatchResultPayload(matchId, item.scheduleMatch, item.validated);
    assert.equal(payload.status, MatchResultStatus.FINISHED);
    assert.equal(payload.sets.length, 2);
    assert.equal(typeof payload.team1Stats.totalScore, "number");
    resultsMap.set(matchId, payload);
  }
  return resultsMap;
}

for (const teamCount of [12, 13, 16]) {
  const { schedule } = buildScheduleFixture(teamCount, 4);
  const resultsMap = buildResultsMap(schedule, 4242);
  const outcome = summarizeQualifyingAutoProgressOutcome(schedule, resultsMap);
  assert.equal(outcome.remainingMatches, 0, `teamCount=${teamCount}`);
  assert.equal(outcome.complete, true, `teamCount=${teamCount}`);
  assert.equal(outcome.blockCount, 4, `teamCount=${teamCount}`);
  assert.equal(outcome.teamCount, teamCount, `teamCount=${teamCount}`);

  const standings = buildQualifyingStandings(schedule, resultsMap);
  assert.equal(standings.blocks.length, 4);
  for (const block of standings.blocks) {
    assert.equal(block.standings.length >= 3, true);
  }
}

{
  const { schedule } = buildScheduleFixture(13, 4);
  const generated = generateQualifyingMatchResults({
    schedule,
    simulationSeed: 777,
    mode: QualifyingSimulationMode.STANDARD,
  });
  const first = generated.results.entries().next().value;
  const [matchId, item] = first;
  const payload = buildValidatedQualifyingMatchResultPayload(matchId, item.scheduleMatch, item.input);
  assert.equal(payload.matchId, matchId);
  assert.equal(payload.team1.entryId, item.scheduleMatch.team1.entryId);
}

console.log("qualifying-auto-progress.service.test.mjs: all passed");
