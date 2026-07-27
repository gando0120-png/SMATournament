/**
 * ダミー参加者（E2E テスト支援）ドメイン（DOM / Firestore 非依存）
 */
import { EntryStatus } from "./constants.js";
import { getAdditionalMemberFieldKeys, normalizeTeamSize } from "./entry-members.js";
import { isDummyEntryMutationBlocked } from "./tournament-structure-state.js";
import { canUseTournamentTestTools } from "./test-tournament-access.js";

export const DUMMY_ENTRY_MAX_TOTAL = 64;
export const DUMMY_ENTRY_TARGET_PRESETS = [2, 3, 4, 5, 8, 12, 13, 16, 32, 40, 64];
export const DUMMY_EMAIL_DOMAIN = "example.invalid";

/**
 * @param {number} index
 */
export function formatDummyTeamName(index) {
  return `ダミーチーム${String(index).padStart(2, "0")}`;
}

/**
 * @param {Set<string>|Array<string>} usedNames
 * @param {number} count
 */
export function allocateDummyTeamNames(usedNames, count) {
  const reserved = usedNames instanceof Set ? new Set(usedNames) : new Set(usedNames);
  const names = [];
  let index = 1;

  while (names.length < count && index <= 999) {
    const candidate = formatDummyTeamName(index);
    index += 1;
    if (!reserved.has(candidate)) {
      names.push(candidate);
      reserved.add(candidate);
    }
  }

  if (names.length < count) {
    return { valid: false, message: "利用可能なダミーチーム名を確保できません。", names: [] };
  }

  return { valid: true, message: null, names };
}

/**
 * @param {Array<object>} entries
 */
export function countConfirmedEntries(entries) {
  return entries.filter((entry) => entry.status === EntryStatus.CONFIRMED).length;
}

/**
 * @param {Array<object>} entries
 */
export function getDummyEntryStats(entries) {
  const dummyEntries = entries.filter((entry) => entry.isDummy === true);
  return {
    dummyCount: dummyEntries.length,
    confirmedCount: countConfirmedEntries(entries),
    dummyEntries,
  };
}

/**
 * @param {Array<object>} entries
 */
export function findLatestDummyBatchId(entries) {
  const dummyEntries = entries.filter((entry) => entry.isDummy === true && entry.dummyBatchId);
  if (dummyEntries.length === 0) {
    return null;
  }

  const batches = new Map();
  for (const entry of dummyEntries) {
    const batchId = entry.dummyBatchId;
    const createdAt = entry.createdAt?.toMillis?.() ?? entry.createdAt ?? 0;
    const current = batches.get(batchId) ?? { batchId, latestCreatedAt: 0, count: 0 };
    current.count += 1;
    if (createdAt >= current.latestCreatedAt) {
      current.latestCreatedAt = createdAt;
    }
    batches.set(batchId, current);
  }

  return [...batches.values()].sort((a, b) => b.latestCreatedAt - a.latestCreatedAt)[0]?.batchId ?? null;
}

/**
 * @param {number} targetCount
 * @param {number} confirmedCount
 * @param {number} [maxTeams]
 */
export function calculateDummyFillPlan({
  targetCount,
  confirmedCount,
  maxTeams = DUMMY_ENTRY_MAX_TOTAL,
  existingEntries = [],
}) {
  if (!Number.isInteger(targetCount) || targetCount < 1 || targetCount > DUMMY_ENTRY_MAX_TOTAL) {
    return {
      valid: false,
      message: `目標人数は 1〜${DUMMY_ENTRY_MAX_TOTAL} の整数で指定してください。`,
      toAdd: 0,
      targetCount: null,
      teamNames: [],
    };
  }

  const effectiveMax = Math.min(maxTeams, DUMMY_ENTRY_MAX_TOTAL);
  if (targetCount > effectiveMax) {
    return {
      valid: false,
      message: `目標人数が大会上限（${effectiveMax}）を超えています。`,
      toAdd: 0,
      targetCount: null,
      teamNames: [],
    };
  }

  if (targetCount < confirmedCount) {
    return {
      valid: false,
      message: `目標人数（${targetCount}）は現在の確定参加者数（${confirmedCount}）以上にしてください。`,
      toAdd: 0,
      targetCount: null,
      teamNames: [],
    };
  }

  const toAdd = targetCount - confirmedCount;
  if (toAdd === 0) {
    return {
      valid: true,
      message: null,
      toAdd: 0,
      targetCount,
      teamNames: [],
    };
  }

  const usedNames = new Set(
    existingEntries
      .map((entry) => entry.teamName)
      .filter((name) => typeof name === "string" && name.length > 0)
  );
  const allocation = allocateDummyTeamNames(usedNames, toAdd);
  if (!allocation.valid) {
    return {
      valid: false,
      message: allocation.message,
      toAdd: 0,
      targetCount: null,
      teamNames: [],
    };
  }

  return {
    valid: true,
    message: null,
    toAdd,
    targetCount,
    teamNames: allocation.names,
  };
}

