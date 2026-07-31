/**
 * 上位/下位独立の決勝設定フォーム・バリデーション スモーク
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { validateTournamentInput } from "../../js/domain/validators.js";
import { TournamentFormat } from "../../js/domain/tournament-format.js";
import { MatchFormat } from "../../js/domain/aggregate-match-format.js";
import { buildConsolationBracket } from "../../js/domain/consolation-bracket.js";
import { buildMainBracketFromAdvancement } from "../../js/domain/finals-bracket-from-config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");

for (const file of [
  "js/ui/bracket-match-config-form.js",
  "js/domain/bracket-match-config.js",
  "tournament-new.html",
  "tournament-edit-v2.html",
]) {
  const text = readFileSync(resolve(root, file), "utf8");
  if (file.endsWith(".html")) {
    assert.match(text, /bracketMatchConfigSection/);
  } else {
    assert.match(text, /bracketMatchConfig|initBracketMatchConfigForm/);
  }
}

const baseQf = {
  name: "上位H2H下位multi",
  eventDate: "2026-08-01",
  venue: "会場A",
  entryDeadline: "2026-07-31T23:59",
  maxTeams: "24",
  teamSize: "4",
  courtCount: "2",
  tournamentFormat: TournamentFormat.QUALIFYING_AND_FINALS,
  blockCount: "8",
  qualifiersPerBlock: "1",
  bracketMatchConfig: {
    main: {
      enabled: true,
      matchFormat: MatchFormat.HEAD_TO_HEAD_SETS,
      finalsMatchRules: {
        defaultWinsRequired: 2,
        roundOverrides: { final: 3 },
      },
    },
    consolation: {
      enabled: true,
      matchFormat: MatchFormat.MULTI_TEAM_TOTAL,
      aggregateMatchRules: {
        teamCount: 4,
        setCount: 2,
        qualifiersCount: 2,
        rankingMethod: "totalScoreDesc",
        tieBreakMethod: "manual",
      },
    },
  },
};

const validation = validateTournamentInput(baseQf);
assert.equal(validation.valid, true, JSON.stringify(validation.errors));
assert.equal(
  validation.values.bracketMatchConfig.main.matchFormat,
  MatchFormat.HEAD_TO_HEAD_SETS
);
assert.equal(
  validation.values.bracketMatchConfig.consolation.matchFormat,
  MatchFormat.MULTI_TEAM_TOTAL
);
assert.equal(validation.values.finalsMatchRules.roundOverrides.final, 3);

const advancement = {
  finalized: true,
  qualifiers: Array.from({ length: 8 }, (_, i) => ({
    entryId: `q${i + 1}`,
    teamName: `Q${i + 1}`,
    seed: i + 1,
    isBye: false,
  })),
};

const mainPreview = buildMainBracketFromAdvancement(
  advancement,
  validation.values
);
assert.equal(mainPreview.canFinalize, true);
assert.ok(mainPreview.bracket);
assert.notEqual(mainPreview.bracket.matchFormat, MatchFormat.MULTI_TEAM_TOTAL);

const consolationParticipants = Array.from({ length: 8 }, (_, i) => ({
  entryId: `c${i + 1}`,
  teamName: `C${i + 1}`,
}));
const consolationPreview = buildConsolationBracket(consolationParticipants, {
  tournament: validation.values,
});
assert.equal(consolationPreview.canFinalize, true);
assert.equal(consolationPreview.bracket.matchFormat, MatchFormat.MULTI_TEAM_TOTAL);
assert.equal(consolationPreview.bracket.aggregateMatchRules.teamCount, 4);
assert.equal(consolationPreview.bracket.aggregateMatchRules.qualifiersCount, 2);

const seValidation = validateTournamentInput({
  name: "一発",
  eventDate: "2026-08-01",
  venue: "会場A",
  entryDeadline: "2026-07-31T23:59",
  maxTeams: "8",
  teamSize: "4",
  courtCount: "2",
  tournamentFormat: TournamentFormat.SINGLE_ELIMINATION,
  matchFormat: MatchFormat.HEAD_TO_HEAD_SETS,
  winsRequired: "2",
});
assert.equal(seValidation.valid, true);
assert.equal(seValidation.values.bracketMatchConfig.consolation.enabled, false);

console.log("bracket-match-config-form.smoke: ok");
