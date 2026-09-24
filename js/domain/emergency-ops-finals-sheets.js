/**
 * 緊急運営 Excel の決勝シート（Sprint 2.1）
 *
 * Mode A は Export 済み正式ブラケットを固定表示する。
 * Mode B は確定進出者を現場抽選結果どおり slot へ手入力し、Excel 数式で
 * 1回戦から既存 nextMatchId / nextTeamSlot 配線へ接続する。
 */
import {
  buildEmergencyFinalsAdvancementRows,
  buildEmergencyFinalsMatchRows,
  projectEmergencyOpsFinals,
  resolveEmergencyFinalsBracket,
  resolveEmergencyFinalsSettings,
} from "./emergency-ops-finals.js";
import {
  EMERGENCY_MANUAL_NOTICE_JA,
  EMERGENCY_OFFICIAL_BRACKET_NOTICE_JA,
} from "./emergency-ops-finals-manual.js";

export const SHEET_FINALS_ADVANCEMENT = "決勝進出";
export const SHEET_FINALS_BRACKET = "決勝トーナメント";
export const SHEET_FINALS_AGG = "_決勝集計";

const MANUAL_CONFIRMED = "緊急決勝ブラケット確定";

function formula(expr, value = null) {
  return { formula: expr, value };
}

function text(value) {
  return value == null ? "" : String(value);
}

function teamNameOf(team) {
  if (!team) return "";
  if (team.isBye) return "BYE";
  return text(team.teamName);
}

function entryIdOf(team) {
  return !team || team.isBye ? "" : text(team.entryId);
}

function setScoreValue(sets, setNumber, side) {
  const found = (sets || []).find((set) => Number(set.setNumber) === setNumber);
  if (!found) return "";
  return side === "a" ? found.team1Score ?? "" : found.team2Score ?? "";
}

function setWinsExpr(aCols, bCols, row) {
  return aCols
    .map(
      (col, index) =>
        `IF(OR(${col}${row}="",${bCols[index]}${row}=""),0,IF(${col}${row}>${bCols[index]}${row},1,0))`
    )
    .join("+");
}

function buildManualPlacementSection({
  advancementRows,
  advancementPack,
  bracket,
  settings,
  inputCells,
}) {
  const bracketSize = Number(bracket?.bracketSize) || 0;
  const finalistStart = 5;
  const finalistEnd = Math.max(finalistStart, finalistStart + advancementPack.rows.length - 1);

  advancementRows.push(["", ""]);
  advancementRows.push(["緊急手動配置（現場抽選結果を入力）", ""]);
  advancementRows.push([EMERGENCY_MANUAL_NOTICE_JA, ""]);
  advancementRows.push([
    "slot",
    "slot entryId",
    "チーム名",
    "配置確認 (=済)",
    "配置ロックコード",
    "現在fingerprint",
    "配置状態",
  ]);

  const firstDataRow = advancementRows.length + 1;
  const lastDataRow = firstDataRow + bracketSize - 1;
  const slotRange = `$B$${firstDataRow}:$B$${lastDataRow}`;
  const finalistRange = `$I$${finalistStart}:$I$${finalistEnd}`;
  const fingerprintParts = Array.from(
    { length: bracketSize },
    (_, index) => `A${firstDataRow + index}&":"&B${firstDataRow + index}`
  );
  const fingerprintFormula = `TEXTJOIN("|",FALSE,${fingerprintParts.join(",")})`;

  const invalidMembership = Array.from(
    { length: bracketSize },
    (_, index) => {
      const row = firstDataRow + index;
      return `AND(B${row}<>"",COUNTIF(${finalistRange},B${row})<>1)`;
    }
  ).join(",");
  const unconfirmed = Array.from(
    { length: bracketSize },
    (_, index) => {
      const row = firstDataRow + index;
      return `AND(B${row}<>"",D${row}<>"済")`;
    }
  ).join(",");
  const duplicate = Array.from(
    { length: bracketSize },
    (_, index) => {
      const row = firstDataRow + index;
      return `AND(B${row}<>"",COUNTIF(${slotRange},B${row})>1)`;
    }
  ).join(",");
  const doubleBye = Array.from(
    { length: bracketSize / 2 },
    (_, index) => {
      const row = firstDataRow + index * 2;
      return `AND(B${row}="",B${row + 1}="")`;
    }
  ).join(",");
  const hasScores = `COUNTA('${SHEET_FINALS_BRACKET}'!M2:V1048576)>0`;
  const stateFormula =
    `IF(COUNTA(${finalistRange})<>${settings.finalTeamCount},"進出者未確定",` +
    `IF(COUNTA(${slotRange})<>${settings.finalTeamCount},"配置未完了",` +
    `IF(OR(${invalidMembership}),"要確認:進出者外",` +
    `IF(OR(${duplicate}),"要確認:重複配置",` +
    `IF(OR(${doubleBye}),"要確認:両側BYE",` +
    `IF(OR(${unconfirmed}),"配置確認待ち",` +
    `IF(E${firstDataRow}="","配置ロック待ち",` +
    `IF(E${firstDataRow}<>F${firstDataRow},IF(${hasScores},"要確認","配置ロック不一致"),` +
    `"${MANUAL_CONFIRMED}"))))))))`;

  for (let index = 0; index < bracketSize; index += 1) {
    const row = firstDataRow + index;
    const slotNumber = index + 1;
    inputCells.push({ row: row - 1, col: 1 }, { row: row - 1, col: 3 });
    if (index === 0) inputCells.push({ row: row - 1, col: 4 });
    advancementRows.push([
      slotNumber,
      "",
      formula(
        `IF(B${row}="","BYE",IFERROR(INDEX($D$${finalistStart}:$D$${finalistEnd},MATCH(B${row},${finalistRange},0)),"要確認"))`
      ),
      "",
      index === 0 ? "" : "↑ 先頭セルのみ入力",
      index === 0 ? formula(fingerprintFormula) : "",
      index === 0 ? formula(stateFormula, "配置未完了") : "",
    ]);
  }

  return {
    firstDataRow,
    lastDataRow,
    stateCell: `'${
      SHEET_FINALS_ADVANCEMENT
    }'!$G$${firstDataRow}`,
    stateRow: firstDataRow,
  };
}

