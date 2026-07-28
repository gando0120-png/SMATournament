/**
 * 下位トーナメント対象者の抽出・作成適格性（DOM / Firestore 非依存）
 */
import { BracketKind, CONSOLATION_MIN_PARTICIPANTS } from "./bracket-collections.js";
import { EntryStatus } from "./constants.js";
import { TournamentFormat } from "./tournament-format.js";

export const ConsolationEligibilityReasonCode = {
  ELIGIBLE: "ELIGIBLE",
  UNSUPPORTED_FORMAT: "UNSUPPORTED_FORMAT",
  ADVANCEMENT_NOT_FINALIZED: "ADVANCEMENT_NOT_FINALIZED",
  MAIN_BRACKET_NOT_FINALIZED: "MAIN_BRACKET_NOT_FINALIZED",
  TOURNAMENT_ALREADY_COMPLETED: "TOURNAMENT_ALREADY_COMPLETED",
  CONSOLATION_ALREADY_CREATED: "CONSOLATION_ALREADY_CREATED",
  NOT_ENOUGH_PARTICIPANTS: "NOT_ENOUGH_PARTICIPANTS",
};

/**
 * @param {object|null|undefined} qualifier
 */
function isExcludableQualifier(qualifier) {
  if (!qualifier || qualifier.isBye === true) {
    return false;
  }
  return typeof qualifier.entryId === "string" && qualifier.entryId.length > 0;
}

/**
 * @param {object|null|undefined} advancement
 */
function buildQualifierEntryIdSet(advancement) {
  const ids = new Set();
  for (const qualifier of advancement?.qualifiers ?? []) {
    if (isExcludableQualifier(qualifier)) {
      ids.add(qualifier.entryId);
    }
  }
  return ids;
}

/**
 * @param {object|null|undefined} entry
 */
function resolveEntryId(entry) {
  if (typeof entry?.entryId === "string" && entry.entryId.length > 0) {
    return entry.entryId;
  }
  if (typeof entry?.id === "string" && entry.id.length > 0) {
    return entry.id;
  }
  return null;
}

/**
 * 下位トーナメント参加候補を算出する。
 * confirmed エントリーから決勝進出者（entryId 基準）を除外する。
 *
 * @param {object[]|null|undefined} entries
 * @param {object|null|undefined} advancement - finalsAdvancement/current
 * @returns {Array<{ entryId: string, teamName: string|null }>}
 */
export function buildConsolationParticipants(entries, advancement) {
  const qualifierIds = buildQualifierEntryIdSet(advancement);
  const seenEntryIds = new Set();
  const participants = [];

  for (const entry of entries ?? []) {
    if (entry?.status !== EntryStatus.CONFIRMED) {
      continue;
    }

    const entryId = resolveEntryId(entry);
    if (!entryId || qualifierIds.has(entryId) || seenEntryIds.has(entryId)) {
      continue;
    }

    seenEntryIds.add(entryId);
    participants.push({
      entryId,
      teamName: entry.teamName ?? null,
    });
  }

  return participants;
}

/**
 * @param {object|null|undefined} tournament
 */
function supportsConsolationFormat(tournament) {
  return tournament?.tournamentFormat === TournamentFormat.QUALIFYING_AND_FINALS;
}

/**
 * @param {object|null|undefined} tournamentResults
 */
function isTournamentCompleted(tournamentResults) {
  return tournamentResults?.finalized === true;
}

/**
 * @param {object|null|undefined} mainBracket
 */
function isMainBracketFinalized(mainBracket) {
  return mainBracket?.finalized === true;
}

/**
 * @param {object|null|undefined} bracket
 */
