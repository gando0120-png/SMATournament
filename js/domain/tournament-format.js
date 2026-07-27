/**
 * 大会形式・互換読取（DOM / Firestore 非依存）
 */
import { isAllowedBlockCount } from "./block-configuration.js";

export const TournamentFormat = {
  QUALIFYING_AND_FINALS: "qualifying_and_finals",
  SINGLE_ELIMINATION: "single_elimination",
};

/** 公開 snapshot / UI 向けの形式識別子 */
export const PublicTournamentFormat = {
  LEGACY: "legacy",
  QUALIFYING_AND_FINALS: "qualifying_and_finals",
  SINGLE_ELIMINATION: "single_elimination",
};

/**
 * @param {object|null|undefined} tournament
 */
export function resolvePublicTournamentFormat(tournament) {
  if (tournament?.tournamentFormat === TournamentFormat.SINGLE_ELIMINATION) {
    return PublicTournamentFormat.SINGLE_ELIMINATION;
  }
  if (tournament?.tournamentFormat === TournamentFormat.QUALIFYING_AND_FINALS) {
    return PublicTournamentFormat.QUALIFYING_AND_FINALS;
  }
  return PublicTournamentFormat.LEGACY;
}

/**
 * @param {string} format - PublicTournamentFormat value
 */
export function getPublicFormatLabel(format) {
  if (format === PublicTournamentFormat.SINGLE_ELIMINATION) {
    return "一発トーナメント";
  }
  if (format === PublicTournamentFormat.QUALIFYING_AND_FINALS) {
    return "予選＋決勝";
  }
  return "予選＋決勝（従来形式）";
}

/**
 * @param {string} format - PublicTournamentFormat value
 */
export function isQualifyingPublicFormat(format) {
  return (
    format === PublicTournamentFormat.LEGACY ||
    format === PublicTournamentFormat.QUALIFYING_AND_FINALS
  );
}

/** 旧形式の既定決勝枠数（constants.js の DEFAULT_FINAL_TEAM_COUNT と同値） */
const LEGACY_DEFAULT_FINAL_TEAM_COUNT = 8;

/**
 * @param {object|null|undefined} tournament
 */
export function resolveTournamentFormat(tournament) {
  if (tournament?.tournamentFormat === TournamentFormat.SINGLE_ELIMINATION) {
    return TournamentFormat.SINGLE_ELIMINATION;
  }
  return TournamentFormat.QUALIFYING_AND_FINALS;
}

/**
 * @param {object|null|undefined} tournament
 * @param {number} preferredBlockSize
 * @param {number} teamCount
 */
function calculateLegacyBlockCount(preferredBlockSize, teamCount) {
  if (!Number.isInteger(teamCount) || teamCount <= 0) {
    return null;
  }
  if (!Number.isInteger(preferredBlockSize) || preferredBlockSize < 2) {
    return null;
  }
  return Math.max(1, Math.ceil(teamCount / preferredBlockSize));
}

/**
 * @param {{ tournament?: object|null, blockDraw?: object|null, teamCount?: number|null }} params
 * @returns {number|null}
 */
export function resolveBlockCount({ tournament = null, blockDraw = null, teamCount = null } = {}) {
  if (isAllowedBlockCount(tournament?.blockCount)) {
    return tournament.blockCount;
  }

  const drawBlockCount = blockDraw?.blockCount;
  if (Number.isInteger(drawBlockCount) && drawBlockCount >= 1) {
    return drawBlockCount;
  }

  if (teamCount != null) {
    return calculateLegacyBlockCount(tournament?.preferredBlockSize, teamCount);
  }

  return null;
}

/**
 * @param {object|null|undefined} tournament
 * @returns {1|2|null}
 */
export function resolveQualifiersPerBlock(tournament) {
  const value = tournament?.qualifiersPerBlock;
  if (value === 1 || value === 2) {
    return value;
  }
  return null;
}

/**
 * @param {{ tournament?: object|null, blockDraw?: object|null, teamCount?: number|null }} params
 * @returns {number|null}
 */
export function resolveFinalQualifierCount({ tournament = null, blockDraw = null, teamCount = null } = {}) {
  const qualifiersPerBlock = resolveQualifiersPerBlock(tournament);
  if (qualifiersPerBlock == null) {
    return LEGACY_DEFAULT_FINAL_TEAM_COUNT;
  }

  const blockCount = resolveBlockCount({ tournament, blockDraw, teamCount });
  if (blockCount == null) {
    return null;
  }

  return blockCount * qualifiersPerBlock;
}

/**
 * @param {object|null|undefined} tournament
 */
export function usesLegacyFinalsAdvancement(tournament) {
  return resolveQualifiersPerBlock(tournament) == null;
}

/**
 * @param {object|null|undefined} tournament
 */
export function usesNewFixedBlockDraw(tournament) {
  return tournament?.tournamentFormat === TournamentFormat.QUALIFYING_AND_FINALS;
}
