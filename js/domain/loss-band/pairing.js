/**
 * 敗戦帯ペアリング（純関数）
 * Phase 1: 隣接決定論 / Phase 2: 再戦回避付き完全マッチング探索
 */

/**
 * @param {unknown} opponentHistory
 * @returns {Map<string, Set<string>>}
 */
export function normalizeOpponentHistory(opponentHistory) {
  const map = new Map();

  function add(a, b) {
    if (typeof a !== "string" || typeof b !== "string" || !a || !b || a === b) {
      return;
    }
    if (!map.has(a)) map.set(a, new Set());
    if (!map.has(b)) map.set(b, new Set());
    map.get(a).add(b);
    map.get(b).add(a);
  }

  if (!opponentHistory) {
    return map;
  }

  if (opponentHistory instanceof Map) {
    for (const [entryId, opponents] of opponentHistory) {
      if (typeof entryId !== "string") continue;
      const list = opponents instanceof Set ? opponents : opponents ?? [];
      for (const other of list) {
        add(entryId, other);
      }
    }
    return map;
  }

  if (typeof opponentHistory === "object") {
    for (const [entryId, opponents] of Object.entries(opponentHistory)) {
      const list = Array.isArray(opponents) ? opponents : [];
      for (const other of list) {
        add(entryId, other);
      }
    }
  }

  return map;
}

/**
 * matchLog から対戦履歴を導出（BYE は含めない）
 * @param {Array<{ team1EntryId: string, team2EntryId: string, isBye?: boolean, resolution?: string }>|null|undefined} matchLog
 */
export function buildOpponentHistoryFromMatchLog(matchLog) {
  const map = new Map();
  if (!Array.isArray(matchLog)) {
    return map;
  }
  for (const match of matchLog) {
    if (match?.isBye === true || match?.resolution === "bye") {
      continue;
    }
    const a = match?.team1EntryId;
    const b = match?.team2EntryId;
    if (typeof a !== "string" || typeof b !== "string" || !a || !b || a === b) {
      continue;
    }
    if (!map.has(a)) map.set(a, new Set());
    if (!map.has(b)) map.set(b, new Set());
    map.get(a).add(b);
    map.get(b).add(a);
  }
  return map;
}

/**
 * @param {string} a
 * @param {string} b
 * @param {Map<string, Set<string>>} history
 */
export function havePlayedBefore(a, b, history) {
  return Boolean(history?.get(a)?.has(b));
}

/**
 * @param {Array<[string, string]>} pairs
 * @param {Map<string, Set<string>>|object} opponentHistory
 */
export function countRematchesInPairs(pairs, opponentHistory) {
  const history = normalizeOpponentHistory(opponentHistory);
  let count = 0;
  for (const [a, b] of pairs) {
    if (havePlayedBefore(a, b, history)) {
      count += 1;
    }
  }
  return count;
}

/**
 * entryId 昇順の隣接ペア（Phase 1 標準・再戦回避なし）
 * @param {string[]} entryIds
 * @returns {Array<[string, string]>}
 */
export function pairEntryIdsDeterministic(entryIds) {
  const sorted = [...entryIds].sort((a, b) => a.localeCompare(b, "en"));
  if (sorted.length % 2 !== 0) {
    const error = new Error(`band size must be even for pairing, got ${sorted.length}`);
    error.code = "loss-band/odd-band-size";
    throw error;
  }
  const pairs = [];
  for (let i = 0; i < sorted.length; i += 2) {
    pairs.push([sorted[i], sorted[i + 1]]);
  }
  return pairs;
}

/**
 * 各ペアを [min,max] にし、team1 昇順で並べる（出力の決定論）
 * @param {Array<[string, string]>} pairs
 */
function canonicalizePairs(pairs) {
  return pairs
    .map(([a, b]) => (a.localeCompare(b, "en") <= 0 ? [a, b] : [b, a]))
    .sort((p, q) => {
      const c0 = p[0].localeCompare(q[0], "en");
      if (c0 !== 0) return c0;
      return p[1].localeCompare(q[1], "en");
    });
}

/**
 * 再戦0の貪欲（各ステップで最小 entryId 未マッチ頂点 × 最小未対戦相手）
 * @param {string[]} sortedIds
 * @param {Map<string, Set<string>>} history
 * @returns {Array<[string, string]>|null}
 */
function tryGreedyRematchZero(sortedIds, history) {
  const matched = new Set();
  const pairs = [];
  for (const v of sortedIds) {
    if (matched.has(v)) continue;
    let partner = null;
    for (const w of sortedIds) {
      if (w === v || matched.has(w)) continue;
      if (!havePlayedBefore(v, w, history)) {
        partner = w;
        break;
      }
    }
    if (!partner) {
      return null;
    }
    matched.add(v);
    matched.add(partner);
    pairs.push([v, partner]);
  }
  return canonicalizePairs(pairs);
}

/**
 * 偶数 n の canonical 1-factorization（circle method）を index ペアで列挙
 * @param {number} n even
 * @returns {Array<Array<[number, number]>>}
 */
function listCanonicalOneFactorIndexPairs(n) {
  const factors = [];
  const circleSize = n - 1;
  const m = n / 2;
  for (let r = 0; r < circleSize; r += 1) {
    const pairs = [];
    pairs.push([n - 1, r % circleSize]);
    for (let k = 1; k < m; k += 1) {
      const a = (r + k) % circleSize;
      const b = (r - k + circleSize) % circleSize;
      pairs.push([a, b]);
    }
    factors.push(pairs);
  }
  return factors;
}

