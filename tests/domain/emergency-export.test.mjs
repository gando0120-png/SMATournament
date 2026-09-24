/**
 * EmergencyExportV1 domain tests
 */
import assert from "node:assert/strict";
import { buildEmergencyExport, collectForbiddenKeys, serializeJsonValue } from "../../js/domain/emergency-export.js";
import {
  EMERGENCY_EXPORT_FORBIDDEN_KEYS,
  EMERGENCY_EXPORT_SCHEMA_VERSION,
  EmergencyExportIntegrityCode,
  EmergencyExportIntegritySeverity,
  EmergencyExportPhase,
} from "../../js/domain/emergency-export-schema.js";
import {
  applyMolkkyOutResolutions,
  buildQualifyingStandings,
} from "../../js/domain/qualifying-standings.js";
import { MatchReconciliationState } from "../../js/domain/player-qualifying-submission.js";

function makeTeam(id, name) {
  return { entryId: id, teamName: name };
}

function makeResult(matchId, team1, team2, stats1, stats2) {
  return {
    matchId,
    team1: makeTeam(team1.id, team1.name),
    team2: makeTeam(team2.id, team2.name),
    sets: [
      { setNumber: 1, team1Score: 50, team2Score: 20, result: "team1", finishReason: "normal" },
      { setNumber: 2, team1Score: 30, team2Score: 50, result: "team2", finishReason: "normal" },
    ],
    team1Stats: stats1,
    team2Stats: stats2,
    status: "finished",
  };
}

function makeSchedule() {
  return {
    finalized: true,
    blockCount: 1,
    totalMatchCount: 3,
    blocks: [
      {
        blockId: "A",
        blockName: "Aブロック",
        teamCount: 3,
        teams: [
          { symbol: "A1", entryId: "e1", teamName: "Alpha" },
          { symbol: "A2", entryId: "e2", teamName: "Bravo" },
          { symbol: "A3", entryId: "e3", teamName: "Charlie" },
        ],
        rounds: [
          {
            roundNumber: 1,
            byes: [],
            matches: [
              {
                matchId: "qualifying-A-R1-M1",
                roundNumber: 1,
                matchNumber: 1,
                courtNumber: 1,
                team1: { symbol: "A1", entryId: "e1", teamName: "Alpha" },
                team2: { symbol: "A2", entryId: "e2", teamName: "Bravo" },
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
                matchNumber: 1,
                courtNumber: 1,
                team1: { symbol: "A1", entryId: "e1", teamName: "Alpha" },
                team2: { symbol: "A3", entryId: "e3", teamName: "Charlie" },
                status: "waiting",
              },
            ],
          },
          {
            roundNumber: 3,
            byes: [],
            matches: [
              {
                matchId: "qualifying-A-R3-M1",
                roundNumber: 3,
                matchNumber: 1,
                courtNumber: 2,
                team1: { symbol: "A2", entryId: "e2", teamName: "Bravo" },
                team2: { symbol: "A3", entryId: "e3", teamName: "Charlie" },
                status: "waiting",
              },
            ],
          },
        ],
      },
    ],
  };
}

function makeEntries() {
  return [
    {
      id: "e1",
      teamName: "Alpha",
      status: "confirmed",
      teamNumber: 1,
      email: "alpha@example.com",
      representativeName: "代表A",
      comment: "秘密のメモ",
      member2: "メンバーA2",
      createdBy: "should-not-leak",
    },
    {
      id: "e2",
      teamName: "Bravo",
      status: "confirmed",
      teamNumber: 2,
      isDummy: false,
    },
    {
      id: "e3",
      teamName: "Charlie",
      status: "confirmed",
    },
    {
      id: "e4",
      teamName: "Pending",
      status: "pending",
      email: "pending@example.com",
    },
  ];
}

const statsWin = { setWins: 1, setDraws: 1, setLosses: 0, totalScore: 80 };
const statsLose = { setWins: 0, setDraws: 1, setLosses: 1, totalScore: 70 };

function finishedResults() {
  const map = new Map();
  map.set(
    "qualifying-A-R1-M1",
    makeResult("qualifying-A-R1-M1", { id: "e1", name: "Alpha" }, { id: "e2", name: "Bravo" }, statsWin, statsLose)
  );
  map.set(
    "qualifying-A-R2-M1",
    makeResult("qualifying-A-R2-M1", { id: "e1", name: "Alpha" }, { id: "e3", name: "Charlie" }, statsWin, statsLose)
  );
  map.set(
    "qualifying-A-R3-M1",
    makeResult("qualifying-A-R3-M1", { id: "e2", name: "Bravo" }, { id: "e3", name: "Charlie" }, statsWin, statsLose)
  );
  return map;
}

