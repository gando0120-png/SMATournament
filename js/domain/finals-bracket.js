/**
 * 決勝トーナメント表生成（DOM / Firestore 非依存）
 */
import { FinalsMatchStatus } from "./constants.js";

export const BRACKET_SIZES = [4, 8, 16, 32];

/** 8チーム標準のスロット順（seed 配置） */
const EXACT_SEED_ORDERS = {
  2: [1, 2],
  4: [1, 4, 2, 3],
  8: [1, 8, 4, 5, 3, 6, 2, 7],
};

export const FINALS_ROUND_LABELS = {
  4: ["準決勝", "決勝"],
  8: ["1回戦", "準々決勝", "準決勝", "決勝"],
  16: ["1回戦", "2回戦", "準々決勝", "準決勝", "決勝"],
  32: ["1回戦", "2回戦", "3回戦", "準々決勝", "準決勝", "決勝"],
};

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
  return BRACKET_SIZES.find((size) => size >= qualifierCount) ?? 32;
}

/**
 * @param {number} bracketSize
 */
export function roundCountFor(bracketSize) {
  return Math.log2(bracketSize);
}

/**
 * @param {number} bracketSize
 * @param {number} roundNumber - 1-indexed
 */
export function getFinalsRoundLabel(bracketSize, roundNumber) {
  const labels = FINALS_ROUND_LABELS[bracketSize] ?? [];
  return labels[roundNumber - 1] ?? `第${roundNumber}ラウンド`;
}

/**
 * 2のべき乗 bracketSize 向けの標準シード配置（16・32 など）
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
 */
export function buildFinalsBracketFromAdvancement(advancement) {
  if (!advancement?.finalized) {
    return {
      valid: false,
      canFinalize: false,
      message: "決勝進出が未確定です。",
      bracket: null,
    };
  }

  const result = buildFinalsBracket(advancement.qualifiers, {
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
  };
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
