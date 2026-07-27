/**
 * 大会作成フォーム スモークテスト
 */
import assert from "node:assert/strict";
import { validateTournamentInput } from "../../js/domain/validators.js";
import { buildQualifyingConfigurationPreview } from "../../js/domain/block-configuration.js";
import { TournamentFormat } from "../../js/domain/tournament-format.js";

const baseInput = {
  name: "テスト大会",
  eventDate: "2026-08-01",
  venue: "会場A",
  entryDeadline: "2026-07-31T23:59",
  maxTeams: "59",
  teamSize: "4",
  courtCount: "2",
};

const qualifyingInput = {
  ...baseInput,
  tournamentFormat: TournamentFormat.QUALIFYING_AND_FINALS,
  blockCount: "16",
  qualifiersPerBlock: "1",
};

const singleElimInput = {
  ...baseInput,
  tournamentFormat: TournamentFormat.SINGLE_ELIMINATION,
};

const qualifyingValidation = validateTournamentInput(qualifyingInput);
assert.equal(qualifyingValidation.valid, true);
assert.equal(qualifyingValidation.values.tournamentFormat, TournamentFormat.QUALIFYING_AND_FINALS);
assert.equal(qualifyingValidation.values.blockCount, 16);
assert.equal(qualifyingValidation.values.qualifiersPerBlock, 1);
assert.equal(qualifyingValidation.values.preferredBlockSize, undefined);

const singleValidation = validateTournamentInput(singleElimInput);
assert.equal(singleValidation.valid, true);
assert.equal(singleValidation.values.tournamentFormat, TournamentFormat.SINGLE_ELIMINATION);
assert.equal(singleValidation.values.blockCount, undefined);
assert.equal(singleValidation.values.qualifiersPerBlock, undefined);
assert.equal(singleValidation.values.preferredBlockSize, undefined);

const preview59 = buildQualifyingConfigurationPreview({
  teamCount: 59,
  blockCount: 16,
  qualifiersPerBlock: 1,
});
assert.equal(preview59.valid, true);
assert.equal(preview59.largerBlockCount, 11);
assert.equal(preview59.smallerBlockCount, 5);
assert.equal(preview59.qualifierCount, 16);

const invalid47 = validateTournamentInput({
  ...qualifyingInput,
  maxTeams: "47",
});
assert.equal(invalid47.valid, false);
assert.ok(invalid47.errors.maxTeams);

const valid48 = validateTournamentInput({
  ...qualifyingInput,
  maxTeams: "48",
});
assert.equal(valid48.valid, true);

const legacyInput = {
  ...baseInput,
  preferredBlockSize: "4",
};
const legacyValidation = validateTournamentInput(legacyInput);
assert.equal(legacyValidation.valid, true);
assert.equal(legacyValidation.values.preferredBlockSize, 4);
assert.equal(legacyValidation.values.tournamentFormat, undefined);

console.log("tournament-create-form.smoke.mjs: all passed");
