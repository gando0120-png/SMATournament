/**
 * 緊急運営用 Excel（予選脱出 Sprint 1.5）domain tests
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildEmergencyExport } from "../../js/domain/emergency-export.js";

/** minimal-xlsx の store ZIP を読む（無圧縮想定） */
function unzipStore(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = {};
  let offset = 0;
  while (offset + 4 <= bytes.length) {
    const sig = view.getUint32(offset, true);
    if (sig !== 0x04034b50) {
      break;
    }
    const method = view.getUint16(offset + 8, true);
    const compSize = view.getUint32(offset + 18, true);
    const nameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const name = new TextDecoder().decode(bytes.subarray(nameStart, nameStart + nameLen));
    const dataStart = nameStart + nameLen + extraLen;
    if (method !== 0) {
      throw new Error(`unexpected zip method ${method} for ${name}`);
    }
    out[name] = bytes.subarray(dataStart, dataStart + compSize);
    offset = dataStart + compSize;
  }
  return out;
}
import {
  EMERGENCY_OPS_EXCEL_ERROR_NOTICE_JA,
  EMERGENCY_OPS_EXCEL_NOTICE_JA,
  EMERGENCY_OPS_RANKING_RULES_JA,
  EMERGENCY_OPS_STANDINGS_GUIDE_JA,
  buildEmergencyOpsExcelBytes,
  buildEmergencyOpsExcelFileName,
  buildEmergencyOpsExcelModel,
  collectEmergencyOpsExcelForbiddenHits,
  projectEmergencyOpsStandings,
} from "../../js/domain/emergency-ops-excel.js";
import { EMERGENCY_EXPORT_FORBIDDEN_KEYS } from "../../js/domain/emergency-export-schema.js";
import { buildQualifyingStandings } from "../../js/domain/qualifying-standings.js";
import { validateMatchResultInput } from "../../js/domain/qualifying-match-result.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

const MID = {
  m1: "qualifying-A-R1-M1",
  m2: "qualifying-A-R2-M1",
  m3: "qualifying-A-R3-M1",
};

function makeSchedule() {
  return {
    finalized: true,
    blockCount: 1,
    totalMatchCount: 3,
    blocks: [
      {
        blockId: "A",
        blockName: "Aブロック",
        teamCount: 3,
        teams: [
          { symbol: "A1", entryId: "e1", teamName: "チーム甲" },
          { symbol: "A2", entryId: "e2", teamName: "チーム乙" },
          { symbol: "A3", entryId: "e3", teamName: "チーム丙" },
        ],
        rounds: [
          {
            roundNumber: 1,
            byes: [],
            matches: [
              {
                matchId: MID.m1,
                roundNumber: 1,
                matchNumber: 1,
                courtNumber: 1,
                team1: { symbol: "A1", entryId: "e1", teamName: "チーム甲" },
                team2: { symbol: "A2", entryId: "e2", teamName: "チーム乙" },
                status: "waiting",
              },
            ],
          },
          {
            roundNumber: 2,
            byes: [],
            matches: [
              {
                matchId: MID.m2,
                roundNumber: 2,
                matchNumber: 1,
                courtNumber: 2,
                team1: { symbol: "A1", entryId: "e1", teamName: "チーム甲" },
                team2: { symbol: "A3", entryId: "e3", teamName: "チーム丙" },
                status: "waiting",
              },
            ],
          },
          {
            roundNumber: 3,
            byes: [],
            matches: [
              {
                matchId: MID.m3,
                roundNumber: 3,
                matchNumber: 1,
                courtNumber: 1,
                team1: { symbol: "A2", entryId: "e2", teamName: "チーム乙" },
                team2: { symbol: "A3", entryId: "e3", teamName: "チーム丙" },
                status: "waiting",
              },
            ],
          },
        ],
      },
    ],
  };
}

