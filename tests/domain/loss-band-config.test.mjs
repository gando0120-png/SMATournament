/**
 * rankingMode / multi 併用禁止
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBracketMatchConfigForSave,
  normalizeBracketMatchConfig,
  resolveRankingMode,
} from "../../js/domain/bracket-match-config.js";
import { MatchFormat } from "../../js/domain/aggregate-match-format.js";
import { TournamentFormat } from "../../js/domain/tournament-format.js";
import { RankingMode } from "../../js/domain/loss-band/constants.js";

test("resolveRankingMode: 未設定は single_elimination", () => {
  assert.equal(resolveRankingMode(undefined), RankingMode.SINGLE_ELIMINATION);
  assert.equal(resolveRankingMode({}), RankingMode.SINGLE_ELIMINATION);
  assert.equal(
    resolveRankingMode({ rankingMode: RankingMode.LOSS_BAND }),
    RankingMode.LOSS_BAND
  );
});

test("normalize: rankingMode 未設定の既存 SE はフィールドを増やさない", () => {
  const config = normalizeBracketMatchConfig({
    tournamentFormat: TournamentFormat.SINGLE_ELIMINATION,
    winsRequired: 2,
  });
  assert.equal(config.main.rankingMode, undefined);
});

test("build: multi + loss_band は拒否", () => {
  const result = buildBracketMatchConfigForSave(
    {
      matchFormat: MatchFormat.MULTI_TEAM_TOTAL,
      rankingMode: RankingMode.LOSS_BAND,
      aggregateMatchRules: {
        teamCount: 4,
        setCount: 2,
        qualifiersCount: 2,
        rankingMethod: "totalScoreDesc",
        tieBreakMethod: "manual",
      },
    },
    TournamentFormat.SINGLE_ELIMINATION
  );
  assert.equal(result.valid, false);
  assert.match(result.message || "", /敗戦帯|複数チーム/);
});

test("build: H2H + loss_band は main に保存できる（64チーム）", () => {
  const result = buildBracketMatchConfigForSave(
    {
      matchFormat: MatchFormat.HEAD_TO_HEAD_SETS,
      winsRequired: 2,
      rankingMode: RankingMode.LOSS_BAND,
      maxTeams: 64,
      rematchAvoidance: true,
      thirdPlaceMatch: true,
      exchangeMatches: false,
      guaranteedMatchCount: 5,
      finalsMatchRules: { defaultWinsRequired: 2, roundOverrides: {} },
    },
    TournamentFormat.SINGLE_ELIMINATION
  );
  assert.equal(result.valid, true);
  assert.equal(
    result.values.bracketMatchConfig.main.rankingMode,
    RankingMode.LOSS_BAND
  );
  assert.equal(result.values.bracketMatchConfig.main.rematchAvoidance, true);
  assert.equal(result.values.bracketMatchConfig.main.thirdPlaceMatch, true);
  assert.equal(result.values.bracketMatchConfig.main.guaranteedMatchCount, 5);
});

test("build: loss_band は 33〜64 以外のチーム数で拒否", () => {
  const result = buildBracketMatchConfigForSave(
    {
      matchFormat: MatchFormat.HEAD_TO_HEAD_SETS,
      winsRequired: 2,
      rankingMode: RankingMode.LOSS_BAND,
      maxTeams: 32,
      finalsMatchRules: { defaultWinsRequired: 2, roundOverrides: {} },
    },
    TournamentFormat.SINGLE_ELIMINATION
  );
  assert.equal(result.valid, false);
  assert.match(result.message || "", /33/);
});

test("build: loss_band は 48 チームを許可", () => {
  const result = buildBracketMatchConfigForSave(
    {
      matchFormat: MatchFormat.HEAD_TO_HEAD_SETS,
      winsRequired: 2,
      rankingMode: RankingMode.LOSS_BAND,
      maxTeams: 48,
      rematchAvoidance: true,
      finalsMatchRules: { defaultWinsRequired: 2, roundOverrides: {} },
    },
    TournamentFormat.SINGLE_ELIMINATION
  );
  assert.equal(result.valid, true, result.message);
  assert.equal(result.values.bracketMatchConfig.main.rankingMode, RankingMode.LOSS_BAND);
});

test("build: consolation に loss_band は拒否", () => {
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
          matchFormat: MatchFormat.HEAD_TO_HEAD_SETS,
          rankingMode: RankingMode.LOSS_BAND,
          finalsMatchRules: { defaultWinsRequired: 2, roundOverrides: {} },
        },
      },
    },
    TournamentFormat.QUALIFYING_AND_FINALS
  );
  assert.equal(result.valid, false);
});
