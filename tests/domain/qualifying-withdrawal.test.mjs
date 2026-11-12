/**
 * 対戦表確定後の参加辞退。配置と対戦表は不変で、無効試合だけを導出する。
 */
import assert from "node:assert/strict";
import { EntryStatus, TournamentStatus } from "../../js/domain/constants.js";
import { evaluateEntryCancellation } from "../../js/domain/entry-cancellation.js";
import { buildQualifyingStandings } from "../../js/domain/qualifying-standings.js";
import { getQualifyingCompletionStatus } from "../../js/domain/finals-advancement.js";
import { buildPublicTournamentView } from "../../js/domain/public-tournament-view.js";
import { buildEmergencyExport } from "../../js/domain/emergency-export.js";
import { buildEmergencyOpsExcelModel } from "../../js/domain/emergency-ops-excel.js";
import {
  evaluatePostScheduleWithdrawal,
  isQualifyingMatchVoid,
  QUALIFYING_WITHDRAWAL_VOID_LABEL,
  collectCancelledEntryIds,
} from "../../js/domain/qualifying-withdrawal.js";

const tournament = {
  id: "t1",
  name: "辞退検証",
  status: TournamentStatus.OPEN,
  eventDate: "2026-11-20",
  venue: "会場",
  tournamentFormat: "qualifying_and_finals",
  blockCount: 1,
  qualifiersPerBlock: 1,
  finalTeamCount: 2,
  maxTeams: 4,
  courtCount: 1,
};

const entries = [
  { id: "e1", teamName: "辞退予定", status: EntryStatus.CONFIRMED, teamNumber: 1 },
  { id: "e2", teamName: "残るA", status: EntryStatus.CONFIRMED, teamNumber: 2 },
  { id: "e3", teamName: "残るB", status: EntryStatus.CONFIRMED, teamNumber: 3 },
];

const blockDraw = {
  status: "finalized",
  blocks: [{ id: "A", name: "Aブロック", entryIds: ["e1", "e2", "e3"] }],
};

const schedule = {
  finalized: true,
  blocks: [
    {
      blockId: "A",
      blockName: "Aブロック",
      teamCount: 3,
      teams: [
        { entryId: "e1", teamName: "辞退予定", symbol: "A1" },
        { entryId: "e2", teamName: "残るA", symbol: "A2" },
        { entryId: "e3", teamName: "残るB", symbol: "A3" },
      ],
      rounds: [
        {
          roundNumber: 1,
          byes: [],
          matches: [
            {
              matchId: "qualifying-A-R1-M1",
              roundNumber: 1,
              courtNumber: 1,
              team1: { entryId: "e1", teamName: "辞退予定" },
              team2: { entryId: "e2", teamName: "残るA" },
              status: "waiting",
            },
          ],
        },
        {
          roundNumber: 2,
          byes: [],
          matches: [
            {
              matchId: "qualifying-A-R2-M1",
              roundNumber: 2,
              courtNumber: 1,
              team1: { entryId: "e2", teamName: "残るA" },
              team2: { entryId: "e3", teamName: "残るB" },
              status: "waiting",
            },
          ],
        },
      ],
    },
  ],
};

const scheduleBefore = JSON.stringify(schedule);
const drawBefore = JSON.stringify(blockDraw);

{
  const beforeDraw = evaluateEntryCancellation({
    entry: entries[0],
    tournament,
  });
  assert.equal(beforeDraw.allowed, true);
}

{
  const decision = evaluatePostScheduleWithdrawal({
    entry: entries[0],
    tournament,
    blockDraw,
    schedule,
    blockers: {},
  });
  assert.equal(decision.allowed, true);
  assert.deepEqual(
    decision.voidMatches.map((match) => match.matchId),
    ["qualifying-A-R1-M1"]
  );
  assert.equal(JSON.stringify(schedule), scheduleBefore);
  assert.equal(JSON.stringify(blockDraw), drawBefore);
}

{
  const blocked = evaluatePostScheduleWithdrawal({
    entry: entries[0],
    tournament,
    blockDraw,
    schedule,
    blockers: { qualifyingMatchResults: true },
  });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.code, "entry/withdrawal-started");
}

{
  const again = evaluatePostScheduleWithdrawal({
    entry: { ...entries[0], status: EntryStatus.CANCELLED },
    tournament,
    blockDraw,
    schedule,
    blockers: {},
  });
  assert.equal(again.alreadyApplied, true);
  assert.equal(again.allowed, false);
}

