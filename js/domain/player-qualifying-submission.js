/**
 * プレイヤー予選H2H提出・照合（DOM / Firestore 非依存）
 */
import {
  buildValidatedQualifyingMatchResultPayload,
} from "./qualifying-match-result-payload.js";
import { validateMatchResultInput } from "./qualifying-match-result.js";

export const ENTRY_ACCESS_TOKENS_COLLECTION = "entryAccessTokens";
export const QUALIFYING_RESULT_SUBMISSIONS_COLLECTION = "qualifyingResultSubmissions";
export const QUALIFYING_MATCH_RECONCILIATIONS_COLLECTION = "qualifyingMatchReconciliations";

export const PlayerSubmissionStatus = Object.freeze({
  PENDING: "pending",
  MATCHED: "matched",
  CONFLICT: "conflict",
  SUPERSEDED: "superseded",
});

export const MatchReconciliationState = Object.freeze({
  NONE: "none",
  AWAITING_OPPONENT: "awaiting_opponent",
  MATCHED: "matched",
  CONFLICT: "conflict",
  OPERATOR_LOCKED: "operator_locked",
});

export const PlayerMatchUiStatus = Object.freeze({
  NOT_SUBMITTED: "not_submitted",
  AWAITING_OPPONENT: "awaiting_opponent",
  MATCHED: "matched",
  CONFLICT: "conflict",
  OFFICIAL: "official",
  LOCKED: "locked",
});

/**
 * @param {string} matchId
 * @param {string} entryId
 */
export function buildSubmissionDocId(matchId, entryId) {
  return `${matchId}_${entryId}`;
}

/**
 * @param {object} scores
 */
export function normalizeSubmissionScores(scores) {
  return {
    set1Team1Score: Number(scores?.set1Team1Score),
    set1Team2Score: Number(scores?.set1Team2Score),
    set2Team1Score: Number(scores?.set2Team1Score),
    set2Team2Score: Number(scores?.set2Team2Score),
  };
}

/**
 * @param {object} a
 * @param {object} b
 */
export function submissionScoresEqual(a, b) {
  const left = normalizeSubmissionScores(a);
  const right = normalizeSubmissionScores(b);
  return (
    left.set1Team1Score === right.set1Team1Score &&
    left.set1Team2Score === right.set1Team2Score &&
    left.set2Team1Score === right.set2Team1Score &&
    left.set2Team2Score === right.set2Team2Score
  );
}

/**
 * @param {object} scheduleMatch
 * @param {string} entryId
 * @returns {"team1"|"team2"|null}
 */
export function resolveMatchSide(scheduleMatch, entryId) {
  if (!scheduleMatch || !entryId) {
    return null;
  }
  if (scheduleMatch.team1?.entryId === entryId) {
    return "team1";
  }
  if (scheduleMatch.team2?.entryId === entryId) {
    return "team2";
  }
  return null;
}

/**
 * @param {object} tournament
 * @param {{ hasFinalsAdvancement?: boolean, scheduleFinalized?: boolean }} [opts]
 */
export function assertPlayerSubmissionAllowed(tournament, opts = {}) {
  if (tournament?.participantResultEntryEnabled !== true) {
    return {
      allowed: false,
      code: "player-submission/disabled",
      message: "この大会ではプレイヤーによる結果入力が無効です。",
    };
  }
  if (tournament?.status !== "open") {
    return {
      allowed: false,
      code: "player-submission/tournament-closed",
      message: "大会が受付中でないため送信できません。",
    };
  }
  if (opts.hasFinalsAdvancement) {
    return {
      allowed: false,
      code: "player-submission/advancement-locked",
      message: "決勝進出確定後はプレイヤーから結果を送信できません。",
    };
  }
  if (opts.scheduleFinalized === false) {
    return {
      allowed: false,
      code: "player-submission/no-schedule",
      message: "予選対戦表が確定していません。",
    };
  }
  return { allowed: true, code: null, message: null };
}

/**
 * @param {object} input scores
 */
export function validatePlayerSubmissionScores(input) {
  return validateMatchResultInput(input);
}

/**
 * @param {string} matchId
 * @param {object} scheduleMatch
 * @param {object} scores
 */
export function buildOfficialResultFromSubmissionScores(matchId, scheduleMatch, scores) {
  return buildValidatedQualifyingMatchResultPayload(matchId, scheduleMatch, scores);
}

/**
 * @param {{
 *   mySubmission?: object|null,
 *   opponentSubmission?: object|null,
 *   officialResult?: object|null,
 *   reconciliation?: object|null,
 *   locked?: boolean,
 * }} params
 */
export function resolvePlayerMatchUiStatus({
  mySubmission = null,
  opponentSubmission = null,
  officialResult = null,
  reconciliation = null,
  locked = false,
} = {}) {
  if (locked || reconciliation?.state === MatchReconciliationState.OPERATOR_LOCKED) {
    if (officialResult?.status === "finished") {
      return PlayerMatchUiStatus.OFFICIAL;
    }
    return PlayerMatchUiStatus.LOCKED;
  }
  if (officialResult?.status === "finished" || reconciliation?.state === MatchReconciliationState.MATCHED) {
    return PlayerMatchUiStatus.OFFICIAL;
  }
  if (reconciliation?.state === MatchReconciliationState.CONFLICT) {
    return PlayerMatchUiStatus.CONFLICT;
  }
  if (mySubmission && !opponentSubmission) {
    return PlayerMatchUiStatus.AWAITING_OPPONENT;
  }
  if (!mySubmission && opponentSubmission) {
    return PlayerMatchUiStatus.AWAITING_OPPONENT;
  }
  if (mySubmission && opponentSubmission) {
    return submissionScoresEqual(mySubmission, opponentSubmission)
      ? PlayerMatchUiStatus.MATCHED
      : PlayerMatchUiStatus.CONFLICT;
  }
  return PlayerMatchUiStatus.NOT_SUBMITTED;
}

