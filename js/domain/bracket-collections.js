/**
 * ブラケット種別と Firestore コレクション名の対応（DOM / Firestore 非依存）
 */

export const BracketKind = {
  MAIN: "main",
  CONSOLATION: "consolation",
};

/** 下位トーナメント生成に必要な最小参加チーム数 */
export const CONSOLATION_MIN_PARTICIPANTS = 2;

/** @type {ReadonlySet<string>} */
const VALID_BRACKET_KINDS = new Set(Object.values(BracketKind));

/** @type {Record<string, { bracket: string, sessions: string, results: string }>} */
export const BRACKET_COLLECTIONS = {
  [BracketKind.MAIN]: {
    bracket: "finalsBracket",
    sessions: "finalsMatchSessions",
    results: "finalsMatchResults",
  },
  [BracketKind.CONSOLATION]: {
    bracket: "consolationBracket",
    sessions: "consolationMatchSessions",
    results: "consolationMatchResults",
  },
};

/**
 * @param {unknown} kind
 */
export function isValidBracketKind(kind) {
  return typeof kind === "string" && VALID_BRACKET_KINDS.has(kind);
}

/**
 * @param {unknown} kind
 * @returns {{ bracket: string, sessions: string, results: string }}
 */
export function resolveBracketCollections(kind) {
  if (!isValidBracketKind(kind)) {
    throw new Error(`Invalid bracket kind: ${String(kind)}`);
  }
  return BRACKET_COLLECTIONS[kind];
}

/**
 * サービス層 options から bracketKind を解決する。
 * 省略時のみ main。不明な kind はエラー。
 *
 * @param {{ bracketKind?: string }} [options]
 */
export function resolveOptionsBracketKind(options = {}) {
  if (options?.bracketKind === undefined || options?.bracketKind === null) {
    return BracketKind.MAIN;
  }
  if (!isValidBracketKind(options.bracketKind)) {
    const error = new Error(`Invalid bracket kind: ${String(options.bracketKind)}`);
    error.code = "bracket/invalid-kind";
    throw error;
  }
  return options.bracketKind;
}
