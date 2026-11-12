/**
 * EmergencyExportV1 integrityChecks（DOM / Firestore 非依存）
 */
import { EntryStatus } from "./constants.js";
import { buildScheduleMatchIndex } from "./qualifying-match-result.js";
import {
  applyMolkkyOutResolutions,
  buildQualifyingStandings,
  hasUnresolvedBlockMolkkyOuts,
  listUnresolvedBlockMolkkyOutGroups,
} from "./qualifying-standings.js";
import { getQualifyingCompletionStatus } from "./finals-advancement.js";
import { collectCancelledEntryIds } from "./qualifying-withdrawal.js";
import { MatchReconciliationState } from "./player-qualifying-submission.js";
import { buildEntryTeamNameLookup } from "./entry-team-name-overlay.js";
import {
  EmergencyExportIntegrityCode,
  EmergencyExportIntegritySeverity,
} from "./emergency-export-schema.js";

function toIdMap(value) {
  if (!value) {
    return {};
  }
  if (value instanceof Map) {
    const object = {};
    for (const [key, nested] of value.entries()) {
      object[String(key)] = nested;
    }
    return object;
  }
  if (Array.isArray(value)) {
    const object = {};
    for (const item of value) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const id = item.matchId ?? item.roundId ?? item.entryId ?? item.id;
      if (id) {
        object[String(id)] = item;
      }
    }
    return object;
  }
  if (typeof value === "object") {
    return { ...value };
  }
  return {};
}

function asMap(value) {
  if (value instanceof Map) {
    return value;
  }
  return new Map(Object.entries(toIdMap(value)));
}

function addItem(items, { code, severity, scope, messageJa, refs = null }) {
  items.push({
    code,
    severity,
    scope,
    messageJa,
    refs,
  });
}

function entryIdsFromEntries(entries) {
  const ids = new Set();
  for (const entry of entries || []) {
    const id = entry?.id ?? entry?.entryId;
    if (id) {
      ids.add(String(id));
    }
  }
  return ids;
}

function collectBracketEntryIds(bracket) {
  const ids = new Set();
  for (const slot of bracket?.slots || []) {
    const id = slot?.entryId ?? slot?.team?.entryId;
    if (id) {
      ids.add(String(id));
    }
  }
  for (const match of bracket?.matches || []) {
    for (const team of [match.team1, match.team2]) {
      if (team?.entryId && !team.isBye) {
        ids.add(String(team.entryId));
      }
    }
  }
  return ids;
}

/**
 * @param {object} input
 * @param {object} source
 * @param {object} derived
 */