function baseInput(overrides = {}) {
  return {
    tournamentId: "t-emergency",
    projectId: "smatournament-ce785",
    exportedAt: new Date("2026-09-17T02:40:49.078Z"),
    tournament: {
      id: "t-emergency",
      name: "[E2E] emergency export",
      eventDate: "2099-12-31",
      venue: "Test",
      status: "open",
      createdBy: "uid-operator-should-not-leak",
      email: "owner@example.com",
      tournamentFormat: "qualifying_and_finals",
      blockCount: 1,
      qualifiersPerBlock: 1,
      finalTeamCount: 4,
      wildcardComparisonMode: "raw",
      courtCount: 2,
      maxTeams: 8,
      teamSize: 2,
      confirmedCount: 0,
    },
    entries: makeEntries(),
    blockDraw: {
      status: "finalized",
      blockCount: 1,
      blocks: [{ id: "A", name: "Aブロック", entryIds: ["e1", "e2", "e3"] }],
    },
    qualifyingSchedule: makeSchedule(),
    qualifyingMatchResults: new Map([
      [
        "qualifying-A-R1-M1",
        makeResult(
          "qualifying-A-R1-M1",
          { id: "e1", name: "Alpha" },
          { id: "e2", name: "Bravo" },
          statsWin,
          statsLose
        ),
      ],
    ]),
    qualifyingMatchSessions: new Map(),
    molkkyOutResolutions: null,
    finalsAdvancement: null,
    ...overrides,
  };
}

{
  const iso = serializeJsonValue({
    toDate() {
      return new Date("2026-09-17T02:40:49.078Z");
    },
  });
  assert.equal(iso, "2026-09-17T02:40:49.078Z");
}

{
  const exported = buildEmergencyExport(baseInput());
  assert.equal(exported.exportMeta.schemaVersion, EMERGENCY_EXPORT_SCHEMA_VERSION);
  assert.equal(exported.exportMeta.exportType, "emergency-ops");
  assert.equal(exported.exportMeta.piiPolicy.includesEmail, false);
  assert.equal(exported.exportMeta.exportedAt, "2026-09-17T02:40:49.078Z");

  const forbidden = collectForbiddenKeys(exported);
  assert.equal(forbidden.size, 0, [...forbidden].join(","));
  const json = JSON.stringify(exported);
  for (const key of EMERGENCY_EXPORT_FORBIDDEN_KEYS) {
    assert.equal(json.includes(`"${key}"`), false, `leaked key ${key}`);
  }
  assert.equal(json.includes("alpha@example.com"), false);
  assert.equal(json.includes("代表A"), false);
  assert.equal(json.includes("uid-operator-should-not-leak"), false);
  assert.equal(json.includes("tokenHash"), false);
  assert.equal(json.includes("clientRequestId"), false);

  const e1 = exported.source.entries.find((entry) => entry.entryId === "e1");
  assert.equal(e1.teamName, "Alpha");
  assert.equal(e1.teamNumber, 1);
  assert.equal(e1.email, undefined);
  assert.equal(e1.representativeName, undefined);
  assert.equal(exported.source.tournament.createdBy, undefined);
}

{
  const input = baseInput({
    qualifyingMatchResults: finishedResults(),
  });
  const exported = buildEmergencyExport(input);
  const expected = applyMolkkyOutResolutions(
    buildQualifyingStandings(input.qualifyingSchedule, input.qualifyingMatchResults),
    null
  );
  const derivedBlock = exported.derived.qualifyingStandings.blocks[0].standings;
  const expectedBlock = expected.blocks[0].standings;
  assert.equal(derivedBlock.length, expectedBlock.length);
  for (let i = 0; i < expectedBlock.length; i += 1) {
    assert.equal(derivedBlock[i].entryId, expectedBlock[i].entryId);
    assert.equal(derivedBlock[i].rank, expectedBlock[i].rank);
    assert.equal(derivedBlock[i].setWins, expectedBlock[i].setWins);
    assert.equal(derivedBlock[i].setDraws, expectedBlock[i].setDraws);
    assert.equal(derivedBlock[i].totalScore, expectedBlock[i].totalScore);
  }
}

