/**
 * 6ブロック設定の保存ペイロード／再読込復元の形状テスト（Firestore 非依存）
 */
import assert from "node:assert/strict";
import { validateTournamentInput } from "../../js/domain/validators.js";
import { TournamentFormat } from "../../js/domain/tournament-format.js";
import { resolveWildcardComparisonMode } from "../../js/domain/wildcard-comparison.js";

const createInput = {
  name: "22チーム地域大会",
  eventDate: "2026-09-01",
  venue: "地域体育館",
  entryDeadline: "2026-08-31T23:59",
  maxTeams: "22",
  teamSize: "4",
  courtCount: "2",
  tournamentFormat: TournamentFormat.QUALIFYING_AND_FINALS,
  blockCount: "6",
  qualifiersPerBlock: "1",
  finalTeamCount: "8",
  wildcardComparisonMode: "normalized",
};

const created = validateTournamentInput(createInput);
assert.equal(created.valid, true);
assert.equal(created.values.blockCount, 6);
assert.equal(created.values.qualifiersPerBlock, 1);
assert.equal(created.values.finalTeamCount, 8);
assert.equal(created.values.wildcardComparisonMode, "normalized");

// createTournament が書く想定ペイロード
const persisted = {
  tournamentFormat: created.values.tournamentFormat,
  blockCount: created.values.blockCount,
  qualifiersPerBlock: created.values.qualifiersPerBlock,
  finalTeamCount: created.values.finalTeamCount,
  wildcardComparisonMode:
    created.values.wildcardComparisonMode === "normalized" ? "normalized" : "raw",
  maxTeams: created.values.maxTeams,
};

// 管理画面再読込相当
assert.equal(persisted.blockCount, 6);
assert.equal(persisted.finalTeamCount, 8);
assert.equal(persisted.qualifiersPerBlock, 1);
assert.equal(resolveWildcardComparisonMode(persisted.wildcardComparisonMode), "normalized");

// 既存大会（未設定）は raw
assert.equal(resolveWildcardComparisonMode(undefined), "raw");
assert.equal(resolveWildcardComparisonMode(null), "raw");

const sevenBlock = validateTournamentInput({
  ...createInput,
  maxTeams: "26",
  blockCount: "7",
  qualifiersPerBlock: "2",
  finalTeamCount: "16",
  wildcardComparisonMode: "normalized",
});
assert.equal(sevenBlock.valid, true);
assert.equal(sevenBlock.values.blockCount, 7);
assert.equal(sevenBlock.values.qualifiersPerBlock, 2);
assert.equal(sevenBlock.values.finalTeamCount, 16);

console.log("six-block-settings-persist.test.mjs: all passed");