/**
 * @param {string[]} sortedIds
 * @param {Array<[number, number]>} indexPairs
 */
function materializeFactor(sortedIds, indexPairs) {
  return canonicalizePairs(
    indexPairs.map(([i, j]) => [sortedIds[i], sortedIds[j]])
  );
}

/**
 * 1-factorization の中から再戦0を探す
 * @param {string[]} sortedIds
 * @param {Map<string, Set<string>>} history
 */
function tryOneFactorRematchZero(sortedIds, history) {
  const factors = listCanonicalOneFactorIndexPairs(sortedIds.length);
  for (const factor of factors) {
    const pairs = materializeFactor(sortedIds, factor);
    if (countRematchesInPairs(pairs, history) === 0) {
      return pairs;
    }
  }
  return null;
}

/**
 * 1-factorization のうち再戦数が最少のものを返す（同数なら pairs の辞書順）
 * @param {string[]} sortedIds
 * @param {Map<string, Set<string>>} history
 */
function pickMinRematchOneFactor(sortedIds, history) {
  const factors = listCanonicalOneFactorIndexPairs(sortedIds.length);
  let best = null;
  let bestRematches = Infinity;
  let bestKey = "";
  for (const factor of factors) {
    const pairs = materializeFactor(sortedIds, factor);
    const rematches = countRematchesInPairs(pairs, history);
    const key = pairs.map(([a, b]) => `${a}:${b}`).join("|");
    if (
      rematches < bestRematches ||
      (rematches === bestRematches && (best === null || key < bestKey))
    ) {
      best = pairs;
      bestRematches = rematches;
      bestKey = key;
    }
  }
  return { pairs: best, rematchCount: bestRematches };
}

/**
 * 再戦0専用の小規模DFS（貪欲・1-factor で見つからない場合の補完）
 * @param {string[]} sortedIds
 * @param {Map<string, Set<string>>} history
 * @param {number} maxNodes
 */
function dfsRematchZero(sortedIds, history, maxNodes) {
  const n = sortedIds.length;
  const rematchMatrix = Array.from({ length: n }, () => Array(n).fill(false));
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const played = havePlayedBefore(sortedIds[i], sortedIds[j], history);
      rematchMatrix[i][j] = played;
      rematchMatrix[j][i] = played;
    }
  }

  const matched = Array(n).fill(false);
  const pairIndices = [];
  let nodesVisited = 0;

  function dfs() {
    nodesVisited += 1;
    if (nodesVisited > maxNodes) {
      return null;
    }
    if (pairIndices.length === n / 2) {
      return true;
    }

    let v = -1;
    for (let i = 0; i < n; i += 1) {
      if (!matched[i]) {
        v = i;
        break;
      }
    }
    if (v < 0) {
      return false;
    }

    const candidates = [];
    for (let j = v + 1; j < n; j += 1) {
      if (matched[j]) continue;
      if (rematchMatrix[v][j]) continue;
      candidates.push(j);
    }

    for (const j of candidates) {
      matched[v] = true;
      matched[j] = true;
      pairIndices.push([v, j]);
      const found = dfs();
      if (found === true) {
        return true;
      }
      pairIndices.pop();
      matched[v] = false;
      matched[j] = false;
      if (found === null || nodesVisited > maxNodes) {
        return null;
      }
    }
    return false;
  }

  const found = dfs();
  if (found !== true) {
    return null;
  }
  return canonicalizePairs(pairIndices.map(([i, j]) => [sortedIds[i], sortedIds[j]]));
}

/**
 * 再戦回避付きペアリング。
 * 1) 再戦0: 貪欲 → canonical 1-factorization → 制限付きDFS
 * 2) 不能なら 1-factorization 上で再戦最少（決定論・O(n²)）
 *
 * @param {string[]} entryIds
 * @param {Map<string, Set<string>>|Record<string, string[]>|null|undefined} opponentHistory
 * @returns {{ pairs: Array<[string, string]>, rematchCount: number }}
 */
export function pairEntryIdsWithRematchAvoidance(entryIds, opponentHistory) {
  if (!Array.isArray(entryIds)) {
    const error = new Error("entryIds must be an array");
    error.code = "loss-band/invalid-entry-ids";
    throw error;
  }

  const sorted = [...entryIds].sort((a, b) => a.localeCompare(b, "en"));
  if (sorted.length % 2 !== 0) {
    const error = new Error(`band size must be even for pairing, got ${sorted.length}`);
    error.code = "loss-band/odd-band-size";
    throw error;
  }
  if (new Set(sorted).size !== sorted.length) {
    const error = new Error("duplicate entryIds in band pairing");
    error.code = "loss-band/pairing-duplicate";
    throw error;
  }
  if (sorted.length === 0) {
    return { pairs: [], rematchCount: 0 };
  }

  const history = normalizeOpponentHistory(opponentHistory);

  const greedyZero = tryGreedyRematchZero(sorted, history);
  if (greedyZero) {
    return { pairs: greedyZero, rematchCount: 0 };
  }

  const factorZero = tryOneFactorRematchZero(sorted, history);
  if (factorZero) {
    return { pairs: factorZero, rematchCount: 0 };
  }

  // 小規模〜中規模の取りこぼし補完（決定論DFS）
  const dfsZero = dfsRematchZero(sorted, history, sorted.length <= 16 ? 250_000 : 100_000);
  if (dfsZero) {
    return { pairs: dfsZero, rematchCount: 0 };
  }

  // 再戦不可避（または探索予算内に再戦0なし）→ 1-factorization 上の最少再戦
  return pickMinRematchOneFactor(sorted, history);
}