/**
 * @param {string} status
 */
export function getPlayerMatchUiStatusLabel(status) {
  switch (status) {
    case PlayerMatchUiStatus.NOT_SUBMITTED:
      return "未入力";
    case PlayerMatchUiStatus.AWAITING_OPPONENT:
      return "自チーム送信済み／相手待ち";
    case PlayerMatchUiStatus.MATCHED:
    case PlayerMatchUiStatus.OFFICIAL:
      return "確定済み";
    case PlayerMatchUiStatus.CONFLICT:
      return "不一致／運営確認中";
    case PlayerMatchUiStatus.LOCKED:
      return "入力締切";
    default:
      return "—";
  }
}

/**
 * @param {{
 *   team1EntryId: string,
 *   team2EntryId: string,
 *   team1Submitted: boolean,
 *   team2Submitted: boolean,
 *   officialExists: boolean,
 *   scoresMatch: boolean|null,
 *   operatorLocked?: boolean,
 * }} params
 */
export function resolveReconciliationState({
  team1EntryId,
  team2EntryId,
  team1Submitted,
  team2Submitted,
  officialExists,
  scoresMatch,
  operatorLocked = false,
}) {
  if (operatorLocked || officialExists) {
    return officialExists
      ? MatchReconciliationState.MATCHED
      : MatchReconciliationState.OPERATOR_LOCKED;
  }
  if (!team1Submitted && !team2Submitted) {
    return MatchReconciliationState.NONE;
  }
  if (team1Submitted !== team2Submitted) {
    return MatchReconciliationState.AWAITING_OPPONENT;
  }
  if (team1Submitted && team2Submitted) {
    return scoresMatch
      ? MatchReconciliationState.MATCHED
      : MatchReconciliationState.CONFLICT;
  }
  return MatchReconciliationState.NONE;
}

/**
 * @param {string} state
 * @param {{ team1Name?: string, team2Name?: string, team1Submitted?: boolean, team2Submitted?: boolean }} [meta]
 */
export function getOperatorReconciliationLabel(state, meta = {}) {
  switch (state) {
    case MatchReconciliationState.NONE:
      return "未提出";
    case MatchReconciliationState.AWAITING_OPPONENT: {
      if (meta.team1Submitted && !meta.team2Submitted) {
        return `片側提出済み（未提出: ${meta.team2Name || "チーム2"}）`;
      }
      if (!meta.team1Submitted && meta.team2Submitted) {
        return `片側提出済み（未提出: ${meta.team1Name || "チーム1"}）`;
      }
      return "片側提出済み";
    }
    case MatchReconciliationState.MATCHED:
      return "両側一致・確定済み";
    case MatchReconciliationState.CONFLICT:
      return "不一致・要確認";
    case MatchReconciliationState.OPERATOR_LOCKED:
      return "運営確定";
    default:
      return "—";
  }
}

/**
 * 照合結果（両提出が揃ったとき）
 * @param {{
 *   submissionA: object,
 *   submissionB: object,
 *   scheduleMatch: object,
 *   officialExists: boolean,
 * }} params
 */
export function reconcileSubmissions({
  submissionA,
  submissionB,
  scheduleMatch,
  officialExists,
}) {
  if (officialExists) {
    return {
      ok: false,
      state: MatchReconciliationState.MATCHED,
      code: "player-submission/already-official",
      message: "正式結果が既に存在します。",
      officialPayload: null,
    };
  }

  if (!submissionScoresEqual(submissionA, submissionB)) {
    return {
      ok: false,
      state: MatchReconciliationState.CONFLICT,
      code: "player-submission/conflict",
      message: "両チームの提出内容が一致しません。",
      officialPayload: null,
      conflictSnapshot: {
        team1: {
          entryId: submissionA.side === "team1" ? submissionA.entryId : submissionB.entryId,
          scores: submissionA.side === "team1" ? normalizeSubmissionScores(submissionA) : normalizeSubmissionScores(submissionB),
        },
        team2: {
          entryId: submissionA.side === "team2" ? submissionA.entryId : submissionB.entryId,
          scores: submissionA.side === "team2" ? normalizeSubmissionScores(submissionA) : normalizeSubmissionScores(submissionB),
        },
      },
    };
  }

  const scores = normalizeSubmissionScores(submissionA);
  try {
    const officialPayload = buildOfficialResultFromSubmissionScores(
      scheduleMatch.matchId,
      scheduleMatch,
      scores
    );
    return {
      ok: true,
      state: MatchReconciliationState.MATCHED,
      code: null,
      message: null,
      officialPayload,
      scores,
    };
  } catch (error) {
    return {
      ok: false,
      state: MatchReconciliationState.CONFLICT,
      code: error?.code || "player-submission/invalid-scores",
      message: error?.message || "提出内容が不正です。",
      officialPayload: null,
    };
  }
}

/**
 * @param {string} tournamentId
 * @param {string} teamToken
 * @param {string} [origin]
 */
export function buildPlayerResultsUrl(tournamentId, teamToken, origin = "") {
  const base = origin ? origin.replace(/\/$/, "") : "";
  const url = new URL(`${base}/player-results.html`, base || "https://example.invalid");
  url.searchParams.set("tournamentId", tournamentId);
  url.searchParams.set("teamToken", teamToken);
  if (!base) {
    return `player-results.html?tournamentId=${encodeURIComponent(tournamentId)}&teamToken=${encodeURIComponent(teamToken)}`;
  }
  return url.toString();
}