{
  const tiedStats = { setWins: 1, setDraws: 0, setLosses: 1, totalScore: 80 };
  const results = new Map();
  results.set(
    "qualifying-A-R1-M1",
    makeResult(
      "qualifying-A-R1-M1",
      { id: "e1", name: "Alpha" },
      { id: "e2", name: "Bravo" },
      tiedStats,
      tiedStats
    )
  );
  results.set(
    "qualifying-A-R2-M1",
    makeResult(
      "qualifying-A-R2-M1",
      { id: "e1", name: "Alpha" },
      { id: "e3", name: "Charlie" },
      statsWin,
      statsLose
    )
  );
  results.set(
    "qualifying-A-R3-M1",
    makeResult(
      "qualifying-A-R3-M1",
      { id: "e2", name: "Bravo" },
      { id: "e3", name: "Charlie" },
      statsWin,
      statsLose
    )
  );

  const unresolved = buildEmergencyExport(
    baseInput({
      qualifyingMatchResults: results,
      molkkyOutResolutions: null,
    })
  );
  const unresolvedCodes = unresolved.derived.integrityChecks.items.map((item) => item.code);
  assert.ok(unresolvedCodes.includes(EmergencyExportIntegrityCode.MOLKKY_OUT_UNRESOLVED));

  const resolved = buildEmergencyExport(
    baseInput({
      qualifyingMatchResults: results,
      molkkyOutResolutions: {
        blockGroups: [{ blockId: "A", entryIds: ["e1", "e2"], orderedEntryIds: ["e2", "e1"] }],
        wildcardGroups: [],
      },
    })
  );
  const expected = applyMolkkyOutResolutions(
    buildQualifyingStandings(makeSchedule(), results),
    {
      blockGroups: [{ blockId: "A", entryIds: ["e1", "e2"], orderedEntryIds: ["e2", "e1"] }],
      wildcardGroups: [],
    }
  );
  const derivedIds = resolved.derived.qualifyingStandings.blocks[0].standings.map((row) => row.entryId);
  const expectedIds = expected.blocks[0].standings.map((row) => row.entryId);
  assert.deepEqual(derivedIds, expectedIds);
  assert.equal(
    resolved.derived.integrityChecks.items.some(
      (item) => item.code === EmergencyExportIntegrityCode.MOLKKY_OUT_UNRESOLVED
    ),
    false
  );
}

{
  const awaiting = buildEmergencyExport(
    baseInput({
      qualifyingMatchReconciliations: {
        "qualifying-A-R2-M1": {
          matchId: "qualifying-A-R2-M1",
          state: MatchReconciliationState.AWAITING_OPPONENT,
          submissions: {
            team1EntryId: "e1",
            team2EntryId: "e3",
            team1Submitted: true,
            team2Submitted: false,
          },
          tokenHashPrefix: "abcdef12",
          clientRequestId: "req-1",
        },
      },
      qualifyingResultSubmissions: {
        "qualifying-A-R2-M1_e1": {
          matchId: "qualifying-A-R2-M1",
          entryId: "e1",
          side: "team1",
          set1OwnScore: 50,
          set2OwnScore: 30,
          status: "pending",
          tokenHashPrefix: "abcdef12",
          authMethod: "teamNumber",
          clientRequestId: "req-1",
        },
      },
    })
  );
  const match = awaiting.derived.matchDisplayStates.find((item) => item.matchId === "qualifying-A-R2-M1");
  assert.equal(match.status, "awaiting_opponent");
  assert.equal(awaiting.source.playerPipeline.submissions["qualifying-A-R2-M1_e1"].set1OwnScore, 50);
  assert.equal(awaiting.source.playerPipeline.submissions["qualifying-A-R2-M1_e1"].tokenHashPrefix, undefined);
  assert.equal(awaiting.source.playerPipeline.reconciliations["qualifying-A-R2-M1"].clientRequestId, undefined);
  assert.ok(
    awaiting.derived.integrityChecks.items.some(
      (item) => item.code === EmergencyExportIntegrityCode.PLAYER_SUBMISSION_AWAITING
    )
  );

  const conflict = buildEmergencyExport(
    baseInput({
      qualifyingMatchReconciliations: {
        "qualifying-A-R2-M1": {
          matchId: "qualifying-A-R2-M1",
          state: MatchReconciliationState.CONFLICT,
          conflictSnapshot: {
            team1: { entryId: "e1", ownScores: { set1OwnScore: 50, set2OwnScore: 10 } },
            team2: { entryId: "e3", ownScores: { set1OwnScore: 20, set2OwnScore: 50 } },
          },
        },
      },
    })
  );
  const conflictMatch = conflict.derived.matchDisplayStates.find(
    (item) => item.matchId === "qualifying-A-R2-M1"
  );
  assert.equal(conflictMatch.status, "conflict");
  assert.ok(
    conflict.derived.integrityChecks.items.some(
      (item) =>
        item.code === EmergencyExportIntegrityCode.PLAYER_SUBMISSION_CONFLICT &&
        item.severity === EmergencyExportIntegritySeverity.WARNING
    )
  );

  const matched = buildEmergencyExport(
    baseInput({
      qualifyingMatchResults: new Map([
        [
          "qualifying-A-R1-M1",
          makeResult(
            "qualifying-A-R1-M1",
            { id: "e1", name: "Alpha" },
            { id: "e2", name: "Bravo" },
            statsWin,
            statsLose
          ),
        ],
      ]),
      qualifyingMatchReconciliations: {
        "qualifying-A-R1-M1": {
          matchId: "qualifying-A-R1-M1",
          state: MatchReconciliationState.MATCHED,
          officialResultId: "qualifying-A-R1-M1",
        },
      },
    })
  );
  const matchedMatch = matched.derived.matchDisplayStates.find(
    (item) => item.matchId === "qualifying-A-R1-M1"
  );
  assert.equal(matchedMatch.status, "finished");
}

