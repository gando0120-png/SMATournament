/**
 * 参加者による決勝（main / H2H）勝利報告 — DOM / Firestore 非依存
 */
import { MatchFormat, isMultiTeamTotalFormat, resolveMatchFormat } from "./aggregate-match-format.js";
import { tournamentViewForBracketRules } from "./bracket-match-config.js";
import {
  FinalsMatchResolution,
  MatchResultStatus,
  MatchSessionStatus,
  SET_WINNING_SCORE,
  TournamentStatus,
} from "./constants.js";
import { getFinalsSetScoreFieldNames, resolveMatchWinsRequired } from "./finals-match-format.js";
import {
  getFinalsChampionAndRunnerUp,
  isMultiTeamMatch,
  resolveFinalsMatchTeams,
} from "./finals-match-progress.js";
import { validateFinalsMatchResultInput } from "./finals-match-result.js";
import { buildPlayedFinalsMatchResultPayload } from "./finals-match-result-payload.js";
import { RankingMode } from "./loss-band/constants.js";
import { resolveMainRankingMode } from "./loss-band/config.js";
import { TournamentFormat, resolveTournamentFormat } from "./tournament-format.js";

export const PLAYER_FINALS_WIN_REPORT_SOURCE = "player_win_report";

export const PlayerFinalsPageMode = Object.freeze({
  QUALIFYING: "qualifying",
  FINALS: "finals",
  UNAVAILABLE: "unavailable",
});

export const PlayerFinalsMatchState = Object.freeze({
  PLAYABLE: "playable",
  WAITING_OPPONENT: "waiting_opponent",
  ELIMINATED: "eliminated",
  CHAMPION: "champion",
  NOT_ADVANCED: "not_advanced",
  UNAVAILABLE: "unavailable",
});

export const PLAYER_FINALS_ALREADY_OFFICIAL_MESSAGE = "この試合はすでに結果が確定しています。";
export const PLAYER_FINALS_UNSUPPORTED_FORMAT_MESSAGE =
  "この大会形式では参加者による決勝の勝利報告は利用できません。";
export const PLAYER_FINALS_DISABLED_MESSAGE = "この大会ではプレイヤーによる結果入力が無効です。";
export const PLAYER_FINALS_TOURNAMENT_CLOSED_MESSAGE = "大会が受付中でないため報告できません。";
export const PLAYER_FINALS_NO_BRACKET_MESSAGE = "決勝トーナメント表がまだ確定していません。";
export const PLAYER_FINALS_WAITING_OPPONENT_MESSAGE =
  "勝ち上がりました。\n次の対戦相手の決定をお待ちください。";
export const PLAYER_FINALS_ELIMINATED_MESSAGE = "決勝トーナメント敗退";
export const PLAYER_FINALS_CHAMPION_MESSAGE = "優勝";
export const PLAYER_FINALS_NOT_ADVANCED_MESSAGE = "予選終了";

/**
 * @param {object|null|undefined} result
 */
export function isPlayerWinReportResult(result) {
  return result?.source === PLAYER_FINALS_WIN_REPORT_SOURCE;
}

/**
 * 公開・管理画面向け。架空のセットスコアは出さない。
 * @param {object|null|undefined} result
 */
export function formatPlayerWinReportResultSummary(result) {
  const winnerName = result?.winner?.teamName;
  if (winnerName) {
    return `${winnerName}（勝利報告）`;
  }
  return "勝利報告";
}

/**
 * @param {string} state
 */
export function getPlayerFinalsStateMessage(state) {
  switch (state) {
    case PlayerFinalsMatchState.WAITING_OPPONENT:
      return PLAYER_FINALS_WAITING_OPPONENT_MESSAGE;
    case PlayerFinalsMatchState.ELIMINATED:
      return PLAYER_FINALS_ELIMINATED_MESSAGE;
    case PlayerFinalsMatchState.CHAMPION:
      return PLAYER_FINALS_CHAMPION_MESSAGE;
    case PlayerFinalsMatchState.NOT_ADVANCED:
      return PLAYER_FINALS_NOT_ADVANCED_MESSAGE;
    default:
      return "";
  }
}

