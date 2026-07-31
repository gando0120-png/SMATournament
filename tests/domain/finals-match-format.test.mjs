/**
 * トーナメント勝利条件（ラウンド別 2先 / 3先）
 */
import assert from "node:assert/strict";
import {
  buildFinalsMatchRulesPreset,
  estimateFinalsBracketSizeForSettings,
  formatFinalsMatchRulesSummaryLines,
  isFinalsMatchRulesLocked,
  isMaterialBracket,
  listFinalsRoundSettings,
  normalizeFinalsMatchRules,
  resolveFinalsRoundKey,
  resolveMatchWinsRequired,
  validateFinalsMatchRulesInput,
} from "../../js/domain/finals-match-format.js";
import { validateFinalsMatchResultInput } from "../../js/domain/finals-match-result.js";
import { TournamentFormat } from "../../js/domain/tournament-format.js";

function scores(...pairs) {
  const input = {};
  pairs.forEach(([t1, t2], index) => {
    const setNumber = index + 1;
    input[`set${setNumber}Team1Score`] = t1;
    input[`set${setNumber}Team2Score`] = t2;
  });
  return input;
}

assert.equal(isMaterialBracket(null), false);
assert.equal(isMaterialBracket({ matches: [], bracketSize: 0 }), false);
assert.equal(isMaterialBracket({ bracketSize: 8 }), true);
assert.equal(isMaterialBracket({ matches: [{ id: "m1" }] }), true);
assert.equal(isFinalsMatchRulesLocked({ hasMaterialFinalsBracket: false }), false);
assert.equal(isFinalsMatchRulesLocked({ hasMaterialFinalsBracket: true }), true);
assert.equal(
  isFinalsMatchRulesLocked({ hasFinalsBracket: true, hasMaterialFinalsBracket: false }),
  false
);

// round keys
assert.equal(resolveFinalsRoundKey({ bracketSize: 8, roundNumber: 1 }), "quarterfinal");
assert.equal(resolveFinalsRoundKey({ bracketSize: 8, roundNumber: 2 }), "semifinal");
assert.equal(resolveFinalsRoundKey({ bracketSize: 8, roundNumber: 3 }), "final");
assert.equal(resolveFinalsRoundKey({ bracketSize: 16, roundNumber: 1 }), "roundOf16");
assert.equal(resolveFinalsRoundKey({ bracketSize: 16, roundNumber: 2 }), "quarterfinal");

const rounds8 = listFinalsRoundSettings(8);
assert.deepEqual(
  rounds8.map((r) => r.label),
  ["準々決勝", "準決勝", "決勝"]
);
const rounds16 = listFinalsRoundSettings(16);
assert.deepEqual(
  rounds16.map((r) => r.label),
  ["1回戦", "準々決勝", "準決勝", "決勝"]
);

assert.equal(
  estimateFinalsBracketSizeForSettings({
    tournamentFormat: TournamentFormat.SINGLE_ELIMINATION,
    maxTeams: 8,
  }),
  8
);
assert.equal(
  estimateFinalsBracketSizeForSettings({
    tournamentFormat: TournamentFormat.QUALIFYING_AND_FINALS,
    blockCount: 16,
    qualifiersPerBlock: 1,
    maxTeams: 59,
  }),
  16
);

// resolve priority
const tournament = {
  winsRequired: 2,
  finalsMatchRules: {
    defaultWinsRequired: 2,
    roundOverrides: { final: 3 },
  },
};
assert.equal(
  resolveMatchWinsRequired({
    tournament,
    bracket: { bracketSize: 8 },
    roundNumber: 1,
  }),
  2
);
assert.equal(
  resolveMatchWinsRequired({
    tournament,
    bracket: { bracketSize: 8 },
    roundNumber: 3,
  }),
  3
);
assert.equal(resolveMatchWinsRequired({ tournament: { winsRequired: 3 } }), 3);
assert.equal(resolveMatchWinsRequired({}), 2);

const legacy = normalizeFinalsMatchRules({ winsRequired: 3 });
assert.equal(legacy.defaultWinsRequired, 3);
assert.deepEqual(legacy.roundOverrides, {});

const validated = validateFinalsMatchRulesInput({
  defaultWinsRequired: 2,
  useRoundOverrides: true,
  roundOverrides: { final: 3, semifinal: 2 },
});
assert.equal(validated.valid, true);
assert.deepEqual(validated.values.finalsMatchRules.roundOverrides, { final: 3 });

const invalidKey = validateFinalsMatchRulesInput({
  defaultWinsRequired: 2,
  useRoundOverrides: true,
  roundOverrides: { bogus: 3 },
});
assert.equal(invalidKey.valid, false);

const preset = buildFinalsMatchRulesPreset("finalOnly3", 8);
assert.equal(preset.defaultWinsRequired, 2);
assert.deepEqual(preset.roundOverrides, { final: 3 });
assert.equal(preset.useRoundOverrides, true);

const summary = formatFinalsMatchRulesSummaryLines(tournament, { bracketSize: 8 });
assert.deepEqual(summary, ["準決勝まで：2セット先取", "決勝：3セット先取"]);

const all2Summary = formatFinalsMatchRulesSummaryLines(
  { finalsMatchRules: { defaultWinsRequired: 2, roundOverrides: {} } },
  { bracketSize: 8 }
);
assert.deepEqual(all2Summary, ["全ラウンド：2セット先取"]);

// match completion with round-specific wins
{
  const qf = validateFinalsMatchResultInput(scores([50, 30], [50, 40]), {
    winsRequired: resolveMatchWinsRequired({
      tournament,
      bracket: { bracketSize: 8 },
      roundNumber: 1,
    }),
  });
  assert.equal(qf.valid, true);
  assert.equal(qf.data.sets.length, 2);

  const finalIncomplete = validateFinalsMatchResultInput(
    scores([50, 30], [50, 40]),
    {
      winsRequired: resolveMatchWinsRequired({
        tournament,
        bracket: { bracketSize: 8 },
        roundNumber: 3,
      }),
    }
  );
  assert.equal(finalIncomplete.valid, false);

  const finalComplete = validateFinalsMatchResultInput(
    scores([50, 30], [50, 40], [50, 10]),
    {
      winsRequired: resolveMatchWinsRequired({
        tournament,
        bracket: { bracketSize: 8 },
        roundNumber: 3,
      }),
    }
  );
  assert.equal(finalComplete.valid, true);
  assert.equal(finalComplete.data.sets.length, 3);
  assert.equal(finalComplete.data.winsRequired, 3);
}

console.log("finals-match-format.test.mjs: all passed");