const cancelledEntries = entries.map((entry) =>
  entry.id === "e1" ? { ...entry, status: EntryStatus.CANCELLED } : entry
);
const cancelledIds = collectCancelledEntryIds(cancelledEntries);
assert.equal(isQualifyingMatchVoid(schedule.blocks[0].rounds[0].matches[0], cancelledIds), true);
assert.equal(isQualifyingMatchVoid(schedule.blocks[0].rounds[1].matches[0], cancelledIds), false);

const results = new Map([
  [
    "qualifying-A-R2-M1",
    {
      status: "finished",
      team1: { entryId: "e2" },
      team2: { entryId: "e3" },
      team1Stats: { setWins: 2, setDraws: 0, setLosses: 0, totalScore: 80 },
      team2Stats: { setWins: 0, setDraws: 0, setLosses: 2, totalScore: 40 },
    },
  ],
]);

{
  const standings = buildQualifyingStandings(schedule, results, { cancelledEntryIds: cancelledIds });
  const rows = standings.blocks[0].standings;
  assert.equal(rows.some((row) => row.entryId === "e1"), false);
  assert.equal(rows.find((row) => row.entryId === "e2").setWins, 2);
  assert.equal(rows.find((row) => row.entryId === "e2").playedMatches, 1);
  const completion = getQualifyingCompletionStatus(schedule, results, {
    cancelledEntryIds: cancelledIds,
  });
  assert.equal(completion.totalMatches, 1);
  assert.equal(completion.complete, true);
  assert.equal(JSON.stringify(schedule), scheduleBefore);
}

{
  const view = buildPublicTournamentView({
    tournament,
    entries: cancelledEntries,
    blockDraw,
    schedule,
    qualifyingResultsMap: results,
    qualifyingSessionsMap: new Map(),
  });
  const names = view.sections.registration.items.map((item) => item.teamName);
  assert.equal(names.includes("辞退予定"), false);
  const matches = view.sections.qualifying.schedule.blocks.flatMap((block) =>
    block.rounds.flatMap((round) => round.matches)
  );
  const voided = matches.find((match) => match.matchId === "qualifying-A-R1-M1");
  const kept = matches.find((match) => match.matchId === "qualifying-A-R2-M1");
  assert.equal(voided.voided, true);
  assert.equal(voided.statusLabel, QUALIFYING_WITHDRAWAL_VOID_LABEL);
  assert.equal(voided.roundNumber, 1);
  assert.equal(voided.courtNumber, 1);
  assert.equal(kept.voided, undefined);
  assert.equal(kept.matchId, "qualifying-A-R2-M1");
  const standingIds = view.sections.qualifying.standings.blocks
    .flatMap((block) => (block.rows || []).map((row) => row.entryId));
  assert.equal(standingIds.includes("e1"), false);
  const blockTeams = view.sections.qualifying.blocks.blocks.flatMap((block) => block.teams);
  assert.equal(blockTeams.find((team) => team.entryId === "e1").teamName, "辞退予定（参加辞退）");
}

{
  const exported = buildEmergencyExport({
    tournament,
    entries: cancelledEntries,
    blockDraw,
    qualifyingSchedule: schedule,
    qualifyingMatchResults: Object.fromEntries(results),
  });
  const remaining = exported.derived.remainingMatches.filter((match) => match.phase === "qualifying");
  assert.equal(remaining.some((match) => match.matchId === "qualifying-A-R1-M1"), false);
  const voidState = exported.derived.matchDisplayStates.find(
    (match) => match.matchId === "qualifying-A-R1-M1"
  );
  assert.equal(voidState.status, "void");
  assert.equal(voidState.statusLabelJa, QUALIFYING_WITHDRAWAL_VOID_LABEL);
  const kept = exported.source.qualifyingSchedules?.current || exported.source.qualifyingSchedule;
  assert.equal(JSON.stringify(schedule), scheduleBefore);
  const excel = buildEmergencyOpsExcelModel(exported);
  const openSheet = excel.sheets.find((sheet) => sheet.name === "未消化試合");
  const openIds = (openSheet?.rows || []).slice(1).map((row) => row[1]);
  assert.equal(openIds.includes("qualifying-A-R1-M1"), false);
  const ledger = excel.sheets.find((sheet) => sheet.name === "予選対戦表");
  const voidRow = (ledger?.rows || []).find((row) => row[0] === "qualifying-A-R1-M1");
  assert.ok(voidRow);
  assert.equal(JSON.stringify(voidRow).includes(QUALIFYING_WITHDRAWAL_VOID_LABEL), true);
}

console.log("qualifying-withdrawal.test.mjs: ok");
