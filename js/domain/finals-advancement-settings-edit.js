/**
 * 抽選確定後・予選開始前の決勝進出条件再編集（DOM / Firestore 非依存）
 *
 * 変更対象は qualifiersPerBlock / finalTeamCount / wildcardComparisonMode のみ。
 * blockCount・blockDraw・qualifyingSchedules は変更しない。
 */
import { MatchSessionStatus } from "./constants.js";
import {
  computeQualifyingAdvancementCounts,
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
import { removeUndefinedFields } from "../lib/remove-undefined-fields.js";

export const FinalsAdvancementSettingsEditReasonCode = {
  ELIGIBLE: "ELIGIBLE",
  UNSUPPORTED_FORMAT: "UNSUPPORTED_FORMAT",
  BLOCK_DRAW_NOT_FINALIZED: "BLOCK_DRAW_NOT_FINALIZED",
  QUALIFYING_STARTED: "QUALIFYING_STARTED",
  FINALS_ADVANCEMENT_EXISTS: "FINALS_ADVANCEMENT_EXISTS",
  FINALS_BRACKET_EXISTS: "FINALS_BRACKET_EXISTS",
  CONSOLATION_BRACKET_EXISTS: "CONSOLATION_BRACKET_EXISTS",
};

export const FINALS_ADVANCEMENT_SETTINGS_NOT_EDITABLE_CODE =
  "finals-advancement-settings/not-editable";

export const FINALS_ADVANCEMENT_SETTINGS_INVALID_CODE =
  "finals-advancement-settings/invalid";

/**
 * @param {unknown} results
 */
export function hasAnyQualifyingMatchResults(results) {
  if (!results) {
    return false;
  }
  if (typeof results.size === "number") {
    return results.size > 0;
  }
  if (Array.isArray(results)) {
    return results.length > 0;
  }
  return false;
}

/**
 * @param {unknown} sessions
 */
function toSessionList(sessions) {
  if (!sessions) {
    return [];
  }
  if (typeof sessions.values === "function" && typeof sessions.size === "number") {
    return [...sessions.values()];
  }
  if (Array.isArray(sessions)) {
    return sessions;
  }
  return [];
}

/**
 * playing / finished の予選セッションがあるか
 * @param {unknown} sessions
 */
export function hasStartedQualifyingMatchSession(sessions) {
  return toSessionList(sessions).some((session) => {
    const status = session?.status;
    return (
      status === MatchSessionStatus.PLAYING ||
      status === MatchSessionStatus.FINISHED ||
      status === "playing" ||
      status === "finished"
    );
  });
}

/**
 * @param {string|null|undefined} reasonCode
 */
export function getFinalsAdvancementSettingsEditErrorMessage(reasonCode) {
  switch (reasonCode) {
    case FinalsAdvancementSettingsEditReasonCode.QUALIFYING_STARTED:
      return "予選開始後は進出条件を変更できません。";
    case FinalsAdvancementSettingsEditReasonCode.FINALS_ADVANCEMENT_EXISTS:
      return "決勝進出確定後は進出条件を変更できません。";
    case FinalsAdvancementSettingsEditReasonCode.FINALS_BRACKET_EXISTS:
    case FinalsAdvancementSettingsEditReasonCode.CONSOLATION_BRACKET_EXISTS:
      return "トーナメント表の生成後は進出条件を変更できません。";
    case FinalsAdvancementSettingsEditReasonCode.BLOCK_DRAW_NOT_FINALIZED:
      return "ブロック抽選の確定後に進出条件を変更できます。";
    case FinalsAdvancementSettingsEditReasonCode.UNSUPPORTED_FORMAT:
      return "この大会形式では進出条件を変更できません。";
    default:
      return "進出条件を変更できません。";
  }
}

/**
 * @param {object} params
 * @param {object|null|undefined} params.tournament
 * @param {object|null|undefined} params.blockDraw
 * @param {unknown} [params.qualifyingMatchResults]
 * @param {unknown} [params.qualifyingMatchSessions]
 * @param {object|null|undefined} [params.finalsAdvancement]
 * @param {object|null|undefined} [params.finalsBracket]
 * @param {object|null|undefined} [params.consolationBracket]
 * @param {object|null|undefined} [params.signals] 進行フラグ（UI 用。実コレクションの代わりに使える）
 */
export function assessFinalsAdvancementSettingsEditEligibility({
  tournament,
  blockDraw,
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
      reasonCode: FinalsAdvancementSettingsEditReasonCode.UNSUPPORTED_FORMAT,
    };
  }

  if (!isBlockDrawFinalized(blockDraw)) {
    return {
      eligible: false,
      reasonCode: FinalsAdvancementSettingsEditReasonCode.BLOCK_DRAW_NOT_FINALIZED,
    };
  }

  if (finalsAdvancement || signals?.hasFinalsAdvancement === true) {
    return {
      eligible: false,
      reasonCode: FinalsAdvancementSettingsEditReasonCode.FINALS_ADVANCEMENT_EXISTS,
    };
  }

  if (isMaterialBracket(finalsBracket) || signals?.hasMaterialFinalsBracket === true) {
    return {
      eligible: false,
      reasonCode: FinalsAdvancementSettingsEditReasonCode.FINALS_BRACKET_EXISTS,
    };
  }

  if (
    isMaterialBracket(consolationBracket) ||
    signals?.hasMaterialConsolationBracket === true
  ) {
    return {
      eligible: false,
      reasonCode: FinalsAdvancementSettingsEditReasonCode.CONSOLATION_BRACKET_EXISTS,
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
      reasonCode: FinalsAdvancementSettingsEditReasonCode.QUALIFYING_STARTED,
    };
  }

  return {
    eligible: true,
    reasonCode: FinalsAdvancementSettingsEditReasonCode.ELIGIBLE,
  };
}

