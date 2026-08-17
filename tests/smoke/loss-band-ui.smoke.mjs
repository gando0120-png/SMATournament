/**
 * Phase 6: loss-band 設定UI / 運営画面 スモーク
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");

for (const file of [
  "js/ui/loss-band-ranking-form.js",
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
  } else if (file.includes("dashboard")) {
    assert.match(text, /tournament-loss-band\.html/);
    assert.match(text, /createLossBandFromTournament|LOSS_BAND/);
  } else if (file.endsWith(".html")) {
    assert.match(text, /lossBandRankingSection/);
  } else {
    assert.match(text, /rankingMode|loss_band|LOSS_BAND/);
  }
}

assert.equal(formatLossBandTournamentStatusLabel("active"), "順位決定戦進行中");
assert.equal(formatLossBandTournamentStatusLabel("finals_pending"), "決勝待ち");
assert.equal(formatLossBandTournamentStatusLabel("third_place_pending"), "3位決定戦待ち");
assert.equal(formatLossBandTournamentStatusLabel("exchange_pending"), "交流戦進行中");
assert.equal(formatLossBandTournamentStatusLabel("completed"), "完了");

const ok = validateTournamentInput({
  name: "LB64",
  eventDate: "2026-08-01",
  venue: "会場",
  entryDeadline: "2026-07-31T23:59",
  maxTeams: "64",
  teamSize: "4",
  courtCount: "4",
  tournamentFormat: TournamentFormat.SINGLE_ELIMINATION,
  matchFormat: MatchFormat.HEAD_TO_HEAD_SETS,
  winsRequired: "2",
  rankingMode: RankingMode.LOSS_BAND,
  rematchAvoidance: true,
  thirdPlaceMatch: false,
  exchangeMatches: false,
  guaranteedMatchCount: 5,
  finalsMatchRules: { defaultWinsRequired: 2, roundOverrides: {} },
});
assert.equal(ok.valid, true, JSON.stringify(ok.errors));
assert.equal(ok.values.bracketMatchConfig.main.rankingMode, RankingMode.LOSS_BAND);

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
