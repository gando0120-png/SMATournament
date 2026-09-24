/**
 * EmergencyExport サービス／Functions が読み取り専用であること
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const serviceSource = readFileSync(join(root, "js/services/emergency-export-service.js"), "utf8");
const functionsSource = readFileSync(join(root, "functions/src/emergency-export.js"), "utf8");
const callableSource = readFileSync(join(root, "functions/index.js"), "utf8");

const writeApis = [
  "setDoc",
  "updateDoc",
  "addDoc",
  "deleteDoc",
  "writeBatch",
  "runTransaction",
  "serverTimestamp",
  "recursiveDelete",
];

for (const api of writeApis) {
  assert.equal(serviceSource.includes(api), false, `service contains ${api}`);
  assert.equal(functionsSource.includes(api), false, `functions contains ${api}`);
}

assert.match(serviceSource, /httpsCallable/);
assert.match(serviceSource, /exportEmergencyTournamentCallable/);
assert.match(serviceSource, /exportEmergencyTournamentViaCallable/);
assert.match(serviceSource, /JSON\.stringify\(exportData, null, 2\)/);
assert.doesNotMatch(serviceSource, /createCustomToken|signInWithCustomToken/);
assert.doesNotMatch(serviceSource, /withPublicSnapshotRebuild/);
assert.doesNotMatch(serviceSource, /publicSnapshot/);

assert.match(functionsSource, /assertOperatorEnabled/);
assert.match(functionsSource, /buildEmergencyExport/);
assert.match(functionsSource, /大会が見つかりません/);
assert.match(callableSource, /exportEmergencyTournamentCallable/);
assert.match(callableSource, /requireAuth/);

assert.match(serviceSource, /downloadEmergencyOpsExcel/);
assert.match(serviceSource, /buildEmergencyOpsExcelBytes/);
assert.match(serviceSource, /emergency-ops-excel\.js/);
assert.doesNotMatch(
  serviceSource.slice(serviceSource.indexOf("downloadEmergencyOpsExcel")),
  /setDoc|updateDoc|addDoc|deleteDoc|writeBatch|runTransaction/
);

console.log("emergency-export.service.test.mjs: all passed");
