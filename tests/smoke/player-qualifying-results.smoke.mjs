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

assert.match(html, /予選結果入力/);
assert.match(page, /listMyQualifyingMatches/);
assert.match(page, /submitPlayerQualifyingResult/);
assert.match(page, /teamToken/);

assert.match(dashboardHtml, /participantResultEntrySelect/);
assert.match(dashboardHtml, /issuePlayerTokensBtn/);
assert.match(dashboardPage, /updateParticipantResultEntryEnabled/);
assert.match(dashboardPage, /issueEntryAccessTokens/);

assert.match(schedulePage, /listMatchReconciliations/);
assert.match(schedulePage, /getOperatorReconciliationLabel/);
assert.match(schedulePage, /markReconciliationOperatorResolved/);

assert.match(functionsIndex, /submitPlayerQualifyingResultCallable/);
assert.match(functionsIndex, /listMyQualifyingMatchesCallable/);
assert.match(functionsIndex, /issueEntryAccessTokensCallable/);

assert.match(rules, /qualifyingResultSubmissions/);
assert.match(rules, /entryAccessTokens/);
assert.match(rules, /validParticipantResultEntryUpdate/);

assert.match(domain, /reconcileSubmissions/);
assert.match(domain, /ENTRY_ACCESS_TOKENS_COLLECTION/);

console.log("player-qualifying-results.smoke.mjs: all passed");
