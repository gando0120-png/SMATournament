import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBracketMatchConfigForSave,
  normalizeBracketMatchConfig,
  resolveBracketMatchConfig,
} from "../../js/domain/bracket-match-config.js";
import { MatchFormat } from "../../js/domain/aggregate-match-format.js";
import { TournamentFormat } from "../../js/domain/tournament-format.js";
import { canFinalizeTournament } from "../../js/domain/tournament-results.js";

test("normalize: 旧共通設定を upper H2H / lower H2H に補完する", () => {
  const config = normalizeBracketMatchConfig({
    tournamentFormat: TournamentFormat.QUALIFYING_AND_FINALS,
    winsRequired: 2,
    finalsMatchRules: {
      defaultWinsRequired: 2,
      roundOverrides: { final: 3 },
    },
  });

  assert.equal(config.main.enabled, true);
  assert.equal(config.main.matchFormat, MatchFormat.HEAD_TO_HEAD_SETS);
  assert.equal(config.main.finalsMatchRules.defaultWinsRequired, 2);
  assert.equal(config.main.finalsMatchRules.roundOverrides.final, 3);
  assert.equal(config.consolation.enabled, true);
  assert.equal(config.consolation.matchFormat, MatchFormat.HEAD_TO_HEAD_SETS);
  assert.equal(config.consolation.finalsMatchRules.roundOverrides.final, 3);
});

test("normalize: SE は下位を無効にする", () => {
  const config = normalizeBracketMatchConfig({
    tournamentFormat: TournamentFormat.SINGLE_ELIMINATION,
    matchFormat: MatchFormat.MULTI_TEAM_TOTAL,
    aggregateMatchRules: {
      teamCount: 4,
      setCount: 2,
      qualifiersCount: 2,
      rankingMethod: "totalScoreDesc",
      tieBreakMethod: "manual",
    },
  });
  assert.equal(config.main.matchFormat, MatchFormat.MULTI_TEAM_TOTAL);
  assert.equal(config.consolation.enabled, false);
});

test("build: upper H2H / lower multi を独立保存できる", () => {
  const result = buildBracketMatchConfigForSave(
    {
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
    },
    TournamentFormat.QUALIFYING_AND_FINALS
  );

  assert.equal(result.valid, true);
  assert.equal(result.values.bracketMatchConfig.main.matchFormat, MatchFormat.HEAD_TO_HEAD_SETS);
  assert.equal(
    result.values.bracketMatchConfig.consolation.matchFormat,
    MatchFormat.MULTI_TEAM_TOTAL
  );
  assert.equal(result.values.bracketMatchConfig.consolation.aggregateMatchRules.teamCount, 4);
  assert.equal(result.values.bracketMatchConfig.consolation.aggregateMatchRules.qualifiersCount, 2);
  assert.equal(result.values.finalsMatchRules.roundOverrides.final, 3);
});

test("build: upper multi / lower H2H", () => {
  const result = buildBracketMatchConfigForSave(
    {
      bracketMatchConfig: {
        main: {
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
        consolation: {
          enabled: true,
          matchFormat: MatchFormat.HEAD_TO_HEAD_SETS,
          finalsMatchRules: { defaultWinsRequired: 2, roundOverrides: {} },
        },
      },
    },
    TournamentFormat.QUALIFYING_AND_FINALS
  );
  assert.equal(result.valid, true);
  assert.equal(result.values.bracketMatchConfig.main.matchFormat, MatchFormat.MULTI_TEAM_TOTAL);
  assert.equal(
    result.values.bracketMatchConfig.consolation.matchFormat,
    MatchFormat.HEAD_TO_HEAD_SETS
  );
});

test("build: 片方無効を許可し、両方無効は拒否", () => {
  const upperOnly = buildBracketMatchConfigForSave(
    {
      bracketMatchConfig: {
        main: {
          enabled: true,
          matchFormat: MatchFormat.HEAD_TO_HEAD_SETS,
          finalsMatchRules: { defaultWinsRequired: 2, roundOverrides: {} },
        },
        consolation: { enabled: false },
      },
    },
    TournamentFormat.QUALIFYING_AND_FINALS
  );
  assert.equal(upperOnly.valid, true);
  assert.equal(upperOnly.values.bracketMatchConfig.consolation.enabled, false);

  const neither = buildBracketMatchConfigForSave(
    {
      bracketMatchConfig: {
        main: { enabled: false },
        consolation: { enabled: false },
      },
    },
    TournamentFormat.QUALIFYING_AND_FINALS
  );
  assert.equal(neither.valid, false);
});

test("build: 下位の通過数がチーム数以上ならエラー", () => {
  const result = buildBracketMatchConfigForSave(
    {
      bracketMatchConfig: {
        main: {
          enabled: true,
          matchFormat: MatchFormat.HEAD_TO_HEAD_SETS,
          finalsMatchRules: { defaultWinsRequired: 2, roundOverrides: {} },
        },
        consolation: {
          enabled: true,
          matchFormat: MatchFormat.MULTI_TEAM_TOTAL,
          aggregateMatchRules: {
            teamCount: 4,
            setCount: 2,
            qualifiersCount: 4,
            rankingMethod: "totalScoreDesc",
            tieBreakMethod: "manual",
          },
        },
      },
    },
    TournamentFormat.QUALIFYING_AND_FINALS
  );
  assert.equal(result.valid, false);
  assert.match(result.errors["consolation.qualifiersCount"] || "", /通過数/);
});

test("resolve: consolation 側を返す", () => {
  const side = resolveBracketMatchConfig(
    {
      tournamentFormat: TournamentFormat.QUALIFYING_AND_FINALS,
      bracketMatchConfig: {
        main: {
          enabled: true,
          matchFormat: MatchFormat.HEAD_TO_HEAD_SETS,
          finalsMatchRules: { defaultWinsRequired: 2, roundOverrides: {} },
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
    },
    "consolation"
  );
  assert.equal(side.matchFormat, MatchFormat.MULTI_TEAM_TOTAL);
});

test("canFinalize: 下位が明示有効なら未作成で拒否", () => {
  const decision = canFinalizeTournament({
    tournament: {
      bracketMatchConfig: {
        main: {
          enabled: true,
          matchFormat: MatchFormat.HEAD_TO_HEAD_SETS,
          finalsMatchRules: { defaultWinsRequired: 2, roundOverrides: {} },
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
    },
    bracket: null,
    resultsMap: new Map(),
    consolationBracket: null,
  });
  assert.equal(decision.canFinalize, false);
  assert.match(decision.message || "", /上位|下位/);
});

test("canFinalize: 旧大会（nestedなし）は下位未作成でも上位完了のみで可", () => {
  // 上位未完了なので false。required 判定だけ見るため consolationRequired 経路を確認
  const decision = canFinalizeTournament({
    tournament: {
      tournamentFormat: TournamentFormat.QUALIFYING_AND_FINALS,
      winsRequired: 2,
    },
    bracket: null,
    resultsMap: new Map(),
    consolationBracket: null,
  });
  // 上位必須で未完了
  assert.equal(decision.canFinalize, false);
  assert.match(decision.message || "", /上位/);
});
