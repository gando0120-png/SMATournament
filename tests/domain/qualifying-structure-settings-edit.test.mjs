/**
 * 抽選確定前の予選構成変更ドメインテスト
 */
import assert from "node:assert/strict";
import { MatchSessionStatus, TournamentStatus } from "../../js/domain/constants.js";
import { TournamentFormat } from "../../js/domain/tournament-format.js";
import { buildPublicTournamentSnapshot } from "../../js/domain/public-tournament-snapshot.js";
import {
  STRUCTURE_LOCK_FIELD_KEYS,
  isTournamentStructureLocked,
} from "../../js/domain/tournament-structure-lock.js";
import {
  buildTournamentSettingsUpdateFields,
  getStructureLockConflictMessage,
} from "../../js/domain/tournament-settings-update.js";
import {
  QualifyingStructureSettingsEditReasonCode,
  assessQualifyingStructureSettingsEditEligibility,
  assertQualifyingStructureSettingsEditable,
  buildQualifyingStructureSettingsPreview,
  buildQualifyingStructureSettingsUpdateFields,
  formatQualifyingStructureDraftDiscardConfirmMessage,
  qualifyingStructureChangeRequiresDraftDiscard,
  readSavedQualifyingStructureFormValues,
} from "../../js/domain/qualifying-structure-settings-edit.js";

function makeTournament(overrides = {}) {
  return {
    name: "26チーム地域大会",
    status: TournamentStatus.OPEN,
    tournamentFormat: TournamentFormat.QUALIFYING_AND_FINALS,
    blockCount: 6,
    qualifiersPerBlock: 1,
    finalTeamCount: 8,
    wildcardComparisonMode: "normalized",
    maxTeams: 32,
    teamSize: 4,
    minTeamSize: 2,
    maxTeamSize: 4,
    courtCount: 2,
    structureLocked: true,
    publicViewEnabled: true,
    ...overrides,
  };
}

function makeEntries(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `e-${index + 1}`,
    teamName: `Team ${index + 1}`,
    status: "confirmed",
  }));
}

{
  const eligibility = assessQualifyingStructureSettingsEditEligibility({
    tournament: makeTournament(),
    blockDraw: null,
  });
  assert.equal(eligibility.eligible, true);
  assert.equal(eligibility.reasonCode, QualifyingStructureSettingsEditReasonCode.ELIGIBLE);
  assert.doesNotThrow(() => assertQualifyingStructureSettingsEditable(eligibility));
}

{
  const built = buildQualifyingStructureSettingsUpdateFields({
    tournament: makeTournament({ structureLocked: true }),
    blockCount: 7,
    qualifiersPerBlock: 2,
    finalTeamCount: 16,
    wildcardComparisonMode: "normalized",
    confirmedTeamCount: 26,
  });
  assert.equal(built.fields.blockCount, 7);
  assert.equal(built.fields.qualifiersPerBlock, 2);
  assert.equal(built.fields.finalTeamCount, 16);
  assert.equal("maxTeams" in built.fields, false);
  assert.equal("teamSize" in built.fields, false);
  assert.equal(built.advancement.wildcardCount, 2);
}

{
  const preview = buildQualifyingStructureSettingsPreview({
    confirmedTeamCount: 26,
    blockCount: 7,
    qualifiersPerBlock: 2,
    finalTeamCount: 16,
    maxTeams: 32,
  });
  assert.equal(preview.confirmedTeamCount, 26);
  assert.equal(preview.distributionLabel, "4人×5ブロック / 3人×2ブロック");
  assert.equal(preview.autoPassCount, 14);
  assert.equal(preview.wildcardCount, 2);
  assert.equal(preview.finalTeamCount, 16);
}

{
  assert.equal(qualifyingStructureChangeRequiresDraftDiscard({ status: "draft" }), true);
  assert.equal(qualifyingStructureChangeRequiresDraftDiscard({ status: "finalized" }), false);
  assert.equal(qualifyingStructureChangeRequiresDraftDiscard(null), false);
  const message = formatQualifyingStructureDraftDiscardConfirmMessage({
    previousBlockCount: 6,
    nextBlockCount: 7,
  });
  assert.match(message, /現在の抽選案を破棄して大会構成を変更します/);
  assert.match(message, /抽選確定前なので試合結果には影響しません/);
}

{
  const saved = readSavedQualifyingStructureFormValues(
    makeTournament({
      blockCount: 7,
      qualifiersPerBlock: 2,
      finalTeamCount: 16,
      wildcardComparisonMode: "normalized",
    })
  );
  assert.equal(saved.blockCount, 7);
  assert.equal(saved.qualifiersPerBlock, 2);
  assert.equal(saved.finalTeamCount, 16);
  assert.equal(saved.wildcardComparisonMode, "normalized");

  const restoredPreview = buildQualifyingStructureSettingsPreview({
    confirmedTeamCount: 26,
    blockCount: saved.blockCount,
    qualifiersPerBlock: saved.qualifiersPerBlock,
    finalTeamCount: saved.finalTeamCount,
    maxTeams: 32,
  });
  assert.equal(restoredPreview.distributionLabel, "4人×5ブロック / 3人×2ブロック");
  assert.equal(restoredPreview.wildcardCount, 2);

  const rawSaved = readSavedQualifyingStructureFormValues(
    makeTournament({ wildcardComparisonMode: "raw" })
  );
  assert.equal(rawSaved.wildcardComparisonMode, "raw");
}