function isMainH2HBracket(bracket) {
  if (!bracket) {
    return false;
  }
  if (isMultiTeamMatch(bracket) || resolveMatchFormat(bracket.matchFormat) === MatchFormat.MULTI_TEAM_TOTAL) {
    return false;
  }
  return true;
}

/**
 * @param {{
 *   tournament?: object|null,
 *   finalsAdvancement?: object|null,
 *   finalsBracket?: object|null,
 * }} params
 */
export function resolvePlayerFinalsPageMode({
  tournament = null,
  finalsAdvancement = null,
  finalsBracket = null,
} = {}) {
  if (tournament?.participantResultEntryEnabled !== true) {
    return {
      pageMode: PlayerFinalsPageMode.UNAVAILABLE,
      reason: PLAYER_FINALS_DISABLED_MESSAGE,
      code: "player-finals/disabled",
    };
  }
  if (tournament?.status !== TournamentStatus.OPEN) {
    return {
      pageMode: PlayerFinalsPageMode.UNAVAILABLE,
      reason: PLAYER_FINALS_TOURNAMENT_CLOSED_MESSAGE,
      code: "player-finals/tournament-closed",
    };
  }
  if (resolveMainRankingMode(tournament) === RankingMode.LOSS_BAND) {
    return {
      pageMode: PlayerFinalsPageMode.UNAVAILABLE,
      reason: PLAYER_FINALS_UNSUPPORTED_FORMAT_MESSAGE,
      code: "player-finals/unsupported-format",
    };
  }
  if (
    isMultiTeamTotalFormat(tournament) ||
    resolveMatchFormat(finalsBracket?.matchFormat) === MatchFormat.MULTI_TEAM_TOTAL
  ) {
    return {
      pageMode: PlayerFinalsPageMode.UNAVAILABLE,
      reason: PLAYER_FINALS_UNSUPPORTED_FORMAT_MESSAGE,
      code: "player-finals/unsupported-format",
    };
  }

  const format = resolveTournamentFormat(tournament);
  if (format === TournamentFormat.SINGLE_ELIMINATION) {
    if (finalsBracket?.finalized === true && isMainH2HBracket(finalsBracket)) {
      return { pageMode: PlayerFinalsPageMode.FINALS, reason: null, code: null };
    }
    return {
      pageMode: PlayerFinalsPageMode.UNAVAILABLE,
      reason: PLAYER_FINALS_NO_BRACKET_MESSAGE,
      code: "player-finals/no-bracket",
    };
  }

  if (!finalsAdvancement) {
    return { pageMode: PlayerFinalsPageMode.QUALIFYING, reason: null, code: null };
  }
  if (finalsBracket?.finalized !== true || !isMainH2HBracket(finalsBracket)) {
    return {
      pageMode: PlayerFinalsPageMode.UNAVAILABLE,
      reason: PLAYER_FINALS_NO_BRACKET_MESSAGE,
      code: "player-finals/no-bracket",
    };
  }
  return { pageMode: PlayerFinalsPageMode.FINALS, reason: null, code: null };
}

function resultInvolvesEntry(result, entryId) {
  return (
    result?.winner?.entryId === entryId ||
    result?.loser?.entryId === entryId ||
    result?.team1?.entryId === entryId ||
    result?.team2?.entryId === entryId
  );
}

function matchInvolvesEntry(match, resolvedTeams, result, entryId) {
  if (match?.team1?.entryId === entryId || match?.team2?.entryId === entryId) {
    return true;
  }
  if (resolvedTeams?.team1?.entryId === entryId || resolvedTeams?.team2?.entryId === entryId) {
    return true;
  }
  if (resolvedTeams?.byeWinner?.entryId === entryId) {
    return true;
  }
  return resultInvolvesEntry(result, entryId);
}

function findPlayableMatch(entryId, bracket, resultsMap) {
  for (const match of bracket?.matches ?? []) {
    if (isMultiTeamMatch(match)) {
      continue;
    }
    const result = resultsMap.get(match.matchId);
    if (result?.status === MatchResultStatus.FINISHED) {
      continue;
    }
    const teams = resolveFinalsMatchTeams({ match, bracket, resultsMap });
    if (teams.reason === "bye" || teams.reason === "double_bye") {
      continue;
    }
    if (!teams.resolved || !teams.team1?.entryId || !teams.team2?.entryId) {
      continue;
    }
    if (teams.team1.entryId === entryId || teams.team2.entryId === entryId) {
      return { match, teams };
    }
  }
  return null;
}

