/**
 * 複数チーム試合の一発トーナメントブラケット生成
 */
import {
  AGGREGATE_SET_COUNT,
  MatchFormat,
  normalizeAggregateMatchRules,
} from "./aggregate-match-format.js";
import { SINGLE_ELIMINATION_MODE } from "./single-elimination-bracket.js";

/**
 * @param {number} roundNumber
 * @param {number} matchNumber
 */
export function buildMultiTeamMatchId(roundNumber, matchNumber) {
  return `mt-r${roundNumber}-m${matchNumber}`;
}

/**
 * @param {number} n
 * @param {number} teamCount
 * @returns {number[]} 各試合の参加人数
 */
export function planMatchSizes(n, teamCount) {
  if (n <= teamCount) {
    return n >= 2 ? [n] : [];
  }
  /** @type {number[]} */
  const sizes = [];
  let remaining = n;
  while (remaining > 0) {
    if (remaining >= teamCount) {
      sizes.push(teamCount);
      remaining -= teamCount;
    } else if (remaining >= 2) {
      sizes.push(remaining);
      remaining = 0;
    } else {
      // 1人余り → 自動通過（試合サイズに含めない）
      break;
    }
  }
  return sizes;
}

/**
 * @param {number} n
 * @param {number} teamCount
 * @param {number} qualifiersCount
 */
export function countAutoPass(n, teamCount, qualifiersCount) {
  const sizes = planMatchSizes(n, teamCount);
  const assigned = sizes.reduce((sum, s) => sum + s, 0);
  return Math.max(0, n - assigned);
}

/**
 * @param {number} n
 * @param {number} teamCount
 * @param {number} qualifiersCount
 */
export function nextRoundParticipantCount(n, teamCount, qualifiersCount) {
  if (n <= qualifiersCount) {
    return n;
  }
  const sizes = planMatchSizes(n, teamCount);
  const fromMatches = sizes.reduce(
    (sum, size) => sum + Math.min(qualifiersCount, Math.max(1, size - 1)),
    0
  );
  return fromMatches + countAutoPass(n, teamCount, qualifiersCount);
}

/**
 * @param {object} params
 * @param {object[]} params.entries
 * @param {object} [params.aggregateMatchRules]
 * @param {() => number} [params.random]
 */
