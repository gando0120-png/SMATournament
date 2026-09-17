/**
 * 抽選確定前の予選構成変更（DOM / Firestore 非依存）
 *
 * 変更対象は blockCount / qualifiersPerBlock / finalTeamCount / wildcardComparisonMode。
 * maxTeams / teamSize は触らない。
 * blockDraw が draft のときは service が先に破棄してから本体を更新する。
 */
import { TournamentStatus } from "./constants.js";
import {
  computeQualifyingAdvancementCounts,
  formatBlockDistributionLabel,
  resolveStoredOrDerivedFinalTeamCount,
  validateBlockConfiguration,
} from "./block-configuration.js";
import { isMaterialBracket } from "./finals-match-format.js";
import { isBlockDrawFinalized } from "./block-draw-state.js";
import { TournamentFormat } from "./tournament-format.js";
import {
  isAllowedWildcardComparisonMode,
  resolveWildcardComparisonMode,
} from "./wildcard-comparison.js";
import {
  hasAnyQualifyingMatchResults,
  hasStartedQualifyingMatchSession,
} from "./finals-advancement-settings-edit.js";
import { removeUndefinedFields } from "../lib/remove-undefined-fields.js";

export const QualifyingStructureSettingsEditReasonCode = {
  ELIGIBLE: "ELIGIBLE",
  UNSUPPORTED_FORMAT: "UNSUPPORTED_FORMAT",
  NOT_OPEN: "NOT_OPEN",
  BLOCK_DRAW_FINALIZED: "BLOCK_DRAW_FINALIZED",
  QUALIFYING_SCHEDULE_EXISTS: "QUALIFYING_SCHEDULE_EXISTS",
  QUALIFYING_STARTED: "QUALIFYING_STARTED",
  FINALS_ADVANCEMENT_EXISTS: "FINALS_ADVANCEMENT_EXISTS",
  FINALS_BRACKET_EXISTS: "FINALS_BRACKET_EXISTS",
  CONSOLATION_BRACKET_EXISTS: "CONSOLATION_BRACKET_EXISTS",
};

export const QUALIFYING_STRUCTURE_SETTINGS_NOT_EDITABLE_CODE =
  "qualifying-structure-settings/not-editable";

export const QUALIFYING_STRUCTURE_SETTINGS_INVALID_CODE =
  "qualifying-structure-settings/invalid";

export const QUALIFYING_STRUCTURE_SETTINGS_DRAFT_REMAINING_CODE =
  "qualifying-structure-settings/draft-remaining";

/**
 * @param {string|null|undefined} reasonCode
 */
export function getQualifyingStructureSettingsEditErrorMessage(reasonCode) {
  switch (reasonCode) {
    case QualifyingStructureSettingsEditReasonCode.BLOCK_DRAW_FINALIZED:
      return "抽選確定後はブロック数を変更できません。";
    case QualifyingStructureSettingsEditReasonCode.QUALIFYING_SCHEDULE_EXISTS:
      return "予選対戦表の作成後はブロック数を変更できません。";
    case QualifyingStructureSettingsEditReasonCode.QUALIFYING_STARTED:
      return "予選開始後は大会構成を変更できません。";
    case QualifyingStructureSettingsEditReasonCode.FINALS_ADVANCEMENT_EXISTS:
      return "決勝進出確定後は大会構成を変更できません。";
    case QualifyingStructureSettingsEditReasonCode.FINALS_BRACKET_EXISTS:
    case QualifyingStructureSettingsEditReasonCode.CONSOLATION_BRACKET_EXISTS:
      return "トーナメント表の生成後は大会構成を変更できません。";
    case QualifyingStructureSettingsEditReasonCode.NOT_OPEN:
      return "受付開始前、または終了済みの大会では大会構成を変更できません。";
    case QualifyingStructureSettingsEditReasonCode.UNSUPPORTED_FORMAT:
      return "この大会形式では予選構成を変更できません。";
    default:
      return "大会構成を変更できません。";
  }
}

/**
 * @param {object} params
 */