function hasLostMatch(entryId, resultsMap) {
  for (const result of resultsMap.values()) {
    if (
      result?.status === MatchResultStatus.FINISHED &&
      result?.resolution !== FinalsMatchResolution.BYE &&
      result?.loser?.entryId === entryId
    ) {
      return true;
    }
  }
  return false;
}

function appearsInMainBracket(entryId, bracket, resultsMap) {
  for (const match of bracket?.matches ?? []) {
    const result = resultsMap.get(match.matchId) ?? null;
    const resolvedTeams = isMultiTeamMatch(match)
      ? null
      : resolveFinalsMatchTeams({ match, bracket, resultsMap });
    if (matchInvolvesEntry(match, resolvedTeams, result, entryId)) {
      return true;
    }
  }
  return false;
}

function opponentNameFor(entryId, team1, team2) {
  if (team1?.entryId === entryId) {
    return team2?.teamName ?? null;
  }
  if (team2?.entryId === entryId) {
    return team1?.teamName ?? null;
  }
  return null;
}

/**
 * チーム選択後の現在状態（main H2H のみ）
 * @param {{
 *   entryId: string,
 *   tournament?: object|null,
 *   finalsAdvancement?: object|null,
 *   bracket?: object|null,
 *   resultsMap?: Map<string, object>,
 *   sessionsMap?: Map<string, object>,
 * }} params
 */
export function resolvePlayerFinalsMatchView({
  entryId,
  tournament = null,
  finalsAdvancement = null,
  bracket = null,
  resultsMap = new Map(),
} = {}) {
  const page = resolvePlayerFinalsPageMode({
    tournament,
    finalsAdvancement,
    finalsBracket: bracket,
  });
  if (page.pageMode !== PlayerFinalsPageMode.FINALS) {
    return {
      pageMode: page.pageMode,
      state: PlayerFinalsMatchState.UNAVAILABLE,
      code: page.code,
      message: page.reason,
      matchId: null,
      roundLabel: null,
      teamName: null,
      opponentName: null,
      team1: null,
      team2: null,
      match: null,
      canReport: false,
    };
  }

  const titles = getFinalsChampionAndRunnerUp(bracket, resultsMap);
  if (titles.champion?.entryId === entryId) {
    return {
      pageMode: PlayerFinalsPageMode.FINALS,
      state: PlayerFinalsMatchState.CHAMPION,
      code: null,
      message: PLAYER_FINALS_CHAMPION_MESSAGE,
      matchId: null,
      roundLabel: null,
      teamName: titles.champion.teamName ?? null,
      opponentName: null,
      team1: null,
      team2: null,
      match: null,
      canReport: false,
    };
  }

  const playable = findPlayableMatch(entryId, bracket, resultsMap);
  if (playable) {
    const ownTeam =
      playable.teams.team1.entryId === entryId ? playable.teams.team1 : playable.teams.team2;
    return {
      pageMode: PlayerFinalsPageMode.FINALS,
      state: PlayerFinalsMatchState.PLAYABLE,
      code: null,
      message: null,
      matchId: playable.match.matchId,
      roundLabel: playable.match.roundLabel ?? null,
      teamName: ownTeam?.teamName ?? null,
      opponentName: opponentNameFor(entryId, playable.teams.team1, playable.teams.team2),
      team1: playable.teams.team1,
      team2: playable.teams.team2,
      match: playable.match,
      canReport: true,
    };
  }

  if (hasLostMatch(entryId, resultsMap)) {
    return {
      pageMode: PlayerFinalsPageMode.FINALS,
      state: PlayerFinalsMatchState.ELIMINATED,
      code: null,
      message: PLAYER_FINALS_ELIMINATED_MESSAGE,
      matchId: null,
      roundLabel: null,
      teamName: null,
      opponentName: null,
      team1: null,
      team2: null,
      match: null,
      canReport: false,
    };
  }

  if (appearsInMainBracket(entryId, bracket, resultsMap)) {
    return {
      pageMode: PlayerFinalsPageMode.FINALS,
      state: PlayerFinalsMatchState.WAITING_OPPONENT,
      code: null,
      message: PLAYER_FINALS_WAITING_OPPONENT_MESSAGE,
      matchId: null,
      roundLabel: null,
      teamName: null,
      opponentName: null,
      team1: null,
      team2: null,
      match: null,
      canReport: false,
    };
  }

  return {
    pageMode: PlayerFinalsPageMode.FINALS,
    state: PlayerFinalsMatchState.NOT_ADVANCED,
    code: null,
    message: PLAYER_FINALS_NOT_ADVANCED_MESSAGE,
    matchId: null,
    roundLabel: null,
    teamName: null,
    opponentName: null,
    team1: null,
    team2: null,
    match: null,
    canReport: false,
  };
}

