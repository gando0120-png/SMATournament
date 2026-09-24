/**
 * EmergencyExportV1 → 緊急運営用 Excel（予選+決勝脱出 Sprint 2）
 *
 * Firestore へは書き込まない。VBA/マクロなし。
 * 脱出時点の公式結果は静的、未消化試合は Excel 数式で集計・順位更新する。
 */
import { EMERGENCY_EXPORT_FORBIDDEN_KEYS } from "./emergency-export-schema.js";
import { buildXlsxArrayBuffer } from "./minimal-xlsx.js";
import { buildQualifyingStandings } from "./qualifying-standings.js";
import { validateMatchResultInput } from "./qualifying-match-result.js";
import { buildEmergencyOpsFinalsSheets } from "./emergency-ops-finals-sheets.js";

export const EMERGENCY_OPS_EXCEL_NOTICE_JA =
  "このファイルへ運営を切り替えた場合、以後はこのExcelを正として大会を進行してください。SMATournamentとの並行入力は行わないでください。";

export const EMERGENCY_OPS_EXCEL_ERROR_NOTICE_JA =
  "このExcelには不整合の可能性があります。手動運営へ移行する前に内容を確認してください。";

export const EMERGENCY_OPS_RANKING_RULES_JA =
  "順位はセット勝→セット分→総得点（sma-qualifying-standings-v1）。同点はモルックアウト等の人手判定。";

export const EMERGENCY_OPS_STANDINGS_GUIDE_JA =
  "同点・要モルックアウトと表示された場合のみ、追加判定後に黄色の『最終順位』へ順位を入力し、『順位確認』へ『済』と入力してください。通常の順位では入力不要です。";

const SHEET_SITUATION = "大会状況";
const SHEET_LEDGER = "予選対戦表";
const SHEET_STANDINGS = "現在順位";
const SHEET_OPEN = "未消化試合";
const SHEET_AGG = "_集計";

const KIND_ESCAPE = "脱出前確定";
const KIND_EXCEL = "Excel連動";
const STATUS_EXCEL_CONFIRMED = "Excel確定";
const STATUS_NEED_CONFIRM = "要確認";
const STATUS_EMPTY = "未入力";

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

function yesNo(value) {
  return value ? "はい" : "いいえ";
}

function teamName(team) {
  return text(team?.teamName || "—");
}

function teamNumber(team) {
  const value = team?.displayTeamNumber;
  return value === null || value === undefined || value === "" ? "" : value;
}

function isQualifyingMatch(match) {
  return !match?.phase || match.phase === "qualifying";
}

function formula(expr, value) {
  return { formula: expr, value: value === undefined ? null : value };
}

function gray(value) {
  return { v: value, style: 4 };
}

function officialResultsMap(exportDoc) {
  const raw = exportDoc?.source?.qualifyingMatchResults;
  if (!raw) {
    return new Map();
  }
  if (raw instanceof Map) {
    return raw;
  }
  if (Array.isArray(raw)) {
    return new Map(raw.map((item) => [item.matchId || item.id, item]));
  }
  return new Map(Object.entries(raw));
}

function reconciliationsMap(exportDoc) {
  const raw =
    exportDoc?.source?.playerPipeline?.reconciliations ||
    exportDoc?.source?.qualifyingMatchReconciliations ||
    {};
  if (raw instanceof Map) {
    return raw;
  }
  return new Map(Object.entries(asObject(raw)));
}

function isEscapeTimeFinished(official) {
  return Boolean(
    official && (official.status === "finished" || official.status === "FINISHED")
  );
}

function setScorePair(result, setNumber) {
  const sets = asArray(result?.sets);
  const found =
    sets.find((set) => Number(set?.setNumber) === setNumber) || sets[setNumber - 1] || null;
  if (!found) {
    return { a: "", b: "" };
  }
  const a = found.team1Score;
  const b = found.team2Score;
  return {
    a: a === null || a === undefined ? "" : a,
    b: b === null || b === undefined ? "" : b,
  };
}

function formatPlayerSubmissionState(match, reconciliation) {
  const status = match?.status || "";
  const label = match?.statusLabelJa || "";
  const submissions = reconciliation?.submissions || {};
  const team1Submitted = submissions.team1Submitted === true;
  const team2Submitted = submissions.team2Submitted === true;
  const parts = [];

  if (label) {
    parts.push(label);
  }

  if (status === "awaiting_opponent" || reconciliation?.state === "awaiting_opponent") {
    if (team1Submitted && !team2Submitted) {
      parts.push("Team A submitted / Team B not submitted（選手提出・非正式）");
    } else if (!team1Submitted && team2Submitted) {
      parts.push("Team B submitted / Team A not submitted（選手提出・非正式）");
    } else {
      parts.push("片側提出あり（選手提出・非正式）");
    }
  } else if (status === "conflict" || reconciliation?.state === "conflict") {
    parts.push("提出競合（選手提出・非正式。紙で裁定）");
  } else if (team1Submitted || team2Submitted) {
    parts.push(
      `選手提出: A=${team1Submitted ? "済" : "未"} / B=${team2Submitted ? "済" : "未"}（非正式）`
    );
  }

  if (match?.noteJa) {
    parts.push(match.noteJa);
  }

  return parts.filter(Boolean).join(" / ") || "—";
}

