/**
 * 運営トーナメント表の表示モード / 選択ラウンド保持
 * URL クエリを優先し、sessionStorage でブラケット種別ごとに補完する。
 */
import { BracketKind } from "../domain/bracket-collections.js";
import {
  BracketViewMode,
  parseBracketViewModeParam,
  resolveDefaultBracketViewMode,
  resolveNearestBracketRoundNumber,
} from "../domain/finals-bracket-display.js";

export const BRACKET_VIEW_MODE_PARAM = "viewMode";
export const BRACKET_ROUND_PARAM = "round";

const SESSION_KEY_PREFIX = "sma.finalsBracketView.";

/**
 * @param {string} tournamentId
 * @param {string} bracketKind
 */
export function buildBracketViewStateSessionKey(tournamentId, bracketKind) {
  const kind = bracketKind === BracketKind.CONSOLATION ? "consolation" : "finals";
  return `${SESSION_KEY_PREFIX}${tournamentId}.${kind}`;
}

/**
 * @param {unknown} value
 * @returns {{ viewMode: string, roundNumber: number|null }|null}
 */
export function normalizeBracketViewState(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const viewMode = parseBracketViewModeParam(value.viewMode);
  if (!viewMode) {
    return null;
  }
  const roundRaw = value.roundNumber;
  const roundNumber =
    typeof roundRaw === "number"
      ? roundRaw
      : typeof roundRaw === "string" && roundRaw.trim() !== ""
        ? Number(roundRaw)
        : null;
  return {
    viewMode,
    roundNumber: Number.isInteger(roundNumber) && roundNumber >= 1 ? roundNumber : null,
  };
}

/**
 * @param {URLSearchParams|string|null|undefined} search
 */
export function readBracketViewStateFromSearch(search) {
  const params =
    search instanceof URLSearchParams
      ? search
      : new URLSearchParams(typeof search === "string" ? search : "");
  const viewMode = parseBracketViewModeParam(params.get(BRACKET_VIEW_MODE_PARAM));
  if (!viewMode) {
    return null;
  }
  const roundRaw = params.get(BRACKET_ROUND_PARAM);
  const roundNumber = roundRaw != null && roundRaw !== "" ? Number(roundRaw) : null;
  return normalizeBracketViewState({
    viewMode,
    roundNumber: Number.isInteger(roundNumber) ? roundNumber : null,
  });
}

/**
 * @param {string} tournamentId
 * @param {string} bracketKind
 * @param {{ getItem?: Function }} [storage]
 */
export function readBracketViewStateFromSession(
  tournamentId,
  bracketKind,
  storage = globalThis.sessionStorage
) {
  if (!tournamentId || !storage?.getItem) {
    return null;
  }
  try {
    const raw = storage.getItem(buildBracketViewStateSessionKey(tournamentId, bracketKind));
    if (!raw) {
      return null;
    }
    return normalizeBracketViewState(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * @param {string} tournamentId
 * @param {string} bracketKind
 * @param {{ viewMode: string, roundNumber?: number|null }} state
 * @param {{ setItem?: Function }} [storage]
 */
export function writeBracketViewStateToSession(
  tournamentId,
  bracketKind,
  state,
  storage = globalThis.sessionStorage
) {
  const normalized = normalizeBracketViewState(state);
  if (!tournamentId || !normalized || !storage?.setItem) {
    return;
  }
  try {
    storage.setItem(
      buildBracketViewStateSessionKey(tournamentId, bracketKind),
      JSON.stringify(normalized)
    );
  } catch {
    // sessionStorage 不可時は無視（URL 側で補完）
  }
}

/**
 * @param {URLSearchParams} params
 * @param {{ viewMode?: string|null, roundNumber?: number|null }|null|undefined} state
 */
export function applyBracketViewStateToSearchParams(params, state) {
  const normalized = normalizeBracketViewState(state);
  if (!normalized) {
    params.delete(BRACKET_VIEW_MODE_PARAM);
    params.delete(BRACKET_ROUND_PARAM);
    return params;
  }
  params.set(BRACKET_VIEW_MODE_PARAM, normalized.viewMode);
  if (normalized.roundNumber != null) {
    params.set(BRACKET_ROUND_PARAM, String(normalized.roundNumber));
  } else {
    params.delete(BRACKET_ROUND_PARAM);
  }
  return params;
}

/**
 * 運営画面向け: URL → session → 初期値の順で復元
 * @param {{
 *   tournamentId: string,
 *   bracketKind: string,
 *   search?: URLSearchParams|string|null,
 *   rounds?: Array<{ roundNumber: number }>,
 *   storage?: Storage,
 * }} params
 */
export function resolveAdminBracketViewState({
  tournamentId,
  bracketKind,
  search = "",
  rounds = [],
  storage = globalThis.sessionStorage,
} = {}) {
  const fromUrl = readBracketViewStateFromSearch(search);
  const fromSession = readBracketViewStateFromSession(tournamentId, bracketKind, storage);

  const viewMode =
    fromUrl?.viewMode ??
    fromSession?.viewMode ??
    resolveDefaultBracketViewMode(1024, { surface: "admin" });

  const preferredRoundNumber = fromUrl?.roundNumber ?? fromSession?.roundNumber ?? null;
  const nearest = resolveNearestBracketRoundNumber(preferredRoundNumber, rounds);
  return {
    viewMode,
    roundNumber: nearest,
    source: fromUrl?.viewMode
      ? "url"
      : fromSession?.viewMode
        ? "session"
        : "default",
  };
}
