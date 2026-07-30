/**
 * 下位トーナメント管理 UI ヘルパー（Domain 非依存の表示・URL ロジック）
 */
import { BracketKind, resolveOptionsBracketKind } from "../domain/bracket-collections.js";
import { ConsolationEligibilityReasonCode } from "../domain/consolation-participants.js";
import { resolveConsolationBracketSize } from "../domain/consolation-bracket.js";
import { applyBracketViewStateToSearchParams } from "./finals-bracket-view-state.js";

export const BracketViewParam = {
  CONSOLATION: "consolation",
};

/**
 * @param {URLSearchParams|string|null|undefined} search
 */
export function getBracketViewParamFromSearch(search) {
  const params =
    search instanceof URLSearchParams
      ? search
      : new URLSearchParams(typeof search === "string" ? search : "");
  return params.get("view");
}

/**
 * @param {string|null|undefined} viewParam
 * @param {boolean} hasConsolationBracket
 */
export function resolveActiveBracketKindFromViewParam(viewParam, hasConsolationBracket) {
  if (viewParam === BracketViewParam.CONSOLATION && hasConsolationBracket) {
    return BracketKind.CONSOLATION;
  }
  return BracketKind.MAIN;
}

/**
 * @param {string} tournamentId
 * @param {string} bracketKind
 * @param {{ viewMode?: string|null, roundNumber?: number|null }} [displayState]
 */
export function buildBracketPageHref(tournamentId, bracketKind = BracketKind.MAIN, displayState = null) {
  const params = new URLSearchParams({ id: tournamentId });
  if (bracketKind === BracketKind.CONSOLATION) {
    params.set("view", BracketViewParam.CONSOLATION);
  }
  applyBracketViewStateToSearchParams(params, displayState);
  return `tournament-finals-bracket.html?${params.toString()}`;
}

/**
 * @param {string} tournamentId
 * @param {string} bracketKind
 * @param {{ viewMode?: string|null, roundNumber?: number|null }|null} [displayState]
 * @param {{ replace?: boolean }} [options]
 */
export function syncBracketViewUrl(
  tournamentId,
  bracketKind,
  displayState = null,
  { replace = true } = {}
) {
  const url = new URL(window.location.href);
  url.searchParams.set("id", tournamentId);
  if (bracketKind === BracketKind.CONSOLATION) {
    url.searchParams.set("view", BracketViewParam.CONSOLATION);
  } else {
    url.searchParams.delete("view");
  }
  if (displayState) {
    applyBracketViewStateToSearchParams(url.searchParams, displayState);
  }
  const nextUrl = `${url.pathname}${url.search}${url.hash}`;
  if (replace) {
    window.history.replaceState({}, "", nextUrl);
  } else {
    window.history.pushState({}, "", nextUrl);
  }
}

/**
 * @param {string|null|undefined} reasonCode
 */
export function shouldShowConsolationEligibilityHint(reasonCode) {
  return (
    reasonCode === ConsolationEligibilityReasonCode.NOT_ENOUGH_PARTICIPANTS ||
    reasonCode === ConsolationEligibilityReasonCode.ADVANCEMENT_NOT_FINALIZED ||
    reasonCode === ConsolationEligibilityReasonCode.MAIN_BRACKET_NOT_FINALIZED
  );
}

/**
 * @param {string|null|undefined} reasonCode
 */
export function getConsolationEligibilityHintMessage(reasonCode) {
  switch (reasonCode) {
    case ConsolationEligibilityReasonCode.NOT_ENOUGH_PARTICIPANTS:
      return "下位トーナメント対象が2チーム未満のため作成できません。";
    case ConsolationEligibilityReasonCode.ADVANCEMENT_NOT_FINALIZED:
      return "決勝進出者を確定すると作成できます。";
    case ConsolationEligibilityReasonCode.MAIN_BRACKET_NOT_FINALIZED:
      return "上位トーナメントを生成すると作成できます。";
    default:
      return null;
  }
}

