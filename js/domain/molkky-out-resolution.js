/**
 * モルックアウト解消データの正規化・検証（DOM 非依存）
 */
import { entryIdsGroupKey, normalizeEntryIds } from "./qualifying-standings.js";

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function asStringIdList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(String);
}

/**
 * @param {object|null|undefined} group
 * @returns {{ valid: true, group: object } | { valid: false, message: string }}
 */
export function validateMolkkyOutGroup(group) {
  if (!group || typeof group !== "object") {
    return { valid: false, message: "モルックアウト解消データが不正です。" };
  }

  const entryIds = normalizeEntryIds(asStringIdList(group.entryIds));
  const orderedEntryIds = asStringIdList(group.orderedEntryIds);

  if (entryIds.length < 2) {
    return { valid: false, message: "モルックアウト対象は2チーム以上必要です。" };
  }

  if (orderedEntryIds.length !== entryIds.length) {
    return { valid: false, message: "モルックアウト後の順位に全チームを含めてください。" };
  }

  if (new Set(orderedEntryIds).size !== orderedEntryIds.length) {
    return { valid: false, message: "モルックアウト後の順位に重複があります。" };
  }

  if (entryIdsGroupKey(orderedEntryIds) !== entryIdsGroupKey(entryIds)) {
    return { valid: false, message: "モルックアウト後の順位が対象チームと一致しません。" };
  }

  return {
    valid: true,
    group: {
      entryIds,
      orderedEntryIds,
    },
  };
}

/**
 * @param {object|null|undefined} group
 */
export function normalizeBlockMolkkyOutGroup(group) {
  const validated = validateMolkkyOutGroup(group);
  if (!validated.valid) {
    return validated;
  }
  if (!group?.blockId) {
    return { valid: false, message: "ブロックIDが必要です。" };
  }
  return {
    valid: true,
    group: {
      blockId: String(group.blockId),
      ...validated.group,
    },
  };
}

/**
 * @param {object|null|undefined} group
 */
export function normalizeWildcardMolkkyOutGroup(group) {
  const validated = validateMolkkyOutGroup(group);
  if (!validated.valid) {
    return validated;
  }
  const rankBand = Number(group?.rankBand);
  if (!Number.isInteger(rankBand) || rankBand < 2) {
    return { valid: false, message: "ワイルドカード順位帯が不正です。" };
  }
  return {
    valid: true,
    group: {
      rankBand,
      ...validated.group,
    },
  };
}

/**
 * @param {object|null|undefined} resolutions
 */
export function normalizeMolkkyOutResolutions(resolutions) {
  const blockGroups = [];
  for (const group of resolutions?.blockGroups || []) {
    const normalized = normalizeBlockMolkkyOutGroup(group);
    if (!normalized.valid) {
      return normalized;
    }
    blockGroups.push(normalized.group);
  }

  const wildcardGroups = [];
  for (const group of resolutions?.wildcardGroups || []) {
    const normalized = normalizeWildcardMolkkyOutGroup(group);
    if (!normalized.valid) {
      return normalized;
    }
    wildcardGroups.push(normalized.group);
  }

  return {
    valid: true,
    data: {
      blockGroups,
      wildcardGroups,
    },
  };
}

/**
 * @param {Array<object>} wildcardGroups
 * @param {number} rankBand
 * @param {string[]} entryIds
 */
export function findWildcardMolkkyOutResolution(wildcardGroups, rankBand, entryIds) {
  const key = entryIdsGroupKey(entryIds);
  return (wildcardGroups || []).find(
    (group) =>
      group.rankBand === rankBand && entryIdsGroupKey(group.entryIds) === key
  ) ?? null;
}

/**
 * 既存解消を upsert した新しい resolutions を返す。
 * @param {object|null|undefined} existing
 * @param {{ blockGroup?: object, wildcardGroup?: object }} patch
 */
export function mergeMolkkyOutResolution(existing, patch = {}) {
  const base = {
    blockGroups: Array.isArray(existing?.blockGroups) ? [...existing.blockGroups] : [],
    wildcardGroups: Array.isArray(existing?.wildcardGroups)
      ? [...existing.wildcardGroups]
      : [],
  };

  if (patch.blockGroup) {
    const normalized = normalizeBlockMolkkyOutGroup(patch.blockGroup);
    if (!normalized.valid) {
      return normalized;
    }
    const key = entryIdsGroupKey(normalized.group.entryIds);
    base.blockGroups = base.blockGroups.filter(
      (group) =>
        !(
          group.blockId === normalized.group.blockId &&
          entryIdsGroupKey(group.entryIds) === key
        )
    );
    base.blockGroups.push(normalized.group);
  }

  if (patch.wildcardGroup) {
    const normalized = normalizeWildcardMolkkyOutGroup(patch.wildcardGroup);
    if (!normalized.valid) {
      return normalized;
    }
    const key = entryIdsGroupKey(normalized.group.entryIds);
    base.wildcardGroups = base.wildcardGroups.filter(
      (group) =>
        !(
          group.rankBand === normalized.group.rankBand &&
          entryIdsGroupKey(group.entryIds) === key
        )
    );
    base.wildcardGroups.push(normalized.group);
  }

  const normalizedAll = normalizeMolkkyOutResolutions(base);
  if (!normalizedAll.valid) {
    return normalizedAll;
  }
  return { valid: true, data: normalizedAll.data };
}
