/**
 * 再現可能な擬似乱数（DOM / Firestore 非依存）
 */

/**
 * @param {string} value
 * @returns {number} 32-bit unsigned integer
 */
export function hashStringToSeed(value) {
  let hash = 2166136261;
  const str = String(value);
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * @param {string|number} seedInput
 * @returns {() => number} 0以上1未満の値を返す関数
 */
export function createSeededRandom(seedInput) {
  let state =
    typeof seedInput === "number" ? seedInput >>> 0 : hashStringToSeed(seedInput);
  if (state === 0) {
    state = 12345;
  }

  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @param {string|number} simulationSeed
 * @param {string} key
 */
export function seededUnitRandom(simulationSeed, key) {
  return createSeededRandom(`${simulationSeed}:${key}`)();
}

/**
 * @param {string|null|undefined} tournamentId
 * @param {number} [fallback=12345]
 */
export function deriveDefaultSimulationSeed(tournamentId, fallback = 12345) {
  if (typeof tournamentId !== "string" || tournamentId.length === 0) {
    return fallback;
  }
  const hashed = hashStringToSeed(tournamentId);
  return (hashed % 99999) + 1;
}