function finishedFromScores(matchId, team1, team2, scores) {
  const validated = validateMatchResultInput({
    set1Team1Score: scores.s1a,
    set1Team2Score: scores.s1b,
    set2Team1Score: scores.s2a,
    set2Team2Score: scores.s2b,
  });
  assert.equal(validated.valid, true, validated.errorJa || "invalid fixture scores");
  return {
    matchId,
    blockId: "A",
    roundNumber: Number(String(matchId).match(/R(\d+)/)?.[1] || 1),
    courtNumber: 1,
    team1: { entryId: team1.entryId, teamName: team1.teamName },
    team2: { entryId: team2.entryId, teamName: team2.teamName },
    sets: validated.data.sets,
    team1Stats: validated.data.team1Stats,
    team2Stats: validated.data.team2Stats,
    status: "finished",
  };
}

function makeEscapeFinished() {
  return finishedFromScores(
    MID.m1,
    { entryId: "e1", teamName: "チーム甲" },
    { entryId: "e2", teamName: "チーム乙" },
    { s1a: 50, s1b: 20, s2a: 50, s2b: 30 }
  );
}

function buildSampleExport() {
  return buildEmergencyExport({
    tournamentId: "tour-demo",
    projectId: "demo",
    exportedAt: new Date("2026-09-24T03:00:00.000Z"),
    tournament: {
      id: "tour-demo",
      name: "緊急Excel検証大会",
      status: "open",
      eventDate: "2026-09-24",
    },
    entries: [
      { id: "e1", teamName: "チーム甲", status: "confirmed", teamNumber: 1 },
      { id: "e2", teamName: "チーム乙", status: "confirmed", teamNumber: 2 },
      { id: "e3", teamName: "チーム丙", status: "confirmed", teamNumber: 3 },
    ],
    blockDraw: { status: "finalized", blocks: [{ blockId: "A", entryIds: ["e1", "e2", "e3"] }] },
    qualifyingSchedule: makeSchedule(),
    qualifyingMatchResults: new Map([[MID.m1, makeEscapeFinished()]]),
    qualifyingMatchSessions: new Map(),
    qualifyingMatchReconciliations: {
      [MID.m2]: {
        matchId: MID.m2,
        state: "awaiting_opponent",
        submissions: {
          team1EntryId: "e1",
          team2EntryId: "e3",
          team1Submitted: true,
          team2Submitted: false,
        },
      },
    },
    qualifyingResultSubmissions: {},
  });
}

function sheetByName(model, name) {
  return model.sheets.find((sheet) => sheet.name === name);
}

function situationMap(model) {
  return Object.fromEntries(sheetByName(model, "大会状況").rows.filter((row) => row[0]));
}

function standingByEntry(standingsDoc, entryId) {
  for (const block of standingsDoc.blocks || []) {
    for (const standing of block.standings || []) {
      if (standing.entryId === entryId) {
        return standing;
      }
    }
  }
  return null;
}

const exportDoc = buildSampleExport();
const model = buildEmergencyOpsExcelModel(exportDoc);

{
  assert.equal(model.meta.tournamentId, exportDoc.exportMeta.tournamentId);
  assert.equal(model.meta.tournamentName, exportDoc.exportMeta.tournamentName);
  assert.equal(model.meta.schemaVersion, exportDoc.exportMeta.schemaVersion);
  assert.deepEqual(
    model.sheets.map((sheet) => sheet.name),
    ["大会状況", "予選対戦表", "現在順位", "未消化試合", "決勝進出", "決勝トーナメント", "_決勝集計", "_集計"]
  );
  assert.equal(sheetByName(model, "_集計").hidden, true);
}

