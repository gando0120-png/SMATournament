/**
 * 大会設定更新ペイロード（preferredBlockSize / finalsMatchRules / undefined 除去）
 */
import assert from "node:assert/strict";
import { validateTournamentInput } from "../../js/domain/validators.js";
import { TournamentFormat } from "../../js/domain/tournament-format.js";
import {
  buildTournamentSettingsUpdateFields,
  getStructureLockConflictMessage,
  usesPreferredBlockSize,
} from "../../js/domain/tournament-settings-update.js";
import {
  findUndefinedFieldPaths,
  removeUndefinedFields,
} from "../../js/lib/remove-undefined-fields.js";

assert.equal(usesPreferredBlockSize(TournamentFormat.SINGLE_ELIMINATION), false);
assert.equal(usesPreferredBlockSize(TournamentFormat.QUALIFYING_AND_FINALS), false);
assert.equal(usesPreferredBlockSize(undefined), true);

const cleaned = removeUndefinedFields({
  a: 1,
  b: undefined,
  c: null,
  d: "",
  e: 0,
  g: { h: undefined, i: 2 },
});
assert.deepEqual(cleaned, { a: 1, c: null, d: "", e: 0, g: { i: 2 } });
assert.deepEqual(findUndefinedFieldPaths(cleaned), []);

function baseFormInput(overrides = {}) {
  return {
    name: "テスト大会",
    eventDate: "2026-08-01",
    venue: "会場",
    entryDeadline: "2026-07-31T12:00",
    maxTeams: "16",
    teamSize: "2",
    courtCount: "2",
    winsRequired: "2",
    defaultWinsRequired: 2,
    useRoundOverrides: true,
    roundOverrides: { final: 3 },
    ...overrides,
  };
}

const existingSe = {
  name: "テスト大会",
  eventDate: "2026-08-01",
  venue: "会場",
  entryDeadline: new Date("2026-07-31T12:00:00"),
  maxTeams: 16,
  teamSize: 2,
  courtCount: 2,
  tournamentFormat: TournamentFormat.SINGLE_ELIMINATION,
  winsRequired: 2,
};

// 1) 一発トーナメント: 勝利条件だけ変更 → payload は差分のみ
{
  const validation = validateTournamentInput(
    baseFormInput({
      tournamentFormat: TournamentFormat.SINGLE_ELIMINATION,
    })
  );
  assert.equal(validation.valid, true);

  const fields = buildTournamentSettingsUpdateFields({
    input: validation.values,
    tournament: existingSe,
    structureLocked: false,
    finalsWinsRequiredLocked: false,
  });

  assert.equal("preferredBlockSize" in fields, false);
  assert.equal("name" in fields, false);
  // winsRequired が同じなら差分に含めない
  assert.equal("winsRequired" in fields, false);
  assert.deepEqual(fields.finalsMatchRules, {
    defaultWinsRequired: 2,
    roundOverrides: { final: 3 },
  });
  assert.deepEqual(findUndefinedFieldPaths(fields), []);
}

// 2) legacy: preferredBlockSize 変更時のみ数値で保存
{
  const validation = validateTournamentInput(
    baseFormInput({
      preferredBlockSize: "6",
      useRoundOverrides: false,
      roundOverrides: {},
    })
  );
  assert.equal(validation.values.preferredBlockSize, 6);

  const fields = buildTournamentSettingsUpdateFields({
    input: validation.values,
    tournament: {
      ...existingSe,
      tournamentFormat: undefined,
      preferredBlockSize: 4,
      winsRequired: 2,
      finalsMatchRules: { defaultWinsRequired: 2, roundOverrides: {} },
    },
  });
  assert.equal(fields.preferredBlockSize, 6);
  assert.deepEqual(findUndefinedFieldPaths(fields), []);
}

// 3) roundOverrides: 基本と同じ値はキーなし / undefined キーなし
{
  const validation = validateTournamentInput(
    baseFormInput({
      tournamentFormat: TournamentFormat.SINGLE_ELIMINATION,
      winsRequired: "3",
      defaultWinsRequired: 3,
      useRoundOverrides: true,
      roundOverrides: {
        final: 3,
        semifinal: 2,
        quarterfinal: undefined,
      },
    })
  );
  assert.deepEqual(validation.values.finalsMatchRules.roundOverrides, { semifinal: 2 });

  const fields = buildTournamentSettingsUpdateFields({
    input: validation.values,
    tournament: {
      ...existingSe,
      winsRequired: 3,
      finalsMatchRules: { defaultWinsRequired: 3, roundOverrides: {} },
    },
  });
  assert.deepEqual(fields.finalsMatchRules.roundOverrides, { semifinal: 2 });
  assert.deepEqual(findUndefinedFieldPaths(fields), []);
}

// 4) 変更なしなら空オブジェクト（updatedAt は service 側）
{
  const validation = validateTournamentInput(
    baseFormInput({
      tournamentFormat: TournamentFormat.SINGLE_ELIMINATION,
      useRoundOverrides: false,
      roundOverrides: {},
    })
  );
  const fields = buildTournamentSettingsUpdateFields({
    input: validation.values,
    tournament: {
      ...existingSe,
      finalsMatchRules: { defaultWinsRequired: 2, roundOverrides: {} },
    },
  });
  assert.deepEqual(fields, {});
}

assert.equal(
  getStructureLockConflictMessage(
    { maxTeams: 16, teamSize: 2, preferredBlockSize: 4 },
    { maxTeams: 16, teamSize: 2 },
    true
  ),
  null
);

console.log("tournament-settings-update.test.mjs: all passed");
