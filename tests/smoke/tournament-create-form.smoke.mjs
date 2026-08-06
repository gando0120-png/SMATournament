/**
 * 大会作成フォーム スモークテスト
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateTournamentInput } from "../../js/domain/validators.js";
import { buildQualifyingConfigurationPreview } from "../../js/domain/block-configuration.js";
import { TournamentFormat } from "../../js/domain/tournament-format.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

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
  finalTeamCount: "16",
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
assert.equal(qualifyingValidation.values.finalTeamCount, 16);
assert.equal(qualifyingValidation.values.preferredBlockSize, undefined);
assert.equal(qualifyingValidation.values.winsRequired, 2);
assert.equal(qualifyingValidation.values.finalsMatchRules.defaultWinsRequired, 2);
assert.deepEqual(qualifyingValidation.values.finalsMatchRules.roundOverrides, {});
assert.ok(qualifyingValidation.values.bracketMatchConfig?.main?.enabled);
assert.ok(qualifyingValidation.values.bracketMatchConfig?.consolation?.enabled);
assert.equal(
  qualifyingValidation.values.bracketMatchConfig.main.matchFormat,
  "headToHeadSets"
);

const threeWinsValidation = validateTournamentInput({
  ...qualifyingInput,
  winsRequired: "3",
});
assert.equal(threeWinsValidation.valid, true);
assert.equal(threeWinsValidation.values.winsRequired, 3);

const finalOnlyValidation = validateTournamentInput({
  ...qualifyingInput,
  defaultWinsRequired: 2,
  useRoundOverrides: true,
  roundOverrides: { final: 3 },
});
assert.equal(finalOnlyValidation.valid, true);
assert.deepEqual(finalOnlyValidation.values.finalsMatchRules.roundOverrides, {
  final: 3,
});

const singleValidation = validateTournamentInput(singleElimInput);
assert.equal(singleValidation.valid, true);
assert.equal(singleValidation.values.tournamentFormat, TournamentFormat.SINGLE_ELIMINATION);
assert.equal(singleValidation.values.blockCount, undefined);
assert.equal(singleValidation.values.qualifiersPerBlock, undefined);
assert.equal(singleValidation.values.preferredBlockSize, undefined);
assert.equal(singleValidation.values.winsRequired, 2);
assert.equal(singleValidation.values.matchFormat, "headToHeadSets");

const multiValidation = validateTournamentInput({
  ...singleElimInput,
  matchFormat: "multiTeamTotal",
  teamCount: 4,
  qualifiersCount: 2,
});
assert.equal(multiValidation.valid, true);
assert.equal(multiValidation.values.matchFormat, "multiTeamTotal");
assert.deepEqual(multiValidation.values.aggregateMatchRules, {
  teamCount: 4,
  setCount: 2,
  qualifiersCount: 2,
  rankingMethod: "totalScoreDesc",
  tieBreakMethod: "manual",
});

const multiInvalid = validateTournamentInput({
  ...singleElimInput,
  matchFormat: "multiTeamTotal",
  teamCount: 2,
  qualifiersCount: 2,
});
assert.equal(multiInvalid.valid, false);

const preview59 = buildQualifyingConfigurationPreview({
  teamCount: 59,
  blockCount: 16,
  qualifiersPerBlock: 1,
  finalTeamCount: 16,
});
assert.equal(preview59.valid, true);
assert.equal(preview59.largerBlockCount, 11);
assert.equal(preview59.smallerBlockCount, 5);
assert.equal(preview59.qualifierCount, 16);
assert.equal(preview59.autoPassCount, 16);
assert.equal(preview59.wildcardCount, 0);
assert.equal(preview59.finalTeamCount, 16);

const overMaxTeams = validateTournamentInput({
  ...qualifyingInput,
  blockCount: "8",
  qualifiersPerBlock: "1",
  finalTeamCount: "32",
  maxTeams: "16",
});
assert.equal(overMaxTeams.valid, false);
assert.ok(overMaxTeams.errors.finalTeamCount);

const previewWildcard = buildQualifyingConfigurationPreview({
  teamCount: 32,
  blockCount: 8,
  qualifiersPerBlock: 1,
  finalTeamCount: 16,
});
assert.equal(previewWildcard.valid, true);
assert.equal(previewWildcard.autoPassCount, 8);
assert.equal(previewWildcard.wildcardCount, 8);
assert.equal(previewWildcard.finalTeamCount, 16);

const previewOverflow = buildQualifyingConfigurationPreview({
  teamCount: 32,
  blockCount: 8,
  qualifiersPerBlock: 2,
  finalTeamCount: 8,
});
assert.equal(previewOverflow.valid, false);
assert.ok(previewOverflow.errors.some((message) => message.includes("超えて")));

const overflowValidation = validateTournamentInput({
  ...qualifyingInput,
  blockCount: "8",
  qualifiersPerBlock: "2",
  finalTeamCount: "8",
  maxTeams: "32",
});
assert.equal(overflowValidation.valid, false);
assert.ok(overflowValidation.errors.finalTeamCount);

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

assert.match(
  readFileSync(join(root, "tournament-new.html"), "utf8"),
  /id="finalTeamCount"/
);
assert.match(
  readFileSync(join(root, "js/ui/pages/tournament-new-page.js"), "utf8"),
  /決勝進出合計/
);

console.log("tournament-create-form.smoke.mjs: all passed");
