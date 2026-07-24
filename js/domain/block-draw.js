/**
 * ブロック抽選ロジック（DOM 非依存）
 */

/**
 * @param {number} teamCount
 * @param {number} preferredBlockSize
 */
export function calculateBlockCount(teamCount, preferredBlockSize) {
  if (teamCount <= 0) {
    return 0;
  }
  return Math.max(1, Math.ceil(teamCount / preferredBlockSize));
}

/**
 * @param {number} index
 */
export function getBlockLabel(index) {
  return String.fromCharCode(65 + index);
}

/**
 * Fisher-Yates シャッフル
 * @template T
 * @param {T[]} items
 * @returns {T[]}
 */
export function shuffleArray(items) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * 参加承認済みエントリーをブロックへ均等振り分け
 * @param {Array<{ id: string }>} entries
 * @param {number} preferredBlockSize
 */
export function distributeEntriesToBlocks(entries, preferredBlockSize) {
  if (entries.length === 0) {
    return {
      preferredBlockSize,
      blockCount: 0,
      blocks: [],
    };
  }

  const blockCount = calculateBlockCount(entries.length, preferredBlockSize);
  const shuffled = shuffleArray(entries);
  const blocks = Array.from({ length: blockCount }, (_, index) => ({
    id: getBlockLabel(index),
    name: `${getBlockLabel(index)}ブロック`,
    entryIds: [],
  }));

  shuffled.forEach((entry, index) => {
    blocks[index % blockCount].entryIds.push(entry.id);
  });

  return {
    preferredBlockSize,
    blockCount,
    blocks,
  };
}
