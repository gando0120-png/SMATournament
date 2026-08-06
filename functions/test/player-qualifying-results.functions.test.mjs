/**
 * プレイヤー提出 Functions ロジック（純関数寄り）テスト
 */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";

function hashTeamToken(token) {
  return createHash("sha256").update(String(token), "utf8").digest("hex");
}

function generateTeamToken() {
  return randomBytes(24).toString("base64url");
}

const a = generateTeamToken();
const b = generateTeamToken();
assert.notEqual(a, b);
assert.equal(hashTeamToken(a).length, 64);
assert.equal(hashTeamToken(a), hashTeamToken(a));
assert.notEqual(hashTeamToken(a), hashTeamToken(b));

console.log("player-qualifying-results.functions.test.mjs: all passed");
