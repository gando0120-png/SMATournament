/**
 * Phase 6–9: loss-band 設定UI / 運営画面 スモーク
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { validateTournamentInput } from "../../js/domain/validators.js";
import { TournamentFormat } from "../../js/domain/tournament-format.js";
import { MatchFormat } from "../../js/domain/aggregate-match-format.js";
import { RankingMode } from "../../js/domain/loss-band/constants.js";
import { formatLossBandTournamentStatusLabel } from "../../js/domain/loss-band/config.js";
import { buildBracketMatchConfigForSave } from "../../js/domain/bracket-match-config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");

for (const file of [
  "js/ui/loss-band-ranking-form.js",
  "js/ui/loss-band-bracket-options.js",
  "js/ui/pages/tournament-loss-band-page.js",
  "tournament-loss-band.html",
  "tournament-new.html",
  "tournament-edit-v2.html",
  "js/ui/pages/tournament-dashboard-page.js",
]) {
  const text = readFileSync(resolve(root, file), "utf8");
  if (file === "tournament-loss-band.html") {
    assert.match(text, /tournament-loss-band-page/);
    assert.match(text, /bandsRoot/);
    assert.doesNotMatch(text, /確定64チーム/);
  } else if (file.includes("dashboard")) {
    assert.match(text, /tournament-loss-band\.html/);
    assert.match(text, /createLossBandFromTournament|resolveAndValidateLossBandSize/);
    assert.doesNotMatch(text, /LOSS_BAND_TEAM_COUNT/);
  } else if (file.endsWith(".html")) {
    assert.match(text, /lossBandRankingSection/);
  } else if (file.includes("bracket-options") || file.includes("ranking-form")) {
    assert.match(text, /32|64|128|bracketSize/);
  } else {
    assert.match(text, /rankingMode|loss_band|LOSS_BAND/);
    if (file.includes("tournament-loss-band-page")) {
      assert.match(text, /結果を修正/);
      assert.match(text, /correctLossBandRankingResult/);
      assert.match(text, /expectedRevision/);
      assert.match(text, /assessLossBandMatchResultCorrection|FINAL|third_place/);
      assert.match(text, /specialEditPanel|specialEditRoot/);
    }
  }
}

assert.equal(formatLossBandTournamentStatusLabel("active"), "順位決定戦進行中");
assert.equal(formatLossBandTournamentStatusLabel("finals_pending"), "決勝待ち");
assert.equal(formatLossBandTournamentStatusLabel("third_place_pending"), "3位決定戦待ち");
assert.equal(formatLossBandTournamentStatusLabel("exchange_pending"), "交流戦進行中");
assert.equal(formatLossBandTournamentStatusLabel("completed"), "完了");

function seLossBand(maxTeams, bracketSize, guaranteed) {
  return validateTournamentInput({
    name: `LB${maxTeams}`,
    eventDate: "2026-08-01",
    venue: "会場",
    entryDeadline: "2026-07-31T23:59",
    maxTeams: String(maxTeams),
    teamSize: "4",
    courtCount: "4",
    tournamentFormat: TournamentFormat.SINGLE_ELIMINATION,
    matchFormat: MatchFormat.HEAD_TO_HEAD_SETS,
    winsRequired: "2",
    rankingMode: RankingMode.LOSS_BAND,
    bracketSize,
    rematchAvoidance: true,
    thirdPlaceMatch: false,
    exchangeMatches: false,
    guaranteedMatchCount: guaranteed,
    finalsMatchRules: { defaultWinsRequired: 2, roundOverrides: {} },
  });
}

for (const [n, b, g] of [
  [32, 32, 4],
  [64, 64, 5],
  [128, 128, 6],
  [48, 64, 5],
]) {
  const ok = seLossBand(n, b, g);
  assert.equal(ok.valid, true, `n=${n}: ${JSON.stringify(ok.errors)}`);
  assert.equal(ok.values.bracketMatchConfig.main.rankingMode, RankingMode.LOSS_BAND);
  assert.equal(ok.values.bracketMatchConfig.main.bracketSize, b);
  assert.equal(ok.values.bracketMatchConfig.main.guaranteedMatchCount, g);
}

const bad16 = seLossBand(16, 32, 4);
assert.equal(bad16.valid, false);

const multiReject = buildBracketMatchConfigForSave(
  {
    matchFormat: MatchFormat.MULTI_TEAM_TOTAL,
    rankingMode: RankingMode.LOSS_BAND,
    maxTeams: 64,
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
assert.equal(multiReject.valid, false);

const qf = buildBracketMatchConfigForSave(
  {
    bracketMatchConfig: {
      main: {
        enabled: true,
        matchFormat: MatchFormat.HEAD_TO_HEAD_SETS,
        rankingMode: RankingMode.LOSS_BAND,
        bracketSize: 32,
        rematchAvoidance: true,
        guaranteedMatchCount: 4,
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
    finalTeamCount: 32,
  },
  TournamentFormat.QUALIFYING_AND_FINALS
);
assert.equal(qf.valid, true, qf.message || JSON.stringify(qf.errors));
assert.equal(qf.values.bracketMatchConfig.main.rankingMode, RankingMode.LOSS_BAND);
assert.equal(qf.values.bracketMatchConfig.main.bracketSize, 32);
assert.equal(
  qf.values.bracketMatchConfig.consolation.matchFormat,
  MatchFormat.MULTI_TEAM_TOTAL
);

const se = validateTournamentInput({
  name: "SE16",
  eventDate: "2026-08-01",
  venue: "会場",
  entryDeadline: "2026-07-31T23:59",
  maxTeams: "16",
  teamSize: "4",
  courtCount: "2",
  tournamentFormat: TournamentFormat.SINGLE_ELIMINATION,
  matchFormat: MatchFormat.HEAD_TO_HEAD_SETS,
  winsRequired: "2",
  finalsMatchRules: { defaultWinsRequired: 2, roundOverrides: {} },
});
assert.equal(se.valid, true);
assert.equal(se.values.bracketMatchConfig.main.rankingMode, undefined);

console.log("loss-band-ui.smoke OK");
