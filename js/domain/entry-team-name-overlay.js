/**
 * エントリーの最新 teamName を、entryId 付きの非正規化データへ重ねる
 * （対戦表・bracket・結果ドキュメントは Rules 上更新不可／制限ありのため）
 */

/**
 * @param {unknown} value
 */
function isPlainObject(value) {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  if (typeof value.toDate === "function" || typeof value.toMillis === "function") {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * @param {Iterable<object>|null|undefined} entries
 * @returns {Map<string, string>}
 */
export function buildEntryTeamNameLookup(entries) {
  const lookup = new Map();
  if (!entries) {
    return lookup;
  }
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const entryId = entry.id ?? entry.entryId;
    const teamName = typeof entry.teamName === "string" ? entry.teamName.trim() : "";
    if (typeof entryId === "string" && entryId && teamName) {
      lookup.set(entryId, teamName);
    }
  }
  return lookup;
}

/**
 * @param {string|null|undefined} entryId
 * @param {string|null|undefined} fallback
 * @param {Map<string, string>|null|undefined} nameByEntryId
 */
export function resolveLiveTeamName(entryId, fallback, nameByEntryId) {
  if (entryId && nameByEntryId?.has(entryId)) {
    return nameByEntryId.get(entryId);
  }
  if (typeof fallback === "string" && fallback.trim()) {
    return fallback;
  }
  return fallback ?? "—";
}

/**
 * entryId + teamName（および home/away）を持つ木構造へ最新名を重ねる。
 * 変更がなければ同一参照を返す。
 * @param {unknown} node
 * @param {Map<string, string>|null|undefined} nameByEntryId
 */
export function overlayEntryTeamNames(node, nameByEntryId) {
  if (!nameByEntryId || nameByEntryId.size === 0) {
    return node;
  }

  if (Array.isArray(node)) {
    let changed = false;
    const next = node.map((item) => {
      const overlaid = overlayEntryTeamNames(item, nameByEntryId);
      if (overlaid !== item) {
        changed = true;
      }
      return overlaid;
    });
    return changed ? next : node;
  }

  if (!isPlainObject(node)) {
    return node;
  }

  let changed = false;
  const next = {};
  for (const [key, value] of Object.entries(node)) {
    const overlaid = overlayEntryTeamNames(value, nameByEntryId);
    next[key] = overlaid;
    if (overlaid !== value) {
      changed = true;
    }
  }

  const entryId = typeof next.entryId === "string" ? next.entryId : null;
  if (entryId && nameByEntryId.has(entryId) && "teamName" in next) {
    const liveName = nameByEntryId.get(entryId);
    if (next.teamName !== liveName) {
      next.teamName = liveName;
      changed = true;
    }
  }

  if (
    typeof next.homeEntryId === "string" &&
    nameByEntryId.has(next.homeEntryId) &&
    "homeTeamName" in next
  ) {
    const liveName = nameByEntryId.get(next.homeEntryId);
    if (next.homeTeamName !== liveName) {
      next.homeTeamName = liveName;
      changed = true;
    }
  }

  if (
    typeof next.awayEntryId === "string" &&
    nameByEntryId.has(next.awayEntryId) &&
    "awayTeamName" in next
  ) {
    const liveName = nameByEntryId.get(next.awayEntryId);
    if (next.awayTeamName !== liveName) {
      next.awayTeamName = liveName;
      changed = true;
    }
  }

  return changed ? next : node;
}

/**
 * @param {Map<string, object>|null|undefined} map
 * @param {Map<string, string>|null|undefined} nameByEntryId
 * @returns {Map<string, object>|null|undefined}
 */
export function overlayEntryTeamNamesInMap(map, nameByEntryId) {
  if (!(map instanceof Map) || !nameByEntryId || nameByEntryId.size === 0) {
    return map;
  }

  const next = new Map();
  let changed = false;
  for (const [key, value] of map) {
    const overlaid = overlayEntryTeamNames(value, nameByEntryId);
    next.set(key, overlaid);
    if (overlaid !== value) {
      changed = true;
    }
  }
  return changed ? next : map;
}
