/**
 * 抽選確定前の予選構成変更サービス層（Firestore 非依存）
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TournamentFormat } from "../../js/domain/tournament-format.js";
import { TournamentStatus } from "../../js/domain/constants.js";
import {
  assessQualifyingStructureSettingsEditEligibility,
  buildQualifyingStructureSettingsUpdateFields,
} from "../../js/domain/qualifying-structure-settings-edit.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const serviceSrc = readFileSync(
  join(root, "js/services/qualifying-structure-settings-service.js"),
  "utf8"
);
const blockDrawServiceSrc = readFileSync(
  join(root, "js/services/block-draw-service.js"),
  "utf8"
);

assert.match(serviceSrc, /export async function updateQualifyingStructureSettingsBeforeDrawFinalize/);
assert.match(serviceSrc, /export async function deleteBlockDrawDraftIfPresent/);
assert.match(serviceSrc, /deleteDoc/);
assert.match(serviceSrc, /withPublicSnapshotRebuild/);
assert.match(serviceSrc, /assertQualifyingStructureSettingsEditable/);
assert.doesNotMatch(serviceSrc, /saveTimeSchedule/);
assert.doesNotMatch(serviceSrc, /saveQualifyingSchedule/);
assert.doesNotMatch(serviceSrc, /finalizeBlockDraw/);
assert.doesNotMatch(serviceSrc, /runTransaction/);
assert.match(blockDrawServiceSrc, /updateQualifyingStructureSettingsBeforeDrawFinalize/);
assert.doesNotMatch(
  blockDrawServiceSrc.slice(blockDrawServiceSrc.indexOf("export async function changeBlockCountDiscardingDraft")),
  /transaction\.delete\(drawRef\)/
);

const tournament = {
  status: TournamentStatus.OPEN,
  tournamentFormat: TournamentFormat.QUALIFYING_AND_FINALS,
  blockCount: 6,
  qualifiersPerBlock: 1,
  finalTeamCount: 8,
  wildcardComparisonMode: "normalized",
  maxTeams: 32,
  teamSize: 4,
  structureLocked: true,
};

{
  const eligibility = assessQualifyingStructureSettingsEditEligibility({
    tournament,
    blockDraw: { status: "draft", blocks: [{ id: "A", entryIds: ["e1", "e2", "e3"] }] },
  });
  assert.equal(eligibility.eligible, true);

  const built = buildQualifyingStructureSettingsUpdateFields({
    tournament,
    blockCount: 7,
    qualifiersPerBlock: 1,
    finalTeamCount: 8,
    wildcardComparisonMode: "normalized",
    confirmedTeamCount: 26,
  });
  assert.equal(built.fields.blockCount, 7);
  assert.equal(built.advancement.wildcardCount, 1);
}

{
  const blocked = assessQualifyingStructureSettingsEditEligibility({
    tournament,
    qualifyingMatchResults: new Map([["m1", { matchId: "m1" }]]),
  });
  assert.equal(blocked.eligible, false);
}

{
  const blocked = assessQualifyingStructureSettingsEditEligibility({
    tournament,
    qualifyingMatchSessions: [{ status: "finished" }],
  });
  assert.equal(blocked.eligible, false);
}

console.log("qualifying-structure-settings.service.test.mjs: all passed");