export function buildEmergencyExportIntegrity(input, source, derived) {
  const items = [];
  const entries = Array.isArray(input.entries) ? input.entries : [];
  const cancelledEntryIds = collectCancelledEntryIds(entries);
  const entryIds = entryIdsFromEntries(entries);
  const confirmed = entries.filter((entry) => entry.status === EntryStatus.CONFIRMED);
  const scheduleIndex = buildScheduleMatchIndex(input.qualifyingSchedule);
  const resultsMap = asMap(input.qualifyingMatchResults);
  const sessionsMap = asMap(input.qualifyingMatchSessions);
  const nameLookup = buildEntryTeamNameLookup(entries);

  for (const [matchId, match] of scheduleIndex.entries()) {
    for (const team of [match.team1, match.team2]) {
      const id = team?.entryId;
      if (id && !entryIds.has(String(id))) {
        addItem(items, {
          code: EmergencyExportIntegrityCode.ENTRY_MISSING_FOR_SCHEDULE,
          severity: EmergencyExportIntegritySeverity.ERROR,
          scope: "qualifying",
          messageJa: `予選組合せ ${matchId} の entryId ${id} が entries にありません。`,
          refs: { matchId, entryId: String(id) },
        });
      }
    }
  }

  for (const block of input.blockDraw?.blocks || []) {
    for (const id of block.entryIds || []) {
      if (id && !entryIds.has(String(id))) {
        addItem(items, {
          code: EmergencyExportIntegrityCode.ENTRY_MISSING_FOR_DRAW,
          severity: EmergencyExportIntegritySeverity.ERROR,
          scope: "blockDraw",
          messageJa: `ブロック抽選 ${block.id || block.blockId || ""} の entryId ${id} が entries にありません。`,
          refs: { blockId: block.id ?? block.blockId ?? null, entryId: String(id) },
        });
      }
    }
  }

  for (const matchId of resultsMap.keys()) {
    if (!scheduleIndex.has(matchId)) {
      addItem(items, {
        code: EmergencyExportIntegrityCode.ORPHAN_QUALIFYING_RESULT,
        severity: EmergencyExportIntegritySeverity.ERROR,
        scope: "qualifying",
        messageJa: `予選結果 ${matchId} に対応する組合せがありません。`,
        refs: { matchId },
      });
    }
  }

  const finalsMatchIds = new Set((input.finalsBracket?.matches || []).map((match) => match.matchId));
  for (const matchId of Object.keys(toIdMap(input.finalsMatchResults))) {
    if (!finalsMatchIds.has(matchId)) {
      addItem(items, {
        code: EmergencyExportIntegrityCode.ORPHAN_FINALS_RESULT,
        severity: EmergencyExportIntegritySeverity.ERROR,
        scope: "finals",
        messageJa: `決勝結果 ${matchId} に対応するブラケット試合がありません。`,
        refs: { matchId },
      });
    }
  }

  if (input.finalsAdvancement?.finalized && input.finalsBracket) {
    const qualifierIds = new Set(
      (input.finalsAdvancement.qualifiers || []).map((item) => item.entryId).filter(Boolean).map(String)
    );
    const bracketIds = collectBracketEntryIds(input.finalsBracket);
    const missingInBracket = [...qualifierIds].filter((id) => !bracketIds.has(id));
    const extraInBracket = [...bracketIds].filter((id) => !qualifierIds.has(id));
    if (missingInBracket.length > 0 || extraInBracket.length > 0) {
      addItem(items, {
        code: EmergencyExportIntegrityCode.ADVANCEMENT_BRACKET_MISMATCH,
        severity: EmergencyExportIntegritySeverity.ERROR,
        scope: "finals",
        messageJa: "決勝進出者とブラケット参加者の集合が一致しません。",
        refs: { missingInBracket, extraInBracket },
      });
    }
  }

  if (input.qualifyingSchedule?.finalized) {
    const standings = buildQualifyingStandings(input.qualifyingSchedule, resultsMap, {
      cancelledEntryIds,
    });
    if (!standings) {
      addItem(items, {
        code: EmergencyExportIntegrityCode.STANDINGS_INPUT_INCOMPLETE,
        severity: EmergencyExportIntegritySeverity.ERROR,
        scope: "qualifying",
        messageJa: "予選組合せは確定していますが、順位を計算できません。",
        refs: null,
      });
    }
  }

  const completion = getQualifyingCompletionStatus(input.qualifyingSchedule, resultsMap, {
    cancelledEntryIds,
  });
  if (input.finalsAdvancement?.finalized && input.qualifyingSchedule?.finalized && !completion.complete) {
    addItem(items, {
      code: EmergencyExportIntegrityCode.ADVANCEMENT_WITHOUT_COMPLETE_QUALIFYING,
      severity: EmergencyExportIntegritySeverity.ERROR,
      scope: "advancement",
      messageJa: "予選が未完了のまま決勝進出が確定されています。",
      refs: {
        remainingMatches: completion.remainingMatches,
      },
    });
  }

  for (const [matchId, recon] of asMap(input.qualifyingMatchReconciliations).entries()) {
    const official = resultsMap.get(matchId);
    if (recon?.state === MatchReconciliationState.CONFLICT && !official) {
      addItem(items, {
        code: EmergencyExportIntegrityCode.PLAYER_SUBMISSION_CONFLICT,
        severity: EmergencyExportIntegritySeverity.WARNING,
        scope: "playerPipeline",
        messageJa: `試合 ${matchId} のプレイヤー提出が競合しており、公式結果がありません。`,
        refs: { matchId },
      });
    }
    if (recon?.state === MatchReconciliationState.AWAITING_OPPONENT && !official) {
      addItem(items, {
        code: EmergencyExportIntegrityCode.PLAYER_SUBMISSION_AWAITING,
        severity: EmergencyExportIntegritySeverity.INFO,
        scope: "playerPipeline",
        messageJa: `試合 ${matchId} は片側のみ提出済みです。`,
        refs: { matchId },
      });
    }
  }

  const standingsForMolkky = derived?.qualifyingStandings
    ? derived.qualifyingStandings
    : applyMolkkyOutResolutions(
        buildQualifyingStandings(input.qualifyingSchedule, resultsMap, { cancelledEntryIds }),
        input.molkkyOutResolutions
      );
  if (
    completion.complete &&
    hasUnresolvedBlockMolkkyOuts(standingsForMolkky) &&
    !input.finalsAdvancement?.finalized
  ) {
    const groups = listUnresolvedBlockMolkkyOutGroups(standingsForMolkky);
    addItem(items, {
      code: EmergencyExportIntegrityCode.MOLKKY_OUT_UNRESOLVED,
      severity: EmergencyExportIntegritySeverity.WARNING,
      scope: "qualifying",
      messageJa: `ブロック内にモルックアウト未解消の同点があります（${groups.length}件）。`,
      refs: {
        groups: groups.map((group) => ({
          blockId: group.blockId,
          entryIds: group.entryIds,
        })),
      },
    });
  }

  for (const [matchId, match] of scheduleIndex.entries()) {
    for (const team of [match.team1, match.team2]) {
      const id = team?.entryId;
      if (!id) {
        continue;
      }
      const live = nameLookup.get(String(id));
      const stored = typeof team.teamName === "string" ? team.teamName.trim() : "";
      if (live && stored && live !== stored) {
        addItem(items, {
          code: EmergencyExportIntegrityCode.TEAM_NAME_STALE,
          severity: EmergencyExportIntegritySeverity.WARNING,
          scope: "qualifying",
          messageJa: `試合 ${matchId} の保存チーム名「${stored}」と現在の「${live}」が異なります。`,
          refs: { matchId, entryId: String(id) },
        });
      }
    }
  }

  const knownMatchIds = new Set([
    ...scheduleIndex.keys(),
    ...(input.finalsBracket?.matches || []).map((match) => match.matchId),
    ...(input.consolationBracket?.matches || []).map((match) => match.matchId),
  ]);
  for (const matchId of sessionsMap.keys()) {
    if (!knownMatchIds.has(matchId) && !scheduleIndex.has(matchId)) {
      addItem(items, {
        code: EmergencyExportIntegrityCode.SESSION_WITHOUT_SCHEDULE,
        severity: EmergencyExportIntegritySeverity.WARNING,
        scope: "qualifying",
        messageJa: `セッション ${matchId} に対応する組合せがありません。`,
        refs: { matchId },
      });
    }
  }

  for (const matchId of sessionsMap.keys()) {
    if (resultsMap.has(matchId)) {
      addItem(items, {
        code: EmergencyExportIntegrityCode.SESSION_AND_RESULT,
        severity: EmergencyExportIntegritySeverity.INFO,
        scope: "qualifying",
        messageJa: `試合 ${matchId} はセッションと公式結果の両方が存在します（終了後は正常です）。`,
        refs: { matchId },
      });
    }
  }

  const unassigned = confirmed.filter((entry) => {
    const n = Number(entry.teamNumber);
    return !Number.isInteger(n) || n < 1;
  });
  if (unassigned.length > 0) {
    addItem(items, {
      code: EmergencyExportIntegrityCode.TEAM_NUMBER_UNASSIGNED,
      severity: EmergencyExportIntegritySeverity.INFO,
      scope: "entries",
      messageJa: `チーム番号未保存の確定参加が ${unassigned.length} 件あります。derived で補完しています。`,
      refs: {
        entryIds: unassigned.map((entry) => entry.id ?? entry.entryId),
      },
    });
  }

  const storedConfirmedCount = Number(input.tournament?.confirmedCount);
  if (Number.isInteger(storedConfirmedCount) && storedConfirmedCount !== confirmed.length) {
    addItem(items, {
      code: EmergencyExportIntegrityCode.CONFIRMED_COUNT_MISMATCH,
      severity: EmergencyExportIntegritySeverity.INFO,
      scope: "tournament",
      messageJa: `大会本体の confirmedCount（${storedConfirmedCount}）と確定 entries（${confirmed.length}）が異なります。entries を正とします。`,
      refs: {
        storedConfirmedCount,
        actualConfirmedCount: confirmed.length,
      },
    });
  }

  if (confirmed.some((entry) => entry.isDummy === true)) {
    addItem(items, {
      code: EmergencyExportIntegrityCode.DUMMY_IN_LIVE_EVENT,
      severity: EmergencyExportIntegritySeverity.INFO,
      scope: "entries",
      messageJa: "確定参加者にダミーチームが含まれています。",
      refs: {
        dummyCount: confirmed.filter((entry) => entry.isDummy === true).length,
      },
    });
  }

  const errorCount = items.filter((item) => item.severity === EmergencyExportIntegritySeverity.ERROR)
    .length;
  const warningCount = items.filter(
    (item) => item.severity === EmergencyExportIntegritySeverity.WARNING
  ).length;

  return {
    ok: errorCount === 0,
    errorCount,
    warningCount,
    items,
  };
}
