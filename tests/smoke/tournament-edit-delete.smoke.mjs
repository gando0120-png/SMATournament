/**
 * 大会編集・論理削除 smoke test（ドメイン・Rules 定義の回帰）
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  filterActiveTournaments,
  isTournamentDeleted,
} from "../../js/domain/tournament-deletion.js";
import {
  isTournamentStructureLocked,
  STRUCTURE_LOCK_FIELD_KEYS,
} from "../../js/domain/tournament-structure-lock.js";
import { isEntryOpenForTournament } from "../../js/lib/entry-open.js";
import { isPublicViewEnabled } from "../../js/domain/public-tournament-view.js";
import { TournamentStatus } from "../../js/domain/constants.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dashboardHtml = readFileSync(resolve(__dirname, "../../tournament-dashboard.html"), "utf8");
const dashboardJs = readFileSync(
  resolve(__dirname, "../../js/ui/pages/tournament-dashboard-page.js"),
  "utf8"
);
const rules = readFileSync(resolve(__dirname, "../../firestore.rules"), "utf8");

assert.match(dashboardHtml, /tournament-dashboard-page\.js\?v=6/);
assert.doesNotMatch(dashboardHtml, /tournament-dashboard-boot\.js/);
assert.match(dashboardHtml, /dashboard-tournament-actions hidden/);
assert.match(dashboardJs, /initTournamentManageGuard\(/);
assert.match(dashboardJs, /runDashboardFirestoreProbe/);
assert.match(dashboardJs, /loadOptionalSubcollections/);
assert.match(dashboardJs, /一部の大会情報を読み込めませんでした/);
assert.doesNotMatch(dashboardJs, /ensureTournamentStructureLocked/);
assert.match(rules, /canManageTournamentRead\(\)/);
assert.match(rules, /isPublicTournamentGet\(\)/);
assert.match(rules, /function isEntryOpenFromData/);

assert.equal(isTournamentDeleted({ isDeleted: true }), true);
assert.equal(isTournamentDeleted({ isDeleted: false }), false);
assert.equal(isTournamentDeleted({}), false);

assert.deepEqual(
  filterActiveTournaments([
    { id: "a", isDeleted: true },
    { id: "b", status: "open" },
  ]).map((t) => t.id),
  ["b"]
);

assert.equal(
  isTournamentStructureLocked({}, { hasEntries: true }),
  true
);
assert.equal(
  isTournamentStructureLocked({ structureLocked: true }, {}),
  true
);
assert.equal(
  isTournamentStructureLocked({}, { hasBlockDraw: true }),
  true
);
assert.equal(
  isTournamentStructureLocked({}, { hasEntries: false, hasBlockDraw: false }),
  false
);
assert.deepEqual(STRUCTURE_LOCK_FIELD_KEYS, ["maxTeams", "teamSize", "preferredBlockSize"]);

assert.equal(
  isEntryOpenForTournament({ status: TournamentStatus.OPEN, isDeleted: true }),
  false
);
assert.equal(isPublicViewEnabled({ publicViewEnabled: true, isDeleted: true }), false);

console.log("tournament-edit-delete.smoke: all tests passed");
