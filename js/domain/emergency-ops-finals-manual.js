/**
 * Sprint 2.1: 緊急手動配置（正式ブラケット未生成時）
 *
 * Excel は抽選を再現しない。運営者が現場抽選結果を slot へ入力し、
 * SMATournament 本体と同じ bracket 配線（slot→1回戦→nextMatchId）で進行する。
 */
import {
  bracketSizeFor,
  buildFinalsMatchId,
  getFinalsRoundLabel,
  isPowerOfTwo,
  roundCountFor,
} from "./finals-bracket.js";
import { FinalsMatchStatus } from "./constants.js";
import { isDoubleByeMatch } from "./finals-match-bye.js";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

/**
 * @param {number|null|undefined} finalTeamCount
 */
export function resolveEmergencyManualBracketSize(finalTeamCount) {
  const count = Number(finalTeamCount);
  if (!Number.isInteger(count) || count < 2) {
    return { valid: false, bracketSize: null, messageJa: "決勝枠数（finalTeamCount）が不正です。" };
  }
  const bracketSize = bracketSizeFor(count);
  if (!bracketSize || !isPowerOfTwo(bracketSize)) {
    return {
      valid: false,
      bracketSize: null,
      messageJa: "対応する決勝ブラケットサイズを決定できません。",
    };
  }
  return { valid: true, bracketSize, byeCount: bracketSize - count, messageJa: null };
}

/**
 * 空スロット = BYE（本体 buildFinalsBracket の欠番 seed と同じ扱い）
 * @param {object} slot
 */
function buildMatchTeamFromManualSlot(slot) {
  if (!slot || slot.isBye || !slot.entryId) {
    return {
      entryId: null,
      teamName: null,
      seed: slot?.slotNumber ?? null,
      blockId: null,
      blockName: null,
      isBye: true,
    };
  }
  return {
    entryId: slot.entryId,
    teamName: slot.teamName ?? null,
    seed: slot.slotNumber,
    blockId: slot.blockId ?? null,
    blockName: slot.blockName ?? null,
    isBye: false,
  };
}

/**
 * 正式ブラケットと同じ matchId / nextMatchId / nextTeamSlot 配線の骨格を作る。
 * @param {number} bracketSize
 * @param {object[]} [slots]
 */