export function buildMultiTeamBracket({
  entries = [],
  aggregateMatchRules = null,
  random = Math.random,
} = {}) {
  const rules = normalizeAggregateMatchRules(aggregateMatchRules || {});
  const { teamCount, qualifiersCount, setCount } = rules;

  const unique = [];
  const seen = new Set();
  for (const entry of entries) {
    if (!entry?.entryId || seen.has(entry.entryId)) continue;
    seen.add(entry.entryId);
    unique.push({
      entryId: entry.entryId,
      teamName: entry.teamName ?? "—",
      seed: null,
      isBye: false,
    });
  }

  if (unique.length < 2) {
    return {
      canFinalize: false,
      message: "参加チームは2チーム以上必要です。",
      bracket: null,
    };
  }

  const shuffled = [...unique];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  shuffled.forEach((p, index) => {
    p.seed = index + 1;
  });

  /** @type {object[]} */
  const matches = [];
  /** @type {{ roundNumber: number, count: number, matchIds: string[], autoPassCount: number }[]} */
  const roundPlans = [];

  let count = shuffled.length;
  let roundNumber = 1;
  let safety = 0;

  while (count > 1 && safety < 24) {
    safety += 1;
    const sizes = planMatchSizes(count, teamCount);
    if (sizes.length === 0) {
      break;
    }

    const autoPassCount = countAutoPass(count, teamCount, qualifiersCount);
    // 生成時点の最終ラウンド候補（リンク前）。リンク後は nextMatchId で確定判定する。
    const isFinalCandidate = sizes.length === 1 && autoPassCount === 0 && count <= teamCount;
    /** @type {string[]} */
    const matchIds = [];

    sizes.forEach((size, index) => {
      const matchNumber = index + 1;
      const matchId = buildMultiTeamMatchId(roundNumber, matchNumber);
      matchIds.push(matchId);
      const qCount = Math.min(qualifiersCount, Math.max(1, size - 1));
      matches.push({
        matchId,
        roundNumber,
        matchNumber,
        matchFormat: MatchFormat.MULTI_TEAM_TOTAL,
        participantEntryIds: [],
        participants: Array.from({ length: size }, (_, slot) => ({
          entryId: null,
          teamName: null,
          seed: null,
          isBye: false,
          pendingSlot: slot,
        })),
        slotCount: size,
        qualifiersCount: qCount,
        setCount,
        status: "pending",
        nextMatchId: null,
        nextSlotStart: null,
        nextQualifierSpan: isFinalCandidate ? null : qCount,
        roundLabel: null,
        isFinal: isFinalCandidate,
      });
    });

    roundPlans.push({
      roundNumber,
      count,
      matchIds,
      autoPassCount,
      sizes,
    });

    if (isFinalCandidate) {
      break;
    }

    count = nextRoundParticipantCount(count, teamCount, qualifiersCount);
    roundNumber += 1;
  }

  // ラウンド間リンク: 進出枠を次ラウンドのスロットへ順に割り当て
  for (let r = 0; r < roundPlans.length - 1; r += 1) {
    const from = roundPlans[r];
    const to = roundPlans[r + 1];
    const toMatches = to.matchIds.map((id) => matches.find((m) => m.matchId === id));
    /** @type {{ matchId: string, index: number }[]} */
    const flatSlots = [];
    for (const m of toMatches) {
      const slots = m.slotCount || m.participants.length;
      for (let i = 0; i < slots; i += 1) {
        flatSlots.push({ matchId: m.matchId, index: i });
      }
    }
    // autoPass は先頭スロットを埋める想定で進出枠の後に続く
    let cursor = 0;
    for (const matchId of from.matchIds) {
      const match = matches.find((m) => m.matchId === matchId);
      const span = match.nextQualifierSpan || match.qualifiersCount;
      const meta = flatSlots[cursor];
      match.nextMatchId = meta?.matchId ?? null;
      match.nextSlotStart = meta?.index ?? null;
      cursor += span;
    }
    // autoPass 用に残スロットを記録（ブラケットメタ）
    from.autoPassSlotStart = cursor;
    from.autoPassNextMatchId = flatSlots[cursor]?.matchId ?? null;
  }

  // ラウンドラベル・isFinal を実ラウンド数で確定（H2H の bracketSize=2^n 前提を使わない）
  const maxRoundNumber = roundPlans.length;
  for (const match of matches) {
    const isFinal = match.roundNumber === maxRoundNumber;
    match.isFinal = isFinal;
    if (match.roundNumber === maxRoundNumber) {
      match.roundLabel = "決勝";
    } else if (match.roundNumber === maxRoundNumber - 1) {
      match.roundLabel = "準決勝";
    } else if (maxRoundNumber >= 3 && match.roundNumber === maxRoundNumber - 2) {
      match.roundLabel = "準々決勝";
    } else {
      match.roundLabel = `ラウンド${match.roundNumber}`;
    }
    if (isFinal) {
      match.nextQualifierSpan = null;
    }
  }

  // ラウンド1に実チームを配置 + autoPass を次ラウンドへ
  placeTeamsIntoRound(matches, roundPlans[0], shuffled, null);

  for (let r = 0; r < roundPlans.length - 1; r += 1) {
    const from = roundPlans[r];
    if (from.autoPassCount <= 0) continue;
    const startIndex = from.sizes.reduce((sum, s) => sum + s, 0);
    const autoTeams = (r === 0 ? shuffled : []).slice(
      startIndex,
      startIndex + from.autoPassCount
    );
    // 初回以外の autoPass は進行時に決まる。初回のみ確定配置。
    if (r === 0 && autoTeams.length > 0) {
      placeAutoPassTeams(matches, from, autoTeams);
    }
  }

  // ラウンド1の status
  for (const match of matches.filter((m) => m.roundNumber === 1)) {
    const filled = match.participants.every((p) => p.entryId);
    match.participantEntryIds = match.participants.map((p) => p.entryId).filter(Boolean);
    match.status = filled ? "ready" : "pending";
  }

  return {
    canFinalize: true,
    message: null,
    bracket: {
      mode: SINGLE_ELIMINATION_MODE,
      matchFormat: MatchFormat.MULTI_TEAM_TOTAL,
      aggregateMatchRules: {
        teamCount,
        setCount: AGGREGATE_SET_COUNT,
        qualifiersCount,
        rankingMethod: "totalScoreDesc",
        tieBreakMethod: "manual",
      },
      finalized: true,
      bracketSize: unique.length,
      teamCount: unique.length,
      slots: shuffled.map((p, index) => ({
        slotIndex: index,
        entryId: p.entryId,
        teamName: p.teamName,
        seed: p.seed,
      })),
      matches: matches.map(stripInternalMatchFields),
      roundCount: roundPlans.length,
      roundPlans: roundPlans.map((p) => ({
        roundNumber: p.roundNumber,
        count: p.count,
        matchIds: p.matchIds,
        autoPassCount: p.autoPassCount,
        autoPassSlotStart: p.autoPassSlotStart ?? null,
        autoPassNextMatchId: p.autoPassNextMatchId ?? null,
      })),
    },
  };
}

