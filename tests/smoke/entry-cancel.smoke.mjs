/**
 * 参加辞退 UI / service / rules スモーク
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");

function read(relativePath) {
  return readFileSync(resolve(root, relativePath), "utf8");
}

const entriesPage = read("js/ui/pages/tournament-entries-page.js");
assert.match(entriesPage, /cancelConfirmedEntry/);
assert.match(entriesPage, /参加辞退/);
assert.match(entriesPage, /参加辞退する/);
assert.match(entriesPage, /エントリー記録自体は削除されません/);
assert.match(entriesPage, /entry\.status === EntryStatus\.CANCELLED/);
assert.match(entriesPage, /handleCancelConfirmedEntry/);
assert.match(entriesPage, /dataset\.action = "cancel-entry"/);

const entryService = read("js/services/entry-service.js");
assert.match(entryService, /export async function cancelConfirmedEntry/);
assert.match(entryService, /assertEntryCancellationAllowed/);
assert.match(entryService, /status: EntryStatus\.CANCELLED/);
assert.match(entryService, /cancelledAt: serverTimestamp\(\)/);
assert.match(entryService, /withPublicSnapshotRebuild/);
assert.match(entryService, /export async function confirmEntry/);
assert.match(entryService, /export async function updateEntryProfile/);
assert.doesNotMatch(entryService, /deleteDoc/);

const domain = read("js/domain/entry-cancellation.js");
assert.match(domain, /confirmed/);
assert.match(domain, /cancelled/);
assert.match(domain, /抽選後の参加辞退は、この画面から処理できません/);
assert.match(domain, /hasFormalDrawOrQualifyingSchedule/);

const constants = read("js/domain/constants.js");
assert.match(constants, /CANCELLED: "cancelled"/);
assert.match(constants, /キャンセル \/ 辞退済み/);
assert.doesNotMatch(constants, /withdrawn/);

const rules = read("firestore.rules");
assert.match(rules, /validEntryCancelUpdate\(tournamentId\)/);
assert.match(rules, /old\.status == 'confirmed'/);
assert.match(rules, /newData\.status == 'cancelled'/);
assert.match(rules, /validEntryConfirmUpdate\(\)/);
assert.match(rules, /validEntryProfileUpdate\(\)/);
assert.doesNotMatch(rules, /old\.status == 'cancelled'\s*\n\s*&& newData\.status == 'confirmed'/);

const css = read("css/components.css");
assert.match(css, /data-status="cancelled"/);

console.log("entry-cancel.smoke: ok");
