/**
 * Sprint 2: 緊急運営 Excel 決勝
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildFinalsBracket } from "../../js/domain/finals-bracket.js";
import {
  buildEmergencyManualBracketFromPlacement,
  buildEmergencyFinalsMatchRows,
  listEmergencyFinalsEscapeFinishedMatchIds,
  projectEmergencyOpsFinals,
  resolveEmergencyFinalsBracket,
  resolveEmergencyFinalsSettings,
  validateEmergencyManualPlacement,
} from "../../js/domain/emergency-ops-finals.js";
import { buildEmergencyOpsFinalsSheets } from "../../js/domain/emergency-ops-finals-sheets.js";
import {
  buildEmergencyOpsExcelBytes,
  buildEmergencyOpsExcelModel,
} from "../../js/domain/emergency-ops-excel.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

function qualifiers4() {
  return [
    { entryId: "e1", teamName: "チーム甲", seed: 1, blockId: "A", blockName: "A", blockRank: 1 },
    { entryId: "e2", teamName: "チーム乙", seed: 2, blockId: "B", blockName: "B", blockRank: 1 },
    { entryId: "e3", teamName: "チーム丙", seed: 3, blockId: "C", blockName: "C", blockRank: 1 },
    { entryId: "e4", teamName: "チーム丁", seed: 4, blockId: "D", blockName: "D", blockRank: 1 },
  ];
}

function makeExport({ results = {}, withBracket = true } = {}) {
  const quals = qualifiers4();
  const built = buildFinalsBracket(quals, { expectedCount: 4 });
  assert.equal(built.valid, true, built.message);
  return {
    exportMeta: {
      tournamentId: "finals-demo",
      tournamentName: "決勝検証大会",
      schemaVersion: 1,
      exportedAt: "2026-09-24T04:00:00.000Z",
    },
    source: {
      tournament: {
        id: "finals-demo",
        name: "決勝検証大会",
        blockCount: 4,
        qualifiersPerBlock: 1,
        finalTeamCount: 4,
        winsRequired: 2,
        wildcardComparisonMode: "raw",
      },
      entries: quals.map((q) => ({
        id: q.entryId,
        teamName: q.teamName,
        status: "confirmed",
      })),
      blockDraw: null,
      qualifyingSchedule: { finalized: true, blocks: [] },
      qualifyingMatchResults: {},
      finalsAdvancement: {
        finalized: true,
        mode: "legacy",
        finalTeamCount: 4,
        qualifiers: quals,
      },
      finalsBracket: withBracket ? built.bracket : null,
      finalsMatchResults: results,
    },
    derived: {
      confirmedEntries: quals.map((q) => ({ entryId: q.entryId, teamName: q.teamName })),
      situation: {
        phase: "finals",
        phaseLabelJa: "決勝",
        qualifying: { totalMatches: 0, finishedMatches: 0, remainingMatches: 0 },
        summaryJa: "決勝",
        nextActionsJa: [],
      },
      matchDisplayStates: [],
      remainingMatches: [],
      qualifyingStandings: { blocks: [] },
      finalsAdvancementStatus: { finalized: true },
      integrityChecks: { ok: true, errorCount: 0, warningCount: 0, items: [] },
    },
  };
}

function sweep(team1Wins = true) {
  return team1Wins
    ? { set1Team1Score: 50, set1Team2Score: 10, set2Team1Score: 50, set2Team2Score: 20 }
    : { set1Team1Score: 10, set1Team2Score: 50, set2Team1Score: 20, set2Team2Score: 50 };
}

function manualPlacements(finalists = qualifiers4()) {
  return finalists.map((team, index) => ({
    slotNumber: index + 1,
    entryId: team.entryId,
    confirmed: "済",
  }));
}

{
  const doc = makeExport();
  assert.equal(resolveEmergencyFinalsSettings(doc).finalTeamCount, 4);
  assert.equal(resolveEmergencyFinalsBracket(doc).source, "export");
}

{
  const doc = makeExport();
  const r1 = doc.source.finalsBracket.matches.filter((m) => m.roundNumber === 1);
  const final = doc.source.finalsBracket.matches.find((m) => m.roundNumber === 2);
  const inputs = {};
  for (const match of r1) {
    inputs[match.matchId] = sweep(true);
  }
  inputs[final.matchId] = sweep(true);
  const projected = projectEmergencyOpsFinals(doc, inputs);
  assert.equal(projected.ok, true);
  assert.equal(projected.complete, true);
  assert.ok(projected.champion?.entryId);
  assert.equal(projected.finishedMatches, 3);
}

{
  const base = makeExport();
  const r1 = base.source.finalsBracket.matches.filter((m) => m.roundNumber === 1);
  const first = r1[0];
  const second = r1[1];
  const final = base.source.finalsBracket.matches.find((m) => m.roundNumber === 2);
  const doc = makeExport({
    results: {
      [first.matchId]: {
        matchId: first.matchId,
        status: "finished",
        team1: first.team1,
        team2: first.team2,
        winner: first.team1,
        loser: first.team2,
        team1SetWins: 2,
        team2SetWins: 0,
        sets: [
          { setNumber: 1, team1Score: 50, team2Score: 0, winner: "team1" },
          { setNumber: 2, team1Score: 50, team2Score: 0, winner: "team1" },
        ],
        winsRequired: 2,
      },
    },
  });
  const escapeIds = listEmergencyFinalsEscapeFinishedMatchIds(doc, doc.source.finalsBracket);
  assert.equal(escapeIds.has(first.matchId), true);
  assert.equal(escapeIds.has(second.matchId), false);

  const projected = projectEmergencyOpsFinals(doc, {
    [first.matchId]: sweep(false),
    [second.matchId]: sweep(true),
    [final.matchId]: sweep(true),
  });
  assert.equal(projected.complete, true);
  assert.equal(projected.resultsMap.get(first.matchId).winner.entryId, first.team1.entryId);

  const firstRow = buildEmergencyFinalsMatchRows(doc, doc.source.finalsBracket).find(
    (row) => row.matchId === first.matchId
  );
  assert.equal(firstRow.escapeFinished, true);
  assert.equal(firstRow.status, "脱出前確定");
}

{
  const doc = makeExport();
  const r1 = doc.source.finalsBracket.matches.filter((m) => m.roundNumber === 1);
  const projected = projectEmergencyOpsFinals(doc, {
    [r1[0].matchId]: { set1Team1Score: 50, set1Team2Score: 10 },
  });
  assert.equal(projected.resultsMap.has(r1[0].matchId), false);
  assert.equal(projected.complete, false);
}

// A: 正式ブラケットなしでは抽選を発明せず、手動配置待ちになる。
{
  const doc = makeExport({ withBracket: false });
  const resolved = resolveEmergencyFinalsBracket(doc);
  assert.equal(resolved.source, "emergency_manual_pending");
  assert.equal(resolved.mode, "emergency_manual");
  assert.equal(resolved.bracketKindJa, "未確定");
  assert.equal(resolved.bracket.matches.length, 3);
  assert.ok(resolved.bracket.slots.every((slot) => slot.isBye));
}

// B: 全進出者の配置確認後だけ、手動ブラケットが確定する。
{
  const doc = makeExport({ withBracket: false });
  const placements = manualPlacements();
  const validation = validateEmergencyManualPlacement(qualifiers4(), placements, {
    finalTeamCount: 4,
  });
  assert.equal(validation.valid, true);
  assert.equal(validation.confirmed, true);
  assert.equal(validation.fingerprint, "1:e1|2:e2|3:e3|4:e4");

  const resolved = resolveEmergencyFinalsBracket(doc, {
    placements,
    lockedFingerprint: validation.fingerprint,
  });
  assert.equal(resolved.source, "emergency_manual");
  assert.equal(resolved.bracket.matches[0].team1.entryId, "e1");
  assert.equal(resolved.bracket.matches[0].team2.entryId, "e2");
}

// C: 重複、進出者外、未確認、両側 BYE を受け入れない。
{
  const finalists = qualifiers4().slice(0, 3);
  const invalid = validateEmergencyManualPlacement(
    finalists,
    [
      { slotNumber: 1, entryId: "e1", confirmed: "済" },
      { slotNumber: 2, entryId: "e1", confirmed: "" },
      { slotNumber: 3, entryId: "outside", confirmed: "済" },
    ],
    { finalTeamCount: 3 }
  );
  assert.equal(invalid.valid, false);
  assert.match(invalid.errors.join("\n"), /複数slot|確認未完了|決勝進出者ではない/);

  const finalists5 = [
    ...qualifiers4(),
    { entryId: "e5", teamName: "チーム戊", seed: 5 },
  ];
  const doubleBye = validateEmergencyManualPlacement(
    finalists5,
    [
      { slotNumber: 1, entryId: "e1", confirmed: "済" },
      { slotNumber: 2, entryId: "e2", confirmed: "済" },
      { slotNumber: 3, entryId: "e3", confirmed: "済" },
      { slotNumber: 4, entryId: "e4", confirmed: "済" },
      { slotNumber: 5, entryId: "e5", confirmed: "済" },
    ],
    { finalTeamCount: 5 }
  );
  assert.equal(doubleBye.valid, false);
  assert.match(doubleBye.errors.join("\n"), /両側がBYE/);
}

// D: 決勝開始後に配置とロックが不一致なら進行を停止する。
{
  const doc = makeExport({ withBracket: false });
  const placements = manualPlacements();
  const projected = projectEmergencyOpsFinals(
    doc,
    { "final-r1-m1": sweep(true) },
    {
      placements: [
        placements[1],
        placements[0],
        placements[2],
        placements[3],
      ].map((row, index) => ({ ...row, slotNumber: index + 1 })),
      lockedFingerprint: "1:e1|2:e2|3:e3|4:e4",
    }
  );
  assert.equal(projected.ok, false);
  assert.equal(projected.tamper.tampered, true);
  assert.equal(projected.resultsMap.size, 0);
}

// E: 手動配置の R1 勝者が nextMatchId/nextTeamSlot を通って決勝へ進む。
{
  const doc = makeExport({ withBracket: false });
  const placements = manualPlacements();
  const fingerprint = "1:e1|2:e2|3:e3|4:e4";
  const projected = projectEmergencyOpsFinals(
    doc,
    {
      "final-r1-m1": sweep(true),
      "final-r1-m2": sweep(false),
      "final-r2-m1": sweep(true),
    },
    { placements, lockedFingerprint: fingerprint }
  );
  assert.equal(projected.ok, true);
  assert.equal(projected.complete, true);
  assert.equal(projected.champion.entryId, "e1");
  assert.equal(projected.runnerUp.entryId, "e4");
  assert.equal(projected.resultsMap.get("final-r2-m1").team1.entryId, "e1");
  assert.equal(projected.resultsMap.get("final-r2-m1").team2.entryId, "e4");
}

// F: 空 slot は BYE となり、既存 BYE 進行で次試合へ接続する。
{
  const finalists = qualifiers4().slice(0, 3);
  const placements = manualPlacements(finalists);
  const built = buildEmergencyManualBracketFromPlacement(finalists, placements, {
    finalTeamCount: 3,
  });
  assert.equal(built.valid, true);
  assert.equal(built.bracket.matches[1].team2.isBye, true);

  const doc = makeExport({ withBracket: false });
  doc.source.tournament.finalTeamCount = 3;
  doc.source.finalsAdvancement.finalTeamCount = 3;
  doc.source.finalsAdvancement.qualifiers = finalists;
  const projected = projectEmergencyOpsFinals(
    doc,
    {
      "final-r1-m1": sweep(true),
      "final-r2-m1": sweep(false),
    },
    {
      placements,
      lockedFingerprint: "1:e1|2:e2|3:e3|4:",
    }
  );
  assert.equal(projected.complete, true);
  assert.equal(projected.resultsMap.get("final-r1-m2").resolution, "bye");
  assert.equal(projected.champion.entryId, "e3");
}

// G: 正式ブラケットがあれば手動配置 options は無視し、Mode A を固定使用する。
{
  const doc = makeExport();
  const resolved = resolveEmergencyFinalsBracket(doc, {
    placements: [{ slotNumber: 1, entryId: "bogus", confirmed: "済" }],
    lockedFingerprint: "tampered",
    hasStartedFinals: true,
  });
  assert.equal(resolved.source, "export");
  assert.equal(resolved.mode, "official");
  assert.equal(resolved.placement, null);
  assert.equal(resolved.tamper.tampered, false);
}

{
  const doc = makeExport();
  const pack = buildEmergencyOpsFinalsSheets(doc);
  assert.deepEqual(
    pack.sheets.map((sheet) => sheet.name),
    ["決勝進出", "決勝トーナメント", "_決勝集計"]
  );
  assert.equal(pack.sheets[2].hidden, true);
  assert.ok(pack.sheets[1].inputCells.length > 0);

  const model = buildEmergencyOpsExcelModel(doc);
  assert.ok(model.sheets.some((sheet) => sheet.name === "決勝進出"));
  assert.ok(model.sheets.some((sheet) => sheet.name === "決勝トーナメント"));
  assert.ok(model.sheets.some((sheet) => sheet.name === "_決勝集計" && sheet.hidden));
  assert.ok(model.sheets.some((sheet) => sheet.name === "_集計" && sheet.hidden));

  const situation = Object.fromEntries(
    model.sheets.find((sheet) => sheet.name === "大会状況").rows.filter((row) => row[0])
  );
  assert.ok(situation["決勝状態"]);
  assert.ok(situation["優勝チーム"]);

  const bytes = buildEmergencyOpsExcelBytes(doc);
  assert.ok(bytes.byteLength > 1000);
  mkdirSync(join(root, "tmp"), { recursive: true });
  writeFileSync(join(root, "tmp", "emergency-ops-sprint2_1-sample.xlsx"), bytes);
}

// H: Mode B シートに黄色配置入力、fingerprint、R1 参照、状態・種別を持つ。
{
  const doc = makeExport({ withBracket: false });
  const pack = buildEmergencyOpsFinalsSheets(doc);
  const advancement = pack.sheets.find((sheet) => sheet.name === "決勝進出");
  const bracket = pack.sheets.find((sheet) => sheet.name === "決勝トーナメント");
  const agg = pack.sheets.find((sheet) => sheet.name === "_決勝集計");
  const placementHeader = advancement.rows.findIndex(
    (row) => row[0] === "slot" && row[1] === "slot entryId"
  );
  assert.ok(placementHeader > 0);
  assert.ok(advancement.inputCells.some((cell) => cell.col === 1));
  assert.ok(advancement.inputCells.some((cell) => cell.col === 3));
  assert.ok(advancement.inputCells.some((cell) => cell.col === 4));
  assert.match(String(advancement.rows[placementHeader + 1][5].formula), /TEXTJOIN/);
  assert.match(String(advancement.rows[placementHeader + 1][6].formula), /配置ロック/);
  assert.match(String(bracket.rows[1][5].formula), /決勝進出/);
  assert.match(String(bracket.rows[1][5].formula), /緊急決勝ブラケット確定/);
  assert.equal(agg.hidden, true);
  assert.ok(agg.rows.some((row) => row[0] === "bracketKind" && row[1] === "緊急手動配置"));

  const model = buildEmergencyOpsExcelModel(doc);
  const situation = Object.fromEntries(
    model.sheets.find((sheet) => sheet.name === "大会状況").rows.filter((row) => row[0])
  );
  assert.ok(situation["決勝状態"]);
  assert.ok(situation["決勝ブラケット種別"]);
  assert.ok(situation["決勝配置状態"]);
  assert.equal(model.meta.schemaVersion, 1);

  const bytes = buildEmergencyOpsExcelBytes(doc);
  mkdirSync(join(root, "tmp"), { recursive: true });
  writeFileSync(join(root, "tmp", "emergency-ops-sprint2_1-sample.xlsx"), bytes);
}

{
  for (const rel of [
    "js/domain/emergency-ops-finals.js",
    "js/domain/emergency-ops-finals-sheets.js",
    "js/domain/emergency-ops-excel.js",
  ]) {
    const src = readFileSync(join(root, rel), "utf8");
    assert.equal(/setDoc|updateDoc|addDoc|writeBatch|runTransaction/.test(src), false);
  }
}

console.log("emergency-ops-finals.test.mjs: all passed");
