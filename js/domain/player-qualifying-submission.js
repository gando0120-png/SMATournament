/**
 * プレイヤー予選H2H提出・照合（DOM / Firestore 非依存）
 *
 * 正式結果はセットごとの team1Score/team2Score から
 * setWins / setDraws / setLosses / totalScore を算出する。
 * 各チームは自側得点のみ提出し、両提出を左右に組み合わせて構築する。
 * 相手得点の 100-x 補完は行わない。
 */
import {
  buildValidatedQualifyingMatchResultPayload,
} from "./qualifying-match-result-payload.js";
import {
  parseNonNegativeInteger,
  validateMatchResultInput,
} from "./qualifying-match-result.js";

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
 * "01" / "1" / 1 → 同一の整数チーム番号へ正規化
 * @param {unknown} input
 * @returns {{ valid: true, value: number } | { valid: false, message: string }}
 */
export function normalizeTeamNumber(input) {
  if (input === null || input === undefined || input === "") {
    return { valid: false, message: "チーム番号を入力してください。" };
  }
  const str = String(input).trim();
  if (!/^\d+$/.test(str)) {
    return { valid: false, message: "チーム番号は数字で入力してください。" };
  }
  const value = Number(str);
  if (!Number.isSafeInteger(value) || value < 1) {
    return { valid: false, message: "チーム番号は1以上の整数です。" };
  }
  if (value > 999) {
    return { valid: false, message: "チーム番号が大きすぎます。" };
  }
  return { valid: true, value };
}

/**
 * @param {number} teamNumber
 * @param {number} [width=2]
 */
export function formatTeamNumber(teamNumber, width = 2) {
  const n = Number(teamNumber);
  if (!Number.isSafeInteger(n) || n < 1) {
    return "";
  }
  const w = Number.isSafeInteger(width) && width >= 1 ? width : 2;
  return String(n).padStart(w, "0");
}

/**
 * 表示桁（64チームなら2）
 * @param {number|null|undefined} maxTeams
 */
export function teamNumberDisplayWidth(maxTeams) {
  const max = Number(maxTeams);
  if (!Number.isFinite(max) || max < 10) {
    return 2;
  }
  return String(Math.trunc(max)).length;
}

/**
 * confirmed エントリーへ欠番のない teamNumber を割り当てた結果を返す（純関数）
 * @param {Array<{ id: string, teamNumber?: unknown, dummyIndex?: unknown, createdAt?: unknown }>} confirmedEntries
 */
export function planTeamNumberAssignments(confirmedEntries) {
  const entries = Array.isArray(confirmedEntries) ? [...confirmedEntries] : [];
  const used = new Set();
  const assigned = new Map();

  for (const entry of entries) {
    const direct = normalizeTeamNumber(entry?.teamNumber);
    if (direct.valid && !used.has(direct.value)) {
      used.add(direct.value);
      assigned.set(entry.id, direct.value);
    }
  }

  for (const entry of entries) {
    if (assigned.has(entry.id)) {
      continue;
    }
    const fromDummy = normalizeTeamNumber(entry?.dummyIndex);
    if (fromDummy.valid && !used.has(fromDummy.value)) {
      used.add(fromDummy.value);
      assigned.set(entry.id, fromDummy.value);
    }
  }

  const needing = entries
    .filter((entry) => !assigned.has(entry.id))
    .sort((a, b) => {
      const aTime = a?.createdAt?.toMillis?.() ?? a?.createdAt ?? 0;
      const bTime = b?.createdAt?.toMillis?.() ?? b?.createdAt ?? 0;
      if (aTime !== bTime) {
        return aTime - bTime;
      }
      return String(a.id).localeCompare(String(b.id));
    });

  let next = 1;
  for (const entry of needing) {
    while (used.has(next)) {
      next += 1;
    }
    assigned.set(entry.id, next);
    used.add(next);
    next += 1;
  }

  return {
    byEntryId: assigned,
    updates: entries
      .filter((entry) => Number(entry?.teamNumber) !== assigned.get(entry.id))
      .map((entry) => ({ entryId: entry.id, teamNumber: assigned.get(entry.id) })),
  };
}

/**
 * @param {Array<{ id: string, teamNumber?: unknown, status?: string }>} entries
 * @param {unknown} teamNumberInput
 */
export function resolveEntryIdByTeamNumber(entries, teamNumberInput) {
  const normalized = normalizeTeamNumber(teamNumberInput);
  if (!normalized.valid) {
    return { ok: false, code: "invalid-argument", message: normalized.message, entryId: null };
  }
  const confirmed = (entries || []).filter((e) => e.status === "confirmed" || e.status == null);
  const plan = planTeamNumberAssignments(confirmed);
  const hit = confirmed.find((entry) => plan.byEntryId.get(entry.id) === normalized.value);
  if (!hit) {
    return {
      ok: false,
      code: "not-found",
      message: `チーム番号 ${formatTeamNumber(normalized.value)} は見つかりません。`,
      entryId: null,
      teamNumber: normalized.value,
    };
  }
  return {
    ok: true,
    entryId: hit.id,
    teamNumber: normalized.value,
    teamName: hit.teamName || hit.id,
    updates: plan.updates,
  };
}

/**
 * @param {object} scores
 */
export function normalizeOwnSideScores(scores) {
  return {
    set1OwnScore: Number(scores?.set1OwnScore),
    set2OwnScore: Number(scores?.set2OwnScore),
  };
}

/**
 * @param {object} input
 */