/**
 * @param {object} exportDoc
 */
export function buildEmergencyOpsFinalsSheets(exportDoc) {
  const settings = resolveEmergencyFinalsSettings(exportDoc);
  const bracketResolved = resolveEmergencyFinalsBracket(exportDoc);
  const bracket = bracketResolved.bracket;
  const isManual = bracketResolved.mode === "emergency_manual";
  const advancementPack = buildEmergencyFinalsAdvancementRows(exportDoc);
  const projected = bracket ? projectEmergencyOpsFinals(exportDoc, {}) : null;
  const matchRows = bracket ? buildEmergencyFinalsMatchRows(exportDoc, bracket) : [];
  const scoreColsA = ["M", "O", "Q", "S", "U"];
  const scoreColsB = ["N", "P", "R", "T", "V"];

  const advancementRows = [
    ["決勝進出（既存 SMATournament 設定・確定進出に基づく）", ""],
    [
      `mode=${settings.mode} / blocks=${settings.blockCount ?? "—"} / perBlock=${settings.qualifiersPerBlock ?? "—"} / finalTeamCount=${settings.finalTeamCount ?? "—"} / wildcardMode=${settings.wildcardComparisonMode}`,
      "",
    ],
    [
      isManual ? EMERGENCY_MANUAL_NOTICE_JA : EMERGENCY_OFFICIAL_BRACKET_NOTICE_JA,
      "",
    ],
    [
      "ブロック",
      "確定順位",
      "チーム番号",
      "チーム名",
      "進出",
      "進出根拠",
      "シード",
      "要確認",
      "entryId",
    ],
  ];
  for (const row of advancementPack.rows) {
    advancementRows.push([
      row.blockName || row.blockId,
      row.blockRank,
      row.teamNumber,
      row.teamName,
      row.advanced ? "進出" : "未確定",
      row.reasonJa,
      row.seed || row.slot,
      row.needsConfirm ? "要確認" : "",
      row.entryId,
    ]);
  }

  const advancementInputCells = [];
  const manualPlacement = isManual && bracket
    ? buildManualPlacementSection({
        advancementRows,
        advancementPack,
        bracket,
        settings,
        inputCells: advancementInputCells,
      })
    : null;

  const finalsRows = [[
    "ラウンド", "matchId", "試合番号", "コート", "予定時刻",
    "チームA", "A_entryId", "チームB", "B_entryId", "状態",
    "結果区分", "必要勝セット", "S1_A", "S1_B", "S2_A", "S2_B",
    "S3_A", "S3_B", "S4_A", "S4_B", "S5_A", "S5_B",
    "Aセット勝", "Bセット勝", "勝者", "勝者entryId",
    "運営確認", "入力チェック", "備考",
  ]];
  const finalsInputCells = [];
  const highlightRowIndexes = [];
  const matchExcelRow = new Map(
    matchRows.map((match, index) => [match.matchId, index + 2])
  );
  const feedersByTarget = new Map();
  for (const match of matchRows) {
    if (!match.nextMatchId) continue;
    const feeders = feedersByTarget.get(match.nextMatchId) || {};
    feeders[match.nextTeamSlot === "team2" ? "team2" : "team1"] = match.matchId;
    feedersByTarget.set(match.nextMatchId, feeders);
  }

  matchRows.forEach((match, index) => {
    const excelRow = index + 2;
    const dataRowIndex = index + 1;
    const locked = !isManual && (match.escapeFinished || match.bye);
    const feeders = feedersByTarget.get(match.matchId) || {};
    let team1Name = teamNameOf(match.team1);
    let team1Id = entryIdOf(match.team1);
    let team2Name = teamNameOf(match.team2);
    let team2Id = entryIdOf(match.team2);

    if (isManual && match.roundNumber === 1 && manualPlacement) {
      const slot1Row = manualPlacement.firstDataRow + (match.matchNumber - 1) * 2;
      const slot2Row = slot1Row + 1;
      const gate = manualPlacement.stateCell;
      team1Name = formula(
        `IF(${gate}<>"${MANUAL_CONFIRMED}","",IF('決勝進出'!B${slot1Row}="","BYE",'決勝進出'!C${slot1Row}))`
      );
      team1Id = formula(
        `IF(${gate}<>"${MANUAL_CONFIRMED}","",'決勝進出'!B${slot1Row})`
      );
      team2Name = formula(
        `IF(${gate}<>"${MANUAL_CONFIRMED}","",IF('決勝進出'!B${slot2Row}="","BYE",'決勝進出'!C${slot2Row}))`
      );
      team2Id = formula(
        `IF(${gate}<>"${MANUAL_CONFIRMED}","",'決勝進出'!B${slot2Row})`
      );
    } else if (match.roundNumber > 1) {
      const f1 = feeders.team1 ? matchExcelRow.get(feeders.team1) : null;
      const f2 = feeders.team2 ? matchExcelRow.get(feeders.team2) : null;
      team1Name = f1 ? formula(`IF(Y${f1}="","",Y${f1})`) : team1Name;
      team1Id = f1 ? formula(`IF(Z${f1}="","",Z${f1})`) : team1Id;
      team2Name = f2 ? formula(`IF(Y${f2}="","",Y${f2})`) : team2Name;
      team2Id = f2 ? formula(`IF(Z${f2}="","",Z${f2})`) : team2Id;
    }

    const scores = [];
    for (let setNumber = 1; setNumber <= 5; setNumber += 1) {
      if (locked) {
        scores.push(
          setScoreValue(match.sets, setNumber, "a"),
          setScoreValue(match.sets, setNumber, "b")
        );
      } else {
        scores.push("", "");
        const col = 12 + (setNumber - 1) * 2;
        finalsInputCells.push({ row: dataRowIndex, col }, { row: dataRowIndex, col: col + 1 });
      }
    }
    if (!locked) {
      highlightRowIndexes.push(dataRowIndex);
      finalsInputCells.push({ row: dataRowIndex, col: 26 });
    }

    const gateExpr = isManual && manualPlacement
      ? `${manualPlacement.stateCell}="${MANUAL_CONFIRMED}"`
      : "TRUE";
    const dynamicBye = isManual && match.roundNumber === 1;
    const winsA = locked
      ? match.team1SetWins ?? ""
      : formula(
          dynamicBye
            ? `IF(AND(${gateExpr},G${excelRow}<>"",I${excelRow}=""),L${excelRow},${setWinsExpr(scoreColsA, scoreColsB, excelRow)})`
            : setWinsExpr(scoreColsA, scoreColsB, excelRow),
          match.team1SetWins
        );
    const winsB = locked
      ? match.team2SetWins ?? ""
      : formula(
          dynamicBye
            ? `IF(AND(${gateExpr},I${excelRow}<>"",G${excelRow}=""),L${excelRow},${setWinsExpr(scoreColsB, scoreColsA, excelRow)})`
            : setWinsExpr(scoreColsB, scoreColsA, excelRow),
          match.team2SetWins
        );

    let winnerName;
    let winnerId;
    if (locked) {
      winnerName = teamNameOf(match.winner);
      winnerId = entryIdOf(match.winner);
    } else {
      winnerName = formula(
        `IF(NOT(${gateExpr}),"",IF(AND(G${excelRow}<>"",I${excelRow}=""),F${excelRow},IF(AND(I${excelRow}<>"",G${excelRow}=""),H${excelRow},IF(OR(F${excelRow}="",H${excelRow}=""),"",IF(AND(W${excelRow}>=L${excelRow},X${excelRow}>=L${excelRow}),"",IF(W${excelRow}>=L${excelRow},F${excelRow},IF(X${excelRow}>=L${excelRow},H${excelRow},"")))))))`
      );
      winnerId = formula(
        `IF(Y${excelRow}="","",IF(Y${excelRow}=F${excelRow},G${excelRow},IF(Y${excelRow}=H${excelRow},I${excelRow},"")))`
      );
    }

    const status = locked
      ? match.status
      : formula(
          `IF(NOT(${gateExpr}),${isManual ? `"要確認"` : `"対戦者待ち"`},IF(AND(G${excelRow}="",I${excelRow}=""),"対戦者待ち",IF(OR(G${excelRow}="",I${excelRow}=""),"BYE",IF(Y${excelRow}<>"","Excel確定","実施可"))))`
        );
    const resultKind = locked
      ? match.bye ? "BYE" : "脱出前確定"
      : formula(`IF(J${excelRow}="BYE","BYE","Excel運営")`);
    const check = locked
      ? ""
      : formula(
          `IF(NOT(${gateExpr}),${isManual ? `"要確認"` : `"対戦者待ち"`},IF(J${excelRow}="BYE","OK",IF(OR(F${excelRow}="",H${excelRow}=""),"対戦者待ち",IF(COUNTA(M${excelRow}:V${excelRow})=0,"未入力",IF(AND(W${excelRow}>=L${excelRow},X${excelRow}>=L${excelRow}),"要確認",IF(Y${excelRow}="","未完了","OK"))))))`
        );

    finalsRows.push([
      match.roundLabel, match.matchId, match.matchNumber, match.courtNumber,
      match.scheduledTime, team1Name, team1Id, team2Name, team2Id, status,
      resultKind, match.winsRequired, ...scores, winsA, winsB, winnerName,
      winnerId, locked ? "済" : "", check,
      locked
        ? match.bye
          ? "BYE自動通過（入力不要）"
          : "脱出前正式結果（変更不可）"
        : "黄色セルにセット得点を入力。勝者は既存ブラケット配線で次試合へ進みます。",
    ]);
  });

  const finishedAtExport = matchRows.filter(
    (match) => match.escapeFinished || match.bye || match.finished
  ).length;
  const bracketKind = isManual ? "緊急手動配置" : "正式ブラケット";
  const placementStateFormula = manualPlacement
    ? manualPlacement.stateCell
    : `"正式ブラケット固定"`;

  const aggRows = [
    ["項目", "値"],
    ["bracketSource", bracketResolved.source],
    ["bracketKind", bracketKind],
    ["bracketMessage", bracketResolved.messageJa],
    ["finalTeamCount", settings.finalTeamCount ?? ""],
    ["advancementFinalized", settings.advancementFinalized ? "はい" : "いいえ"],
    ["配置状態", formula(placementStateFormula, isManual ? "配置未完了" : "正式ブラケット固定")],
    ["総試合数", matchRows.length],
    ["終了試合数", formula(
      `COUNTIF('${SHEET_FINALS_BRACKET}'!K:K,"脱出前確定")+COUNTIF('${SHEET_FINALS_BRACKET}'!J:J,"BYE")+COUNTIF('${SHEET_FINALS_BRACKET}'!AB:AB,"OK")`,
      finishedAtExport
    )],
    ["残り試合数", formula("MAX(0,B8-B9)", Math.max(0, matchRows.length - finishedAtExport))],
    ["要確認試合数", formula(`COUNTIF('${SHEET_FINALS_BRACKET}'!AB:AB,"要確認")`, 0)],
    ["次に実施可能な試合", formula(
      `IFERROR(INDEX('${SHEET_FINALS_BRACKET}'!B:B,MATCH("実施可",'${SHEET_FINALS_BRACKET}'!J:J,0)),"")`,
      matchRows.find((match) => match.status === "実施可")?.matchId || ""
    )],
    ["優勝チーム", formula(
      `IFERROR(LOOKUP(2,1/(ISNUMBER(SEARCH("決勝",'${SHEET_FINALS_BRACKET}'!A:A))*('${SHEET_FINALS_BRACKET}'!Y:Y<>"")),'${SHEET_FINALS_BRACKET}'!Y:Y),"")`,
      projected?.champion?.teamName || ""
    )],
    ["優勝entryId", formula(
      `IFERROR(LOOKUP(2,1/(ISNUMBER(SEARCH("決勝",'${SHEET_FINALS_BRACKET}'!A:A))*('${SHEET_FINALS_BRACKET}'!Z:Z<>"")),'${SHEET_FINALS_BRACKET}'!Z:Z),"")`,
      projected?.champion?.entryId || ""
    )],
    ["決勝状態", formula(
      `IF(B7="要確認","要確認",IF(B13<>"","決勝終了",IF(B9>0,"決勝進行中",IF(B7="${MANUAL_CONFIRMED}","決勝開始可能",IF(B6="はい","決勝進出者確定","決勝未開始")))))`,
      projected?.complete ? "決勝終了" : settings.advancementFinalized ? "決勝進出者確定" : "決勝未開始"
    )],
  ];

  return {
    settings,
    bracketResolved,
    matchCount: matchRows.length,
    sheets: [
      {
        name: SHEET_FINALS_ADVANCEMENT,
        rows: advancementRows,
        columns: [
          { width: 14 }, { width: 18 }, { width: 18 }, { width: 16 },
          { width: 28 }, { width: 48 }, { width: 28 }, { width: 12 }, { width: 16 },
        ],
        freeze: { rows: 4, cols: 0 },
        inputCells: advancementInputCells,
      },
      {
        name: SHEET_FINALS_BRACKET,
        rows: finalsRows,
        columns: Array.from({ length: 29 }, (_, index) => ({
          width: [0, 9].includes(index) ? 12 : index === 28 ? 38 : 10,
        })),
        freeze: { rows: 1, cols: 0 },
        autoFilter: true,
        highlightRowIndexes,
        inputCells: finalsInputCells,
      },
      {
        name: SHEET_FINALS_AGG,
        rows: aggRows,
        hidden: true,
        columns: [{ width: 22 }, { width: 60 }],
        freeze: { rows: 1, cols: 0 },
      },
    ],
    situationExtras: [
      ["決勝状態", formula(`'${SHEET_FINALS_AGG}'!B15`)],
      ["決勝ブラケット種別", formula(`'${SHEET_FINALS_AGG}'!B3`)],
      ["決勝配置状態", formula(`'${SHEET_FINALS_AGG}'!B7`)],
      ["決勝総試合数", formula(`'${SHEET_FINALS_AGG}'!B8`)],
      ["決勝終了試合数", formula(`'${SHEET_FINALS_AGG}'!B9`)],
      ["決勝残り試合数", formula(`'${SHEET_FINALS_AGG}'!B10`)],
      ["次に実施可能な決勝試合", formula(`'${SHEET_FINALS_AGG}'!B12`)],
      ["決勝要確認試合数", formula(`'${SHEET_FINALS_AGG}'!B11`)],
      ["優勝チーム", formula(`'${SHEET_FINALS_AGG}'!B13`)],
    ],
  };
}