/**
 * @param {object} eligibility
 */
export function assertFinalsAdvancementSettingsEditable(eligibility) {
  if (eligibility?.eligible === true) {
    return;
  }
  const error = new Error(
    getFinalsAdvancementSettingsEditErrorMessage(eligibility?.reasonCode)
  );
  error.code = FINALS_ADVANCEMENT_SETTINGS_NOT_EDITABLE_CODE;
  error.reasonCode = eligibility?.reasonCode ?? null;
  throw error;
}

/**
 * 進出条件の更新フィールドだけを組み立てる。blockCount は含めない。
 *
 * @param {object} params
 * @param {object} params.tournament
 * @param {number} params.qualifiersPerBlock
 * @param {number} params.finalTeamCount
 * @param {string|null|undefined} [params.wildcardComparisonMode]
 * @param {number} params.confirmedTeamCount
 */
export function buildFinalsAdvancementSettingsUpdateFields({
  tournament,
  qualifiersPerBlock,
  finalTeamCount,
  wildcardComparisonMode = null,
  confirmedTeamCount,
} = {}) {
  const blockCount = tournament?.blockCount;
  const configValidation = validateBlockConfiguration({
    teamCount: confirmedTeamCount,
    blockCount,
    qualifiersPerBlock,
  });
  if (!configValidation.valid) {
    const error = new Error(configValidation.errors[0] ?? "ブロック設定が不正です。");
    error.code = FINALS_ADVANCEMENT_SETTINGS_INVALID_CODE;
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
    error.code = FINALS_ADVANCEMENT_SETTINGS_INVALID_CODE;
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
    error.code = FINALS_ADVANCEMENT_SETTINGS_INVALID_CODE;
    throw error;
  }

  /** @type {Record<string, unknown>} */
  const next = {
    qualifiersPerBlock,
    finalTeamCount,
    wildcardComparisonMode: resolvedComparisonMode,
  };

  /** @type {Record<string, unknown>} */
  const changed = {};
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
  };
}

/**
 * @param {object} params
 * @param {{ qualifiersPerBlock: number, finalTeamCount: number }} params.previous
 * @param {{ qualifiersPerBlock: number, finalTeamCount: number }} params.next
 * @param {number} params.blockCount
 * @param {number|null} [params.teamCount]
 */
export function formatFinalsAdvancementSettingsChangeConfirmMessage({
  previous,
  next,
  blockCount,
  teamCount = null,
} = {}) {
  const previousCounts = computeQualifyingAdvancementCounts({
    blockCount,
    qualifiersPerBlock: previous.qualifiersPerBlock,
    finalTeamCount: previous.finalTeamCount,
    teamCount,
  });
  const nextCounts = computeQualifyingAdvancementCounts({
    blockCount,
    qualifiersPerBlock: next.qualifiersPerBlock,
    finalTeamCount: next.finalTeamCount,
    teamCount,
  });

  const previousAuto = previousCounts.autoPassCount ?? "—";
  const previousWc = previousCounts.wildcardCount ?? "—";
  const nextAuto = nextCounts.autoPassCount ?? "—";
  const nextWc = nextCounts.wildcardCount ?? "—";
  const remaining =
    Number.isInteger(teamCount) && Number.isInteger(next.finalTeamCount)
      ? teamCount - next.finalTeamCount
      : null;

  const lines = [
    "決勝進出条件を変更します。",
    "ブロック抽選・予選対戦表は変更されません。",
    "",
    "現在の設定:",
    `各ブロック${previous.qualifiersPerBlock}位通過 / 決勝${previous.finalTeamCount}チーム`,
    `自動通過 ${previousAuto} / WC ${previousWc} / 合計 ${previous.finalTeamCount}`,
    "",
    "↓",
    "",
    "変更後:",
    `各ブロック${next.qualifiersPerBlock}位まで通過 / 決勝${next.finalTeamCount}チーム`,
    `自動通過 ${nextAuto} / WC ${nextWc} / 合計 ${next.finalTeamCount}`,
  ];

  if (Number.isInteger(remaining) && remaining > 0) {
    lines.push(`下位対象 ${remaining}チーム`);
  }

  lines.push("", "この変更を保存しますか？");
  return lines.join("\n");
}

/**
 * @param {object|null|undefined} tournament
 */
export function resolveCurrentFinalsAdvancementSettings(tournament) {
  return {
    qualifiersPerBlock: tournament?.qualifiersPerBlock,
    finalTeamCount:
      resolveStoredOrDerivedFinalTeamCount(tournament) ??
      Number(tournament?.blockCount) * Number(tournament?.qualifiersPerBlock),
    wildcardComparisonMode: resolveWildcardComparisonMode(tournament?.wildcardComparisonMode),
  };
}