export function buildEmergencyManualBracketSkeleton(bracketSize, slots = null) {
  if (!isPowerOfTwo(bracketSize)) {
    return { valid: false, messageJa: "ブラケットサイズが不正です。", bracket: null };
  }

  const resolvedSlots =
    slots ||
    Array.from({ length: bracketSize }, (_, index) => ({
      slotNumber: index + 1,
      seed: index + 1,
      entryId: null,
      teamName: null,
      blockId: null,
      blockName: null,
      advancementSource: "emergency_manual",
      isBye: true,
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
        team1 = buildMatchTeamFromManualSlot(resolvedSlots[slotIndex]);
        team2 = buildMatchTeamFromManualSlot(resolvedSlots[slotIndex + 1]);
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

  const placed = resolvedSlots.filter((slot) => !slot.isBye && slot.entryId);
  return {
    valid: true,
    messageJa: null,
    bracket: {
      bracketSize,
      qualifierCount: placed.length,
      roundCount,
      slots: resolvedSlots,
      matches,
      placementMode: "emergency_manual",
      emergencyManual: true,
    },
  };
}

/**
 * @param {object[]} finalists - { entryId, teamName, blockId?, blockName?, reasonJa? }
 * @param {object[]} placements - { slotNumber, entryId, confirmed? }
 * @param {{ finalTeamCount: number, requireConfirm?: boolean }} options
 */
export function validateEmergencyManualPlacement(finalists, placements, options = {}) {
  const sizePack = resolveEmergencyManualBracketSize(options.finalTeamCount);
  if (!sizePack.valid) {
    return {
      valid: false,
      confirmed: false,
      errors: [sizePack.messageJa],
      bracketSize: null,
      byeSlots: [],
    };
  }

  const bracketSize = sizePack.bracketSize;
  const requireConfirm = options.requireConfirm !== false;
  const finalistList = asArray(finalists).filter((item) => text(item.entryId));
  const finalistIds = new Set(finalistList.map((item) => text(item.entryId)));
  const finalistById = new Map(finalistList.map((item) => [text(item.entryId), item]));
  const errors = [];
  const usedSlots = new Map();
  const usedTeams = new Map();
  const normalized = [];

  for (const raw of asArray(placements)) {
    const slotNumber = Number(raw.slotNumber);
    const entryId = text(raw.entryId).trim();
    const confirmed = text(raw.confirmed).trim() === "済" || raw.confirmed === true;

    if (!entryId) {
      if (confirmed && requireConfirm) {
        errors.push(`slot ${slotNumber || "?"}: 配置確認済みなのに entryId が未入力`);
      }
      continue;
    }

    if (!Number.isInteger(slotNumber) || slotNumber < 1 || slotNumber > bracketSize) {
      errors.push(`存在しないslot: ${raw.slotNumber}`);
      continue;
    }

    if (!finalistIds.has(entryId)) {
      errors.push(`決勝進出者ではないチーム: ${entryId}`);
    }

    if (usedSlots.has(slotNumber)) {
      errors.push(`同じslotへ複数チーム: ${slotNumber}`);
    } else {
      usedSlots.set(slotNumber, entryId);
    }

    if (usedTeams.has(entryId)) {
      errors.push(`同じチームを複数slotへ配置: ${entryId}`);
    } else {
      usedTeams.set(entryId, slotNumber);
    }

    if (requireConfirm && !confirmed) {
      errors.push(`slot ${slotNumber}: 配置確認未完了`);
    }

    const meta = finalistById.get(entryId) || {};
    normalized.push({
      slotNumber,
      entryId,
      teamName: text(raw.teamName || meta.teamName),
      blockId: meta.blockId ?? null,
      blockName: meta.blockName ?? null,
      reasonJa: text(raw.reasonJa || meta.reasonJa),
      confirmed,
      isBye: false,
    });
  }

  for (const entryId of finalistIds) {
    if (!usedTeams.has(entryId)) {
      errors.push(`必要な進出者が未配置: ${entryId}`);
    }
  }

  if (finalistList.length !== Number(options.finalTeamCount)) {
    errors.push(
      `進出者数 ${finalistList.length} が決勝枠 ${options.finalTeamCount} と一致しません`
    );
  }

  const byeSlots = [];
  for (let slotNumber = 1; slotNumber <= bracketSize; slotNumber += 1) {
    if (!usedSlots.has(slotNumber)) {
      byeSlots.push(slotNumber);
    }
  }

  if (byeSlots.length !== sizePack.byeCount) {
    errors.push(
      `BYE slot 数が不正です（必要 ${sizePack.byeCount} / 空き ${byeSlots.length}）`
    );
  }

  // 両側 BYE には勝者が存在せず、既存 finals progression で後続を解決できない。
  for (let slotNumber = 1; slotNumber <= bracketSize; slotNumber += 2) {
    if (!usedSlots.has(slotNumber) && !usedSlots.has(slotNumber + 1)) {
      errors.push(`1回戦の両側がBYEです: slot ${slotNumber}/${slotNumber + 1}`);
    }
  }

  const uniqueErrors = [...new Set(errors)];
  return {
    valid: uniqueErrors.length === 0 && finalistList.length > 0,
    confirmed:
      uniqueErrors.length === 0 &&
      finalistList.length > 0 &&
      (!requireConfirm || normalized.every((row) => row.confirmed)),
    errors: uniqueErrors,
    bracketSize,
    byeSlots,
    placements: normalized,
    fingerprint: Array.from({ length: bracketSize }, (_, index) => {
      const slotNumber = index + 1;
      const row = normalized.find((item) => item.slotNumber === slotNumber);
      return `${slotNumber}:${row?.entryId || ""}`;
    }).join("|"),
  };
}

/**
 * @param {object[]} finalists
 * @param {object[]} placements
 * @param {{ finalTeamCount: number, requireConfirm?: boolean }} options
 */
export function buildEmergencyManualBracketFromPlacement(finalists, placements, options = {}) {
  const validation = validateEmergencyManualPlacement(finalists, placements, options);
  if (!validation.valid || !validation.confirmed) {
    const sizePack = resolveEmergencyManualBracketSize(options.finalTeamCount);
    const skeleton = sizePack.valid
      ? buildEmergencyManualBracketSkeleton(sizePack.bracketSize)
      : { valid: false, bracket: null };
    return {
      valid: false,
      confirmed: false,
      messageJa: validation.errors[0] || "緊急手動配置が未確定です。",
      errors: validation.errors,
      validation,
      bracket: skeleton.bracket,
    };
  }

  const slots = Array.from({ length: validation.bracketSize }, (_, index) => {
    const slotNumber = index + 1;
    const placed = validation.placements.find((row) => row.slotNumber === slotNumber);
    if (!placed) {
      return {
        slotNumber,
        seed: slotNumber,
        entryId: null,
        teamName: null,
        blockId: null,
        blockName: null,
        advancementSource: "emergency_manual",
        isBye: true,
      };
    }
    return {
      slotNumber,
      seed: slotNumber,
      entryId: placed.entryId,
      teamName: placed.teamName,
      blockId: placed.blockId,
      blockName: placed.blockName,
      advancementSource: "emergency_manual",
      isBye: false,
    };
  });

  const built = buildEmergencyManualBracketSkeleton(validation.bracketSize, slots);
  const hasDoubleBye = built.bracket?.matches?.some(
    (match) =>
      match.roundNumber === 1 && isDoubleByeMatch(match.team1, match.team2)
  );
  if (hasDoubleBye) {
    return {
      valid: false,
      confirmed: false,
      messageJa: "1回戦に両側BYEの試合があります。",
      errors: ["1回戦に両側BYEの試合があります。"],
      validation,
      bracket: built.bracket,
    };
  }
  return {
    valid: built.valid,
    confirmed: true,
    messageJa: "緊急手動ブラケット確定",
    errors: [],
    validation,
    bracket: built.bracket,
  };
}

/**
 * 決勝開始後に配置 fingerprint が変わっていないか。
 * @param {string} lockedFingerprint
 * @param {string} currentFingerprint
 * @param {boolean} hasStartedFinals
 */
export function detectEmergencyPlacementTamper(
  lockedFingerprint,
  currentFingerprint,
  hasStartedFinals
) {
  if (!hasStartedFinals) {
    return { tampered: false, messageJa: "" };
  }
  const locked = text(lockedFingerprint);
  const current = text(currentFingerprint);
  if (!locked) {
    return {
      tampered: true,
      messageJa: "要確認：決勝開始後に配置ロックコードが未入力です",
    };
  }
  if (locked !== current) {
    return {
      tampered: true,
      messageJa: "要確認：決勝開始後に配置が変更されています",
    };
  }
  return { tampered: false, messageJa: "" };
}

export const EMERGENCY_MANUAL_NOTICE_JA =
  "SMATournament停止前に決勝抽選が実施されていないため、緊急手動配置を使用します。現場で抽選を行い、その結果を黄色セルへ入力してください。";

export const EMERGENCY_OFFICIAL_BRACKET_NOTICE_JA =
  "脱出前に確定した正式ブラケットを使用します。緊急手動配置は不要・変更不可です。";