function countIntegrity(integrity) {
  const items = asArray(integrity?.items);
  const errorCount = Number(
    integrity?.errorCount ?? items.filter((item) => item.severity === "ERROR").length
  );
  const warningCount = Number(
    integrity?.warningCount ?? items.filter((item) => item.severity === "WARNING").length
  );
  const infoCount = items.filter((item) => item.severity === "INFO").length;
  return { errorCount, warningCount, infoCount, items };
}

function findScheduleMatch(schedule, matchId) {
  for (const block of asArray(schedule?.blocks)) {
    for (const round of asArray(block.rounds)) {
      for (const match of asArray(round.matches)) {
        if (match?.matchId === matchId) {
          return {
            matchId: match.matchId,
            blockId: block.blockId,
            roundNumber: round.roundNumber ?? match.roundNumber,
            courtNumber: match.courtNumber,
            team1: match.team1,
            team2: match.team2,
          };
        }
      }
    }
  }
  return null;
}

function openSetResultFormula(aCol, bCol, row) {
  return `IF(AND(${aCol}${row}="",${bCol}${row}=""),"",IF(OR(${aCol}${row}="",${bCol}${row}=""),"片側",IF(OR(NOT(ISNUMBER(${aCol}${row})),NOT(ISNUMBER(${bCol}${row})),${aCol}${row}<0,${aCol}${row}>50,${bCol}${row}<0,${bCol}${row}>50,AND(${aCol}${row}=50,${bCol}${row}=50)),"不正",IF(${aCol}${row}>${bCol}${row},"A",IF(${bCol}${row}>${aCol}${row},"B","分")))))`;
}

function openWinsFormula(row, sideLetter) {
  return `IF(OR(R${row}="",S${row}="",R${row}="片側",S${row}="片側",R${row}="不正",S${row}="不正"),"",IF(R${row}="${sideLetter}",1,0)+IF(S${row}="${sideLetter}",1,0))`;
}

function openDrawsFormula(row) {
  return `IF(OR(R${row}="",S${row}="",R${row}="片側",S${row}="片側",R${row}="不正",S${row}="不正"),"",IF(R${row}="分",1,0)+IF(S${row}="分",1,0))`;
}

function openStatusFormula(row) {
  return `IF(AND(OR(R${row}="A",R${row}="B",R${row}="分"),OR(S${row}="A",S${row}="B",S${row}="分")),"${STATUS_EXCEL_CONFIRMED}",IF(AND(R${row}="",S${row}=""),"${STATUS_EMPTY}","${STATUS_NEED_CONFIRM}"))`;
}

function openWinnerFormula(row) {
  return `IF(OR(T${row}="",U${row}=""),"",IF(T${row}>U${row},G${row},IF(U${row}>T${row},J${row},"")))`;
}

function cellHaystack(cell) {
  if (cell === null || cell === undefined) {
    return "";
  }
  if (typeof cell === "object" && !Array.isArray(cell)) {
    return [cell.formula, cell.f, cell.value, cell.v]
      .filter((part) => part !== null && part !== undefined && part !== "")
      .map((part) => String(part))
      .join(" ");
  }
  return text(cell);
}

function collectTeamRows(standingsDoc) {
  const rows = [];
  for (const block of asArray(standingsDoc.blocks)) {
    for (const standing of asArray(block.standings)) {
      rows.push({
        entryId: text(standing.entryId),
        blockId: text(block.blockId),
        blockName: text(block.blockName || block.blockId),
        teamName: text(standing.teamName),
        displayTeamNumber: standing.displayTeamNumber ?? "",
        symbol: text(standing.symbol),
        scheduledMatches:
          Number(standing.playedMatches ?? 0) + Number(standing.remainingMatches ?? 0),
        playedMatches: standing.playedMatches ?? 0,
        setWins: standing.setWins ?? 0,
        setDraws: standing.setDraws ?? 0,
        setLosses: standing.setLosses ?? 0,
        totalScore: standing.totalScore ?? 0,
        remainingMatches: standing.remainingMatches ?? 0,
        rank: standing.rank ?? "",
        tied: standing.tied === true,
        needsMolkkyOut: standing.needsMolkkyOut === true,
        molkkyOutApplied: standing.molkkyOutApplied === true,
      });
    }
  }
  return rows;
}

