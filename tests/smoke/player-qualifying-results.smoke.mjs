/**
 * プレイヤー予選結果入力 smoke
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

const html = readFileSync(join(root, "player-results.html"), "utf8");
const page = readFileSync(join(root, "js/ui/pages/player-results-page.js"), "utf8");
const dashboardHtml = readFileSync(join(root, "tournament-dashboard.html"), "utf8");
const dashboardPage = readFileSync(join(root, "js/ui/pages/tournament-dashboard-page.js"), "utf8");
const schedulePage = readFileSync(join(root, "js/ui/pages/tournament-schedule-page.js"), "utf8");
const functionsIndex = readFileSync(join(root, "functions/index.js"), "utf8");
const rules = readFileSync(join(root, "firestore.rules"), "utf8");
const domain = readFileSync(join(root, "js/domain/player-qualifying-submission.js"), "utf8");
const dialog = readFileSync(join(root, "js/ui/components/match-result-dialog.js"), "utf8");

assert.match(html, /予選結果入力/);
assert.match(html, /teamSearchInput/);
assert.match(html, /teamChoiceList/);
assert.match(html, /チーム番号またはチーム名/);
assert.match(page, /listPlayerTeamChoices/);
assert.match(page, /listMyQualifyingMatches/);
assert.match(page, /submitPlayerQualifyingResult/);
assert.match(page, /filterPlayerTeamChoices/);
assert.match(page, /teamNumber/);
assert.match(page, /playerOwnSideResultDialog/);
assert.match(html, /チームを選び直す/);
assert.match(html, /チームを選択してください/);
assert.match(dialog, /playerOwnSideResultDialog/);
assert.match(dialog, /set1OwnScore/);
assert.doesNotMatch(page, /data-entry-id/);
assert.doesNotMatch(html, /data-entry-id/);

assert.match(dashboardHtml, /participantResultEntrySelect/);
assert.match(dashboardHtml, /playerCommonUrlPanel/);
assert.match(dashboardHtml, /copyPlayerCommonUrlBtn/);
assert.doesNotMatch(dashboardHtml, /issuePlayerTokensBtn/);
assert.match(dashboardPage, /updateParticipantResultEntryEnabled/);
assert.match(dashboardPage, /buildTournamentPlayerResultsUrl/);
assert.match(dashboardPage, /renderPlayerCommonUrl/);

assert.match(schedulePage, /listMatchReconciliations/);
assert.match(schedulePage, /getOperatorReconciliationLabel/);
assert.match(schedulePage, /markReconciliationOperatorResolved/);

assert.match(functionsIndex, /submitPlayerQualifyingResultCallable/);
assert.match(functionsIndex, /listMyQualifyingMatchesCallable/);
assert.match(functionsIndex, /listPlayerTeamChoicesCallable/);
assert.match(functionsIndex, /set1OwnScore/);
assert.match(functionsIndex, /teamNumber/);
// 後方互換: token callable は残す
assert.match(functionsIndex, /issueEntryAccessTokensCallable/);

assert.match(rules, /qualifyingResultSubmissions/);
assert.match(rules, /entryAccessTokens/);
assert.match(rules, /validParticipantResultEntryUpdate/);

assert.match(domain, /reconcileSubmissions/);
assert.match(domain, /combineOneSidedSubmissions/);
assert.match(domain, /normalizeTeamNumber/);
assert.match(domain, /buildPlayerTeamChoices/);
assert.match(domain, /filterPlayerTeamChoices/);
assert.match(domain, /buildTournamentPlayerResultsUrl/);
assert.match(domain, /ENTRY_ACCESS_TOKENS_COLLECTION/);

const css = readFileSync(join(root, "css/components.css"), "utf8");
assert.match(css, /\.team-choice-list/);
assert.match(css, /\.team-choice-item/);

console.log("player-qualifying-results.smoke.mjs: all passed");
