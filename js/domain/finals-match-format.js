/**
 * トーナメント試合の勝利条件（2先 / 3先、ラウンド別）
 */
import { FINALS_MATCH_SETS_TO_WIN } from "./constants.js";
import { roundCountFor } from "./finals-bracket.js";
import { resolveSingleEliminationBracketSize } from "./single-elimination-bracket.js";
import { TournamentFormat, resolveFinalQualifierCount } from "./tournament-format.js";

export const ALLOWED_FINALS_WINS_REQUIRED = Object.freeze([2, 3]);
export const DEFAULT_FINALS_WINS_REQUIRED = FINALS_MATCH_SETS_TO_WIN;

/** @type {readonly string[]} */
export const FINALS_ROUND_KEYS = Object.freeze([
  "roundOf64",
  "roundOf32",
  "roundOf16",
  "quarterfinal",
  "semifinal",
  "final",
]);

const ROUND_KEY_BY_TEAMS = Object.freeze({
  64: "roundOf64",
  32: "roundOf32",
  16: "roundOf16",
  8: "quarterfinal",
  4: "semifinal",
  2: "final",
});

const NAMED_ROUND_KEY_LABELS = Object.freeze({
  quarterfinal: "準々決勝",
  semifinal: "準決勝",
  final: "決勝",
});

/**
 * 未設定・不正値は従来互換の 2 先
 * @param {unknown} value
 * @returns {2|3}
 */
export function resolveFinalsWinsRequired(value) {
  if (value === 2 || value === "2") {
    return 2;
  }
  if (value === 3 || value === "3") {
    return 3;
  }
  return DEFAULT_FINALS_WINS_REQUIRED;
}

/**
 * @param {unknown} winsRequired
 */
export function resolveFinalsMaxSets(winsRequired) {
  return resolveFinalsWinsRequired(winsRequired) * 2 - 1;
}

/**
 * @param {unknown} winsRequired
 */
export function formatFinalsWinsRequiredLabel(winsRequired) {
  const wins = resolveFinalsWinsRequired(winsRequired);
  return `${wins}セット先取（最大${resolveFinalsMaxSets(wins)}セット）`;
}

/**
 * @param {unknown} winsRequired
 */
export function formatFinalsWinsRequiredShortLabel(winsRequired) {
  return `${resolveFinalsWinsRequired(winsRequired)}セット先取`;
}

/**
 * @param {number} setNumber
 */
export function getFinalsSetScoreFieldNames(setNumber) {
  return {
    team1: `set${setNumber}Team1Score`,
    team2: `set${setNumber}Team2Score`,
  };
}

/**
 * @param {unknown} value
 * @returns {{ valid: boolean, value?: number, message?: string }}
 */
export function validateFinalsWinsRequiredInput(value) {
  if (value === "" || value == null || value === undefined) {
    return { valid: true, value: DEFAULT_FINALS_WINS_REQUIRED };
  }
  const parsed = typeof value === "number" ? value : Number(String(value).trim());
  if (!ALLOWED_FINALS_WINS_REQUIRED.includes(parsed)) {
    return {
      valid: false,
      message: "トーナメント勝利条件は2セット先取または3セット先取を選択してください。",
    };
  }
  return { valid: true, value: parsed };
}

/**
 * 実ブラケット（枠数>=2 または matches あり）かどうか。
 * 空ドキュメント / 空配列だけでは未生成扱い。
 * @param {object|null|undefined} bracket
 */
export function isMaterialBracket(bracket) {
  if (!bracket || typeof bracket !== "object") {
    return false;
  }
  const size = Number(bracket.bracketSize);
  if (Number.isInteger(size) && size >= 2) {
    return true;
  }
  if (Array.isArray(bracket.matches) && bracket.matches.length > 0) {
    return true;
  }
  return false;
}

/**
 * トーナメント表生成後、または試合結果がある場合は変更不可。
 * Rules の hasFinalsWinsRequiredLock と同じ「実ブラケット」判定を使う。
 * @param {object|null|undefined} signals
 */
