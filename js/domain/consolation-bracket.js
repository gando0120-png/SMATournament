/**
 * 下位トーナメント bracket 生成（DOM / Firestore 非依存）
 *
 * matchId は `final-rX-mY` 形式を再利用する。
 * 上位 bracket と同一形式だが、保存先コレクションが異なる（bracketKind で識別）。
 */
import { BracketKind, CONSOLATION_MIN_PARTICIPANTS } from "./bracket-collections.js";
import {
  buildSingleEliminationBracket,
  countFirstRoundDoubleByeMatches,
  resolveSingleEliminationBracketSize,
  validateSingleEliminationByeResults,
} from "./single-elimination-bracket.js";
import { buildByeMatchResultPayload } from "./finals-match-progress.js";

export const CONSOLATION_MODE = "consolation";

/**
 * @param {object|null|undefined} bracket
 */
export function isConsolationBracket(bracket) {
  return bracket?.mode === CONSOLATION_MODE || bracket?.bracketKind === BracketKind.CONSOLATION;
}

/**
 * 下位トーナメントとして作成済みとみなす条件
 * @param {object|null|undefined} bracket
 */
export function hasCreatedConsolationBracket(bracket) {
  if (!isConsolationBracket(bracket) || bracket.finalized !== true) {
    return false;
  }

  return (
    Number.isInteger(bracket.bracketSize) &&
    Array.isArray(bracket.slots) &&
    bracket.slots.length === bracket.bracketSize &&
    Array.isArray(bracket.matches) &&
    bracket.matches.length > 0
  );
}

/**
 * @param {Array<{ entryId: string, teamName?: string|null }>} participants
 */
function normalizeParticipants(participants) {
  return participants.map((participant) => ({
    entryId: participant.entryId,
    teamName: participant.teamName ?? null,
  }));
}

/**
 * @param {object} bracket - buildSingleEliminationBracket の bracket
 */
function toConsolationBracket(bracket) {
  return {
    ...bracket,
    mode: CONSOLATION_MODE,
    bracketKind: BracketKind.CONSOLATION,
    placementMode: "random",
    finalized: true,
    qualifierCount: bracket.teamCount,
    slots: (bracket.slots ?? []).map((slot) => ({
      ...slot,
      advancementSource: slot.isBye ? null : CONSOLATION_MODE,
    })),
  };
}

/**
 * 下位トーナメント bracket を生成する。
 *
 * @param {Array<{ entryId: string, teamName?: string|null }>} participants
 * @param {{ random?: () => number }} [options]
 */
export function buildConsolationBracket(participants, options = {}) {
  const { random = Math.random } = options;

  if (!Array.isArray(participants) || participants.length === 0) {
    return {
      valid: false,
      canFinalize: false,
      message: "下位トーナメントの参加チームがありません。",
      bracket: null,
    };
  }

  if (participants.length < CONSOLATION_MIN_PARTICIPANTS) {
    return {
      valid: false,
      canFinalize: false,
      message: "下位トーナメントを開始するには、2チーム以上の参加チームが必要です。",
      bracket: null,
    };
  }

  const entries = normalizeParticipants(participants);
  const result = buildSingleEliminationBracket({ entries, random });

  if (!result.valid || !result.bracket) {
    return result;
  }

  const consolationBracket = toConsolationBracket(result.bracket);

  if (countFirstRoundDoubleByeMatches(consolationBracket) > 0) {
    return {
      valid: false,
      canFinalize: false,
      message: "BYE 同士の対戦が含まれているため、下位トーナメント表を作成できません。",
      bracket: null,
    };
  }

  return {
    valid: true,
    canFinalize: true,
    message: null,
    bracket: consolationBracket,
  };
}

/**
 * @param {object} match
 * @param {object} winner
 */
export function buildConsolationByeMatchResultPayload(match, winner) {
  return {
    ...buildByeMatchResultPayload(match, winner),
    bracketKind: BracketKind.CONSOLATION,
  };
}

/**
 * Firestore 保存向けペイロード（Sprint 2 で使用）
 * @param {object} preview - buildConsolationBracket の成功結果
 */
export function buildPersistedConsolationBracket(preview) {
  const { bracket } = preview;
  return {
    finalized: true,
    mode: CONSOLATION_MODE,
    bracketKind: BracketKind.CONSOLATION,
    placementMode: bracket.placementMode ?? "random",
    bracketSize: bracket.bracketSize,
    teamCount: bracket.teamCount,
    byeCount: bracket.byeCount,
    qualifierCount: bracket.teamCount,
    roundCount: bracket.roundCount,
    slots: bracket.slots,
    matches: bracket.matches,
    matchIds: Object.fromEntries(
      (bracket.matches ?? []).map((match) => [match.matchId, true])
    ),
    matchIdsList: (bracket.matches ?? []).map((match) => match.matchId),
  };
}

/**
 * @param {number} participantCount
 */
export function resolveConsolationBracketSize(participantCount) {
  return resolveSingleEliminationBracketSize(participantCount);
}

/**
 * @param {object|null|undefined} bracket
 */
export function validateConsolationByeResults(bracket) {
  return validateSingleEliminationByeResults(bracket);
}