/**
 * クライアントの winnerEntryId は使わない。常に identity の entryId。
 * @param {string} identityEntryId
 * @param {unknown} [_clientWinnerEntryId]
 */
export function resolveReportWinnerEntryId(identityEntryId, _clientWinnerEntryId) {
  return identityEntryId;
}

/**
 * @param {object} params
 * @param {object} params.match
 * @param {object} params.team1
 * @param {object} params.team2
 * @param {string} params.winnerEntryId
 * @param {2|3} params.winsRequired
 */
export function buildPlayerWinReportPlayedPayload({
  match,
  team1,
  team2,
  winnerEntryId,
  winsRequired,
}) {
  const winnerSide = team1?.entryId === winnerEntryId ? "team1" : "team2";
  if (winnerSide === "team2" && team2?.entryId !== winnerEntryId) {
    return {
      valid: false,
      message: "この試合の勝利を報告する権限がありません。",
    };
  }

  const input = {};
  for (let setNumber = 1; setNumber <= winsRequired; setNumber += 1) {
    const fields = getFinalsSetScoreFieldNames(setNumber);
    if (winnerSide === "team1") {
      input[fields.team1] = SET_WINNING_SCORE;
      input[fields.team2] = 0;
    } else {
      input[fields.team1] = 0;
      input[fields.team2] = SET_WINNING_SCORE;
    }
  }

  const validation = validateFinalsMatchResultInput(input, {
    winsRequired,
    requireFinishReason: false,
  });
  if (!validation.valid) {
    return validation;
  }

  const payload = buildPlayedFinalsMatchResultPayload({
    match,
    team1,
    team2,
    validatedData: validation.data,
  });
  payload.source = PLAYER_FINALS_WIN_REPORT_SOURCE;
  payload.reportedByEntryId = winnerEntryId;
  return { valid: true, data: payload, winnerSide };
}

/**
 * @param {object} params
 */
export function buildPlayerWinReportSessionFields({ match, team1, team2 }) {
  return {
    matchId: match.matchId,
    roundNumber: match.roundNumber,
    matchNumber: match.matchNumber,
    status: MatchSessionStatus.FINISHED,
    team1,
    team2,
  };
}

function reportFailure(code, message, extras = {}) {
  return { ok: false, code, message, ...extras };
}

/**
 * 報告直前の検証。勝者は identityEntryId のみ。clientWinnerEntryId は無視。
 * @param {{
 *   tournament: object,
 *   finalsAdvancement?: object|null,
 *   bracket: object,
 *   resultsMap: Map<string, object>,
 *   entryId: string,
 *   clientMatchId?: string|null,
 *   clientWinnerEntryId?: unknown,
 * }} params
 */
