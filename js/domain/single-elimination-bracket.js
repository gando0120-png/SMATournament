/**
 * 一発トーナメント（single_elimination）ブラケット生成
 */
import { FinalsMatchStatus } from "./constants.js";
import {
  buildFinalsMatchId,
  getFinalsRoundLabel,
  roundCountFor,
} from "./finals-bracket.js";
import { listByeMatchesNeedingResults } from "./finals-match-progress.js";
import { getByeWinnerTeam } from "./finals-match-bye.js";

export const SINGLE_ELIMINATION_MODE = "single_elimination";

export const SINGLE_ELIMINATION_BRACKET_SIZES = [2, 4, 8, 16, 32, 64];

export const SINGLE_ELIM_MIN_TEAMS = 2;

export const SINGLE_ELIM_MAX_TEAMS = 64;

/**
 * @param {object|null|undefined} bracket
 */
export function isSingleEliminationBracket(bracket) {
  return bracket?.mode === SINGLE_ELIMINATION_MODE;
}

/**
 * 一発TNとして作成済みとみなす条件（finalized フラグ単体や exists 相当は使わない）
 * @param {object|null|undefined} bracket
 */
export function hasCreatedSingleEliminationBracket(bracket) {
  if (!isSingleEliminationBracket(bracket) || bracket.finalized !== true) {
    return false;
  }

  return (
    Number.isInteger(bracket.bracketSize) &&
    Array.isArray(bracket.slots) &&
    bracket.slots.length === bracket.bracketSize &&
    Array.isArray(bracket.matches) &&
    bracket.matches.length > 0
  );
}

/**
 * @param {object|null|undefined} existing
 */
export function assessSingleEliminationBracketCreation(existing) {
  if (hasCreatedSingleEliminationBracket(existing)) {
    return {
      canCreate: false,
      code: "single-elimination-bracket/already-created",
      message: "一発トーナメント表はすでに作成済みです。",
    };
  }

  if (
    existing &&
    (existing.finalized === true ||
      (Array.isArray(existing.matches) && existing.matches.length > 0) ||
      (Array.isArray(existing.slots) && existing.slots.length > 0))
  ) {
    return {
      canCreate: false,
      code: "single-elimination-bracket/orphan-data",
      message:
        "決勝トーナメント表の不完全なデータが残っています。Firebase Console で tournaments/{id}/finalsBracket/current を確認してください。",
    };
  }

  return { canCreate: true, code: null, message: null };
}

/**
 * @param {object|null|undefined} bracket
 */
export function validateSingleEliminationByeResults(bracket) {
  if (!bracket) {
    return { valid: false, message: "トーナメント表がありません。" };
  }

  const doubleByeMatches = countFirstRoundDoubleByeMatches(bracket);
  if (doubleByeMatches > 0) {
    return {
      valid: false,
      message: "BYE 同士の対戦が含まれているため、トーナメント表を作成できません。",
    };
  }

  const byeMatches = listByeMatchesNeedingResults(bracket);
  for (const match of byeMatches) {
    const winner = getByeWinnerTeam(match.team1, match.team2);
    if (!winner?.entryId) {
      return {
        valid: false,
        message: "BYE 試合の勝者を特定できません。",
      };
    }
  }

  return { valid: true, message: null };
}

/**
 * @param {number} teamCount
 */
export function resolveSingleEliminationBracketSize(teamCount) {
  const errors = [];

  if (!Number.isInteger(teamCount)) {
    return {
      valid: false,
      bracketSize: null,
      byeCount: null,
      errors: ["参加チーム数が不正です。"],
    };
  }

  if (teamCount < SINGLE_ELIM_MIN_TEAMS) {
    errors.push("一発トーナメントを開始するには、2チーム以上の確定エントリーが必要です。");
  }

  if (teamCount > SINGLE_ELIM_MAX_TEAMS) {
    errors.push("現在の一発トーナメントは64チームまで対応しています。");
  }

  if (errors.length > 0) {
    return { valid: false, bracketSize: null, byeCount: null, errors };
  }

  const bracketSize =
    SINGLE_ELIMINATION_BRACKET_SIZES.find((size) => size >= teamCount) ?? null;

  if (!bracketSize) {
    return {
      valid: false,
      bracketSize: null,
      byeCount: null,
      errors: ["現在の一発トーナメントは64チームまで対応しています。"],
    };
  }

  return {
    valid: true,
    bracketSize,
    byeCount: bracketSize - teamCount,
    errors: [],
  };
}

/**
 * @template T
 * @param {T[]} items
 * @param {() => number} random
 */
export function shuffleWithRandom(items, random = Math.random) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * 1回戦カードへチームを分散配置し、BYE同士の対戦を避ける
 * @param {object[]} shuffledTeams
 * @param {number} bracketSize
 * @param {() => number} random
 */