{
  const asMap = situationMap(model);
  assert.equal(asMap["注意"], EMERGENCY_OPS_EXCEL_NOTICE_JA);
  assert.equal(asMap["大会名"], "緊急Excel検証大会");
  assert.equal(asMap["tournamentId"], "tour-demo");
  assert.equal(asMap["順位計算ルール"], EMERGENCY_OPS_RANKING_RULES_JA);
  assert.equal(Number(asMap["確定参加チーム数"]), exportDoc.derived.confirmedEntries.length);
  assert.equal(Number(asMap["予選総試合数"]), 3);
  assert.equal(Number(asMap["脱出時点終了試合数"]), 1);
  assert.equal(Number(asMap["予選未消化試合数"]), 2);
  assert.equal(asMap["Excel切替後入力試合数"].formula.includes("COUNTIFS"), true);
  assert.equal(asMap["現在終了試合数"].formula.includes("SUM"), true);
  assert.match(String(asMap["予選完了フラグ"].formula), /予選試合終了・順位確定待ち/);
  assert.match(String(asMap["予選完了フラグ"].formula), /予選完了：決勝進出処理へ進めます/);
  assert.equal(asMap["予選完了フラグ"].value, "予選未完了");
  assert.equal(asMap["決勝進出判定が確定済みか"], "いいえ");
  assert.equal(Number(asMap["integrity ERROR件数"]), 0);
}

{
  const ledger = sheetByName(model, "予選対戦表");
  assert.equal(ledger.rows.length - 1, exportDoc.derived.matchDisplayStates.length);
  const finished = ledger.rows[1];
  assert.equal(finished[0], MID.m1);
  assert.equal(finished[5], "チーム甲");
  assert.equal(finished[11], "脱出前確定");
  assert.equal(finished[12], 50);
  assert.equal(finished[13], 20);
  assert.equal(finished[14], 50);
  assert.equal(finished[15], 30);
  assert.equal(finished[16], 2);
  assert.equal(finished[24], 1);
  assert.equal(finished[26], "チーム甲");

  const openLinked = ledger.rows[2];
  assert.equal(openLinked[0], MID.m2);
  assert.equal(openLinked[11], "Excel連動");
  assert.equal(openLinked[12].formula, "'未消化試合'!N2");
  assert.equal(openLinked[24].formula.includes("Excel確定"), true);
  assert.match(String(openLinked[27]), /選手提出・非正式/);
}

{
  const open = sheetByName(model, "未消化試合");
  assert.equal(open.rows.length - 1, 2);
  assert.ok(open.inputCells.some((cell) => cell.row === 1 && cell.col === 13));
  const first = open.rows[1];
  assert.equal(first[1], MID.m2);
  assert.equal(first[6], "チーム甲");
  assert.match(String(first[12]), /Team A submitted/);
  assert.match(String(first[12]), /非正式/);
  assert.equal(first[13], "");
  assert.equal(first[14], "");
  assert.equal(first[17].formula.includes("片側"), true);
  assert.equal(first[27].formula.includes("Excel確定"), true);
}

{
  const standings = sheetByName(model, "現在順位");
  assert.equal(standings.rows[0][0], "Excel運営順位（入力に応じて自動更新）");
  assert.equal(standings.rows[1][0], EMERGENCY_OPS_STANDINGS_GUIDE_JA);
  assert.equal(standings.rows[3][1], "確定順位");
  assert.equal(standings.rows[3][2], "自動順位");
  assert.equal(standings.rows[3][3], "同順位状態");
  assert.equal(standings.rows[3][4], "最終順位");
  assert.equal(standings.rows[3][5], "順位確認");
  assert.ok(standings.inputCells.some((cell) => cell.row === 4 && cell.col === 4));
  assert.ok(standings.inputCells.some((cell) => cell.row === 4 && cell.col === 5));
  assert.equal(String(standings.rows[1][0]).includes("_集計"), false);
  assert.ok(standings.rows.some((row) => String(row[0]?.v || row[0]).includes("脱出時点順位")));
  const escapeHeaderIdx = standings.rows.findIndex((row) =>
    String(row[0]?.v || row[0]).includes("脱出時点順位")
  );
  assert.ok(escapeHeaderIdx > 4);
  const snapshotRow = standings.rows[escapeHeaderIdx + 2];
  const expected = exportDoc.derived.qualifyingStandings.blocks[0].standings[0];
  assert.equal(snapshotRow[14]?.v ?? snapshotRow[14], expected.entryId);
  assert.equal(snapshotRow[1]?.v ?? snapshotRow[1], expected.rank);
}

