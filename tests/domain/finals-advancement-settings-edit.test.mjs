/**
 * 抽選確定後・予選開始前の進出条件再編集ドメインテスト
 */
import assert from "node:assert/strict";
import { EntryStatus, TournamentStatus } from "../../js/domain/constants.js";
import { TournamentFormat } from "../../js/domain/tournament-format.js";
import { computeQualifyingAdvancementCounts } from "../../js/domain/block-configuration.js";
import { buildConsolationParticipants } from "../../js/domain/consolation-participants.js";
import {
  assessFinalsAdvancementSettingsEditEligibility,
  assertFinalsAdvancementSettingsEditable,
  buildFinalsAdvancementSettingsUpdateFields,
  FinalsAdvancementSettingsEditReasonCode,
  formatFinalsAdvancementSettingsChangeConfirmMessage,
  getFinalsAdvancementSettingsEditErrorMessage,
  resolveCurrentFinalsAdvancementSettings,
} from "../../js/domain/finals-advancement-settings-edit.js";
import {
  buildPublicTournamentSnapshot,
} from "../../js/domain/public-tournament-snapshot.js";

function makeTournament(overrides = {}) {
  return {
    name: "22チーム地域大会",
    status: TournamentStatus.OPEN,
    tournamentFormat: TournamentFormat.QUALIFYING_AND_FINALS,
    blockCount: 6,
    qualifiersPerBlock: 1,
    finalTeamCount: 8,
    wildcardComparisonMode: "normalized",
    maxTeams: 22,
    teamSize: 4,
    courtCount: 2,
    publicViewEnabled: true,
    ...overrides,
  };
}

function makeFinalizedDraw() {
  return {
    status: "finalized",
    blockCount: 6,
    blocks: Array.from({ length: 6 }, (_, index) => ({
      id: String.fromCharCode(65 + index),
      name: `${String.fromCharCode(65 + index)}ブロック`,
      entryIds: index < 4 ? [`e-${index * 4 + 1}`, `e-${index * 4 + 2}`, `e-${index * 4 + 3}`, `e-${index * 4 + 4}`] : [`e-${17 + (index - 4) * 3}`, `e-${18 + (index - 4) * 3}`, `e-${19 + (index - 4) * 3}`],
    })),
  };
}

function makeEntries(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `e-${index + 1}`,
    teamName: `Team ${index + 1}`,
    status: EntryStatus.CONFIRMED,
  }));
}

const eligibleBase = {
  tournament: makeTournament(),
  blockDraw: makeFinalizedDraw(),
};

{
  const counts = computeQualifyingAdvancementCounts({
    blockCount: 6,
    qualifiersPerBlock: 2,
    finalTeamCount: 16,
    teamCount: 22,
  });
  assert.equal(counts.valid, true);
  assert.equal(counts.autoPassCount, 12);
  assert.equal(counts.wildcardCount, 4);
}

{
  const eligible = assessFinalsAdvancementSettingsEditEligibility(eligibleBase);
  assert.equal(eligible.eligible, true);
  assert.equal(eligible.reasonCode, FinalsAdvancementSettingsEditReasonCode.ELIGIBLE);
}

{
  const draft = assessFinalsAdvancementSettingsEditEligibility({
    ...eligibleBase,
    blockDraw: { ...makeFinalizedDraw(), status: "draft" },
  });
  assert.equal(draft.eligible, false);
  assert.equal(
    draft.reasonCode,
    FinalsAdvancementSettingsEditReasonCode.BLOCK_DRAW_NOT_FINALIZED
  );
}

{
  const started = assessFinalsAdvancementSettingsEditEligibility({
    ...eligibleBase,
    qualifyingMatchResults: new Map([["m1", { matchId: "m1" }]]),
  });
  assert.equal(started.eligible, false);
  assert.equal(
    started.reasonCode,
    FinalsAdvancementSettingsEditReasonCode.QUALIFYING_STARTED
  );
  assert.equal(
    getFinalsAdvancementSettingsEditErrorMessage(started.reasonCode),
    "予選開始後は進出条件を変更できません。"
  );
}

{
  const playing = assessFinalsAdvancementSettingsEditEligibility({
    ...eligibleBase,
    qualifyingMatchSessions: [{ status: "playing" }],
  });
  assert.equal(playing.eligible, false);
  assert.equal(
    playing.reasonCode,
    FinalsAdvancementSettingsEditReasonCode.QUALIFYING_STARTED
  );
}

