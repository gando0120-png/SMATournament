/**
 * テスト大会一括削除 smoke テスト
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isDeletableTestTournamentName,
  isTestTournamentName,
} from "../../js/domain/test-tournament-access.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const pageSource = readFileSync(
  join(root, "js/ui/pages/test-tournament-cleanup-page.js"),
  "utf8"
);
const htmlSource = readFileSync(join(root, "test-tournament-cleanup.html"), "utf8");
const indexHtml = readFileSync(join(root, "index.html"), "utf8");
const indexPageSource = readFileSync(join(root, "js/ui/pages/index-page.js"), "utf8");

assert.match(indexHtml, /test-tournament-cleanup\.html/);
assert.match(indexHtml, /テスト大会を整理/);
assert.match(indexPageSource, /cleanupTestTournamentsBtn/);
assert.match(indexPageSource, /isOperatorEnabled/);

assert.match(htmlSource, /削除対象を確認/);
assert.match(htmlSource, /選択したテスト大会を削除/);
assert.match(htmlSource, /すべて選択/);
assert.match(htmlSource, /選択解除/);

assert.match(pageSource, /initOperatorGuard/);
assert.match(pageSource, /confirmDeleteDialog/);
assert.match(pageSource, /DELETE/);
assert.match(pageSource, /dryRunBlocked/);
assert.match(pageSource, /setBusy/);
assert.match(pageSource, /selectedIds = new Set\(\)/);
assert.match(pageSource, /summarizeCleanupExecution/);
assert.doesNotMatch(pageSource, /dev=1/);

assert.equal(isTestTournamentName("E2E"), true);
assert.equal(isTestTournamentName("通常大会"), false);
assert.equal(isDeletableTestTournamentName("SMA E2E CUP"), false);
assert.equal(isDeletableTestTournamentName("大会TEST版"), false);

console.log("test-tournament-cleanup.smoke.mjs: all passed");