/**
 * @param {object[]} matches
 * @param {object} roundPlan
 * @param {object[]} teams
 */
function placeTeamsIntoRound(matches, roundPlan, teams) {
  let offset = 0;
  for (let i = 0; i < roundPlan.matchIds.length; i += 1) {
    const match = matches.find((m) => m.matchId === roundPlan.matchIds[i]);
    const size = roundPlan.sizes[i];
    const slice = teams.slice(offset, offset + size);
    offset += size;
    match.participants = slice.map((p, slot) => ({
      entryId: p.entryId,
      teamName: p.teamName,
      seed: p.seed,
      isBye: false,
      pendingSlot: slot,
    }));
    match.participantEntryIds = slice.map((p) => p.entryId);
    match.status = "ready";
  }
}

/**
 * @param {object[]} matches
 * @param {object} fromPlan
 * @param {object[]} autoTeams
 */
function placeAutoPassTeams(matches, fromPlan, autoTeams) {
  let cursor = fromPlan.autoPassSlotStart ?? 0;
  // 次ラウンドのフラットスロットへ
  const nextRound = fromPlan.roundNumber + 1;
  const nextMatches = matches
    .filter((m) => m.roundNumber === nextRound)
    .sort((a, b) => a.matchNumber - b.matchNumber);
  const flat = [];
  for (const m of nextMatches) {
    for (let i = 0; i < m.participants.length; i += 1) {
      flat.push({ match: m, index: i });
    }
  }
  for (const team of autoTeams) {
    const slot = flat[cursor];
    if (!slot) break;
    slot.match.participants[slot.index] = {
      entryId: team.entryId,
      teamName: team.teamName,
      seed: team.seed,
      isBye: false,
      pendingSlot: slot.index,
    };
    slot.match.participantEntryIds = slot.match.participants
      .map((p) => p.entryId)
      .filter(Boolean);
    if (slot.match.participants.every((p) => p.entryId)) {
      slot.match.status = "ready";
    }
    cursor += 1;
  }
}

function stripInternalMatchFields(match) {
  return {
    matchId: match.matchId,
    roundNumber: match.roundNumber,
    matchNumber: match.matchNumber,
    matchFormat: MatchFormat.MULTI_TEAM_TOTAL,
    participantEntryIds: match.participantEntryIds || [],
    participants: (match.participants || []).map((p) => ({
      entryId: p.entryId ?? null,
      teamName: p.teamName ?? null,
      seed: p.seed ?? null,
      isBye: false,
    })),
    qualifiersCount: match.qualifiersCount,
    setCount: match.setCount ?? AGGREGATE_SET_COUNT,
    status: match.status,
    nextMatchId: match.nextMatchId ?? null,
    nextSlotStart: match.nextSlotStart ?? null,
    nextQualifierSpan: match.nextQualifierSpan ?? match.qualifiersCount ?? null,
    roundLabel: match.roundLabel ?? null,
    isFinal: Boolean(match.isFinal),
  };
}

/**
 * @param {object} previewResult
 */