{
  const blocked = assessQualifyingStructureSettingsEditEligibility({
    tournament: makeTournament(),
    blockDraw: { status: "finalized", blocks: [{ id: "A", entryIds: ["e1"] }] },
  });
  assert.equal(blocked.reasonCode, QualifyingStructureSettingsEditReasonCode.BLOCK_DRAW_FINALIZED);
}

{
  const blocked = assessQualifyingStructureSettingsEditEligibility({
    tournament: makeTournament(),
    qualifyingSchedule: { finalized: true },
  });
  assert.equal(
    blocked.reasonCode,
    QualifyingStructureSettingsEditReasonCode.QUALIFYING_SCHEDULE_EXISTS
  );
}

{
  const blocked = assessQualifyingStructureSettingsEditEligibility({
    tournament: makeTournament(),
    qualifyingMatchResults: new Map([["m1", {}]]),
  });
  assert.equal(blocked.reasonCode, QualifyingStructureSettingsEditReasonCode.QUALIFYING_STARTED);
}

{
  const blocked = assessQualifyingStructureSettingsEditEligibility({
    tournament: makeTournament(),
    qualifyingMatchSessions: [{ status: MatchSessionStatus.PLAYING }],
  });
  assert.equal(blocked.reasonCode, QualifyingStructureSettingsEditReasonCode.QUALIFYING_STARTED);
}

{
  const blocked = assessQualifyingStructureSettingsEditEligibility({
    tournament: makeTournament(),
    finalsAdvancement: { finalized: true },
  });
  assert.equal(
    blocked.reasonCode,
    QualifyingStructureSettingsEditReasonCode.FINALS_ADVANCEMENT_EXISTS
  );
}

{
  const blocked = assessQualifyingStructureSettingsEditEligibility({
    tournament: makeTournament(),
    finalsBracket: { matches: [{ matchId: "final-r1-m1" }] },
  });
  assert.equal(blocked.reasonCode, QualifyingStructureSettingsEditReasonCode.FINALS_BRACKET_EXISTS);
}

{
  const blocked = assessQualifyingStructureSettingsEditEligibility({
    tournament: makeTournament(),
    consolationBracket: { matches: [{ matchId: "final-r1-m1" }] },
  });
  assert.equal(
    blocked.reasonCode,
    QualifyingStructureSettingsEditReasonCode.CONSOLATION_BRACKET_EXISTS
  );
}

{
  const blocked = assessQualifyingStructureSettingsEditEligibility({
    tournament: makeTournament({ status: TournamentStatus.CLOSED }),
  });
  assert.equal(blocked.reasonCode, QualifyingStructureSettingsEditReasonCode.NOT_OPEN);
}

{
  const blocked = assessQualifyingStructureSettingsEditEligibility({
    tournament: makeTournament({ tournamentFormat: TournamentFormat.SINGLE_ELIMINATION }),
  });
  assert.equal(
    blocked.reasonCode,
    QualifyingStructureSettingsEditReasonCode.UNSUPPORTED_FORMAT
  );
}

{
  const tournament = makeTournament({ structureLocked: true });
  assert.equal(isTournamentStructureLocked(tournament, { hasEntries: true }), true);
  assert.deepEqual(STRUCTURE_LOCK_FIELD_KEYS, ["maxTeams", "teamSize", "preferredBlockSize"]);
  const conflict = getStructureLockConflictMessage(
    tournament,
    { maxTeams: 20, teamSize: 3 },
    true
  );
  assert.match(conflict, /募集チーム数・人数/);
  const settingsFields = buildTournamentSettingsUpdateFields({
    input: {
      name: tournament.name,
      eventDate: "2026-09-01",
      venue: tournament.venue,
      courtCount: 2,
      entryDeadline: new Date("2099-01-01T00:00:00Z"),
      maxTeams: 20,
      teamSize: 3,
    },
    tournament,
    structureLocked: true,
  });
  assert.equal("maxTeams" in settingsFields, false);
  assert.equal("teamSize" in settingsFields, false);
  assert.equal("blockCount" in settingsFields, false);
}

{
  const snapshot = buildPublicTournamentSnapshot({
    tournament: makeTournament({
      blockCount: 7,
      qualifiersPerBlock: 2,
      finalTeamCount: 16,
    }),
    entries: makeEntries(26),
  });
  assert.equal(snapshot.tournament.blockCount, 7);
  assert.equal(snapshot.tournament.qualifiersPerBlock, 2);
  assert.equal("consolationBracket" in snapshot, false);
}

console.log("qualifying-structure-settings-edit.test.mjs: all passed");