{
  const preview = buildEmergencyExport(baseInput());
  assert.equal(preview.derived.finalsAdvancementStatus.finalized, false);
  assert.equal(preview.derived.finalsAdvancementStatus.qualifiers, null);
  assert.ok(Array.isArray(preview.derived.finalsAdvancementStatus.projectedQualifiers));

  const finalized = buildEmergencyExport(
    baseInput({
      finalsAdvancement: {
        finalized: true,
        mode: "fixed_block_qualifiers",
        qualifiers: [{ entryId: "e1", teamName: "Alpha", blockId: "A", blockRank: 1 }],
      },
    })
  );
  assert.equal(finalized.derived.finalsAdvancementStatus.finalized, true);
  assert.equal(finalized.derived.finalsAdvancementStatus.projectedQualifiers, null);
  assert.equal(finalized.derived.finalsAdvancementStatus.qualifiers[0].entryId, "e1");
  assert.equal(finalized.derived.finalsAdvancementStatus.qualifiers[0].displayTeamNumber, 1);
}

{
  const missingEntry = buildEmergencyExport(
    baseInput({
      qualifyingSchedule: {
        ...makeSchedule(),
        blocks: [
          {
            ...makeSchedule().blocks[0],
            rounds: [
              {
                roundNumber: 1,
                matches: [
                  {
                    matchId: "qualifying-A-R1-M1",
                    roundNumber: 1,
                    matchNumber: 1,
                    courtNumber: 1,
                    team1: { entryId: "missing", teamName: "Ghost" },
                    team2: { entryId: "e2", teamName: "Bravo" },
                  },
                ],
              },
            ],
          },
        ],
      },
    })
  );
  assert.equal(missingEntry.derived.integrityChecks.ok, false);
  assert.ok(
    missingEntry.derived.integrityChecks.items.some(
      (item) => item.code === EmergencyExportIntegrityCode.ENTRY_MISSING_FOR_SCHEDULE
    )
  );

  const orphan = buildEmergencyExport(
    baseInput({
      qualifyingMatchResults: new Map([
        [
          "orphan-match",
          makeResult("orphan-match", { id: "e1", name: "Alpha" }, { id: "e2", name: "Bravo" }, statsWin, statsLose),
        ],
      ]),
    })
  );
  assert.ok(
    orphan.derived.integrityChecks.items.some(
      (item) => item.code === EmergencyExportIntegrityCode.ORPHAN_QUALIFYING_RESULT
    )
  );
}

{
  const inProgress = buildEmergencyExport(baseInput());
  assert.equal(inProgress.derived.situation.phase, EmergencyExportPhase.QUALIFYING_IN_PROGRESS);
  assert.ok(inProgress.derived.remainingMatches.some((match) => match.matchId === "qualifying-A-R2-M1"));
  const remaining = inProgress.derived.remainingMatches.find((match) => match.matchId === "qualifying-A-R3-M1");
  assert.equal(remaining.team1.teamName, "Bravo");
  assert.equal(remaining.team1.displayTeamNumber, 2);
  assert.equal(remaining.courtNumber, 2);

  const confirmed = inProgress.derived.confirmedEntries;
  assert.equal(confirmed.length, 3);
  assert.equal(confirmed.find((entry) => entry.entryId === "e3").displayTeamNumber, 3);
  assert.equal(confirmed.find((entry) => entry.entryId === "e3").storedTeamNumber, null);
}

console.log("emergency-export.test.mjs: all passed");
