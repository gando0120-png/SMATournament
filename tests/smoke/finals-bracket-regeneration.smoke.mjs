/**
 * 決勝トーナメント再生成 smoke
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const page = readFileSync(join(root, "js/ui/pages/tournament-finals-bracket-page.js"), "utf8");
const html = readFileSync(join(root, "tournament-finals-bracket.html"), "utf8");
const service = readFileSync(join(root, "js/services/finals-bracket-service.js"), "utf8");
const domain = readFileSync(join(root, "js/domain/finals-bracket-regeneration.js"), "utf8");
const rules = readFileSync(join(root, "firestore.rules"), "utf8");

assert.match(html, /id="regeneratePanel"/);
assert.match(html, /id="regenerateBracketBtn"/);
assert.match(html, /トーナメントを再生成する/);

assert.match(page, /regenerateFinalsBracket/);
assert.match(page, /handleRegenerateBracket/);
assert.match(page, /renderRegeneratePanel/);
assert.match(page, /assessFinalsBracketRegeneration/);

// 確定時 confirmDialog は今回まだ残す
assert.match(page, /handleFinalizeBracket/);
assert.match(page, /このシード配置で決勝トーナメントを確定します/);

assert.match(service, /export async function regenerateFinalsBracket/);
assert.match(service, /assessFinalsBracketRegeneration/);
assert.match(service, /deleteByeOnlyFinalsMatchResults/);
assert.match(service, /source:\s*"server"/);

assert.match(domain, /FinalsBracketRegenerationReasonCode/);
assert.match(domain, /HAS_PLAYED_RESULTS/);
assert.match(domain, /HAS_SESSIONS/);
assert.match(domain, /reseedLegacyQualifiersForRegeneration/);

assert.match(rules, /validFinalsBracketUpdate/);
assert.match(rules, /resource\.data\.resolution == 'bye'/);

console.log("finals-bracket-regeneration.smoke.mjs: all passed");