/**
 * @param {{ eligible?: boolean, reasonCode?: string }} eligibility
 * @param {boolean} hasConsolationBracket
 * @param {string} activeBracketKind
 * @param {boolean} mainBracketFinalized
 */
export function shouldShowConsolationCreateButton(
  eligibility,
  hasConsolationBracket,
  activeBracketKind,
  mainBracketFinalized
) {
  return (
    eligibility?.eligible === true &&
    !hasConsolationBracket &&
    activeBracketKind === BracketKind.MAIN &&
    mainBracketFinalized === true
  );
}

/**
 * @param {number} participantCount
 */
export function buildConsolationCreateConfirmMessage(participantCount) {
  const sizeResult = resolveConsolationBracketSize(participantCount);
  const byeCount = sizeResult.valid ? sizeResult.byeCount ?? 0 : 0;
  const byeLine =
    byeCount > 0 ? `${byeCount}チームが1回戦BYEになります。\n\n` : "\n";
  return (
    `下位トーナメントを作成しますか？\n\n` +
    `対象：${participantCount}チーム\n` +
    `方式：ランダム抽選\n` +
    `${byeLine}` +
    `作成後は参加チームや組み合わせを変更できません。`
  );
}

/**
 * @param {number} participantCount
 */
export function formatConsolationTargetLine(participantCount) {
  return `下位トーナメント対象：${participantCount}チーム`;
}

/**
 * @param {object|null|undefined} bracket
 */
export function formatConsolationBracketMeta(bracket) {
  const teamCount = bracket?.teamCount ?? "—";
  const bracketSize = bracket?.bracketSize ?? "—";
  const byeCount = bracket?.byeCount ?? "—";
  return `${teamCount} チーム / ${bracketSize} 枠 / BYE ${byeCount} / ランダム抽選`;
}

/**
 * @param {URLSearchParams|string|null|undefined} search
 */
export function resolveMatchPageBracketKind(search) {
  const params =
    search instanceof URLSearchParams
      ? search
      : new URLSearchParams(typeof search === "string" ? search : "");
  const raw = params.get("bracketKind");
  if (raw === null) {
    return BracketKind.MAIN;
  }
  return resolveOptionsBracketKind({ bracketKind: raw });
}

/**
 * @param {string} tournamentId
 * @param {string} matchId
 * @param {{
 *   enterResult?: boolean,
 *   bracketKind?: string,
 *   viewMode?: string|null,
 *   roundNumber?: number|null,
 * }} [options]
 */
export function buildFinalsMatchPageHref(tournamentId, matchId, options = {}) {
  const {
    enterResult = false,
    bracketKind = BracketKind.MAIN,
    viewMode = null,
    roundNumber = null,
  } = options;
  const params = new URLSearchParams({
    id: tournamentId,
    matchId,
  });
  if (enterResult) {
    params.set("enterResult", "1");
  }
  if (bracketKind === BracketKind.CONSOLATION) {
    params.set("bracketKind", BracketKind.CONSOLATION);
  }
  applyBracketViewStateToSearchParams(params, { viewMode, roundNumber });
  return `tournament-finals-match.html?${params.toString()}`;
}

/**
 * @param {string} tournamentId
 * @param {string} bracketKind
 * @param {{ entryId?: string|null, replace?: boolean }} [options]
 */
export function syncPublicBracketViewUrl(tournamentId, bracketKind, options = {}) {
  const { entryId = null, replace = true } = options;
  const url = new URL(window.location.href);
  url.searchParams.set("id", tournamentId);
  if (entryId) {
    url.searchParams.set("entry", entryId);
  } else {
    url.searchParams.delete("entry");
  }
  if (bracketKind === BracketKind.CONSOLATION) {
    url.searchParams.set("view", BracketViewParam.CONSOLATION);
  } else {
    url.searchParams.delete("view");
  }
  const nextUrl = `${url.pathname}${url.search}${url.hash}`;
  if (replace) {
    window.history.replaceState({}, "", nextUrl);
  } else {
    window.history.pushState({}, "", nextUrl);
  }
}
