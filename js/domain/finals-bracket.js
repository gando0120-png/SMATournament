/**
 * 決勝トーナメント表生成（DOM / Firestore 非依存）
 */
import { FinalsMatchStatus } from "./constants.js";
import {
  normalizeFixedBlockQualifiersForBracket,
  validateFixedBlockQualifiersForBracket,
} from "./fixed-block-finals-advancement.js";

export const BRACKET_SIZES = [4, 8, 16, 32, 64];

/** 8チーム標準のスロット順（seed 配置） */
const EXACT_SEED_ORDERS = {
  2: [1, 2],
  4: [1, 4, 2, 3],
  8: [1, 8, 4, 5, 3, 6, 2, 7],
};

/** @param {number} bracketSize */
export function roundCountFor(bracketSize) {
  return Math.log2(bracketSize);
}

/**
 * @param {number} bracketSize
 * @param {number} roundNumber - 1-indexed
 */
export function getFinalsRoundLabel(bracketSize, roundNumber) {
  const roundCount = roundCountFor(bracketSize);
  if (!Number.isFinite(roundCount) || roundNumber < 1 || roundNumber > roundCount) {
    return `第${roundNumber}ラウンド`;
  }
  if (roundNumber === roundCount) {
    return "決勝";
  }
  if (roundNumber === roundCount - 1) {
    return "準決勝";
  }
  if (roundCount >= 4 && roundNumber === roundCount - 2) {
    return "準々決勝";
  }
  return `${roundNumber}回戦`;
}

/** @type {Record<number, string[]>} */
export const FINALS_ROUND_LABELS = Object.fromEntries(
  [2, 4, 8, 16, 32, 64].map((bracketSize) => {
    const roundCount = roundCountFor(bracketSize);
    return [
      bracketSize,
      Array.from({ length: roundCount }, (_, index) => getFinalsRoundLabel(bracketSize, index + 1)),
    ];
  })
);

/**
 * @param {number} value
 */
export function isPowerOfTwo(value) {
  return Number.isInteger(value) && value >= 2 && (value & (value - 1)) === 0;
}

/**
 * @param {number} qualifierCount
 */
export function bracketSizeFor(qualifierCount) {
  if (!Number.isInteger(qualifierCount) || qualifierCount < 1) {
    return null;
  }
  if (BRACKET_SIZES.includes(qualifierCount)) {
    return qualifierCount;
  }
  return BRACKET_SIZES.find((size) => size >= qualifierCount) ?? 64;
}

/**
 * @template T
 * @param {T[]} items
 * @param {() => number} random
 */
function shuffleWithRandom(items, random = Math.random) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * 同一ブロック同士の1回戦対戦を避けるよう、可能な範囲で入替する
 * @param {object[]} ordered
 */
function reduceSameBlockFirstRoundPairings(ordered) {
  const next = [...ordered];
  for (let i = 0; i < next.length; i += 2) {
    if (next[i]?.blockId !== next[i + 1]?.blockId) {
      continue;
    }
    for (let j = i + 2; j < next.length; j += 1) {
      if (next[j]?.blockId !== next[i]?.blockId) {
        [next[i + 1], next[j]] = [next[j], next[i + 1]];
        break;
      }
    }
  }
  return next;
}

/**
 * 新形式: ランダム配置（同一ブロック1回戦回避を可能な範囲で試行）
 * @param {object[]} qualifiers
 * @param {{ expectedCount?: number, random?: () => number }} [options]
 */