/**
 * @param {{ teamName: string, dummyBatchId: string, dummyIndex: number, teamSize?: number, emailSuffix?: string }} params
 */
export function buildDummyEntryPayload({
  teamName,
  dummyBatchId,
  dummyIndex,
  teamSize = 1,
  emailSuffix,
}) {
  const normalizedTeamSize = normalizeTeamSize(teamSize);
  const suffix = emailSuffix ?? `${dummyBatchId.slice(0, 8)}-${String(dummyIndex).padStart(3, "0")}`;
  const payload = {
    teamName,
    representativeName: `ダミー代表${String(dummyIndex).padStart(2, "0")}`,
    email: `dummy-${suffix}@${DUMMY_EMAIL_DOMAIN}`,
    status: EntryStatus.CONFIRMED,
    isDummy: true,
    dummyBatchId,
    dummyIndex,
  };

  for (const fieldKey of getAdditionalMemberFieldKeys(normalizedTeamSize)) {
    const memberNumber = fieldKey.replace("member", "");
    payload[fieldKey] = `ダミーメンバー${memberNumber}`;
  }

  return payload;
}

/**
 * @param {object} params
 */
export function validateDummyEntryFill({
  tournament,
  canManage = false,
  structureState,
  targetCount,
  confirmedCount,
  maxTeams,
  existingEntries = [],
}) {
  const access = canUseTournamentTestTools({ tournament, canManage });
  if (!access.allowed) {
    return { valid: false, message: access.reason, plan: null };
  }

  if (isDummyEntryMutationBlocked(structureState)) {
    return {
      valid: false,
      message:
        "ブロック抽選・対戦表・決勝構造・試合結果・大会結果のいずれかが存在するため、ダミー参加者を変更できません。",
      plan: null,
    };
  }

  const plan = calculateDummyFillPlan({
    targetCount,
    confirmedCount,
    maxTeams,
    existingEntries,
  });

  if (!plan.valid) {
    return { valid: false, message: plan.message, plan: null };
  }

  return { valid: true, message: null, plan };
}

/**
 * @param {object} params
 */
export function validateDummyEntryDeletion({
  tournament,
  canManage = false,
  structureState,
  entries,
  mode,
}) {
  const access = canUseTournamentTestTools({ tournament, canManage });
  if (!access.allowed) {
    return { valid: false, message: access.reason, targets: [] };
  }

  if (isDummyEntryMutationBlocked(structureState)) {
    return {
      valid: false,
      message:
        "ブロック抽選・対戦表・決勝構造・試合結果・大会結果のいずれかが存在するため、ダミー参加者を削除できません。",
      targets: [],
    };
  }

  const dummyEntries = entries.filter((entry) => entry.isDummy === true);
  if (dummyEntries.length === 0) {
    return { valid: false, message: "削除対象のダミー参加者がありません。", targets: [] };
  }

  if (mode === "latest-batch") {
    const latestBatchId = findLatestDummyBatchId(entries);
    if (!latestBatchId) {
      return { valid: false, message: "最新バッチを特定できません。", targets: [] };
    }
    const targets = dummyEntries.filter((entry) => entry.dummyBatchId === latestBatchId);
    if (targets.length === 0) {
      return { valid: false, message: "最新バッチに削除対象がありません。", targets: [] };
    }
    return { valid: true, message: null, targets, batchId: latestBatchId };
  }

  if (mode === "all") {
    return { valid: true, message: null, targets: dummyEntries, batchId: null };
  }

  return { valid: false, message: "削除モードが不正です。", targets: [] };
}

/**
 * @param {() => string} [randomUuid]
 */
export function generateDummyBatchId(randomUuid) {
  if (typeof randomUuid === "function") {
    return randomUuid();
  }
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `dummy-batch-${Date.now()}`;
}