export function isFinalsWinsRequiredLocked(signals = {}) {
  // hasMaterial* があれば優先。なければ従来の has*Bracket を実ブラケット相当として扱う。
  const materialMain =
    typeof signals?.hasMaterialFinalsBracket === "boolean"
      ? signals.hasMaterialFinalsBracket
      : Boolean(signals?.hasFinalsBracket);
  const materialConsolation =
    typeof signals?.hasMaterialConsolationBracket === "boolean"
      ? signals.hasMaterialConsolationBracket
      : Boolean(signals?.hasConsolationBracket);

  return Boolean(
    materialMain ||
      materialConsolation ||
      signals?.hasFinalsMatchResults ||
      signals?.hasConsolationMatchResults
  );
}

export const isFinalsMatchRulesLocked = isFinalsWinsRequiredLocked;

/**
 * bracketSize + roundNumber → 安定ラウンドキー
 * @param {{ bracketSize?: unknown, roundNumber?: unknown }} params
 * @returns {string|null}
 */
export function resolveFinalsRoundKey({ bracketSize, roundNumber } = {}) {
  const size = Number(bracketSize);
  const round = Number(roundNumber);
  if (!Number.isInteger(size) || size < 2 || (size & (size - 1)) !== 0) {
    return null;
  }
  if (!Number.isInteger(round) || round < 1) {
    return null;
  }
  const roundCount = roundCountFor(size);
  if (round > roundCount) {
    return null;
  }
  const teamsInRound = size / 2 ** (round - 1);
  return ROUND_KEY_BY_TEAMS[teamsInRound] ?? null;
}

/**
 * @param {string|null|undefined} roundKey
 * @param {{ bracketSize?: number, roundNumber?: number }} [context]
 */
export function getFinalsRoundKeyLabel(roundKey, context = {}) {
  if (!roundKey || !FINALS_ROUND_KEYS.includes(roundKey)) {
    return "ラウンド";
  }
  if (NAMED_ROUND_KEY_LABELS[roundKey]) {
    return NAMED_ROUND_KEY_LABELS[roundKey];
  }
  const roundNumber = Number(context.roundNumber);
  if (Number.isInteger(roundNumber) && roundNumber >= 1) {
    return `${roundNumber}回戦`;
  }
  if (roundKey === "roundOf16") {
    return "1回戦";
  }
  if (roundKey === "roundOf32") {
    return "ラウンド32";
  }
  if (roundKey === "roundOf64") {
    return "ラウンド64";
  }
  return roundKey;
}

/**
 * @param {number} bracketSize
 * @returns {{ roundKey: string, roundNumber: number, label: string }[]}
 */
export function listFinalsRoundSettings(bracketSize) {
  const size = Number(bracketSize);
  if (!Number.isInteger(size) || size < 2 || (size & (size - 1)) !== 0) {
    return [];
  }
  const roundCount = roundCountFor(size);
  const rounds = [];
  for (let roundNumber = 1; roundNumber <= roundCount; roundNumber += 1) {
    const roundKey = resolveFinalsRoundKey({ bracketSize: size, roundNumber });
    if (!roundKey) {
      continue;
    }
    rounds.push({
      roundKey,
      roundNumber,
      label: getFinalsRoundKeyLabel(roundKey, { bracketSize: size, roundNumber }),
    });
  }
  return rounds;
}

/**
 * 作成・編集画面用の想定ブラケットサイズ
 * @param {object|null|undefined} input
 */
export function estimateFinalsBracketSizeForSettings(input = {}) {
  const format = input.tournamentFormat;
  const maxTeams = Number(input.maxTeams);

  if (format === TournamentFormat.SINGLE_ELIMINATION) {
    if (!Number.isInteger(maxTeams) || maxTeams < 2) {
      return null;
    }
    const resolved = resolveSingleEliminationBracketSize(Math.min(64, maxTeams));
    return resolved.valid ? resolved.bracketSize : null;
  }

  if (format === TournamentFormat.QUALIFYING_AND_FINALS) {
    const qualifierCount = resolveFinalQualifierCount({
      tournament: {
        tournamentFormat: format,
        blockCount: input.blockCount,
        qualifiersPerBlock: input.qualifiersPerBlock,
        maxTeams: Number.isInteger(maxTeams) ? maxTeams : undefined,
      },
      teamCount: Number.isInteger(maxTeams) ? maxTeams : null,
    });
    if (!Number.isInteger(qualifierCount) || qualifierCount < 2) {
      return null;
    }
    return qualifierCount;
  }

  // legacy / 不明: maxTeams から概算
  if (Number.isInteger(maxTeams) && maxTeams >= 2) {
    const resolved = resolveSingleEliminationBracketSize(Math.min(64, maxTeams));
    return resolved.valid ? resolved.bracketSize : null;
  }
  return null;
}