export function evaluatePlayerFinalsWinReport({
  tournament,
  finalsAdvancement = null,
  bracket,
  resultsMap = new Map(),
  entryId,
  clientMatchId = null,
  clientWinnerEntryId = null,
} = {}) {
  const winnerEntryId = resolveReportWinnerEntryId(entryId, clientWinnerEntryId);
  const view = resolvePlayerFinalsMatchView({
    entryId: winnerEntryId,
    tournament,
    finalsAdvancement,
    bracket,
    resultsMap,
  });

  if (view.pageMode !== PlayerFinalsPageMode.FINALS) {
    return reportFailure(
      view.code || "player-finals/unavailable",
      view.message || PLAYER_FINALS_UNSUPPORTED_FORMAT_MESSAGE,
      { view }
    );
  }

  if (view.state !== PlayerFinalsMatchState.PLAYABLE || !view.match || !view.canReport) {
    if (clientMatchId) {
      const existing = resultsMap.get(clientMatchId);
      if (existing?.status === MatchResultStatus.FINISHED) {
        return reportFailure("player-finals/already-official", PLAYER_FINALS_ALREADY_OFFICIAL_MESSAGE, {
          view,
        });
      }
    }
    const messageByState = {
      [PlayerFinalsMatchState.WAITING_OPPONENT]: "次の対戦相手の決定をお待ちください。",
      [PlayerFinalsMatchState.ELIMINATED]: "決勝トーナメント敗退のため報告できません。",
      [PlayerFinalsMatchState.CHAMPION]: "すでに優勝が確定しています。",
      [PlayerFinalsMatchState.NOT_ADVANCED]: "予選終了のため報告できません。",
    };
    return reportFailure(
      "player-finals/not-playable",
      messageByState[view.state] || "現在報告できる試合がありません。",
      { view }
    );
  }

  if (clientMatchId && clientMatchId !== view.matchId) {
    return reportFailure("player-finals/already-official", PLAYER_FINALS_ALREADY_OFFICIAL_MESSAGE, {
      view,
    });
  }

  const existing = resultsMap.get(view.matchId);
  if (existing?.status === MatchResultStatus.FINISHED) {
    return reportFailure("player-finals/already-official", PLAYER_FINALS_ALREADY_OFFICIAL_MESSAGE, {
      view,
    });
  }

  const winsRequired = resolveMatchWinsRequired({
    tournament: tournamentViewForBracketRules(tournament, bracket),
    bracket,
    roundNumber: view.match.roundNumber,
  });
  const built = buildPlayerWinReportPlayedPayload({
    match: view.match,
    team1: view.team1,
    team2: view.team2,
    winnerEntryId,
    winsRequired,
  });
  if (!built.valid) {
    return reportFailure("player-finals/invalid-result", built.message || "結果を保存できません。", {
      view,
    });
  }

  return {
    ok: true,
    code: null,
    message: null,
    view,
    winnerEntryId,
    winsRequired,
    payload: built.data,
    sessionFields: buildPlayerWinReportSessionFields({
      match: view.match,
      team1: view.team1,
      team2: view.team2,
    }),
  };
}

/**
 * 公開・管理向けに返す最小 payload（内部スコアを隠す）
 * @param {object} view
 */
export function toPlayerFinalsMatchListPayload(view, extras = {}) {
  return {
    pageMode: view.pageMode,
    state: view.state,
    message: view.message,
    roundLabel: view.roundLabel,
    teamName: view.teamName,
    opponentName: view.opponentName,
    team1: view.team1,
    team2: view.team2,
    matchId: view.state === PlayerFinalsMatchState.PLAYABLE ? view.matchId : null,
    canReport: view.canReport === true,
    ...extras,
  };
}

export function assertClientDidNotChooseWinner(winnerEntryId, identityEntryId) {
  return winnerEntryId === identityEntryId;
}

export const PLAYER_FINALS_SELECTED_TEAM_LABEL = "あなたが選択しているチーム";
export const PLAYER_FINALS_YOUR_TEAM_LABEL = "あなたのチーム";
export const PLAYER_FINALS_CHANGE_TEAM_LABEL = "チームを変更";
export const PLAYER_FINALS_WIN_CONFIRM_TITLE = "勝利報告の確認";
export const PLAYER_FINALS_WIN_CONFIRM_WINNER_LABEL = "勝者として報告するチーム";
export const PLAYER_FINALS_WIN_CONFIRM_MATCH_LABEL = "対戦";
export const PLAYER_FINALS_WIN_CONFIRM_BODY =
  "この内容でトーナメント結果を確定します。\n確定後は次のカードに反映されます。";
export const PLAYER_FINALS_WIN_CONFIRM_CANCEL_LABEL = "戻る";

function displayTeamName(value) {
  const name = String(value || "").trim();
  return name || "このチーム";
}

