/**
 * 決勝勝利報告 押し間違い防止 UI
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PLAYER_FINALS_ELIMINATED_MESSAGE,
  PLAYER_FINALS_NOT_ADVANCED_MESSAGE,
  PLAYER_FINALS_WAITING_OPPONENT_MESSAGE,
  PlayerFinalsMatchState,
  canShowPlayerFinalsWinReportButton,
  formatPlayerFinalsWinConfirmButtonLabel,
  resolvePlayerFinalsMatchView,
} from "../../js/domain/player-finals-win-report.js";
import { getByeWinnerTeam } from "../../js/domain/finals-match-bye.js";
import { listByeMatchesNeedingResults } from "../../js/domain/finals-match-progress.js";
import {
  buildPersistedSingleEliminationBracket,
  buildSingleEliminationBracket,
} from "../../js/domain/single-elimination-bracket.js";
import { TournamentFormat } from "../../js/domain/tournament-format.js";
import { TournamentStatus } from "../../js/domain/constants.js";
import {
  renderPlayerFinalsMatchPanel,
  renderPlayerFinalsWinConfirmDialogInner,
} from "../../js/ui/player-finals-win-report-view.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const html = readFileSync(join(root, "player-results.html"), "utf8");
const page = readFileSync(join(root, "js/ui/pages/player-results-page.js"), "utf8");
const css = readFileSync(join(root, "css/components.css"), "utf8");
const functionsImpl = readFileSync(join(root, "functions/src/player-finals-win-report.js"), "utf8");
const qualifyingPageFn = page.slice(
  page.indexOf("function renderQualifyingMatches"),
  page.indexOf("function renderFinalsState")
);

assert.match(html, /あなたが選択しているチーム/);
assert.match(html, /changeSelectedTeamBtn/);
assert.match(html, /チームを変更/);
assert.match(html, /チームを選び直す/);
assert.match(page, /handleChangeTeam/);
assert.match(page, /setFinalsSelectedTeamChrome/);
assert.match(page, /renderPlayerFinalsMatchPanel/);
assert.match(page, /renderPlayerFinalsWinConfirmDialogInner/);
assert.doesNotMatch(qualifyingPageFn, /あなたが選択しているチーム/);
assert.doesNotMatch(qualifyingPageFn, /勝利を報告/);
assert.match(qualifyingPageFn, /結果を送信/);
assert.doesNotMatch(page, /setInterval/);
assert.doesNotMatch(functionsImpl, /あなたが選択しているチーム/);

const team1Html = renderPlayerFinalsMatchPanel({
  state: PlayerFinalsMatchState.PLAYABLE,
  roundLabel: "準決勝",
  entryId: "sma",
  teamName: "SMA",
  opponentName: "チームB",
  team1: { teamName: "SMA", entryId: "sma" },
  team2: { teamName: "チームB", entryId: "b" },
});
assert.match(team1Html, /あなたのチーム/);
assert.match(team1Html, /勝利を報告/);
assert.match(team1Html, /選択中の SMA を勝者として報告します/);
assert.ok(team1Html.indexOf("あなたのチーム") < team1Html.indexOf("SMA"));
assert.ok(team1Html.indexOf("SMA") < team1Html.indexOf("チームB"));

const team2Html = renderPlayerFinalsMatchPanel({
  state: PlayerFinalsMatchState.PLAYABLE,
  roundLabel: "準決勝",
  entryId: "sma",
  teamName: "SMA",
  opponentName: "チームB",
  team1: { teamName: "チームB", entryId: "b" },
  team2: { teamName: "SMA", entryId: "sma" },
});
assert.match(team2Html, /あなたのチーム/);
assert.ok(team2Html.indexOf("チームB") < team2Html.indexOf("あなたのチーム"));
assert.ok(team2Html.lastIndexOf("SMA") > team2Html.indexOf("あなたのチーム"));

const sameNameHtml = renderPlayerFinalsMatchPanel({
  state: PlayerFinalsMatchState.PLAYABLE,
  entryId: "clone-b",
  teamName: "SMA",
  opponentName: "SMA",
  team1: { teamName: "SMA", entryId: "clone-a" },
  team2: { teamName: "SMA", entryId: "clone-b" },
});
assert.match(sameNameHtml, /あなたのチーム/);
assert.ok(sameNameHtml.indexOf("VS") < sameNameHtml.indexOf("あなたのチーム"));

const longName = "庄内もっきいず超長いチーム名テスト用ABCDEFG";
const longHtml = renderPlayerFinalsMatchPanel({
  state: PlayerFinalsMatchState.PLAYABLE,
  entryId: "long-1",
  teamName: longName,
  opponentName: "相手",
  team1: { teamName: longName, entryId: "long-1" },
  team2: { teamName: "相手", entryId: "opp-1" },
});
assert.ok(longHtml.includes(longName));
assert.match(css, /player-selected-team__name/);
assert.match(css, /overflow-wrap: anywhere/);
assert.match(css, /player-finals-confirm__submit/);

const confirmHtml = renderPlayerFinalsWinConfirmDialogInner({
  teamName: "SMA",
  opponentName: "チームB",
});
assert.match(confirmHtml, /勝利報告の確認/);
assert.match(confirmHtml, /勝者として報告するチーム/);
assert.match(confirmHtml, /SMA vs チームB/);
assert.match(confirmHtml, /SMAの勝利を確定/);
assert.equal(formatPlayerFinalsWinConfirmButtonLabel("SMA"), "SMAの勝利を確定");

for (const state of [
  PlayerFinalsMatchState.WAITING_OPPONENT,
  PlayerFinalsMatchState.ELIMINATED,
  PlayerFinalsMatchState.CHAMPION,
  PlayerFinalsMatchState.NOT_ADVANCED,
]) {
  const htmlForState = renderPlayerFinalsMatchPanel({
    state,
    teamName: "SMA",
    message:
      state === PlayerFinalsMatchState.WAITING_OPPONENT
        ? PLAYER_FINALS_WAITING_OPPONENT_MESSAGE
        : state === PlayerFinalsMatchState.ELIMINATED
          ? PLAYER_FINALS_ELIMINATED_MESSAGE
          : state === PlayerFinalsMatchState.CHAMPION
            ? "優勝"
            : PLAYER_FINALS_NOT_ADVANCED_MESSAGE,
  });
  assert.doesNotMatch(htmlForState, /data-action="report-win"/);
  assert.equal(canShowPlayerFinalsWinReportButton(state), false);
}

const generated = buildSingleEliminationBracket({
  entries: [
    { entryId: "se-a", teamName: "SE-A" },
    { entryId: "se-b", teamName: "SE-B" },
    { entryId: "se-c", teamName: "SE-C" },
  ],
  random: () => 0.2,
});
const bracket = buildPersistedSingleEliminationBracket(generated);
const byeMatch = listByeMatchesNeedingResults(bracket)[0];
const byeWinner = getByeWinnerTeam(byeMatch.team1, byeMatch.team2);
const before = resolvePlayerFinalsMatchView({
  entryId: byeWinner.entryId,
  tournament: {
    status: TournamentStatus.OPEN,
    participantResultEntryEnabled: true,
    tournamentFormat: TournamentFormat.SINGLE_ELIMINATION,
  },
  bracket,
  resultsMap: new Map(),
});
assert.notEqual(before.matchId, byeMatch.matchId);
assert.notEqual(before.state, PlayerFinalsMatchState.PLAYABLE);
const byePanel = renderPlayerFinalsMatchPanel({
  state: before.state,
  teamName: byeWinner.teamName,
  message: before.message,
});
assert.doesNotMatch(byePanel, /data-action="report-win"/);

console.log("player-finals-win-report-identity-ui.test.mjs: all passed");
