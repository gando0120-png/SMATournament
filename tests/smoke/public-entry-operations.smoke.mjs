/**
 * 公開エントリー Firestore 操作のスモークテスト（パス・Rules 照合メモ）
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rules = readFileSync(resolve(__dirname, "../../firestore.rules"), "utf8");

assert.match(rules, /allow get: if canManageTournament\(tournamentId\)/);
assert.match(rules, /allow create: if validPublicEntryCreate\(\)/);
assert.match(rules, /allow get, list: if canManageTournament\(tournamentId\)/);
assert.match(rules, /function isEntryOpen\(tournamentId\)/);
assert.match(rules, /function hasOpenEntryDeadline\(t\)/);
assert.match(rules, /t\.entryDeadline == null/);
assert.match(rules, /t\.entryDeadline is timestamp/);
assert.match(rules, /t\.status == 'open'/);
assert.match(rules, /function validEntryEmail\(\)/);
assert.match(rules, /validEntryEmail\(\)/);
assert.match(rules, /optionalEntryString\('member4'\)/);
assert.match(rules, /data\.status == 'pending'/);
assert.match(rules, /data\.createdAt == request\.time/);

console.log("public-entry-operations.smoke: all tests passed");
