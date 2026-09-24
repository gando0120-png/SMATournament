/**
 * ダッシュボード非常データ / 緊急運営 Excel UI 配線
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

function read(rel) {
  return readFileSync(join(root, rel), "utf8");
}

const html = read("tournament-dashboard.html");
const pageJs = read("js/ui/pages/tournament-dashboard-page.js");
const service = read("js/services/emergency-export-service.js");
const css = read("css/components.css");

assert.match(html, /id="emergencyExportBtn"/);
assert.match(html, /非常データを保存（JSON）/);
assert.match(html, /非常データ（JSON）を保存します/);
assert.match(html, /data-section="info"/);

const infoBlock = html.match(
  /<details class="dashboard-section" data-section="info"[\s\S]*?<\/details>/
);
assert.ok(infoBlock, "大会情報セクションが必要");
assert.match(infoBlock[0], /id="emergencyExportBtn"/);
assert.match(infoBlock[0], /id="editTournamentBtn"/);
assert.doesNotMatch(infoBlock[0], /id="blockDrawBtn"/);

assert.match(pageJs, /exportEmergencyTournamentViaCallable/);
assert.match(pageJs, /downloadEmergencyExportJson/);
assert.match(pageJs, /handleEmergencyExport/);
assert.match(pageJs, /非常データ（JSON）を作成中/);
assert.match(pageJs, /非常データ（JSON）を保存しました/);
assert.match(pageJs, /運営者権限がありません/);
assert.match(pageJs, /ログイン状態を確認してください/);
assert.match(
  pageJs,
  /const emergencyOpsExcelBtn = document\.getElementById\("emergencyOpsExcelBtn"\)/
);
assert.doesNotMatch(pageJs, /createCustomToken|signInWithCustomToken/);
assert.doesNotMatch(pageJs, /error\.stack/);

assert.match(service, /httpsCallable/);
assert.match(service, /exportEmergencyTournamentCallable/);
assert.match(service, /JSON\.stringify\(exportData, null, 2\)/);
assert.match(service, /link\.download = fileName/);
assert.doesNotMatch(service, /setDoc|updateDoc|addDoc|deleteDoc|writeBatch|runTransaction/);

assert.match(css, /#emergencyExportBtn/);
assert.match(css, /overflow-wrap:\s*anywhere/);

assert.match(html, /id="emergencyOpsExcelBtn"/);
assert.match(html, /緊急運営用Excelを保存（XLSX）/);
assert.match(html, /手動運営へ切り替えるためのExcelを保存します/);
assert.match(html, /非常データを保存（JSON）/);
assert.match(infoBlock[0], /id="emergencyOpsExcelBtn"/);

assert.match(pageJs, /downloadEmergencyOpsExcel/);
assert.match(pageJs, /handleEmergencyOpsExcel/);
assert.match(pageJs, /緊急運営用Excelを作成中/);
assert.match(pageJs, /緊急運営用Excel（XLSX）を保存しました/);
assert.match(pageJs, /非常データを保存（JSON）/);

assert.match(service, /downloadEmergencyOpsExcel/);
assert.match(service, /buildEmergencyOpsExcelBytes/);
assert.match(service, /emergency-ops-excel\.js/);
assert.doesNotMatch(
  service.slice(service.indexOf("downloadEmergencyOpsExcel")),
  /setDoc|updateDoc|addDoc|deleteDoc|writeBatch|runTransaction/
);

assert.match(css, /#emergencyOpsExcelBtn/);

console.log("emergency-export-ui.smoke.mjs: all passed");