/**
 * JS シミュレータ: 脱出時点の公式結果 + Excel 入力のみを合成して順位を再計算する。
 * 公式結果は上書きしない。不完全・不正・片側入力は無視する。
 * @param {object} exportDoc
 * @param {Record<string, object>} [excelInputsByMatchId]
 */
export function projectEmergencyOpsStandings(exportDoc, excelInputsByMatchId = {}) {
  const schedule = exportDoc?.source?.qualifyingSchedule;
  if (!schedule?.finalized) {
    return null;
  }

  const resultsMap = new Map();
  const officialMap = officialResultsMap(exportDoc);

  for (const [id, result] of officialMap.entries()) {
    if (!isEscapeTimeFinished(result)) {
      continue;
    }
    resultsMap.set(id, {
      matchId: id,
      status: "finished",
      team1: result.team1,
      team2: result.team2,
      team1Stats: result.team1Stats,
      team2Stats: result.team2Stats,
      sets: result.sets,
    });
  }

  for (const [matchId, input] of Object.entries(excelInputsByMatchId || {})) {
    if (resultsMap.has(matchId)) {
      continue;
    }
    const validated = validateMatchResultInput({
      set1Team1Score: input?.s1a ?? input?.set1Team1Score,
      set1Team2Score: input?.s1b ?? input?.set1Team2Score,
      set2Team1Score: input?.s2a ?? input?.set2Team1Score,
      set2Team2Score: input?.s2b ?? input?.set2Team2Score,
    });
    if (!validated.valid) {
      continue;
    }
    const match = findScheduleMatch(schedule, matchId);
    if (!match) {
      continue;
    }
    resultsMap.set(matchId, {
      matchId,
      status: "finished",
      team1: match.team1,
      team2: match.team2,
      sets: validated.data.sets,
      team1Stats: validated.data.team1Stats,
      team2Stats: validated.data.team2Stats,
    });
  }

  return buildQualifyingStandings(schedule, resultsMap);
}

/**
 * EmergencyExportV1 からシートモデルを組み立てる。
 * @param {object} exportDoc
 */