export function validateOwnSideScores(input) {
  const set1 = parseNonNegativeInteger(input?.set1OwnScore);
  if (!set1.valid) {
    return { valid: false, message: `第1セット得点：${set1.message}` };
  }
  const set2 = parseNonNegativeInteger(input?.set2OwnScore);
  if (!set2.valid) {
    return { valid: false, message: `第2セット得点：${set2.message}` };
  }
  return {
    valid: true,
    data: {
      set1OwnScore: set1.value,
      set2OwnScore: set2.value,
    },
  };
}

/**
 * 提出ドキュメントから自側得点を取り出す（レガシー両側提出も吸収）
 * @param {object|null|undefined} submission
 * @param {"team1"|"team2"} side
 */
export function extractOwnSideScores(submission, side) {
  if (!submission) {
    return null;
  }
  if (
    submission.set1OwnScore !== undefined &&
    submission.set1OwnScore !== null &&
    submission.set2OwnScore !== undefined &&
    submission.set2OwnScore !== null
  ) {
    return normalizeOwnSideScores(submission);
  }
  if (side === "team1") {
    return {
      set1OwnScore: Number(submission.set1Team1Score),
      set2OwnScore: Number(submission.set2Team1Score),
    };
  }
  if (side === "team2") {
    return {
      set1OwnScore: Number(submission.set1Team2Score),
      set2OwnScore: Number(submission.set2Team2Score),
    };
  }
  return null;
}

/**
 * 左右の自側提出を公式の両側スコアへ組み合わせる（推測補完なし）
 * @param {object} team1Own
 * @param {object} team2Own
 */
export function combineOneSidedSubmissions(team1Own, team2Own) {
  const left = normalizeOwnSideScores(team1Own);
  const right = normalizeOwnSideScores(team2Own);
  return {
    set1Team1Score: left.set1OwnScore,
    set1Team2Score: right.set1OwnScore,
    set2Team1Score: left.set2OwnScore,
    set2Team2Score: right.set2OwnScore,
  };
}

/**
 * @param {object} scores bilateral
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
 * @deprecated 片側提出へ移行。正式結果構築時は combine + validateMatchResultInput を使う。
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
    // 両提出済みで未確定なら、照合結果待ち／conflict 扱い（state が優先）
    return PlayerMatchUiStatus.MATCHED;
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
      return "自チーム提出済み／相手待ち";
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
 *   team1Submitted: boolean,
 *   team2Submitted: boolean,
 *   officialExists: boolean,
 *   scoresMatch: boolean|null,
 *   operatorLocked?: boolean,
 * }} params
 */
export function resolveReconciliationState({
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
      return "両側提出・確定済み";
    case MatchReconciliationState.CONFLICT:
      return "不一致・要確認";
    case MatchReconciliationState.OPERATOR_LOCKED:
      return "運営確定";
    default:
      return "—";
  }
}

/**
 * 両チームの自側提出を組み合わせ、既存バリデーションで正式結果を構築する。
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

  if (!submissionA?.side || !submissionB?.side || submissionA.side === submissionB.side) {
    return {
      ok: false,
      state: MatchReconciliationState.CONFLICT,
      code: "player-submission/conflict",
      message: "提出の対戦サイドが不正です。",
      officialPayload: null,
    };
  }

  const team1Sub = submissionA.side === "team1" ? submissionA : submissionB;
  const team2Sub = submissionA.side === "team2" ? submissionA : submissionB;
  const team1Own = extractOwnSideScores(team1Sub, "team1");
  const team2Own = extractOwnSideScores(team2Sub, "team2");

  if (!team1Own || !team2Own) {
    return {
      ok: false,
      state: MatchReconciliationState.CONFLICT,
      code: "player-submission/conflict",
      message: "提出内容が不正です。",
      officialPayload: null,
    };
  }

  const scores = combineOneSidedSubmissions(team1Own, team2Own);
  const validation = validateMatchResultInput(scores);
  if (!validation.valid) {
    return {
      ok: false,
      state: MatchReconciliationState.CONFLICT,
      code: "player-submission/conflict",
      message: validation.message || "両チームの提出を組み合わせた結果が不正です。",
      officialPayload: null,
      conflictSnapshot: {
        team1: { entryId: team1Sub.entryId, ownScores: team1Own },
        team2: { entryId: team2Sub.entryId, ownScores: team2Own },
        combinedScores: scores,
      },
    };
  }

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
      conflictSnapshot: {
        team1: { entryId: team1Sub.entryId, ownScores: team1Own },
        team2: { entryId: team2Sub.entryId, ownScores: team2Own },
        combinedScores: scores,
      },
    };
  }
}

/**
 * 大会共通のプレイヤー入力URL（チーム番号入力画面）
 * @param {string} tournamentId
 * @param {string} [origin]
 */
export function buildTournamentPlayerResultsUrl(tournamentId, origin = "") {
  const base = origin ? origin.replace(/\/$/, "") : "";
  if (!base) {
    return `player-results.html?tournamentId=${encodeURIComponent(tournamentId)}`;
  }
  const url = new URL(`${base}/player-results.html`);
  url.searchParams.set("tournamentId", tournamentId);
  return url.toString();
}

/**
 * @deprecated チーム別URLは運用終了。後方互換のため残す。
 * @param {string} tournamentId
 * @param {string} teamToken
 * @param {string} [origin]
 */
export function buildPlayerResultsUrl(tournamentId, teamToken, origin = "") {
  const base = origin ? origin.replace(/\/$/, "") : "";
  if (!base) {
    return `player-results.html?tournamentId=${encodeURIComponent(tournamentId)}&teamToken=${encodeURIComponent(teamToken)}`;
  }
  const url = new URL(`${base}/player-results.html`);
  url.searchParams.set("tournamentId", tournamentId);
  url.searchParams.set("teamToken", teamToken);
  return url.toString();
}
