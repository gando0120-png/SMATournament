/**
 * 進出条件再編集サービス層（Firestore 非依存）
 *
 * 実サービスは Firebase SDK に依存するため、更新ペイロードとガードを検証する。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TournamentFormat } from "../../js/domain/tournament-format.js";
import {
  assessFinalsAdvancementSettingsEditEligibility,
  buildFinalsAdvancementSettingsUpdateFields,
} from "../../js/domain/finals-advancement-settings-edit.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const serviceSrc = readFileSync(
  join(root, "js/services/finals-advancement-settings-service.js"),
  "utf8"
);

assert.match(serviceSrc, /export async function updateFinalsAdvancementSettingsBeforeQualifyingStart/);
assert.match(serviceSrc, /withPublicSnapshotRebuild/);
assert.match(serviceSrc, /assertFinalsAdvancementSettingsEditable/);
assert.doesNotMatch(serviceSrc, /finalizeBlockDraw/);
assert.doesNotMatch(serviceSrc, /saveQualifyingSchedule/);
assert.doesNotMatch(serviceSrc, /blockCount:/);
assert.match(serviceSrc, /\.\.\.built\.fields/);

const tournament = {
  tournamentFormat: TournamentFormat.QUALIFYING_AND_FINALS,
  blockCount: 6,
  qualifiersPerBlock: 1,
  finalTeamCount: 8,
  wildcardComparisonMode: "normalized",
  maxTeams: 22,
};

const blockDraw = {
  status: "finalized",
  blocks: [{ id: "A", entryIds: ["e1", "e2", "e3"] }],
};

{
  const eligibility = assessFinalsAdvancementSettingsEditEligibility({
    tournament,
    blockDraw,
    qualifyingMatchResults: new Map(),
    qualifyingMatchSessions: new Map(),
  });
  assert.equal(eligibility.eligible, true);

  const built = buildFinalsAdvancementSettingsUpdateFields({
    tournament,
    qualifiersPerBlock: 2,
    finalTeamCount: 16,
    wildcardComparisonMode: "normalized",
    confirmedTeamCount: 22,
  });
  assert.equal(built.fields.qualifiersPerBlock, 2);
  assert.equal(built.fields.finalTeamCount, 16);
  assert.equal("blockCount" in built.fields, false);
  assert.equal(built.next.blockCount, undefined);
  assert.equal(tournament.blockCount, 6);
}

{
  const blocked = assessFinalsAdvancementSettingsEditEligibility({
    tournament,
    blockDraw,
    qualifyingMatchResults: new Map([["m1", {}]]),
  });
  assert.equal(blocked.eligible, false);
}

console.log("finals-advancement-settings.service.test.mjs: all passed");
