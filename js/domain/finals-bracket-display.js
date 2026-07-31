/**
 * 決勝トーナメント表の表示用ドメイン（DOM / Firestore 非依存）
 */
import { getFinalsRoundLabel } from "./finals-bracket.js";
import { FinalsMatchDisplayStatus } from "./finals-match-progress.js";
import { resolveMatchCourtNumber } from "./finals-court-assignment.js";
import {
  getMultiTeamRoundLabel,
  isMultiTeamBracket,
} from "./multi-team-bracket.js";

export { resolveMatchCourtNumber } from "./finals-court-assignment.js";

export const BracketViewMode = {
  ROUND: "round",
  BOARD: "board",
};

/** 768px 未満をスマホ縦画面相当とみなす（既存 CSS の max-width: 768px と整合） */
export const MOBILE_BRACKET_VIEW_MAX_WIDTH = 767;

/**
 * @param {number|null|undefined} courtNumber
 */
export function formatFinalsMatchCourtLabel(courtNumber) {
  if (!Number.isInteger(courtNumber) || courtNumber < 1) {
    return "コート—";
  }
  return `コート${courtNumber}`;
}

/**
 * @param {object} bracket
 */
export function groupBracketMatchesByRound(bracket) {
  const rounds = new Map();
  for (const match of bracket?.matches ?? []) {
    if (!rounds.has(match.roundNumber)) {
      rounds.set(match.roundNumber, []);
    }
    rounds.get(match.roundNumber).push(match);
  }

  const bracketSize = bracket?.bracketSize;
  const multi = isMultiTeamBracket(bracket);

  return [...rounds.entries()]
    .sort(([a], [b]) => a - b)
    .map(([roundNumber, matches]) => {
      const sortedMatches = matches.sort((a, b) => a.matchNumber - b.matchNumber);
      let roundLabel;
      if (multi) {
        // H2H の log2(bracketSize) 前提を使わず、実ラウンド数から算出
        roundLabel = getMultiTeamRoundLabel(bracket, roundNumber);
      } else if (bracketSize) {
        roundLabel = getFinalsRoundLabel(bracketSize, roundNumber);
      } else {
        roundLabel = sortedMatches[0]?.roundLabel ?? `第${roundNumber}ラウンド`;
      }

      return {
        roundNumber,
        roundLabel,
        matches: sortedMatches,
      };
    });
}

/**
 * @param {string} displayStatus
 */
export function isFinalsMatchUnfinished(displayStatus) {
  return (
    displayStatus !== FinalsMatchDisplayStatus.FINISHED &&
    displayStatus !== FinalsMatchDisplayStatus.BYE
  );
}

/**
 * @param {string} displayStatus
 */
export function getFinalsMatchCardStateClass(displayStatus) {
  switch (displayStatus) {
    case FinalsMatchDisplayStatus.PLAYING:
      return "finals-bracket__match--playing";
    case FinalsMatchDisplayStatus.FINISHED:
      return "finals-bracket__match--finished";
    case FinalsMatchDisplayStatus.BYE:
      return "finals-bracket__match--bye";
    case FinalsMatchDisplayStatus.READY:
      return "finals-bracket__match--ready";
    case FinalsMatchDisplayStatus.WAITING_OPPONENT:
    default:
      return "finals-bracket__match--waiting";
  }
}

/**
 * @param {string} displayStatus
 */
export function getFinalsMatchStatusBadgeDataset(displayStatus) {
  switch (displayStatus) {
    case FinalsMatchDisplayStatus.FINISHED:
      return "confirmed";
    case FinalsMatchDisplayStatus.PLAYING:
      return "open";
    default:
      return "draft";
  }
}

/**
 * 公開画面の statusLabel から表示状態を復元（スナップショット互換）
 * @param {string} statusLabel
 */