export function buildPersistedMultiTeamBracket(previewResult) {
  const bracket = previewResult.bracket;
  return {
    mode: bracket.mode,
    matchFormat: bracket.matchFormat,
    aggregateMatchRules: bracket.aggregateMatchRules,
    finalized: true,
    bracketSize: bracket.bracketSize,
    teamCount: bracket.teamCount,
    slots: bracket.slots,
    matches: bracket.matches,
    roundCount: bracket.roundCount,
    roundPlans: bracket.roundPlans || [],
  };
}

/**
 * multi ブラケットが作成済みか
 * @param {object|null|undefined} bracket
 */
export function isMultiTeamBracket(bracket) {
  return (
    bracket?.matchFormat === MatchFormat.MULTI_TEAM_TOTAL ||
    (bracket?.mode === SINGLE_ELIMINATION_MODE &&
      Array.isArray(bracket?.matches) &&
      bracket.matches[0]?.matchFormat === MatchFormat.MULTI_TEAM_TOTAL)
  );
}

/**
 * 最終試合か。
 * ブラケットがあれば「最大 roundNumber の試合」で判定（次ラウンドが存在しない）。
 * 単体のときは nextMatchId / isFinal を参照。
 * @param {object|null|undefined} match
 * @param {object|null|undefined} [bracket]
 */
export function isMultiTeamFinalMatch(match, bracket = null) {
  if (!match) return false;
  if (bracket?.matches?.length) {
    const maxRound = getMultiTeamRoundCount(bracket);
    if (Number.isInteger(match.roundNumber) && maxRound >= 1) {
      return match.roundNumber === maxRound;
    }
  }
  if (match.isFinal === true) return true;
  return match.nextMatchId == null || match.nextMatchId === "";
}

/**
 * 最終ラウンドか（このラウンドの次が構造上存在しない）
 * @param {object} params
 * @param {object|null|undefined} [params.bracket]
 * @param {number|null|undefined} [params.roundNumber]
 * @param {object|null|undefined} [params.match]
 */
export function isMultiTeamFinalRound({ bracket = null, roundNumber = null, match = null } = {}) {
  if (match) {
    return isMultiTeamFinalMatch(match, bracket);
  }
  const rn = Number(roundNumber);
  if (!Number.isInteger(rn) || !bracket?.matches?.length) {
    return false;
  }
  const maxRound = getMultiTeamRoundCount(bracket);
  return rn === maxRound && maxRound >= 1;
}

/**
 * multi ブラケットの実ラウンド数（最大 roundNumber）
 * @param {object|null|undefined} bracket
 */
export function getMultiTeamRoundCount(bracket) {
  const rounds = (bracket?.matches || []).map((m) => m.roundNumber || 0);
  return rounds.length > 0 ? Math.max(...rounds) : Number(bracket?.roundCount) || 0;
}

/**
 * multi 用ラウンド表示名（H2H の log2(bracketSize) には依存しない）
 * @param {object|null|undefined} bracket
 * @param {number} roundNumber
 */
export function getMultiTeamRoundLabel(bracket, roundNumber) {
  const maxRound = getMultiTeamRoundCount(bracket);
  if (!Number.isInteger(roundNumber) || roundNumber < 1) {
    return `ラウンド${roundNumber}`;
  }
  if (maxRound >= 1 && roundNumber === maxRound) {
    return "決勝";
  }
  if (maxRound >= 2 && roundNumber === maxRound - 1) {
    return "準決勝";
  }
  if (maxRound >= 3 && roundNumber === maxRound - 2) {
    return "準々決勝";
  }
  return `ラウンド${roundNumber}`;
}

/**
 * 試合カード見出し（決勝 / 準決勝 第N組）
 * @param {object} match
 * @param {object|null|undefined} bracket
 */
export function getMultiTeamMatchTitle(match, bracket = null) {
  const roundLabel =
    (bracket && getMultiTeamRoundLabel(bracket, match?.roundNumber)) ||
    match?.roundLabel ||
    `ラウンド${match?.roundNumber ?? ""}`;
  if (isMultiTeamFinalMatch(match, bracket)) {
    return roundLabel;
  }
  const matchNumber = match?.matchNumber;
  if (Number.isInteger(matchNumber) && matchNumber >= 1) {
    return `${roundLabel} 第${matchNumber}組`;
  }
  return roundLabel;
}
