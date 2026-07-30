/**
 * 決勝／下位トーナメントのコート番号割当（DOM / Firestore 非依存）
 *
 * 上位: 既存どおり matchNumber（または保存済み courtNumber）をコート番号として扱う。
 * 下位: 上位の最大コート番号の次から開始し、大会コート数までの範囲で循環する。
 */

/**
 * @param {object|null|undefined} match
 * @returns {number|null}
 */
export function resolveMatchCourtNumber(match) {
  if (Number.isInteger(match?.courtNumber) && match.courtNumber >= 1) {
    return match.courtNumber;
  }
  if (Number.isInteger(match?.matchNumber) && match.matchNumber >= 1) {
    return match.matchNumber;
  }
  return null;
}

/**
 * 上位ブラケットが使用する最大コート番号
 * @param {object|null|undefined} mainBracket
 */
export function resolveMainBracketMaxCourtNumber(mainBracket) {
  let maxCourt = 0;
  for (const match of mainBracket?.matches ?? []) {
    const court = resolveMatchCourtNumber(match);
    if (court != null && court > maxCourt) {
      maxCourt = court;
    }
  }
  return maxCourt;
}

/**
 * @param {{ mainBracket?: object|null, tournamentCourtCount?: number|null }} params
 */
export function resolveConsolationCourtRange({
  mainBracket = null,
  tournamentCourtCount = null,
} = {}) {
  const mainMaxCourt = resolveMainBracketMaxCourtNumber(mainBracket);
  const startCourt = mainMaxCourt + 1;
  const endCourt =
    Number.isInteger(tournamentCourtCount) && tournamentCourtCount >= startCourt
      ? tournamentCourtCount
      : startCourt;

  return {
    mainMaxCourt,
    startCourt,
    endCourt,
    poolSize: endCourt - startCourt + 1,
  };
}

/**
 * ラウンド内 matchNumber（1始まり）から下位コート番号を算出
 * @param {number} matchNumber
 * @param {{ startCourt: number, poolSize: number }} range
 */
export function assignConsolationCourtNumber(matchNumber, range) {
  if (!Number.isInteger(matchNumber) || matchNumber < 1) {
    return range.startCourt;
  }
  const offset = (matchNumber - 1) % range.poolSize;
  return range.startCourt + offset;
}

/**
 * 下位ブラケットの各試合へ courtNumber を付与する
 * @param {object} bracket
 * @param {{ mainBracket?: object|null, tournamentCourtCount?: number|null }} [options]
 */
export function assignConsolationCourtsToBracket(bracket, options = {}) {
  if (!bracket || !Array.isArray(bracket.matches)) {
    return bracket;
  }

  const range = resolveConsolationCourtRange(options);
  return {
    ...bracket,
    courtAssignment: {
      mainMaxCourt: range.mainMaxCourt,
      startCourt: range.startCourt,
      endCourt: range.endCourt,
    },
    matches: bracket.matches.map((match) => ({
      ...match,
      courtNumber: assignConsolationCourtNumber(match.matchNumber, range),
    })),
  };
}

/**
 * 保存済み courtNumber が揃っていればそのまま。欠ける場合のみ再計算して付与。
 * @param {object|null|undefined} bracket
 * @param {{ mainBracket?: object|null, tournamentCourtCount?: number|null }} [options]
 */
export function ensureConsolationCourtNumbers(bracket, options = {}) {
  if (!bracket?.matches?.length) {
    return bracket;
  }

  const allAssigned = bracket.matches.every(
    (match) => Number.isInteger(match.courtNumber) && match.courtNumber >= 1
  );
  if (allAssigned) {
    return bracket;
  }

  return assignConsolationCourtsToBracket(bracket, options);
}