{
  const advancement = assessFinalsAdvancementSettingsEditEligibility({
    ...eligibleBase,
    finalsAdvancement: { finalized: true },
  });
  assert.equal(advancement.eligible, false);
  assert.equal(
    advancement.reasonCode,
    FinalsAdvancementSettingsEditReasonCode.FINALS_ADVANCEMENT_EXISTS
  );
}

{
  const bracket = assessFinalsAdvancementSettingsEditEligibility({
    ...eligibleBase,
    finalsBracket: { bracketSize: 8, matches: [{ matchId: "final-r1-m1" }] },
  });
  assert.equal(bracket.eligible, false);
  assert.equal(
    bracket.reasonCode,
    FinalsAdvancementSettingsEditReasonCode.FINALS_BRACKET_EXISTS
  );
}

{
  const consolation = assessFinalsAdvancementSettingsEditEligibility({
    ...eligibleBase,
    consolationBracket: { bracketSize: 8, matches: [{ matchId: "final-r1-m1" }] },
  });
  assert.equal(consolation.eligible, false);
  assert.equal(
    consolation.reasonCode,
    FinalsAdvancementSettingsEditReasonCode.CONSOLATION_BRACKET_EXISTS
  );
}

{
  const signalsBlocked = assessFinalsAdvancementSettingsEditEligibility({
    ...eligibleBase,
    signals: { hasQualifyingMatchResults: true },
  });
  assert.equal(signalsBlocked.eligible, false);
}

assert.throws(
  () =>
    assertFinalsAdvancementSettingsEditable({
      eligible: false,
      reasonCode: FinalsAdvancementSettingsEditReasonCode.QUALIFYING_STARTED,
    }),
  (error) => error.code === "finals-advancement-settings/not-editable"
);

{
  const built = buildFinalsAdvancementSettingsUpdateFields({
    tournament: makeTournament(),
    qualifiersPerBlock: 2,
    finalTeamCount: 16,
    wildcardComparisonMode: "normalized",
    confirmedTeamCount: 22,
  });
  assert.equal(built.valid, true);
  assert.equal(built.fields.qualifiersPerBlock, 2);
  assert.equal(built.fields.finalTeamCount, 16);
  assert.equal("blockCount" in built.fields, false);
  assert.equal(built.advancement.autoPassCount, 12);
  assert.equal(built.advancement.wildcardCount, 4);
  assert.deepEqual(Object.keys(built.fields).sort(), [
    "finalTeamCount",
    "qualifiersPerBlock",
  ]);
}

assert.throws(
  () =>
    buildFinalsAdvancementSettingsUpdateFields({
      tournament: makeTournament(),
      qualifiersPerBlock: 2,
      finalTeamCount: 8,
      confirmedTeamCount: 22,
    }),
  (error) =>
    error.code === "finals-advancement-settings/invalid" &&
    String(error.message).includes("自動通過")
);

{
  const message = formatFinalsAdvancementSettingsChangeConfirmMessage({
    previous: { qualifiersPerBlock: 1, finalTeamCount: 8 },
    next: { qualifiersPerBlock: 2, finalTeamCount: 16 },
    blockCount: 6,
    teamCount: 22,
  });
  assert.match(message, /各ブロック1位通過 \/ 決勝8チーム/);
  assert.match(message, /各ブロック2位まで通過 \/ 決勝16チーム/);
  assert.match(message, /自動通過 12 \/ WC 4 \/ 合計 16/);
  assert.match(message, /下位対象 6チーム/);
  assert.match(message, /ブロック抽選・予選対戦表は変更されません/);
}

{
  const entries = makeEntries(22);
  const advancement = {
    finalized: true,
    qualifiers: entries.slice(0, 16).map((entry) => ({ entryId: entry.id })),
  };
  const remaining = buildConsolationParticipants(entries, advancement);
  assert.equal(remaining.length, 6);
}

{
  const previous = resolveCurrentFinalsAdvancementSettings(makeTournament());
  assert.equal(previous.qualifiersPerBlock, 1);
  assert.equal(previous.finalTeamCount, 8);

  const updatedTournament = makeTournament({
    qualifiersPerBlock: 2,
    finalTeamCount: 16,
  });
  const snapshot = buildPublicTournamentSnapshot({
    tournament: updatedTournament,
    entries: makeEntries(22),
    blockDraw: makeFinalizedDraw(),
  });
  assert.equal(snapshot.tournament.qualifiersPerBlock, 2);
  assert.equal(snapshot.tournament.finalQualifierCount, 16);
  assert.equal(snapshot.tournament.blockCount, 6);
}

console.log("finals-advancement-settings-edit.test.mjs: all passed");