export function mapFinalsStatusLabelToDisplayStatus(statusLabel) {
  switch (statusLabel) {
    case "BYE通過":
      return FinalsMatchDisplayStatus.BYE;
    case "終了":
      return FinalsMatchDisplayStatus.FINISHED;
    case "試合中":
      return FinalsMatchDisplayStatus.PLAYING;
    case "開始可能":
      return FinalsMatchDisplayStatus.READY;
    case "対戦相手未定":
    default:
      return FinalsMatchDisplayStatus.WAITING_OPPONENT;
  }
}

/**
 * @param {number} [viewportWidth]
 * @param {{ surface?: 'admin'|'public' }} [options]
 */
export function resolveDefaultBracketViewMode(viewportWidth = 1024, options = {}) {
  if (options.surface === "admin") {
    return BracketViewMode.ROUND;
  }
  return viewportWidth <= MOBILE_BRACKET_VIEW_MAX_WIDTH
    ? BracketViewMode.ROUND
    : BracketViewMode.BOARD;
}

/**
 * URL / 保存値から表示モードを復元。不正値は null。
 * @param {string|null|undefined} value
 * @returns {'round'|'board'|null}
 */
export function parseBracketViewModeParam(value) {
  if (value === BracketViewMode.ROUND) {
    return BracketViewMode.ROUND;
  }
  if (value === BracketViewMode.BOARD || value === "overall") {
    return BracketViewMode.BOARD;
  }
  return null;
}

/**
 * 希望ラウンドが無い／無効なとき、最も近い有効ラウンドへフォールバック。
 * @param {number|null|undefined} preferredRoundNumber
 * @param {BracketRoundSummary[]} rounds
 * @returns {number|null}
 */
export function resolveNearestBracketRoundNumber(preferredRoundNumber, rounds) {
  if (!rounds?.length) {
    return null;
  }

  const sorted = [...rounds].sort((a, b) => a.roundNumber - b.roundNumber);
  if (
    Number.isInteger(preferredRoundNumber) &&
    sorted.some((round) => round.roundNumber === preferredRoundNumber)
  ) {
    return preferredRoundNumber;
  }

  if (!Number.isInteger(preferredRoundNumber)) {
    return null;
  }

  let best = sorted[0].roundNumber;
  let bestDistance = Math.abs(best - preferredRoundNumber);
  for (const round of sorted) {
    const distance = Math.abs(round.roundNumber - preferredRoundNumber);
    if (distance < bestDistance) {
      best = round.roundNumber;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * @typedef {{ roundNumber: number, roundLabel: string, matches: object[] }} BracketRoundSummary
 * @typedef {(match: object) => string} GetDisplayStatusFn
 */

/**
 * 初期表示ラウンド:
 * 1. 進行中試合があるラウンド
 * 2. 未終了試合がある最も早いラウンド
 * 3. すべて終了済みなら決勝（最終ラウンド）
 *
 * @param {BracketRoundSummary[]} rounds
 * @param {GetDisplayStatusFn} getDisplayStatus
 */
export function resolveInitialBracketRoundNumber(rounds, getDisplayStatus) {
  if (!rounds?.length) {
    return null;
  }

  const sorted = [...rounds].sort((a, b) => a.roundNumber - b.roundNumber);

  for (const round of sorted) {
    for (const match of round.matches) {
      if (getDisplayStatus(match) === FinalsMatchDisplayStatus.PLAYING) {
        return round.roundNumber;
      }
    }
  }

  for (const round of sorted) {
    for (const match of round.matches) {
      if (isFinalsMatchUnfinished(getDisplayStatus(match))) {
        return round.roundNumber;
      }
    }
  }

  return sorted[sorted.length - 1].roundNumber;
}

/**
 * @param {BracketRoundSummary[]} rounds
 * @param {number} roundNumber
 */
export function getAdjacentBracketRoundNumbers(rounds, roundNumber) {
  const sorted = [...rounds].sort((a, b) => a.roundNumber - b.roundNumber);
  const index = sorted.findIndex((round) => round.roundNumber === roundNumber);
  if (index < 0) {
    return { previous: null, next: null };
  }
  return {
    previous: index > 0 ? sorted[index - 1].roundNumber : null,
    next: index < sorted.length - 1 ? sorted[index + 1].roundNumber : null,
  };
}