export function buildEmergencyOpsExcelModel(exportDoc) {
  if (!exportDoc || typeof exportDoc !== "object") {
    throw new Error("emergency-ops-excel/invalid-export");
  }

  const meta = asObject(exportDoc.exportMeta);
  const derived = asObject(exportDoc.derived);
  const situation = asObject(derived.situation);
  const qualifying = asObject(situation.qualifying);
  const integrity = countIntegrity(derived.integrityChecks);
  const confirmed = asArray(derived.confirmedEntries);
  const matchStates = asArray(derived.matchDisplayStates).filter(isQualifyingMatch);
  const remaining = asArray(derived.remainingMatches).filter(isQualifyingMatch);
  const standingsDoc = asObject(derived.qualifyingStandings);
  const finalsAdv = asObject(derived.finalsAdvancementStatus);
  const officialMap = officialResultsMap(exportDoc);
  const reconMap = reconciliationsMap(exportDoc);
  const displayById = new Map(matchStates.map((match) => [match.matchId, match]));
  const teamRows = collectTeamRows(standingsDoc);

  const openRowByMatchId = new Map();
  remaining.forEach((match, index) => {
    openRowByMatchId.set(match.matchId, index + 2);
  });

  // --- 未消化試合 ---
  const openHeader = [
    "実施順",
    "matchId",
    "ブロック",
    "節",
    "コート",
    "予定時刻",
    "チームA",
    "A番号",
    "A_entryId",
    "チームB",
    "B番号",
    "B_entryId",
    "参考提出状態(非正式)",
    "S1_A",
    "S1_B",
    "S2_A",
    "S2_B",
    "S1結果",
    "S2結果",
    "A勝",
    "B勝",
    "A分",
    "B分",
    "A敗",
    "B敗",
    "A点",
    "B点",
    "試合状態",
    "勝者",
    "運営確認",
    "備考",
  ];
  const openRows = [openHeader];
  const openInputCells = [];
  const openHighlight = [];

  remaining.forEach((match, index) => {
    const excelRow = index + 2;
    const dataRowIndex = index + 1;
    const display = displayById.get(match.matchId) || match;
    const recon = reconMap.get(match.matchId);
    openHighlight.push(dataRowIndex);
    for (const col of [13, 14, 15, 16, 29]) {
      openInputCells.push({ row: dataRowIndex, col });
    }
    openRows.push([
      index + 1,
      text(match.matchId),
      text(match.blockId),
      match.roundNumber ?? "",
      match.courtNumber ?? "",
      text(match.scheduledTime),
      teamName(match.team1),
      teamNumber(match.team1),
      text(match.team1?.entryId),
      teamName(match.team2),
      teamNumber(match.team2),
      text(match.team2?.entryId),
      formatPlayerSubmissionState(display, recon),
      "",
      "",
      "",
      "",
      formula(openSetResultFormula("N", "O", excelRow)),
      formula(openSetResultFormula("P", "Q", excelRow)),
      formula(openWinsFormula(excelRow, "A")),
      formula(openWinsFormula(excelRow, "B")),
      formula(openDrawsFormula(excelRow)),
      formula(openDrawsFormula(excelRow)),
      formula(openWinsFormula(excelRow, "B")),
      formula(openWinsFormula(excelRow, "A")),
      formula(`IF(T${excelRow}="","",N${excelRow}+P${excelRow})`),
      formula(`IF(U${excelRow}="","",O${excelRow}+Q${excelRow})`),
      formula(openStatusFormula(excelRow)),
      formula(openWinnerFormula(excelRow)),
      "",
      text(match.noteJa || display.noteJa),
    ]);
  });

  // --- 予選対戦表 ---
  const ledgerHeader = [
    "matchId",
    "ブロック",
    "節",
    "コート",
    "予定時刻",
    "チームA",
    "A番号",
    "A_entryId",
    "チームB",
    "B番号",
    "B_entryId",
    "結果区分",
    "S1_A",
    "S1_B",
    "S2_A",
    "S2_B",
    "A勝",
    "A分",
    "A敗",
    "A点",
    "B勝",
    "B分",
    "B敗",
    "B点",
    "集計対象",
    "状態",
    "勝者",
    "備考",
  ];
  const ledgerRows = [ledgerHeader];
  const ledgerHighlight = [];

  matchStates.forEach((match, index) => {
    const official = officialMap.get(match.matchId) || null;
    const escapeFinished = isEscapeTimeFinished(official);
    const openRow = openRowByMatchId.get(match.matchId);
    const noteParts = [];

    if (escapeFinished) {
      const s1 = setScorePair(official, 1);
      const s2 = setScorePair(official, 2);
      const t1 = asObject(official.team1Stats);
      const t2 = asObject(official.team2Stats);
      const wins1 = Number(t1.setWins ?? 0);
      const wins2 = Number(t2.setWins ?? 0);
      let winner = "";
      if (wins1 > wins2) {
        winner = teamName(official.team1 || match.team1);
      } else if (wins2 > wins1) {
        winner = teamName(official.team2 || match.team2);
      }
      if (match.noteJa) {
        noteParts.push(match.noteJa);
      }
      ledgerRows.push([
        text(match.matchId),
        text(match.blockId),
        match.roundNumber ?? "",
        match.courtNumber ?? "",
        text(match.scheduledTime),
        teamName(match.team1),
        teamNumber(match.team1),
        text(match.team1?.entryId),
        teamName(match.team2),
        teamNumber(match.team2),
        text(match.team2?.entryId),
        KIND_ESCAPE,
        s1.a,
        s1.b,
        s2.a,
        s2.b,
        t1.setWins ?? 0,
        t1.setDraws ?? 0,
        t1.setLosses ?? 0,
        t1.totalScore ?? 0,
        t2.setWins ?? 0,
        t2.setDraws ?? 0,
        t2.setLosses ?? 0,
        t2.totalScore ?? 0,
        1,
        KIND_ESCAPE,
        winner,
        noteParts.filter(Boolean).join(" / "),
      ]);
      return;
    }

    if (openRow) {
      ledgerHighlight.push(index + 1);
      const recon = reconMap.get(match.matchId);
      noteParts.push(formatPlayerSubmissionState(match, recon));
      ledgerRows.push([
        text(match.matchId),
        text(match.blockId),
        match.roundNumber ?? "",
        match.courtNumber ?? "",
        text(match.scheduledTime),
        teamName(match.team1),
        teamNumber(match.team1),
        text(match.team1?.entryId),
        teamName(match.team2),
        teamNumber(match.team2),
        text(match.team2?.entryId),
        KIND_EXCEL,
        formula(`'${SHEET_OPEN}'!N${openRow}`),
        formula(`'${SHEET_OPEN}'!O${openRow}`),
        formula(`'${SHEET_OPEN}'!P${openRow}`),
        formula(`'${SHEET_OPEN}'!Q${openRow}`),
        formula(`'${SHEET_OPEN}'!T${openRow}`),
        formula(`'${SHEET_OPEN}'!V${openRow}`),
        formula(`'${SHEET_OPEN}'!X${openRow}`),
        formula(`'${SHEET_OPEN}'!Z${openRow}`),
        formula(`'${SHEET_OPEN}'!U${openRow}`),
        formula(`'${SHEET_OPEN}'!W${openRow}`),
        formula(`'${SHEET_OPEN}'!Y${openRow}`),
        formula(`'${SHEET_OPEN}'!AA${openRow}`),
        formula(`IF('${SHEET_OPEN}'!AB${openRow}="${STATUS_EXCEL_CONFIRMED}",1,0)`),
        formula(`'${SHEET_OPEN}'!AB${openRow}`),
        formula(`'${SHEET_OPEN}'!AC${openRow}`),
        noteParts.filter(Boolean).join(" / "),
      ]);
      return;
    }

    // Fallback: not escape-finished and not on open sheet
    ledgerRows.push([
      text(match.matchId),
      text(match.blockId),
      match.roundNumber ?? "",
      match.courtNumber ?? "",
      text(match.scheduledTime),
      teamName(match.team1),
      teamNumber(match.team1),
      text(match.team1?.entryId),
      teamName(match.team2),
      teamNumber(match.team2),
      text(match.team2?.entryId),
      KIND_EXCEL,
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      0,
      text(match.statusLabelJa || match.status || STATUS_EMPTY),
      "",
      text(match.noteJa),
    ]);
  });

  // --- _集計 ---
  // 手入力は表側「現在順位」のみ。ここは参照・集計専用（運営者は操作不要）。
  const standingsDataStartRow = 5; // 現在順位の先頭データ行（1-based）
  const standingsDataEndRow = standingsDataStartRow + Math.max(teamRows.length, 1) - 1;

  const aggHeader = [
    "entryId",
    "blockId",
    "ブロック名",
    "チーム名",
    "チーム番号",
    "記号",
    "予定試合数",
    "消化試合数",
    "セット勝",
    "セット分",
    "セット敗",
    "総得点",
    "",
    "sortKey",
    "自動順位",
    "同点人数",
    "同点要モルックアウト",
    "最終順位手入力",
    "順位確認",
    "確定順位",
    "残り試合",
  ];
  const aggRows = [aggHeader];

  teamRows.forEach((team, index) => {
    const r = index + 2;
    const sr = standingsDataStartRow + index;
    aggRows.push([
      team.entryId,
      team.blockId,
      team.blockName,
      team.teamName,
      team.displayTeamNumber,
      team.symbol,
      team.scheduledMatches,
      formula(
        `SUMIFS('${SHEET_LEDGER}'!Y:Y,'${SHEET_LEDGER}'!H:H,A${r},'${SHEET_LEDGER}'!Y:Y,1)+SUMIFS('${SHEET_LEDGER}'!Y:Y,'${SHEET_LEDGER}'!K:K,A${r},'${SHEET_LEDGER}'!Y:Y,1)`,
        team.playedMatches
      ),
      formula(
        `SUMIFS('${SHEET_LEDGER}'!Q:Q,'${SHEET_LEDGER}'!H:H,A${r},'${SHEET_LEDGER}'!Y:Y,1)+SUMIFS('${SHEET_LEDGER}'!U:U,'${SHEET_LEDGER}'!K:K,A${r},'${SHEET_LEDGER}'!Y:Y,1)`,
        team.setWins
      ),
      formula(
        `SUMIFS('${SHEET_LEDGER}'!R:R,'${SHEET_LEDGER}'!H:H,A${r},'${SHEET_LEDGER}'!Y:Y,1)+SUMIFS('${SHEET_LEDGER}'!V:V,'${SHEET_LEDGER}'!K:K,A${r},'${SHEET_LEDGER}'!Y:Y,1)`,
        team.setDraws
      ),
      formula(
        `SUMIFS('${SHEET_LEDGER}'!S:S,'${SHEET_LEDGER}'!H:H,A${r},'${SHEET_LEDGER}'!Y:Y,1)+SUMIFS('${SHEET_LEDGER}'!W:W,'${SHEET_LEDGER}'!K:K,A${r},'${SHEET_LEDGER}'!Y:Y,1)`,
        team.setLosses
      ),
      formula(
        `SUMIFS('${SHEET_LEDGER}'!T:T,'${SHEET_LEDGER}'!H:H,A${r},'${SHEET_LEDGER}'!Y:Y,1)+SUMIFS('${SHEET_LEDGER}'!X:X,'${SHEET_LEDGER}'!K:K,A${r},'${SHEET_LEDGER}'!Y:Y,1)`,
        team.totalScore
      ),
      "",
      formula(`I${r}*1000000+J${r}*1000+L${r}`),
      formula(`COUNTIFS(B:B,B${r},N:N,">"&N${r})+1`),
      formula(`COUNTIFS(B:B,B${r},N:N,N${r})`),
      formula(`IF(P${r}>1,"はい","いいえ")`),
      formula(`'${SHEET_STANDINGS}'!E${sr}`),
      formula(`'${SHEET_STANDINGS}'!F${sr}`),
      formula(
        `IF(AND(Q${r}="はい",R${r}<>"",S${r}="済"),R${r},IF(Q${r}="はい","同点・要モルックアウト",O${r}))`
      ),
      formula(`MAX(0,G${r}-H${r})`, team.remainingMatches),
    ]);
  });

  // --- 現在順位 ---
  const standingsRows = [];
  const standingsInputCells = [];
  standingsRows.push(["Excel運営順位（入力に応じて自動更新）", ""]);
  standingsRows.push([EMERGENCY_OPS_STANDINGS_GUIDE_JA, ""]);
  standingsRows.push([EMERGENCY_OPS_RANKING_RULES_JA, ""]);
  standingsRows.push([
    "ブロック",
    "確定順位",
    "自動順位",
    "同順位状態",
    "最終順位",
    "順位確認",
    "入力チェック",
    "チーム番号",
    "チーム名",
    "試合数",
    "セット勝",
    "セット敗",
    "セット分",
    "総得点",
    "残り",
    "entryId",
  ]);

  teamRows.forEach((_, index) => {
    const r = index + 2;
    const sr = standingsDataStartRow + index;
    // rows: 0 title, 1 guide, 2 rules, 3 header, 4+ data
    standingsInputCells.push({ row: 4 + index, col: 4 }, { row: 4 + index, col: 5 });
    standingsRows.push([
      formula(`'${SHEET_AGG}'!C${r}`),
      formula(
        `IF(OR(G${sr}="",G${sr}="OK"),'${SHEET_AGG}'!T${r},"要確認")`
      ),
      formula(`'${SHEET_AGG}'!O${r}`),
      formula(
        `IF('${SHEET_AGG}'!Q${r}="はい",IF(AND(E${sr}<>"",F${sr}="済"),"人手確定済","要モルックアウト"),"なし")`
      ),
      "",
      "",
      formula(
        `IF(AND(E${sr}="",F${sr}=""),"",IF(AND(F${sr}="済",E${sr}=""),"要確認:最終順位未入力",IF(AND(E${sr}<>"",F${sr}<>"済"),"要確認:順位確認未完了",IF(NOT(ISNUMBER(E${sr})),"要確認:順位が数値ではない",IF(E${sr}<=0,"要確認:順位が0以下",IF(E${sr}>COUNTIF($A$${standingsDataStartRow}:$A$${standingsDataEndRow},A${sr}),"要確認:ブロック人数超過",IF(COUNTIFS($A$${standingsDataStartRow}:$A$${standingsDataEndRow},A${sr},$E$${standingsDataStartRow}:$E$${standingsDataEndRow},E${sr},$F$${standingsDataStartRow}:$F$${standingsDataEndRow},"済")>1,"要確認:最終順位重複","OK")))))))`
      ),
      formula(`'${SHEET_AGG}'!E${r}`),
      formula(`'${SHEET_AGG}'!D${r}`),
      formula(`'${SHEET_AGG}'!H${r}`),
      formula(`'${SHEET_AGG}'!I${r}`),
      formula(`'${SHEET_AGG}'!K${r}`),
      formula(`'${SHEET_AGG}'!J${r}`),
      formula(`'${SHEET_AGG}'!L${r}`),
      formula(`'${SHEET_AGG}'!U${r}`),
      formula(`'${SHEET_AGG}'!A${r}`),
    ]);
  });

  standingsRows.push(["", ""]);
  standingsRows.push([
    gray("脱出時点順位（EmergencyExportV1 スナップショット・変更不可）"),
    gray(""),
  ]);
  standingsRows.push([
    gray("ブロック"),
    gray("順位"),
    gray("チーム番号"),
    gray("チーム名"),
    gray("試合数"),
    gray("セット勝"),
    gray("セット敗"),
    gray("セット分"),
    gray("総得点"),
    gray("残り試合"),
    gray("同点"),
    gray("モルックアウト要"),
    gray("モルックアウト適用済"),
    gray("記号"),
    gray("entryId"),
  ]);
  for (const team of teamRows) {
    standingsRows.push([
      gray(team.blockName),
      gray(team.rank),
      gray(team.displayTeamNumber),
      gray(team.teamName),
      gray(team.playedMatches),
      gray(team.setWins),
      gray(team.setLosses),
      gray(team.setDraws),
      gray(team.totalScore),
      gray(team.remainingMatches),
      gray(yesNo(team.tied)),
      gray(yesNo(team.needsMolkkyOut)),
      gray(yesNo(team.molkkyOutApplied)),
      gray(team.symbol),
      gray(team.entryId),
    ]);
  }

  const finalsPack = buildEmergencyOpsFinalsSheets(exportDoc);

  // --- 大会状況 ---
  const finishedAtEscape = qualifying.finishedMatches ?? "";
  const remainingAtEscape = qualifying.remainingMatches ?? "";
  const totalMatches = qualifying.totalMatches ?? "";

  const remainingFormula = `MAX(0,COUNTA('${SHEET_LEDGER}'!A:A)-1-SUM('${SHEET_LEDGER}'!Y:Y))`;
  const unresolvedFormula = `COUNTIF('${SHEET_AGG}'!T:T,"同点・要モルックアウト")+COUNTIF('${SHEET_STANDINGS}'!G:G,"要確認*")`;

  const situationRows = [
    ["項目", "値"],
    ["注意", EMERGENCY_OPS_EXCEL_NOTICE_JA],
  ];
  if (integrity.errorCount > 0) {
    situationRows.push(["整合性注意", EMERGENCY_OPS_EXCEL_ERROR_NOTICE_JA]);
  }
  situationRows.push(
    ["大会名", text(meta.tournamentName)],
    ["tournamentId", text(meta.tournamentId)],
    ["Excel出力日時", text(meta.exportedAt)],
    ["EmergencyExport schemaVersion", meta.schemaVersion ?? ""],
    ["現在フェーズ", text(situation.phaseLabelJa || situation.phase)],
    ["確定参加チーム数", confirmed.length],
    ["順位計算ルール", EMERGENCY_OPS_RANKING_RULES_JA],
    ["予選総試合数", totalMatches],
    ["予選終了試合数", finishedAtEscape],
    ["予選未消化試合数", remainingAtEscape],
    ["脱出時点終了試合数", finishedAtEscape],
    [
      "Excel切替後入力試合数",
      formula(
        `COUNTIFS('${SHEET_LEDGER}'!L:L,"${KIND_EXCEL}",'${SHEET_LEDGER}'!Y:Y,1)`,
        0
      ),
    ],
    ["現在終了試合数", formula(`SUM('${SHEET_LEDGER}'!Y:Y)`, finishedAtEscape)],
    ["残り試合数", formula(remainingFormula, remainingAtEscape)],
    [
      "要確認試合数",
      formula(`COUNTIF('${SHEET_OPEN}'!AB:AB,"${STATUS_NEED_CONFIRM}")`, 0),
    ],
    ["順位未確定件数", formula(unresolvedFormula, 0)],
    [
      "予選完了フラグ",
      formula(
        `IF(${remainingFormula}>0,"予選未完了",IF(${unresolvedFormula}>0,"予選試合終了・順位確定待ち","予選完了：決勝進出処理へ進めます"))`,
        "予選未完了"
      ),
    ],
    ...finalsPack.situationExtras,
    ["決勝進出判定が確定済みか", yesNo(finalsAdv.finalized === true)],
    ["integrity ERROR件数", integrity.errorCount],
    ["integrity WARNING件数", integrity.warningCount],
    ["integrity INFO件数", integrity.infoCount],
    ["状況サマリー", text(situation.summaryJa)],
    ["", ""],
    ["integrity 詳細", "severity / message"],
    ...integrity.items.map((item) => [
      text(item.code),
      `${text(item.severity)} / ${text(item.messageJa)}`,
    ]),
    ["", ""],
    ["次にやること", ""],
    ...asArray(situation.nextActionsJa).map((action, index) => [
      `次アクション${index + 1}`,
      text(action),
    ])
  );


  return {
    meta: {
      tournamentId: text(meta.tournamentId),
      tournamentName: text(meta.tournamentName),
      schemaVersion: meta.schemaVersion ?? null,
      exportedAt: text(meta.exportedAt),
      errorCount: integrity.errorCount,
      warningCount: integrity.warningCount,
      infoCount: integrity.infoCount,
    },
    sheets: [
      {
        name: SHEET_SITUATION,
        rows: situationRows,
        columns: [{ width: 28 }, { width: 72 }],
        freeze: { rows: 1, cols: 0 },
      },
      {
        name: SHEET_LEDGER,
        rows: ledgerRows,
        columns: [
          { width: 22 },
          { width: 10 },
          { width: 8 },
          { width: 8 },
          { width: 12 },
          { width: 16 },
          { width: 8 },
          { width: 12 },
          { width: 16 },
          { width: 8 },
          { width: 12 },
          { width: 12 },
          { width: 8 },
          { width: 8 },
          { width: 8 },
          { width: 8 },
          { width: 8 },
          { width: 8 },
          { width: 8 },
          { width: 8 },
          { width: 8 },
          { width: 8 },
          { width: 8 },
          { width: 8 },
          { width: 10 },
          { width: 12 },
          { width: 14 },
          { width: 28 },
        ],
        freeze: { rows: 1, cols: 0 },
        autoFilter: true,
        highlightRowIndexes: ledgerHighlight,
      },
      {
        name: SHEET_STANDINGS,
        rows: standingsRows,
        columns: [
          { width: 12 },
          { width: 12 },
          { width: 10 },
          { width: 14 },
          { width: 10 },
          { width: 10 },
          { width: 22 },
          { width: 10 },
          { width: 18 },
          { width: 8 },
          { width: 8 },
          { width: 8 },
          { width: 8 },
          { width: 10 },
          { width: 8 },
          { width: 14 },
        ],
        freeze: { rows: 4, cols: 0 },
        inputCells: standingsInputCells,
      },
      {
        name: SHEET_OPEN,
        rows: openRows,
        columns: [
          { width: 8 },
          { width: 22 },
          { width: 10 },
          { width: 8 },
          { width: 8 },
          { width: 12 },
          { width: 16 },
          { width: 8 },
          { width: 12 },
          { width: 16 },
          { width: 8 },
          { width: 12 },
          { width: 36 },
          { width: 8 },
          { width: 8 },
          { width: 8 },
          { width: 8 },
          { width: 10 },
          { width: 10 },
          { width: 8 },
          { width: 8 },
          { width: 8 },
          { width: 8 },
          { width: 8 },
          { width: 8 },
          { width: 8 },
          { width: 8 },
          { width: 12 },
          { width: 14 },
          { width: 10 },
          { width: 24 },
        ],
        freeze: { rows: 1, cols: 0 },
        autoFilter: true,
        highlightRowIndexes: openHighlight,
        inputCells: openInputCells,
      },
      ...finalsPack.sheets,
      {
        name: SHEET_AGG,
        rows: aggRows,
        hidden: true,
        columns: [
          { width: 14 },
          { width: 10 },
          { width: 12 },
          { width: 18 },
          { width: 10 },
          { width: 8 },
          { width: 10 },
          { width: 10 },
          { width: 8 },
          { width: 8 },
          { width: 8 },
          { width: 10 },
          { width: 4 },
          { width: 12 },
          { width: 10 },
          { width: 10 },
          { width: 16 },
          { width: 12 },
          { width: 10 },
          { width: 18 },
          { width: 10 },
        ],
        freeze: { rows: 1, cols: 0 },
      },
    ],
  };
}