export function buildFixedBlockFinalsBracket(qualifiers, options = {}) {
  const { expectedCount, random = Math.random } = options;

  const validation = validateFixedBlockQualifiersForBracket(qualifiers);
  if (!validation.valid) {
    return {
      valid: false,
      message: validation.errors[0] ?? "決勝進出チームのデータが不正です。",
      bracket: null,
    };
  }

  const normalizedQualifiers = validation.qualifiers;

  if (normalizedQualifiers.length === 0) {
    return { valid: false, message: "決勝進出チームがありません。", bracket: null };
  }

  if (
    expectedCount !== undefined &&
    Number.isInteger(expectedCount) &&
    normalizedQualifiers.length !== expectedCount
  ) {
    return {
      valid: false,
      message: `進出チーム数（${normalizedQualifiers.length}）と決勝枠数（${expectedCount}）が一致しません。`,
      bracket: null,
    };
  }

  const qualifierCount = normalizedQualifiers.length;
  if (!BRACKET_SIZES.includes(qualifierCount) || !isPowerOfTwo(qualifierCount)) {
    return {
      valid: false,
      message: `決勝枠 ${qualifierCount} は対応していません。`,
      bracket: null,
    };
  }

  const bracketSize = qualifierCount;
  const ordered = reduceSameBlockFirstRoundPairings(
    shuffleWithRandom(normalizedQualifiers, random)
  );

  const slots = ordered.map((qualifier, index) => ({
    slotNumber: index + 1,
    seed: index + 1,
    entryId: qualifier.entryId,
    teamName: qualifier.teamName ?? null,
    blockId: qualifier.blockId ?? null,
    blockName: qualifier.blockName ?? null,
    blockRank: qualifier.blockRank ?? null,
    advancementSource: "fixed_block_qualifiers",
    isBye: false,
  }));

  const roundCount = roundCountFor(bracketSize);
  const matches = [];

  for (let roundNumber = 1; roundNumber <= roundCount; roundNumber += 1) {
    const matchesInRound = bracketSize / 2 ** roundNumber;

    for (let matchNumber = 1; matchNumber <= matchesInRound; matchNumber += 1) {
      const matchId = buildFinalsMatchId(roundNumber, matchNumber);
      const hasNext = roundNumber < roundCount;
      const nextMatchId = hasNext
        ? buildFinalsMatchId(roundNumber + 1, Math.ceil(matchNumber / 2))
        : null;
      const nextTeamSlot = matchNumber % 2 === 1 ? "team1" : "team2";

      let team1 = null;
      let team2 = null;

      if (roundNumber === 1) {
        const slotIndex = (matchNumber - 1) * 2;
        team1 = buildMatchTeamFromSlot(slots[slotIndex]);
        team2 = buildMatchTeamFromSlot(slots[slotIndex + 1]);
      }

      matches.push({
        matchId,
        roundNumber,
        matchNumber,
        bracketPosition: matchNumber,
        roundLabel: getFinalsRoundLabel(bracketSize, roundNumber),
        team1,
        team2,
        status: FinalsMatchStatus.PENDING,
        nextMatchId,
        nextTeamSlot,
      });
    }
  }

  return {
    valid: true,
    message: null,
    bracket: {
      bracketSize,
      qualifierCount,
      roundCount,
      slots,
      matches,
      placementMode: "random",
    },
  };
}

/**
 * @param {number} bracketSize
 */
function buildSeedOrderRecursive(bracketSize) {
  if (bracketSize === 2) {
    return [1, 2];
  }
  const half = buildSeedOrderRecursive(bracketSize / 2);
  const result = [];
  for (const seed of half) {
    result.push(seed);
    result.push(bracketSize + 1 - seed);
  }
  return result;
}

/**
 * 一般的なトーナメントのシード配置順（スロット1..N に並べる seed 番号）
 * @param {number} bracketSize
 */
export function buildSeedOrder(bracketSize) {
  if (!isPowerOfTwo(bracketSize)) {
    return { valid: false, message: "トーナメントサイズは2のべき乗である必要があります。" };
  }

  if (EXACT_SEED_ORDERS[bracketSize]) {
    return { valid: true, seedOrder: [...EXACT_SEED_ORDERS[bracketSize]] };
  }

  return { valid: true, seedOrder: buildSeedOrderRecursive(bracketSize) };
}

/**
 * @param {object[]} qualifiers
 * @param {number} [expectedCount]
 */
export function validateSeededQualifiers(qualifiers, expectedCount) {
  if (!Array.isArray(qualifiers) || qualifiers.length === 0) {
    return { valid: false, message: "決勝進出チームがありません。" };
  }

  if (
    expectedCount !== undefined &&
    Number.isInteger(expectedCount) &&
    qualifiers.length !== expectedCount
  ) {
    return {
      valid: false,
      message: `進出チーム数（${qualifiers.length}）と決勝枠数（${expectedCount}）が一致しません。`,
    };
  }

  const seenSeeds = new Set();
  const seenEntryIds = new Set();
  const sorted = [...qualifiers].sort((a, b) => a.seed - b.seed);

  for (const qualifier of sorted) {
    if (!qualifier?.entryId || typeof qualifier.entryId !== "string") {
      return { valid: false, message: "進出チームに entryId がありません。" };
    }
    if (!Number.isInteger(qualifier.seed) || qualifier.seed < 1) {
      return { valid: false, message: "seed が不正です。" };
    }
    if (seenSeeds.has(qualifier.seed)) {
      return { valid: false, message: `seed ${qualifier.seed} が重複しています。` };
    }
    if (seenEntryIds.has(qualifier.entryId)) {
      return { valid: false, message: "同じ entryId が複数含まれています。" };
    }
    seenSeeds.add(qualifier.seed);
    seenEntryIds.add(qualifier.entryId);
  }

  for (let seed = 1; seed <= sorted.length; seed += 1) {
    if (!seenSeeds.has(seed)) {
      return { valid: false, message: `seed ${seed} が欠番です。` };
    }
  }

  return { valid: true, sortedQualifiers: sorted };
}