/**
 * @param {string|null|undefined} teamName
 */
export function formatPlayerFinalsWinConfirmButtonLabel(teamName) {
  return `${displayTeamName(teamName)}の勝利を確定`;
}

/**
 * @param {string|null|undefined} teamName
 */
export function formatPlayerFinalsReportHint(teamName) {
  return `選択中の ${displayTeamName(teamName)} を勝者として報告します`;
}

/**
 * @param {string|null|undefined} teamName
 * @param {string|null|undefined} opponentName
 */
export function formatPlayerFinalsMatchLine(teamName, opponentName) {
  return `${displayTeamName(teamName)} vs ${displayTeamName(opponentName)}`;
}

function displayId(value) {
  return String(value || "").trim();
}

/**
 * ブラケット上の team1/team2 を崩さず、自チーム側を特定する。
 * 同名チームでも誤判定しないよう entryId を優先し、無い場合のみ名前照合する。
 * @param {{
 *   entryId?: string|null,
 *   teamName?: string|null,
 *   opponentName?: string|null,
 *   team1?: { teamName?: string|null, entryId?: string|null }|null,
 *   team2?: { teamName?: string|null, entryId?: string|null }|null,
 * }} payload
 */
export function resolvePlayerFinalsOwnMatchSides(payload = {}) {
  const ownEntryId = displayId(payload.entryId);
  const ownName = String(payload.teamName || "").trim();
  const opponentName = String(payload.opponentName || "").trim();
  const team1Name = String(payload.team1?.teamName || "").trim();
  const team2Name = String(payload.team2?.teamName || "").trim();
  const team1EntryId = displayId(payload.team1?.entryId);
  const team2EntryId = displayId(payload.team2?.entryId);
  const hasBracketTeams = Boolean(team1Name || team2Name || team1EntryId || team2EntryId);

  let ownSide = null;
  if (ownEntryId && (team1EntryId === ownEntryId || team2EntryId === ownEntryId)) {
    ownSide = team1EntryId === ownEntryId ? "team1" : "team2";
  } else if (hasBracketTeams) {
    if (ownName && team1Name === ownName && team2Name !== ownName) {
      ownSide = "team1";
    } else if (ownName && team2Name === ownName && team1Name !== ownName) {
      ownSide = "team2";
    } else if (opponentName && team1Name === opponentName && team2Name !== opponentName) {
      ownSide = "team2";
    } else if (opponentName && team2Name === opponentName && team1Name !== opponentName) {
      ownSide = "team1";
    } else {
      ownSide = "team1";
    }
  } else {
    ownSide = "team1";
  }

  const topName = hasBracketTeams ? team1Name || (ownSide === "team1" ? ownName : opponentName) : ownName;
  const bottomName = hasBracketTeams
    ? team2Name || (ownSide === "team2" ? ownName : opponentName)
    : opponentName;

  return {
    ownSide,
    team1: {
      name: displayTeamName(topName),
      isOwn: ownSide === "team1",
    },
    team2: {
      name: displayTeamName(bottomName),
      isOwn: ownSide === "team2",
    },
  };
}

/**
 * @param {{ teamName?: string|null, opponentName?: string|null }} params
 */
export function buildPlayerFinalsWinConfirmCopy({ teamName, opponentName } = {}) {
  const winnerName = displayTeamName(teamName);
  return {
    title: PLAYER_FINALS_WIN_CONFIRM_TITLE,
    winnerLabel: PLAYER_FINALS_WIN_CONFIRM_WINNER_LABEL,
    winnerName,
    matchLabel: PLAYER_FINALS_WIN_CONFIRM_MATCH_LABEL,
    matchLine: formatPlayerFinalsMatchLine(teamName, opponentName),
    body: PLAYER_FINALS_WIN_CONFIRM_BODY,
    cancelLabel: PLAYER_FINALS_WIN_CONFIRM_CANCEL_LABEL,
    confirmLabel: formatPlayerFinalsWinConfirmButtonLabel(teamName),
  };
}

/**
 * @param {string|null|undefined} state
 */
export function canShowPlayerFinalsWinReportButton(state) {
  return state === PlayerFinalsMatchState.PLAYABLE;
}