export function assessQualifyingStructureSettingsEditEligibility({
  tournament,
  blockDraw = null,
  qualifyingSchedule = null,
  qualifyingMatchResults = null,
  qualifyingMatchSessions = null,
  finalsAdvancement = null,
  finalsBracket = null,
  consolationBracket = null,
  signals = null,
} = {}) {
  if (tournament?.tournamentFormat !== TournamentFormat.QUALIFYING_AND_FINALS) {
    return {
      eligible: false,
      reasonCode: QualifyingStructureSettingsEditReasonCode.UNSUPPORTED_FORMAT,
    };
  }

  if (tournament?.status !== TournamentStatus.OPEN) {
    return {
      eligible: false,
      reasonCode: QualifyingStructureSettingsEditReasonCode.NOT_OPEN,
    };
  }

  if (isBlockDrawFinalized(blockDraw) || signals?.hasFinalizedBlockDraw === true) {
    return {
      eligible: false,
      reasonCode: QualifyingStructureSettingsEditReasonCode.BLOCK_DRAW_FINALIZED,
    };
  }

  if (qualifyingSchedule || signals?.hasQualifyingSchedule === true) {
    return {
      eligible: false,
      reasonCode: QualifyingStructureSettingsEditReasonCode.QUALIFYING_SCHEDULE_EXISTS,
    };
  }

  if (finalsAdvancement || signals?.hasFinalsAdvancement === true) {
    return {
      eligible: false,
      reasonCode: QualifyingStructureSettingsEditReasonCode.FINALS_ADVANCEMENT_EXISTS,
    };
  }

  if (isMaterialBracket(finalsBracket) || signals?.hasMaterialFinalsBracket === true) {
    return {
      eligible: false,
      reasonCode: QualifyingStructureSettingsEditReasonCode.FINALS_BRACKET_EXISTS,
    };
  }

  if (
    isMaterialBracket(consolationBracket) ||
    signals?.hasMaterialConsolationBracket === true
  ) {
    return {
      eligible: false,
      reasonCode: QualifyingStructureSettingsEditReasonCode.CONSOLATION_BRACKET_EXISTS,
    };
  }

  if (
    hasAnyQualifyingMatchResults(qualifyingMatchResults) ||
    signals?.hasQualifyingMatchResults === true ||
    hasStartedQualifyingMatchSession(qualifyingMatchSessions) ||
    signals?.hasStartedQualifyingMatchSessions === true
  ) {
    return {
      eligible: false,
      reasonCode: QualifyingStructureSettingsEditReasonCode.QUALIFYING_STARTED,
    };
  }

  return {
    eligible: true,
    reasonCode: QualifyingStructureSettingsEditReasonCode.ELIGIBLE,
  };
}

/**
 * @param {object} eligibility
 */
export function assertQualifyingStructureSettingsEditable(eligibility) {
  if (eligibility?.eligible === true) {
    return;
  }
  const error = new Error(
    getQualifyingStructureSettingsEditErrorMessage(eligibility?.reasonCode)
  );
  error.code = QUALIFYING_STRUCTURE_SETTINGS_NOT_EDITABLE_CODE;
  error.reasonCode = eligibility?.reasonCode ?? null;
  throw error;
}

/**
 * @param {object} params
 */
export function buildQualifyingStructureSettingsUpdateFields({
  tournament,
  blockCount,
  qualifiersPerBlock,
  finalTeamCount,
  wildcardComparisonMode = null,
  confirmedTeamCount,
} = {}) {
  const configValidation = validateBlockConfiguration({
    teamCount: confirmedTeamCount,
    blockCount,
    qualifiersPerBlock,
  });
  if (!configValidation.valid) {
    const error = new Error(configValidation.errors[0] ?? "ブロック設定が不正です。");
    error.code = QUALIFYING_STRUCTURE_SETTINGS_INVALID_CODE;
    throw error;
  }

  const advancement = computeQualifyingAdvancementCounts({
    blockCount,
    qualifiersPerBlock,
    finalTeamCount,
    teamCount: Math.max(confirmedTeamCount, tournament?.maxTeams ?? 0),
  });
  if (!advancement.valid) {
    const error = new Error(advancement.errors[0] ?? "決勝枠の設定が不正です。");
    error.code = QUALIFYING_STRUCTURE_SETTINGS_INVALID_CODE;
    throw error;
  }

  const resolvedComparisonMode =
    wildcardComparisonMode === "normalized" || wildcardComparisonMode === "raw"
      ? wildcardComparisonMode
      : advancement.wildcardCount > 0
        ? "normalized"
        : tournament?.wildcardComparisonMode === "normalized"
          ? "normalized"
          : "raw";

  if (!isAllowedWildcardComparisonMode(resolvedComparisonMode)) {
    const error = new Error("ワイルドカード比較方法が不正です。");
    error.code = QUALIFYING_STRUCTURE_SETTINGS_INVALID_CODE;
    throw error;
  }

  /** @type {Record<string, unknown>} */
  const next = {
    blockCount,
    qualifiersPerBlock,
    finalTeamCount,
    wildcardComparisonMode: resolvedComparisonMode,
  };

  /** @type {Record<string, unknown>} */
  const changed = {};
  if (tournament?.blockCount !== next.blockCount) {
    changed.blockCount = next.blockCount;
  }
  if (tournament?.qualifiersPerBlock !== next.qualifiersPerBlock) {
    changed.qualifiersPerBlock = next.qualifiersPerBlock;
  }
  if (tournament?.finalTeamCount !== next.finalTeamCount) {
    changed.finalTeamCount = next.finalTeamCount;
  }
  if (
    resolveWildcardComparisonMode(tournament?.wildcardComparisonMode) !==
    next.wildcardComparisonMode
  ) {
    changed.wildcardComparisonMode = next.wildcardComparisonMode;
  }

  return {
    valid: true,
    fields: removeUndefinedFields(changed),
    next,
    advancement,
    distribution: configValidation.distribution,
  };
}

