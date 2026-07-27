/**
 * 決勝トーナメント表ページ初期化 smoke テスト
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isValidTournamentId } from "../../js/domain/validators.js";
import { classifyError, InvalidTournamentIdError } from "../../js/lib/errors.js";
import {
  BRACKET_SIZES,
  buildFinalsBracket,
  buildPersistedFinalsBracket,
} from "../../js/domain/finals-bracket.js";
import {
  buildPersistedSingleEliminationBracket,
  buildSingleEliminationBracket,
  isSingleEliminationBracket,
} from "../../js/domain/single-elimination-bracket.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const bracketPageSource = readFileSync(
  resolve(__dirname, "../../js/ui/pages/tournament-finals-bracket-page.js"),
  "utf8"
);

assert.match(bracketPageSource, /let tournamentId = null;/);
assert.match(
  bracketPageSource,
  /const openResultsPageBtn = document\.getElementById\("openResultsPageBtn"\)/
);
assert.match(bracketPageSource, /import\s*\{[^}]*isValidTournamentId[^}]*\}\s*from/);

function simulateInitBracketPage(search) {
  const params = new URLSearchParams(search);
  const id = params.get("id");
  if (!isValidTournamentId(id)) {
    return { ok: false, reason: "invalid-id" };
  }
  return {
    ok: true,
    tournamentId: id,
    dashboardHref: `tournament-dashboard.html?id=${encodeURIComponent(id)}`,
    matchHref: `tournament-finals-match.html?id=${encodeURIComponent(id)}&matchId=final-r1-m1`,
  };
}

const validId = "ACMYFRu24Tr6B5kIZrNv";
assert.doesNotThrow(() => simulateInitBracketPage(`id=${validId}`));
const initResult = simulateInitBracketPage(`id=${validId}`);
assert.equal(initResult.ok, true);
assert.equal(initResult.tournamentId, validId);

assert.equal(simulateInitBracketPage("").ok, false);
assert.equal(simulateInitBracketPage("id=").ok, false);
assert.equal(simulateInitBracketPage("id=bad id").ok, false);

assert.match(classifyError(new InvalidTournamentIdError()).message, /大会/);

for (const size of BRACKET_SIZES) {
  const qualifiers = Array.from({ length: size }, (_, index) => ({
    entryId: `e-${index + 1}`,
    teamName: `Team ${index + 1}`,
    seed: index + 1,
    blockId: "A",
    blockName: "A",
    source: "block_winner",
  }));
  const bracket = buildPersistedFinalsBracket(buildFinalsBracket(qualifiers));
  assert.equal(bracket.bracketSize, size);
  assert.ok(Array.isArray(bracket.matches) && bracket.matches.length > 0);
}

const singleElimEntries = [
  { entryId: "e-1", teamName: "Team 1" },
  { entryId: "e-2", teamName: "Team 2" },
  { entryId: "e-3", teamName: "Team 3" },
];
const singleElimBracket = buildPersistedSingleEliminationBracket(
  buildSingleEliminationBracket({ entries: singleElimEntries, random: () => 0.5 })
);
assert.equal(isSingleEliminationBracket(singleElimBracket), true);
assert.equal(singleElimBracket.finalized, true);

assert.match(bracketPageSource, /if\s*\(!isValidTournamentId\(tournamentId\)\)/);
assert.match(bracketPageSource, /showPageError\(message\)/);
assert.match(bracketPageSource, /console\.error\("\[finals-bracket\] loadPage failed", error\)/);
assert.match(bracketPageSource, /console\.error\("\[finals-bracket\] init failed", error\)/);
assert.match(
  bracketPageSource,
  /catch\s*\(error\)[\s\S]*showPageError/
);

console.log("tournament-finals-bracket-init.smoke.mjs: all passed");