/**
 * @param {object} slot
 */
function buildMatchTeamFromSlot(slot) {
  if (slot.isBye) {
    return {
      entryId: null,
      teamName: null,
      seed: slot.seed,
      blockId: null,
      blockName: null,
      isBye: true,
    };
  }

  return {
    entryId: slot.entryId,
    teamName: slot.teamName,
    seed: slot.seed,
    blockId: slot.blockId,
    blockName: slot.blockName,
    isBye: false,
  };
}

/**
 * @param {number} roundNumber
 * @param {number} matchNumber
 */
export function buildFinalsMatchId(roundNumber, matchNumber) {
  return `final-r${roundNumber}-m${matchNumber}`;
}

/**
 * @param {object[]} qualifiers - finalsAdvancement/current.qualifiers
 * @param {{ expectedCount?: number }} [options]
 */
export function buildFinalsBracket(qualifiers, options = {}) {
  const validation = validateSeededQualifiers(qualifiers, options.expectedCount);
  if (!validation.valid) {
    return { valid: false, message: validation.message, bracket: null };
  }

  const sortedQualifiers = validation.sortedQualifiers;
  const qualifierCount = sortedQualifiers.length;
  const bracketSize = bracketSizeFor(qualifierCount);

  if (!bracketSize || !isPowerOfTwo(bracketSize)) {
    return { valid: false, message: "トーナメントサイズを決定できません。", bracket: null };
  }

  const seedOrderResult = buildSeedOrder(bracketSize);
  if (!seedOrderResult.valid) {
    return { valid: false, message: seedOrderResult.message, bracket: null };
  }

  const qualifierBySeed = new Map(sortedQualifiers.map((entry) => [entry.seed, entry]));
  const slots = seedOrderResult.seedOrder.map((seed, index) => {
    const slotNumber = index + 1;
    const qualifier = qualifierBySeed.get(seed);

    if (qualifier) {
      return {
        slotNumber,
        seed,
        entryId: qualifier.entryId,
        teamName: qualifier.teamName,
        blockId: qualifier.blockId,
        blockName: qualifier.blockName,
        advancementSource: qualifier.source ?? null,
        isBye: false,
      };
    }

    return {
      slotNumber,
      seed,
      entryId: null,
      teamName: null,
      blockId: null,
      blockName: null,
      advancementSource: null,
      isBye: true,
    };
  });

  const placedEntryIds = new Set(
    slots.filter((slot) => !slot.isBye && slot.entryId).map((slot) => slot.entryId)
  );

  if (placedEntryIds.size !== qualifierCount) {
    return {
      valid: false,
      message: "進出チームの配置に不整合があります。",
      bracket: null,
    };
  }

  const roundCount = roundCountFor(bracketSize);
  const matches = [];

  for (let roundNumber = 1; roundNumber <= roundCount; roundNumber += 1) {
    const matchesInRound = bracketSize / 2 ** roundNumber;

    for (let matchNumber = 1; matchNumber <= matchesInRound; matchNumber += 1) {
      const matchId = buildFinalsMatchId(roundNumber, matchNumber);
      const hasNext = roundNumber < roundCount;
      const nextMatchId = hasNext
        ? buildFinalsMatchId(roundNumber + 1, Math.ceil(matchNumber / 2))
        : null;
      const nextTeamSlot = matchNumber % 2 === 1 ? "team1" : "team2";

      let team1 = null;
      let team2 = null;

      if (roundNumber === 1) {
        const slotIndex = (matchNumber - 1) * 2;
        team1 = buildMatchTeamFromSlot(slots[slotIndex]);
        team2 = buildMatchTeamFromSlot(slots[slotIndex + 1]);
      }

      matches.push({
        matchId,
        roundNumber,
        matchNumber,
        bracketPosition: matchNumber,
        roundLabel: getFinalsRoundLabel(bracketSize, roundNumber),
        team1,
        team2,
        status: FinalsMatchStatus.PENDING,
        nextMatchId,
        nextTeamSlot,
      });
    }
  }

  return {
    valid: true,
    message: null,
    bracket: {
      bracketSize,
      qualifierCount,
      roundCount,
      slots,
      matches,
    },
  };
}