/**
 * @param {object|null|undefined} blockDraw
 */
export function qualifyingStructureChangeRequiresDraftDiscard(blockDraw) {
  return blockDraw?.status === "draft";
}

/**
 * @param {object} params
 */
export function formatQualifyingStructureDraftDiscardConfirmMessage({
  previousBlockCount = null,
  nextBlockCount = null,
} = {}) {
  const lines = [
    "現在の抽選案を破棄して大会構成を変更します。",
    "抽選確定前なので試合結果には影響しません。",
  ];
  if (
    Number.isInteger(previousBlockCount) &&
    Number.isInteger(nextBlockCount) &&
    previousBlockCount !== nextBlockCount
  ) {
    lines.push("", `ブロック数：${previousBlockCount} → ${nextBlockCount}`);
  }
  lines.push("", "この変更を保存しますか？");
  return lines.join("\n");
}

/**
 * 確認ダイアログキャンセル時にフォームへ戻す保存済み値。
 * Firestore write はしない。呼び出し側の currentTournament を使う。
 * @param {object|null|undefined} tournament
 */
export function readSavedQualifyingStructureFormValues(tournament) {
  return {
    blockCount: Number.isInteger(tournament?.blockCount) ? tournament.blockCount : null,
    qualifiersPerBlock: Number.isInteger(tournament?.qualifiersPerBlock)
      ? tournament.qualifiersPerBlock
      : null,
    finalTeamCount: resolveStoredOrDerivedFinalTeamCount(tournament),
    wildcardComparisonMode: resolveWildcardComparisonMode(
      tournament?.wildcardComparisonMode
    ),
  };
}

/**
 * ダッシュボード保存前プレビュー
 * @param {object} params
 */
export function buildQualifyingStructureSettingsPreview({
  confirmedTeamCount,
  blockCount,
  qualifiersPerBlock,
  finalTeamCount,
  maxTeams = null,
} = {}) {
  const confirmed = Number.isInteger(confirmedTeamCount) ? confirmedTeamCount : 0;
  const distribution =
    confirmed >= 1 && Number.isInteger(blockCount) && blockCount > 0
      ? validateBlockConfiguration({
          teamCount: confirmed,
          blockCount,
          qualifiersPerBlock,
        })
      : null;
  const teamCountForAdvancement = Math.max(confirmed, Number(maxTeams) || 0);
  const advancement = computeQualifyingAdvancementCounts({
    blockCount,
    qualifiersPerBlock,
    finalTeamCount,
    teamCount: teamCountForAdvancement > 0 ? teamCountForAdvancement : null,
  });

  return {
    confirmedTeamCount: confirmed,
    blockCount,
    qualifiersPerBlock,
    finalTeamCount: advancement.finalTeamCount ?? finalTeamCount ?? null,
    autoPassCount: advancement.autoPassCount,
    wildcardCount: advancement.wildcardCount,
    distributionLabel:
      distribution?.valid === true
        ? formatBlockDistributionLabel(distribution.distribution, blockCount)
        : null,
    distributionError:
      confirmed >= 1 && distribution && distribution.valid !== true
        ? distribution.errors[0] ?? null
        : null,
    advancementValid: advancement.valid,
    advancementError: advancement.valid ? null : advancement.errors[0] ?? null,
  };
}
