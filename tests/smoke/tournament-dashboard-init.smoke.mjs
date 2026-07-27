/**
 * 大会ダッシュボード初期化 smoke テスト
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isValidTournamentId } from "../../js/domain/validators.js";
import { classifyError, InvalidTournamentIdError } from "../../js/lib/errors.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dashboardSource = readFileSync(
  resolve(__dirname, "../../js/ui/pages/tournament-dashboard-page.js"),
  "utf8"
);

assert.match(
  dashboardSource,
  /import\s*\{[^}]*isValidTournamentId[^}]*\}\s*from\s*["']\.\.\/\.\.\/domain\/validators\.js["']/
);

function buildTournamentScheduleHref(id) {
  return `tournament-schedule.html?id=${encodeURIComponent(id)}`;
}

function simulateSetTournamentNavigationLinks(tournamentId) {
  if (!isValidTournamentId(tournamentId)) {
    return null;
  }

  return {
    schedule: buildTournamentScheduleHref(tournamentId),
    standings: `tournament-standings.html?id=${encodeURIComponent(tournamentId)}`,
    finals: `tournament-finals-advancement.html?id=${encodeURIComponent(tournamentId)}`,
    bracket: `tournament-finals-bracket.html?id=${encodeURIComponent(tournamentId)}`,
  };
}

const validId = "tournament-e2e-single-3";
assert.doesNotThrow(() => simulateSetTournamentNavigationLinks(validId));
const validLinks = simulateSetTournamentNavigationLinks(validId);
assert.ok(validLinks);
assert.match(validLinks.schedule, /id=tournament-e2e-single-3/);

assert.equal(simulateSetTournamentNavigationLinks(""), null);
assert.equal(simulateSetTournamentNavigationLinks(null), null);
assert.equal(simulateSetTournamentNavigationLinks("bad id"), null);

const invalidMessage = classifyError(new InvalidTournamentIdError()).message;
assert.match(invalidMessage, /大会/);

assert.match(dashboardSource, /if\s*\(!isValidTournamentId\(tournamentId\)\)/);
assert.match(dashboardSource, /showPageError\(message\)/);
assert.match(dashboardSource, /catch\s*\(error\)[\s\S]*showPageError/);

console.log("tournament-dashboard-init.smoke.mjs: all passed");