{
  const agg = sheetByName(model, "_集計");
  assert.ok(agg.rows[1][7].formula.includes("SUMIFS"));
  assert.ok(agg.rows[1][14].formula.includes("COUNTIFS"));
  assert.ok(String(agg.rows[1][19].formula).includes("同点・要モルックアウト"));
  assert.equal(!agg.inputCells || agg.inputCells.length === 0, true);
  assert.match(String(agg.rows[1][17].formula), /現在順位'!E/);
  assert.match(String(agg.rows[1][18].formula), /現在順位'!F/);
}

{
  // 1) escape時点: 1終了 / 2未消化
  const escapeOnly = projectEmergencyOpsStandings(exportDoc, {});
  assert.equal(standingByEntry(escapeOnly, "e1").playedMatches, 1);
  assert.equal(standingByEntry(escapeOnly, "e1").setWins, 2);
  assert.equal(standingByEntry(escapeOnly, "e3").playedMatches, 0);

  // 2-3) 第2試合入力で順位更新
  const afterM2 = projectEmergencyOpsStandings(exportDoc, {
    [MID.m2]: { s1a: 50, s1b: 10, s2a: 50, s2b: 20 },
  });
  assert.equal(standingByEntry(afterM2, "e1").playedMatches, 2);
  assert.equal(standingByEntry(afterM2, "e1").setWins, 4);
  assert.equal(standingByEntry(afterM2, "e3").playedMatches, 1);
  assert.ok(standingByEntry(afterM2, "e1").setWins > standingByEntry(escapeOnly, "e1").setWins);

  // 4-6) 第3試合入力 → 予選完了相当、domain と一致
  const excelInputs = {
    [MID.m2]: { s1a: 50, s1b: 10, s2a: 50, s2b: 20 },
    [MID.m3]: { s1a: 50, s1b: 5, s2a: 40, s2b: 50 },
  };
  const fullExcel = projectEmergencyOpsStandings(exportDoc, excelInputs);

  const domainResults = new Map([
    [MID.m1, makeEscapeFinished()],
    [
      MID.m2,
      finishedFromScores(
        MID.m2,
        { entryId: "e1", teamName: "チーム甲" },
        { entryId: "e3", teamName: "チーム丙" },
        excelInputs[MID.m2]
      ),
    ],
    [
      MID.m3,
      finishedFromScores(
        MID.m3,
        { entryId: "e2", teamName: "チーム乙" },
        { entryId: "e3", teamName: "チーム丙" },
        excelInputs[MID.m3]
      ),
    ],
  ]);
  const domainFull = buildQualifyingStandings(makeSchedule(), domainResults);

  for (const entryId of ["e1", "e2", "e3"]) {
    const a = standingByEntry(fullExcel, entryId);
    const b = standingByEntry(domainFull, entryId);
    assert.equal(a.rank, b.rank, entryId);
    assert.equal(a.setWins, b.setWins, entryId);
    assert.equal(a.setDraws, b.setDraws, entryId);
    assert.equal(a.totalScore, b.totalScore, entryId);
    assert.equal(a.needsMolkkyOut, b.needsMolkkyOut, entryId);
    assert.equal(a.playedMatches, 2);
  }
  assert.equal(standingByEntry(fullExcel, "e1").rank, 1);
  assert.equal(standingByEntry(fullExcel, "e2").rank, 2);
  assert.equal(standingByEntry(fullExcel, "e3").rank, 3);
}

{
  // 7) 未入力は含めない
  const none = projectEmergencyOpsStandings(exportDoc, {});
  assert.equal(standingByEntry(none, "e1").playedMatches, 1);

  // 8) 片側入力は正式結果にしない
  const oneSided = projectEmergencyOpsStandings(exportDoc, {
    [MID.m2]: { s1a: 50, s1b: 10 },
  });
  assert.equal(standingByEntry(oneSided, "e1").playedMatches, 1);
  assert.equal(standingByEntry(oneSided, "e3").playedMatches, 0);

  // 9) 不正入力（50-50）は正式結果にしない
  const invalid = projectEmergencyOpsStandings(exportDoc, {
    [MID.m2]: { s1a: 50, s1b: 50, s2a: 50, s2b: 20 },
  });
  assert.equal(standingByEntry(invalid, "e1").playedMatches, 1);

  // 11) 脱出前結果を Excel 入力で上書き・二重計上しない
  const overwriteAttempt = projectEmergencyOpsStandings(exportDoc, {
    [MID.m1]: { s1a: 0, s1b: 50, s2a: 0, s2b: 50 },
    [MID.m2]: { s1a: 50, s1b: 0, s2a: 50, s2b: 0 },
  });
  // 脱出 m1 の 2勝 + Excel m2 の 2勝 = 4。上書きされると 0+2=2 になる
  assert.equal(standingByEntry(overwriteAttempt, "e1").setWins, 4);
}

{
  // 10) 同点は勝手に確定せず needsMolkkyOut
  const tieExport = buildEmergencyExport({
    tournamentId: "tie-demo",
    projectId: "demo",
    exportedAt: new Date("2026-09-24T03:00:00.000Z"),
    tournament: { id: "tie-demo", name: "同点検証", status: "open" },
    entries: [
      { id: "e1", teamName: "チーム甲", status: "confirmed", teamNumber: 1 },
      { id: "e2", teamName: "チーム乙", status: "confirmed", teamNumber: 2 },
      { id: "e3", teamName: "チーム丙", status: "confirmed", teamNumber: 3 },
    ],
    blockDraw: { status: "finalized", blocks: [{ blockId: "A", entryIds: ["e1", "e2", "e3"] }] },
    qualifyingSchedule: makeSchedule(),
    qualifyingMatchResults: new Map([
      [
        MID.m1,
        finishedFromScores(
          MID.m1,
          { entryId: "e1", teamName: "チーム甲" },
          { entryId: "e2", teamName: "チーム乙" },
          { s1a: 50, s1b: 40, s2a: 40, s2b: 50 }
        ),
      ],
    ]),
    qualifyingMatchSessions: new Map(),
    qualifyingMatchReconciliations: {},
    qualifyingResultSubmissions: {},
  });
  const tied = projectEmergencyOpsStandings(tieExport, {
    [MID.m2]: { s1a: 50, s1b: 40, s2a: 40, s2b: 50 },
    [MID.m3]: { s1a: 50, s1b: 40, s2a: 40, s2b: 50 },
  });
  const e1 = standingByEntry(tied, "e1");
  const e2 = standingByEntry(tied, "e2");
  const e3 = standingByEntry(tied, "e3");
  assert.equal(e1.setWins, e2.setWins);
  assert.equal(e1.setDraws, e2.setDraws);
  assert.equal(e1.totalScore, e2.totalScore);
  assert.equal(e1.setWins, e3.setWins);
  assert.equal(e1.totalScore, e3.totalScore);
  assert.equal(e1.needsMolkkyOut, true);
  assert.equal(e2.needsMolkkyOut, true);
  assert.equal(e3.needsMolkkyOut, true);
}

{
  // 12) 選手提出は正式結果へ自動採用しない（reconciliation があっても Excel 未入力なら未消化）
  const withSubOnly = projectEmergencyOpsStandings(exportDoc, {});
  assert.equal(standingByEntry(withSubOnly, "e3").playedMatches, 0);
  assert.equal(standingByEntry(withSubOnly, "e1").playedMatches, 1);
}

{
  // PII / forbidden keys
  const hits = collectEmergencyOpsExcelForbiddenHits(exportDoc, model);
  assert.deepEqual(hits, []);
  const haystack = model.sheets.flatMap((sheet) => sheet.rows.flat()).map((cell) => {
    if (cell && typeof cell === "object") {
      return [cell.formula, cell.value, cell.v].filter(Boolean).join(" ");
    }
    return String(cell ?? "");
  }).join("\n");
  for (const key of EMERGENCY_EXPORT_FORBIDDEN_KEYS) {
    assert.equal(haystack.includes(`"${key}"`), false);
  }
  assert.equal(haystack.includes("@"), false);
  assert.equal(haystack.toLowerCase().includes("token"), false);
}

{
  // 15) xlsx structure / no fitToPage / hidden sheet / formulas / Japanese
  const bytes = buildEmergencyOpsExcelBytes(exportDoc);
  assert.ok(bytes instanceof Uint8Array);
  assert.ok(bytes.length > 1000);
  assert.equal(bytes[0], 0x50);
  assert.equal(bytes[1], 0x4b);
  assert.match(
    buildEmergencyOpsExcelFileName("tour-demo", "2026-09-24T03:00:00.000Z"),
    /^sma-emergency-ops-tour-demo-.*\.xlsx$/
  );

  const unzipped = unzipStore(bytes);
  const names = Object.keys(unzipped);
  assert.ok(names.includes("xl/workbook.xml"));
  assert.ok(names.includes("xl/worksheets/sheet5.xml"));
  const workbookXml = new TextDecoder().decode(unzipped["xl/workbook.xml"]);
  assert.match(workbookXml, /state="hidden"/);
  assert.match(workbookXml, /fullCalcOnLoad="1"/);
  assert.doesNotMatch(workbookXml, /vbaProject|macrosheet|xlsm/i);

  for (const sheetPath of names.filter((n) => n.startsWith("xl/worksheets/"))) {
    const xml = new TextDecoder().decode(unzipped[sheetPath]);
    assert.doesNotMatch(xml, /fitToPage|pageSetup/);
  }

  const shared = new TextDecoder().decode(unzipped["xl/sharedStrings.xml"]);
  assert.match(shared, /チーム甲/);
  assert.match(shared, /脱出前確定/);
  assert.match(shared, /Excel運営順位/);

  const outDir = join(root, "tmp");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "emergency-ops-sprint1_5-sample.xlsx");
  writeFileSync(outPath, bytes);
  const roundTrip = readFileSync(outPath);
  assert.equal(roundTrip[0], 0x50);
  assert.equal(roundTrip[1], 0x4b);
}

{
  const withError = structuredClone(exportDoc);
  withError.derived.integrityChecks = {
    ok: false,
    errorCount: 1,
    warningCount: 0,
    items: [
      {
        code: "ENTRY_MISSING_FOR_SCHEDULE",
        severity: "ERROR",
        scope: "schedule",
        messageJa: "対戦表に存在しない entry があります。",
        refs: {},
      },
    ],
  };
  const errorModel = buildEmergencyOpsExcelModel(withError);
  const asMap = situationMap(errorModel);
  assert.equal(asMap["整合性注意"], EMERGENCY_OPS_EXCEL_ERROR_NOTICE_JA);
  assert.equal(Number(asMap["integrity ERROR件数"]), 1);
}


{
  // Sprint 1.6: 表側だけで同点確定できる構造
  const standings = sheetByName(model, "現在順位");
  assert.match(String(standings.rows[4][1].formula), /要確認|_集計.*!T/);
  assert.match(String(standings.rows[4][6].formula), /要確認:最終順位未入力/);
  assert.match(String(standings.rows[4][6].formula), /要確認:最終順位重複/);
  assert.match(String(standings.rows[4][3].formula), /要モルックアウト/);
  const agg = sheetByName(model, "_集計");
  assert.equal(agg.hidden, true);
  assert.equal(!agg.inputCells || agg.inputCells.length === 0, true);
}

{
  // styles.xml has Normal style
  const bytes = buildEmergencyOpsExcelBytes(exportDoc);
  const unzipped = unzipStore(bytes);
  const styles = new TextDecoder().decode(unzipped["xl/styles.xml"]);
  assert.match(styles, /cellStyle name="Normal"/);
  assert.match(styles, /cellStyleXfs count="1"/);
  assert.doesNotMatch(styles, /<cellStyleXfs count="1"><xf\/>/);
}

console.log("emergency-ops-excel.test.mjs: all passed");
