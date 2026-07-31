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
assert.equal(usesPreferredBlockSize("legacy"), true);

const cleaned = removeUndefinedFields({
  a: 1,
  b: undefined,
  c: null,
  d: "",
  e: 0,
  f: false,
  g: { h: undefined, i: 2, j: { k: undefined, l: 3 } },
  m: [1, undefined, 2],
});
assert.deepEqual(cleaned, {
  a: 1,
  c: null,
  d: "",
  e: 0,
  f: false,
  g: { i: 2, j: { l: 3 } },
  m: [1, 2],
});
assert.deepEqual(findUndefinedFieldPaths(cleaned), []);
assert.ok(findUndefinedFieldPaths({ x: undefined }).includes("x"));

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

// 1) 一発トーナメント編集保存: preferredBlockSize なし / 決勝のみ3先 / undefined なし
{
  const validation = validateTournamentInput(
    baseFormInput({
      tournamentFormat: TournamentFormat.SINGLE_ELIMINATION,
      preferredBlockSize: undefined,
    })
  );
  assert.equal(validation.valid, true);
  assert.equal(validation.values.preferredBlockSize, undefined);
  assert.equal("preferredBlockSize" in validation.values, false);
  assert.deepEqual(validation.values.finalsMatchRules.roundOverrides, { final: 3 });

  const fields = buildTournamentSettingsUpdateFields({
    input: validation.values,
    tournament: {
      tournamentFormat: TournamentFormat.SINGLE_ELIMINATION,
      preferredBlockSize: 4, // 残存していても更新しない
    },
    structureLocked: false,
    finalsWinsRequiredLocked: false,
  });

  assert.equal("preferredBlockSize" in fields, false);
  assert.equal(fields.winsRequired, 2);
  assert.deepEqual(fields.finalsMatchRules, {
    defaultWinsRequired: 2,
    roundOverrides: { final: 3 },
  });
  assert.deepEqual(findUndefinedFieldPaths(fields), []);
}

// 2) 通常（legacy）大会: preferredBlockSize が数値で保存
{
  const validation = validateTournamentInput(
    baseFormInput({
      preferredBlockSize: "4",
      useRoundOverrides: false,
      roundOverrides: {},
    })
  );
  assert.equal(validation.valid, true);
  assert.equal(validation.values.preferredBlockSize, 4);

  const fields = buildTournamentSettingsUpdateFields({
    input: validation.values,
    tournament: { preferredBlockSize: 4 },
    structureLocked: false,
    finalsWinsRequiredLocked: false,
  });
  assert.equal(fields.preferredBlockSize, 4);
  assert.deepEqual(findUndefinedFieldPaths(fields), []);
}

// 3) roundOverrides: 基本と同じ値はキー自体を保存しない / undefined キーなし
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
  assert.equal(validation.valid, true);
  assert.deepEqual(validation.values.finalsMatchRules.roundOverrides, { semifinal: 2 });
  assert.equal("final" in validation.values.finalsMatchRules.roundOverrides, false);
  assert.equal("quarterfinal" in validation.values.finalsMatchRules.roundOverrides, false);

  const fields = buildTournamentSettingsUpdateFields({
    input: validation.values,
    tournament: { tournamentFormat: TournamentFormat.SINGLE_ELIMINATION },
  });
  assert.deepEqual(fields.finalsMatchRules.roundOverrides, { semifinal: 2 });
  assert.deepEqual(findUndefinedFieldPaths(fields), []);
}

// 4) 既存大会: preferredBlockSize 未指定でも保存フィールドを組み立てられる
{
  const validation = validateTournamentInput(
    baseFormInput({
      tournamentFormat: TournamentFormat.SINGLE_ELIMINATION,
    })
  );
  const fields = buildTournamentSettingsUpdateFields({
    input: validation.values,
    tournament: {
      tournamentFormat: TournamentFormat.SINGLE_ELIMINATION,
      name: "旧名",
    },
    structureLocked: false,
  });
  assert.equal(fields.name, "テスト大会");
  assert.equal("preferredBlockSize" in fields, false);
  assert.deepEqual(findUndefinedFieldPaths(fields), []);
}

// 構造ロック: 未入力キーは衝突扱いにしない
{
  const message = getStructureLockConflictMessage(
    { maxTeams: 16, teamSize: 2, preferredBlockSize: 4 },
    { maxTeams: 16, teamSize: 2 },
    true
  );
  assert.equal(message, null);
}

{
  const message = getStructureLockConflictMessage(
    { maxTeams: 16, teamSize: 2, preferredBlockSize: 4 },
    { maxTeams: 20, teamSize: 2 },
    true
  );
  assert.match(message, /変更できません/);
}

console.log("tournament-settings-update.test.mjs: all passed");
