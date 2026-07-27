/**
 * 運営者・大会所有者判定 smoke test
 */
import assert from "node:assert/strict";
import {
  canManageTournament,
  isOperatorEnabledRecord,
  isTournamentOwner,
} from "../../js/domain/tournament-access.js";

assert.equal(isTournamentOwner({ createdBy: "uid-a" }, "uid-a"), true);
assert.equal(isTournamentOwner({ createdBy: "uid-a" }, "uid-b"), false);
assert.equal(isOperatorEnabledRecord({ enabled: true }), true);
assert.equal(isOperatorEnabledRecord({ enabled: false }), false);
assert.equal(isOperatorEnabledRecord({ email: "a@b.c" }), false);
assert.equal(
  canManageTournament({ createdBy: "owner" }, "owner", null),
  true
);
assert.equal(
  canManageTournament({ createdBy: "owner" }, "other", { enabled: true }),
  true
);
assert.equal(
  canManageTournament({ createdBy: "owner" }, "other", { enabled: false }),
  false
);

console.log("operator-access.smoke: all tests passed");
