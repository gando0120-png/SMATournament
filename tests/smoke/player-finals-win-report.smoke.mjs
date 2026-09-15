/**
 * 決勝勝利報告 UI smoke
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

const html = readFileSync(join(root, "player-results.html"), "utf8");
const page = readFileSync(join(root, "js/ui/pages/player-results-page.js"), "utf8");
const functionsIndex = readFileSync(join(root, "functions/index.js"), "utf8");
const fnImpl = readFileSync(join(root, "functions/src/player-finals-win-report.js"), "utf8");
const domain = readFileSync(join(root, "js/domain/player-finals-win-report.js"), "utf8");
const matchPage = readFileSync(join(root, "js/ui/pages/tournament-finals-match-page.js"), "utf8");
const resultService = readFileSync(join(root, "js/services/finals-match-result-service.js"), "utf8");
const publicView = readFileSync(join(root, "js/domain/public-tournament-view.js"), "utf8");

assert.match(html, /予選結果入力/);
assert.match(html, /reloadMatchesBtn/);
assert.match(html, /viewport-fit=cover/);
assert.match(page, /listMyQualifyingMatches/);
assert.match(page, /submitPlayerQualifyingResult/);
assert.match(page, /listMyCurrentFinalsMatch/);
assert.match(page, /reportMyFinalsWin/);
assert.match(page, /PlayerFinalsPageMode/);
assert.match(page, /勝利を報告/);
assert.match(page, /勝利報告の確認/);
assert.match(page, /勝利を確定する/);
assert.match(page, /confirmBtn.disabled = true/);
assert.match(page, /payload.message/);
assert.match(domain, /決勝トーナメント敗退/);
assert.match(domain, /優勝/);
assert.match(domain, /予選終了/);
assert.match(domain, /次の対戦相手の決定をお待ちください/);
assert.match(domain, /PLAYER_FINALS_WIN_REPORT_SOURCE/);

assert.match(page, /getUserFacingError/);
assert.match(page, /UserFacingErrorContext.PLAYER_SUBMIT/);
assert.doesNotMatch(page, /winnerEntryId/);
assert.doesNotMatch(page, /setInterval/);

assert.match(functionsIndex, /listMyCurrentFinalsMatchCallable/);
assert.match(functionsIndex, /reportMyFinalsWinCallable/);
assert.match(fnImpl, /runTransaction/);
assert.match(fnImpl, /rebuildPublicSnapshotAdmin/);
assert.match(fnImpl, /resolved\.entryId/);
assert.doesNotMatch(fnImpl, /consolationMatchResults/);

assert.match(domain, /PLAYER_FINALS_WIN_REPORT_SOURCE/);
assert.match(domain, /resolveReportWinnerEntryId/);
assert.match(matchPage, /detail.isPlayerWinReport/);
assert.match(matchPage, /勝利報告/);
assert.match(resultService, /deleteField\(\)/);
assert.match(resultService, /reportedByEntryId: deleteField/);
assert.match(publicView, /player_win_report/);
assert.match(publicView, /勝利報告/);

console.log("player-finals-win-report.smoke.mjs: all passed");