export function assignTeamsToFirstRoundSlots(shuffledTeams, bracketSize, random = Math.random) {
  const numPairs = bracketSize / 2;
  const pairs = Array.from({ length: numPairs }, () => [null, null]);
  const pairOrder = shuffleWithRandom(
    Array.from({ length: numPairs }, (_, index) => index),
    random
  );

  let teamIndex = 0;

  for (const pairIdx of pairOrder) {
    if (teamIndex >= shuffledTeams.length) {
      break;
    }
    pairs[pairIdx][0] = shuffledTeams[teamIndex];
    teamIndex += 1;
  }

  const partialPairs = pairOrder.filter((pairIdx) => pairs[pairIdx][0] && !pairs[pairIdx][1]);
  for (const pairIdx of shuffleWithRandom(partialPairs, random)) {
    if (teamIndex >= shuffledTeams.length) {
      break;
    }
    pairs[pairIdx][1] = shuffledTeams[teamIndex];
    teamIndex += 1;
  }

  for (const pairIdx of pairOrder) {
    for (let slot = 0; slot < 2; slot += 1) {
      if (teamIndex >= shuffledTeams.length) {
        break;
      }
      if (!pairs[pairIdx][slot]) {
        pairs[pairIdx][slot] = shuffledTeams[teamIndex];
        teamIndex += 1;
      }
    }
  }

  const slots = [];
  for (const pair of pairs) {
    slots.push(pair[0], pair[1]);
  }
  return slots;
}

/**
 * @param {object|null|undefined} teamOrNull
 * @param {number} slotNumber
 */
function buildSlotFromTeam(teamOrNull, slotNumber) {
  if (!teamOrNull) {
    return {
      slotNumber,
      seed: slotNumber,
      entryId: null,
      teamName: null,
      blockId: null,
      blockName: null,
      advancementSource: null,
      isBye: true,
    };
  }

  return {
    slotNumber,
    seed: slotNumber,
    entryId: teamOrNull.entryId,
    teamName: teamOrNull.teamName ?? null,
    blockId: null,
    blockName: null,
    advancementSource: SINGLE_ELIMINATION_MODE,
    isBye: false,
  };
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
    blockId: null,
    blockName: null,
    isBye: false,
  };
}

/**
 * @param {object[]} entries - { entryId, teamName }
 * @param {{ random?: () => number }} [options]
 */
export function buildSingleEliminationBracket({ entries, random = Math.random }) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return {
      valid: false,
      canFinalize: false,
      message: "確定エントリーがありません。",
      bracket: null,
    };
  }

  const seenEntryIds = new Set();
  for (const entry of entries) {
    if (!entry?.entryId || typeof entry.entryId !== "string") {
      return {
        valid: false,
        canFinalize: false,
        message: "確定エントリーに entryId がありません。",
        bracket: null,
      };
    }
    if (seenEntryIds.has(entry.entryId)) {
      return {
        valid: false,
        canFinalize: false,
        message: "同じ entryId が複数含まれています。",
        bracket: null,
      };
    }
    seenEntryIds.add(entry.entryId);
  }

  const teamCount = entries.length;
  const sizeResult = resolveSingleEliminationBracketSize(teamCount);
  if (!sizeResult.valid) {
    return {
      valid: false,
      canFinalize: false,
      message: sizeResult.errors[0] ?? "参加チーム数が不正です。",
      bracket: null,
    };
  }

  const { bracketSize, byeCount } = sizeResult;
  const shuffledTeams = shuffleWithRandom(entries, random);
  const assigned = assignTeamsToFirstRoundSlots(shuffledTeams, bracketSize, random);
  const slots = assigned.map((teamOrNull, index) => buildSlotFromTeam(teamOrNull, index + 1));

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
    canFinalize: true,
    message: null,
    bracket: {
      mode: SINGLE_ELIMINATION_MODE,
      bracketSize,
      teamCount,
      byeCount,
      qualifierCount: teamCount,
      roundCount,
      slots,
      matches,
      placementMode: "random",
    },
  };
}

/**
 * @param {object} preview - buildSingleEliminationBracket の成功結果
 */
export function buildPersistedSingleEliminationBracket(preview) {
  const { bracket } = preview;
  return {
    finalized: true,
    mode: SINGLE_ELIMINATION_MODE,
    bracketSize: bracket.bracketSize,
    teamCount: bracket.teamCount,
    byeCount: bracket.byeCount,
    qualifierCount: bracket.teamCount,
    roundCount: bracket.roundCount,
    slots: bracket.slots,
    matches: bracket.matches,
  };
}

/**
 * 一発TNの結果算出用参加者リスト
 * @param {object|null|undefined} bracket
 */
export function getSingleEliminationParticipants(bracket) {
  if (!isSingleEliminationBracket(bracket)) {
    return [];
  }

  return (bracket.slots ?? [])
    .filter((slot) => !slot.isBye && slot.entryId)
    .map((slot) => ({
      entryId: slot.entryId,
      teamName: slot.teamName ?? null,
      seed: slot.seed ?? slot.slotNumber,
    }));
}

/**
 * @param {object} bracket
 */
export function countFirstRoundDoubleByeMatches(bracket) {
  return (bracket.matches ?? []).filter(
    (match) =>
      match.roundNumber === 1 &&
      match.team1?.isBye === true &&
      match.team2?.isBye === true
  ).length;
}
