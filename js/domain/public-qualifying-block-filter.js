/**
 * 公開ページ予選：ブロック選択用の純関数（snapshot / view 構造は変更しない）
 */

/**
 * @param {{ blockId?: string, blockName?: string }[]} blocks
 * @returns {{ blockId: string, blockName: string }[]}
 */
function normalizeBlockList(blocks) {
  if (!Array.isArray(blocks)) return [];
  const out = [];
  const seen = new Set();
  for (const block of blocks) {
    const blockId = String(block?.blockId ?? "").trim();
    if (!blockId || seen.has(blockId)) continue;
    seen.add(blockId);
    out.push({
      blockId,
      blockName: String(block?.blockName || blockId).trim() || blockId,
    });
  }
  return out;
}

/**
 * public view の qualifying セクションからブロック候補を収集する。
 * blocks → standings → schedule の順で初出の並びを優先する。
 *
 * @param {object|null|undefined} qualifying
 * @returns {{ blockId: string, blockName: string }[]}
 */
export function collectQualifyingBlockOptions(qualifying) {
  if (!qualifying || qualifying.visible === false) {
    return [];
  }

  const fromBlocks = normalizeBlockList(qualifying.blocks?.blocks);
  if (fromBlocks.length) return fromBlocks;

  const fromStandings = normalizeBlockList(qualifying.standings?.blocks);
  if (fromStandings.length) return fromStandings;

  return normalizeBlockList(qualifying.schedule?.blocks);
}

/**
 * @param {object|null|undefined} section blocks 配列を持つセクション
 * @param {string|null|undefined} blockId
 * @returns {object|null|undefined}
 */
export function filterQualifyingSectionByBlockId(section, blockId) {
  if (!section || typeof section !== "object") return section;
  if (!blockId) return section;
  const blocks = Array.isArray(section.blocks) ? section.blocks : [];
  return {
    ...section,
    blocks: blocks.filter((b) => String(b?.blockId ?? "") === String(blockId)),
  };
}

/**
 * @param {object|null|undefined} qualifying
 * @param {string|null|undefined} entryId
 * @returns {string|null}
 */
export function findQualifyingBlockIdForEntry(qualifying, entryId) {
  if (!qualifying || !entryId) return null;
  const id = String(entryId);

  for (const block of qualifying.standings?.blocks || []) {
    if ((block.rows || []).some((row) => row?.entryId === id)) {
      return block.blockId ?? null;
    }
  }
  for (const block of qualifying.blocks?.blocks || []) {
    if ((block.teams || []).some((team) => team?.entryId === id)) {
      return block.blockId ?? null;
    }
  }
  for (const block of qualifying.schedule?.blocks || []) {
    for (const round of block.rounds || []) {
      for (const match of round.matches || []) {
        if (match?.team1?.entryId === id || match?.team2?.entryId === id) {
          return block.blockId ?? null;
        }
      }
    }
  }
  return null;
}

/**
 * @param {{ blockId: string, blockName: string }[]} options
 * @param {{
 *   preferredBlockId?: string|null,
 *   urlBlockId?: string|null,
 *   highlightBlockId?: string|null,
 * }} [prefs]
 * @returns {string|null}
 */
export function resolveInitialQualifyingBlockId(options, prefs = {}) {
  const list = Array.isArray(options) ? options : [];
  if (!list.length) return null;

  const ids = new Set(list.map((b) => b.blockId));
  const candidates = [
    prefs.preferredBlockId,
    prefs.urlBlockId,
    prefs.highlightBlockId,
  ];
  for (const candidate of candidates) {
    const id = candidate == null ? "" : String(candidate).trim();
    if (id && ids.has(id)) return id;
  }
  return list[0].blockId;
}

/**
 * @param {{ blockId: string }[]} options
 * @returns {boolean}
 */
export function shouldShowQualifyingBlockSelect(options) {
  return Array.isArray(options) && options.length > 1;
}

/**
 * @param {object|null|undefined} qualifying
 * @returns {boolean}
 */
export function shouldRenderQualifyingBlockUi(qualifying) {
  if (!qualifying || qualifying.visible === false) return false;
  return collectQualifyingBlockOptions(qualifying).length > 0;
}

/**
 * standings 行から「負」を取得。無い場合は 試合数 - 勝 - 分。
 * @param {object|null|undefined} row
 * @returns {number|null}
 */
export function resolveStandingSetLosses(row) {
  if (!row || typeof row !== "object") return null;
  if (Number.isFinite(row.setLosses)) return Number(row.setLosses);
  const played = Number(row.playedMatches);
  const wins = Number(row.setWins);
  const draws = Number(row.setDraws);
  if ([played, wins, draws].every((n) => Number.isFinite(n))) {
    return Math.max(0, played - wins - draws);
  }
  return null;
}

/**
 * @param {object|null|undefined} standingsSection
 * @param {string|null|undefined} entryId
 * @returns {object|null}
 */
export function findStandingRowByEntryId(standingsSection, entryId) {
  if (!standingsSection || !entryId) return null;
  const id = String(entryId);
  for (const block of standingsSection.blocks || []) {
    const row = (block.rows || []).find((r) => String(r?.entryId ?? "") === id);
    if (row) {
      return { ...row, blockId: block.blockId, blockName: block.blockName };
    }
  }
  return null;
}

/**
 * 公開ページ用のチーム総合戦績カード用データ
 * @param {object|null|undefined} row
 * @returns {{
 *   teamName: string,
 *   setWins: number|null,
 *   setDraws: number|null,
 *   setLosses: number|null,
 *   totalScore: number|null,
 *   rank: number|null,
 * } | null}
 */
export function buildPublicTeamRecordCard(row) {
  if (!row) return null;
  return {
    teamName: String(row.teamName || row.entryId || "").trim() || "—",
    setWins: Number.isFinite(row.setWins) ? Number(row.setWins) : null,
    setDraws: Number.isFinite(row.setDraws) ? Number(row.setDraws) : null,
    setLosses: resolveStandingSetLosses(row),
    totalScore: Number.isFinite(row.totalScore) ? Number(row.totalScore) : null,
    rank: Number.isFinite(row.rank) ? Number(row.rank) : null,
  };
}