/**
 * @param {object|null|undefined} tournament
 * @returns {{ defaultWinsRequired: 2|3, roundOverrides: Record<string, 2|3> }}
 */
export function normalizeFinalsMatchRules(tournament) {
  const rules = tournament?.finalsMatchRules;
  const defaultFromRules = rules?.defaultWinsRequired;
  const defaultWinsRequired = resolveFinalsWinsRequired(
    defaultFromRules ?? tournament?.winsRequired
  );

  /** @type {Record<string, 2|3>} */
  const roundOverrides = {};
  const rawOverrides = rules?.roundOverrides;
  if (rawOverrides && typeof rawOverrides === "object" && !Array.isArray(rawOverrides)) {
    for (const key of FINALS_ROUND_KEYS) {
      if (!(key in rawOverrides)) {
        continue;
      }
      const wins = resolveFinalsWinsRequired(rawOverrides[key]);
      if (wins !== defaultWinsRequired) {
        roundOverrides[key] = wins;
      }
    }
  }

  return { defaultWinsRequired, roundOverrides };
}

/**
 * @param {object} params
 * @returns {2|3}
 */
export function resolveMatchWinsRequired({
  tournament = null,
  bracket = null,
  roundKey = null,
  roundNumber = null,
} = {}) {
  const rules = normalizeFinalsMatchRules(tournament);
  const resolvedKey =
    roundKey ||
    resolveFinalsRoundKey({
      bracketSize: bracket?.bracketSize,
      roundNumber: roundNumber ?? undefined,
    });

  if (resolvedKey && rules.roundOverrides[resolvedKey] != null) {
    return resolveFinalsWinsRequired(rules.roundOverrides[resolvedKey]);
  }
  return rules.defaultWinsRequired;
}

/**
 * @param {object|null|undefined} input
 * @returns {{ valid: boolean, values?: object, message?: string, errors?: Record<string, string> }}
 */
export function validateFinalsMatchRulesInput(input = {}) {
  const errors = {};
  const defaultResult = validateFinalsWinsRequiredInput(
    input.defaultWinsRequired ?? input.winsRequired
  );
  if (!defaultResult.valid) {
    errors.winsRequired = defaultResult.message;
    return { valid: false, errors, values: null, message: defaultResult.message };
  }

  const defaultWinsRequired = defaultResult.value;
  const useRoundOverrides = Boolean(input.useRoundOverrides);
  /** @type {Record<string, 2|3>} */
  const roundOverrides = {};

  if (useRoundOverrides) {
    const raw = input.roundOverrides;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      for (const [key, value] of Object.entries(raw)) {
        if (value === undefined || value === null || value === "") {
          // 未設定キーは保存しない（デフォルト値に落とさない）
          continue;
        }
        if (!FINALS_ROUND_KEYS.includes(key)) {
          errors.finalsMatchRules = `不正なラウンドキーです: ${key}`;
          continue;
        }
        const parsed = validateFinalsWinsRequiredInput(value);
        if (!parsed.valid) {
          errors.finalsMatchRules = parsed.message;
          continue;
        }
        if (parsed.value !== defaultWinsRequired) {
          roundOverrides[key] = parsed.value;
        }
      }
    }
  }

  if (Object.keys(errors).length > 0) {
    return { valid: false, errors, values: null, message: "トーナメント勝利条件を確認してください。" };
  }

  return {
    valid: true,
    errors: {},
    values: {
      winsRequired: defaultWinsRequired,
      finalsMatchRules: {
        defaultWinsRequired,
        roundOverrides,
      },
    },
  };
}

/**
 * プリセット適用（指定ブラケットのラウンド一覧に対する wins マップ）
 * @param {"all2"|"all3"|"finalOnly3"} preset
 * @param {number|null|undefined} bracketSize
 * @param {2|3} [defaultWinsRequired]
 */
