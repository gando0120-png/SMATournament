/**
 * H2H セット終了理由（normal / time_limit）と勝敗導出
 * DOM / Firestore 非依存
 */
import { SetResult, SET_WINNING_SCORE } from "./constants.js";

export const SetFinishReason = Object.freeze({
  NORMAL: "normal",
  TIME_LIMIT: "time_limit",
});

export const ALLOWED_SET_FINISH_REASONS = Object.freeze([
  SetFinishReason.NORMAL,
  SetFinishReason.TIME_LIMIT,
]);

/**
 * @param {unknown} value
 * @returns {"normal"|"time_limit"|null}
 */
export function resolveSetFinishReason(value) {
  if (value === SetFinishReason.TIME_LIMIT || value === SetFinishReason.NORMAL) {
    return value;
  }
  return null;
}

/**
 * @param {unknown} value
 */
export function isAllowedSetFinishReason(value) {
  return ALLOWED_SET_FINISH_REASONS.includes(value);
}

/**
 * 編集 UI 用: 既存セットから終了理由を推定（未設定の旧データ向け）
 * @param {{ team1Score?: number, team2Score?: number, finishReason?: string|null }} set
 * @returns {"normal"|"time_limit"}
 */
export function inferSetFinishReasonForEdit(set) {
  const explicit = resolveSetFinishReason(set?.finishReason);
  if (explicit) {
    return explicit;
  }
  const t1 = Number(set?.team1Score);
  const t2 = Number(set?.team2Score);
  if (t1 === SET_WINNING_SCORE || t2 === SET_WINNING_SCORE) {
    return SetFinishReason.NORMAL;
  }
  return SetFinishReason.TIME_LIMIT;
}

/**
 * フィールド名（予選・決勝共通パターン）
 * @param {number} setNumber
 */
export function getSetFinishReasonFieldName(setNumber) {
  return `set${setNumber}FinishReason`;
}

/**
 * H2H セット勝敗導出（新規入力向け）
 * @param {{
 *   team1Score: number,
 *   team2Score: number,
 *   finishReason: "normal"|"time_limit",
 *   allowDraw?: boolean,
 *   setLabel?: string,
 * }} params
 * @returns {{
 *   valid: true,
 *   result: "team1"|"team2"|"draw",
 *   winner: "team1"|"team2"|null,
 *   finishReason: "normal"|"time_limit",
 * } | {
 *   valid: false,
 *   message: string,
 * }}
 */
export function deriveH2HSetOutcome({
  team1Score,
  team2Score,
  finishReason,
  allowDraw = false,
  setLabel = "セット",
}) {
  const reason = resolveSetFinishReason(finishReason);
  if (!reason) {
    return {
      valid: false,
      message: `${setLabel}：終了理由（通常終了 / 時間切れ）を選択してください。`,
    };
  }

  if (
    !Number.isInteger(team1Score) ||
    !Number.isInteger(team2Score) ||
    team1Score < 0 ||
    team2Score < 0 ||
    team1Score > SET_WINNING_SCORE ||
    team2Score > SET_WINNING_SCORE
  ) {
    return {
      valid: false,
      message: `${setLabel}：得点は0〜${SET_WINNING_SCORE}の整数で入力してください。`,
    };
  }

  if (reason === SetFinishReason.NORMAL) {
    if (team1Score === SET_WINNING_SCORE && team2Score < SET_WINNING_SCORE) {
      return {
        valid: true,
        result: SetResult.TEAM1,
        winner: "team1",
        finishReason: reason,
      };
    }
    if (team2Score === SET_WINNING_SCORE && team1Score < SET_WINNING_SCORE) {
      return {
        valid: true,
        result: SetResult.TEAM2,
        winner: "team2",
        finishReason: reason,
      };
    }
    return {
      valid: false,
      message: `${setLabel}：通常終了では勝者が${SET_WINNING_SCORE}点である必要があります。時間切れの場合は「時間切れ」を選択してください。`,
    };
  }

  // time_limit: 50 到達は通常終了へ誘導
  if (team1Score === SET_WINNING_SCORE || team2Score === SET_WINNING_SCORE) {
    return {
      valid: false,
      message: `${setLabel}：${SET_WINNING_SCORE}点に到達している場合は「通常終了」を選択してください。`,
    };
  }

  if (team1Score === team2Score) {
    if (allowDraw) {
      return {
        valid: true,
        result: SetResult.DRAW,
        winner: null,
        finishReason: reason,
      };
    }
    return {
      valid: false,
      message: `${setLabel}：時間切れ時に同点の場合は、勝者を決定してから結果を入力してください。`,
    };
  }

  if (team1Score > team2Score) {
    return {
      valid: true,
      result: SetResult.TEAM1,
      winner: "team1",
      finishReason: reason,
    };
  }

  return {
    valid: true,
    result: SetResult.TEAM2,
    winner: "team2",
    finishReason: reason,
  };
}

/**
 * 終了理由なしの旧データ向け勝敗導出（新規入力では使わない）
 * @param {number} team1Score
 * @param {number} team2Score
 * @param {{ allowDraw?: boolean }} [options]
 * @returns {"team1"|"team2"|"draw"|null}
 */
export function deriveLegacyH2HSetResult(team1Score, team2Score, options = {}) {
  const allowDraw = options.allowDraw === true;
  if (team1Score > team2Score) {
    return SetResult.TEAM1;
  }
  if (team1Score < team2Score) {
    return SetResult.TEAM2;
  }
  if (allowDraw && team1Score === team2Score && team1Score < SET_WINNING_SCORE) {
    return SetResult.DRAW;
  }
  return null;
}

/**
 * 表示用の短い終了理由ラベル
 * @param {unknown} finishReason
 */
export function formatSetFinishReasonLabel(finishReason) {
  if (finishReason === SetFinishReason.TIME_LIMIT) {
    return "時間切れ";
  }
  return null;
}