/**
 * @param {object|null|undefined} advancement - finalsAdvancement/current
 * @param {{ random?: () => number, regenerate?: boolean }} [options]
 *   regenerate=true のとき:
 *   - 固定ブロック: ランダム再配置（同一ブロック1回戦回避を維持）
 *   - 旧形式: seed を再抽選してから決定的シード配置
 */
export function buildFinalsBracketFromAdvancement(advancement, options = {}) {
  const { random = Math.random, regenerate = false } = options;

  if (!advancement?.finalized) {
    return {
      valid: false,
      canFinalize: false,
      message: "決勝進出が未確定です。",
      bracket: null,
    };
  }

  if (advancement.mode === "fixed_block_qualifiers") {
    const result = buildFixedBlockFinalsBracket(
      normalizeFixedBlockQualifiersForBracket(advancement.qualifiers),
      {
        expectedCount: advancement.qualifierCount ?? advancement.finalTeamCount,
        random,
      }
    );
    return {
      valid: result.valid,
      canFinalize: result.valid,
      message: result.message,
      bracket: result.bracket,
    };
  }

  const legacyQualifiers = regenerate
    ? reseedLegacyQualifiersInline(advancement.qualifiers, random)
    : advancement.qualifiers;

  const result = buildFinalsBracket(legacyQualifiers, {
    expectedCount: advancement.finalTeamCount,
  });

  return {
    valid: result.valid,
    canFinalize: result.valid,
    message: result.message,
    bracket: result.bracket,
  };
}

/**
 * @param {object[]} qualifiers
 * @param {() => number} random
 */
function reseedLegacyQualifiersInline(qualifiers, random) {
  if (!Array.isArray(qualifiers) || qualifiers.length === 0) {
    return [];
  }
  const arr = [...qualifiers];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.map((qualifier, index) => ({
    ...qualifier,
    seed: index + 1,
  }));
}

/**
 * @param {object} preview - buildFinalsBracketFromAdvancement の成功結果
 */
export function buildPersistedFinalsBracket(preview) {
  const { bracket } = preview;
  return {
    finalized: true,
    bracketSize: bracket.bracketSize,
    qualifierCount: bracket.qualifierCount,
    roundCount: bracket.roundCount,
    slots: bracket.slots,
    matches: bracket.matches,
    placementMode: bracket.placementMode ?? null,
  };
}

/**
 * 保存済み bracket の第1ラウンドに teamName 欠落があるか（修復対象判定）
 * @param {object|null|undefined} bracket
 */
export function needsFinalsBracketTeamDataRepair(bracket) {
  if (!bracket?.finalized || !Array.isArray(bracket.matches)) {
    return false;
  }

  const round1 = bracket.matches.filter((match) => match.roundNumber === 1);
  if (round1.length === 0) {
    return false;
  }

  for (const match of round1) {
    for (const team of [match.team1, match.team2]) {
      if (!team || team.isBye) {
        continue;
      }
      if (!team.entryId || !team.teamName) {
        return true;
      }
    }
  }

  return false;
}

/**
 * テスト・検証用: 指定 seed 同士が最早で対戦するラウンド番号（1-indexed）
 * @param {object} bracket
 * @param {number} seedA
 * @param {number} seedB
 */
export function findEarliestMeetingRound(bracket, seedA, seedB) {
  const seedToSlot = new Map(bracket.slots.map((slot) => [slot.seed, slot.slotNumber]));

  const slotA = seedToSlot.get(seedA);
  const slotB = seedToSlot.get(seedB);
  if (!slotA || !slotB) {
    return null;
  }

  let indexA = slotA - 1;
  let indexB = slotB - 1;

  for (let round = 1; round <= bracket.roundCount; round += 1) {
    const span = 2 ** round;
    const matchIndexA = Math.floor(indexA / span);
    const matchIndexB = Math.floor(indexB / span);

    if (matchIndexA === matchIndexB) {
      return round;
    }
  }

  return null;
}