function hasCreatedConsolationBracket(bracket) {
  const isConsolation =
    bracket?.mode === BracketKind.CONSOLATION ||
    bracket?.bracketKind === BracketKind.CONSOLATION;

  if (isConsolation && bracket.finalized === true) {
    return (
      Number.isInteger(bracket.bracketSize) &&
      Array.isArray(bracket.slots) &&
      bracket.slots.length === bracket.bracketSize &&
      Array.isArray(bracket.matches) &&
      bracket.matches.length > 0
    );
  }

  if (
    bracket &&
    (bracket.finalized === true ||
      (Array.isArray(bracket.matches) && bracket.matches.length > 0) ||
      (Array.isArray(bracket.slots) && bracket.slots.length > 0))
  ) {
    return isConsolation;
  }

  return false;
}

/**
 * @param {object} params
 * @param {object|null|undefined} params.tournament
 * @param {object[]|null|undefined} params.entries
 * @param {object|null|undefined} params.advancement
 * @param {object|null|undefined} params.mainBracket - finalsBracket/current
 * @param {object|null|undefined} params.tournamentResults
 * @param {object|null|undefined} params.consolationBracket
 */
export function assessConsolationEligibility({
  tournament,
  entries,
  advancement,
  mainBracket,
  tournamentResults,
  consolationBracket,
}) {
  const participants = buildConsolationParticipants(entries, advancement);
  const participantCount = participants.length;

  const base = { participantCount };

  if (!supportsConsolationFormat(tournament)) {
    return {
      ...base,
      eligible: false,
      reasonCode: ConsolationEligibilityReasonCode.UNSUPPORTED_FORMAT,
    };
  }

  if (isTournamentCompleted(tournamentResults)) {
    return {
      ...base,
      eligible: false,
      reasonCode: ConsolationEligibilityReasonCode.TOURNAMENT_ALREADY_COMPLETED,
    };
  }

  if (hasCreatedConsolationBracket(consolationBracket)) {
    return {
      ...base,
      eligible: false,
      reasonCode: ConsolationEligibilityReasonCode.CONSOLATION_ALREADY_CREATED,
    };
  }

  if (advancement?.finalized !== true) {
    return {
      ...base,
      eligible: false,
      reasonCode: ConsolationEligibilityReasonCode.ADVANCEMENT_NOT_FINALIZED,
    };
  }

  if (!isMainBracketFinalized(mainBracket)) {
    return {
      ...base,
      eligible: false,
      reasonCode: ConsolationEligibilityReasonCode.MAIN_BRACKET_NOT_FINALIZED,
    };
  }

  if (participantCount < CONSOLATION_MIN_PARTICIPANTS) {
    return {
      ...base,
      eligible: false,
      reasonCode: ConsolationEligibilityReasonCode.NOT_ENOUGH_PARTICIPANTS,
    };
  }

  return {
    ...base,
    eligible: true,
    reasonCode: ConsolationEligibilityReasonCode.ELIGIBLE,
  };
}

const REASON_TO_ERROR_CODE = {
  [ConsolationEligibilityReasonCode.UNSUPPORTED_FORMAT]: "consolation-bracket/unsupported-format",
  [ConsolationEligibilityReasonCode.ADVANCEMENT_NOT_FINALIZED]:
    "consolation-bracket/advancement-not-finalized",
  [ConsolationEligibilityReasonCode.MAIN_BRACKET_NOT_FINALIZED]:
    "consolation-bracket/main-bracket-not-finalized",
  [ConsolationEligibilityReasonCode.TOURNAMENT_ALREADY_COMPLETED]:
    "consolation-bracket/tournament-completed",
  [ConsolationEligibilityReasonCode.CONSOLATION_ALREADY_CREATED]:
    "consolation-bracket/already-created",
  [ConsolationEligibilityReasonCode.NOT_ENOUGH_PARTICIPANTS]:
    "consolation-bracket/not-enough-participants",
};

/**
 * @param {{ reasonCode?: string }} eligibility
 */
export function mapConsolationEligibilityToErrorCode(eligibility) {
  return REASON_TO_ERROR_CODE[eligibility.reasonCode] ?? "consolation-bracket/ineligible";
}