export function buildFinalsMatchRulesPreset(preset, bracketSize, defaultWinsRequired = 2) {
  const rounds = listFinalsRoundSettings(bracketSize);
  const base = resolveFinalsWinsRequired(defaultWinsRequired);
  /** @type {Record<string, 2|3>} */
  const winsByRound = {};

  if (preset === "all3") {
    for (const round of rounds) {
      winsByRound[round.roundKey] = 3;
    }
    return {
      defaultWinsRequired: 3,
      useRoundOverrides: false,
      winsByRound,
      roundOverrides: {},
    };
  }

  if (preset === "finalOnly3") {
    for (const round of rounds) {
      winsByRound[round.roundKey] = round.roundKey === "final" ? 3 : 2;
    }
    return {
      defaultWinsRequired: 2,
      useRoundOverrides: rounds.some((round) => round.roundKey === "final"),
      winsByRound,
      roundOverrides: rounds.some((round) => round.roundKey === "final") ? { final: 3 } : {},
    };
  }

  // all2
  for (const round of rounds) {
    winsByRound[round.roundKey] = 2;
  }
  return {
    defaultWinsRequired: 2,
    useRoundOverrides: false,
    winsByRound,
    roundOverrides: {},
  };
}

/**
 * 公開・ダッシュボード用の概要行
 * @param {object|null|undefined} tournament
 * @param {{ bracketSize?: number|null }} [options]
 * @returns {string[]}
 */
export function formatFinalsMatchRulesSummaryLines(tournament, options = {}) {
  const rules = normalizeFinalsMatchRules(tournament);
  const bracketSize =
    options.bracketSize ??
    estimateFinalsBracketSizeForSettings({
      tournamentFormat: tournament?.tournamentFormat,
      maxTeams: tournament?.maxTeams,
      blockCount: tournament?.blockCount,
      qualifiersPerBlock: tournament?.qualifiersPerBlock,
    });

  const rounds = listFinalsRoundSettings(bracketSize);
  if (rounds.length === 0 || Object.keys(rules.roundOverrides).length === 0) {
    return [`全ラウンド：${formatFinalsWinsRequiredShortLabel(rules.defaultWinsRequired)}`];
  }

  const resolved = rounds.map((round) => ({
    ...round,
    winsRequired: resolveMatchWinsRequired({
      tournament,
      roundKey: round.roundKey,
    }),
  }));

  const lines = [];
  let index = 0;
  while (index < resolved.length) {
    const wins = resolved[index].winsRequired;
    let end = index;
    while (end + 1 < resolved.length && resolved[end + 1].winsRequired === wins) {
      end += 1;
    }
    if (index === 0 && end === resolved.length - 1) {
      lines.push(`全ラウンド：${formatFinalsWinsRequiredShortLabel(wins)}`);
    } else if (index === end) {
      lines.push(`${resolved[index].label}：${formatFinalsWinsRequiredShortLabel(wins)}`);
    } else if (end === resolved.length - 1 && wins === rules.defaultWinsRequired) {
      // 末尾まで同じでデフォルトと同じなら「〜まで」表現
      lines.push(
        `${resolved[end].label}まで：${formatFinalsWinsRequiredShortLabel(wins)}`
      );
    } else {
      lines.push(
        `${resolved[index].label}〜${resolved[end].label}：${formatFinalsWinsRequiredShortLabel(wins)}`
      );
    }
    index = end + 1;
  }

  // 「決勝のみ3」を読みやすく整形
  if (
    resolved.length >= 2 &&
    resolved.every((round, i) =>
      round.roundKey === "final" ? round.winsRequired === 3 : round.winsRequired === 2
    ) &&
    resolved[resolved.length - 1].roundKey === "final"
  ) {
    const before = resolved[resolved.length - 2];
    return [
      `${before.label}まで：2セット先取`,
      `決勝：3セット先取`,
    ];
  }

  return lines;
}

/**
 * @param {object|null|undefined} tournament
 * @param {{ bracketSize?: number|null }} [options]
 */
export function formatFinalsMatchRulesSummaryText(tournament, options = {}) {
  return formatFinalsMatchRulesSummaryLines(tournament, options).join(" / ");
}