/**
 * @param {object} exportDoc
 * @returns {Uint8Array}
 */
export function buildEmergencyOpsExcelBytes(exportDoc) {
  const model = buildEmergencyOpsExcelModel(exportDoc);
  return buildXlsxArrayBuffer({
    sheets: model.sheets.map((sheet) => ({
      name: sheet.name,
      rows: sheet.rows,
      columns: sheet.columns,
      freeze: sheet.freeze,
      autoFilter: sheet.autoFilter === true,
      highlightRowIndexes: sheet.highlightRowIndexes || [],
      inputCells: sheet.inputCells || [],
      hidden: sheet.hidden === true,
    })),
  });
}

/**
 * @param {string} tournamentId
 * @param {string} [exportedAtIso]
 */
export function buildEmergencyOpsExcelFileName(tournamentId, exportedAtIso) {
  const id = text(tournamentId || "tournament").replace(/[^\w.-]+/g, "-") || "tournament";
  const stampSource = exportedAtIso ? new Date(exportedAtIso) : new Date();
  const stamp = Number.isNaN(stampSource.getTime())
    ? new Date().toISOString()
    : stampSource.toISOString();
  const compact = stamp.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z").replace("T", "-");
  return `sma-emergency-ops-${id}-${compact}.xlsx`;
}

/**
 * Excel セル文字列に禁止キー名が混入していないことを検査する。
 * @param {object} exportDoc
 * @param {ReturnType<typeof buildEmergencyOpsExcelModel>|null} [model]
 */
export function collectEmergencyOpsExcelForbiddenHits(exportDoc, model = null) {
  const workbook = model || buildEmergencyOpsExcelModel(exportDoc);
  const haystack = workbook.sheets
    .flatMap((sheet) => sheet.rows.flat())
    .map((cell) => cellHaystack(cell))
    .join("\n");

  const hits = [];
  for (const key of EMERGENCY_EXPORT_FORBIDDEN_KEYS) {
    if (haystack.includes(key)) {
      hits.push(key);
    }
  }
  return hits;
}
