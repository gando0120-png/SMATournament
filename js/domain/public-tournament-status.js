/**
 * 公開大会の進行ステータス（形式別）
 */
import {
  PublicTournamentProgressStatusLabels,
  PublicTournamentStatusLabels,
  TournamentStatus,
} from "./constants.js";
import {
  PublicTournamentFormat,
  isQualifyingPublicFormat,
  resolvePublicTournamentFormat,
} from "./tournament-format.js";

/**
 * @param {object|null|undefined} tournament
 * @param {object} [context]
 */
export function resolvePublicProgressStatusLabel(tournament, context = {}) {
  const {
    blockDraw = null,
    schedule = null,
    finalsAdvancement = null,
    finalsBracket = null,
    tournamentResults = null,
  } = context;

  const status = tournament?.status;
  const format = resolvePublicTournamentFormat(tournament);

  if (status === TournamentStatus.CLOSED || tournamentResults?.finalized) {
    return PublicTournamentStatusLabels[TournamentStatus.CLOSED];
  }

  if (status === TournamentStatus.DRAFT) {
    return PublicTournamentStatusLabels[TournamentStatus.DRAFT];
  }

  if (status === TournamentStatus.ARCHIVED) {
    return PublicTournamentStatusLabels[TournamentStatus.ARCHIVED];
  }

  if (format === PublicTournamentFormat.SINGLE_ELIMINATION) {
    if (!finalsBracket?.finalized) {
      return PublicTournamentProgressStatusLabels.tournamentPreparing;
    }
    return PublicTournamentProgressStatusLabels.tournamentInProgress;
  }

  if (finalsBracket?.finalized) {
    return PublicTournamentProgressStatusLabels.tournamentInProgress;
  }

  if (finalsAdvancement?.finalized) {
    return PublicTournamentProgressStatusLabels.advancementConfirmed;
  }

  if (schedule?.finalized || blockDraw?.blocks?.length) {
    return PublicTournamentProgressStatusLabels.qualifyingInProgress;
  }

  if (status === TournamentStatus.OPEN) {
    return PublicTournamentStatusLabels[TournamentStatus.OPEN];
  }

  return PublicTournamentStatusLabels[status] ?? status ?? "—";
}

/**
 * @param {string} format
 */
export function shouldShowQualifyingPublicSections(format) {
  return isQualifyingPublicFormat(format);
}

/**
 * @param {string} format
 */
export function shouldShowAdvancementPublicSection(format) {
  return isQualifyingPublicFormat(format);
}

/**
 * @param {string} format
 */
export function shouldShowSeedInPublicBracket(format) {
  return format === PublicTournamentFormat.LEGACY;
}

/**
 * @param {string} format
 */
export function getPublicBracketTitle(format) {
  if (format === PublicTournamentFormat.SINGLE_ELIMINATION) {
    return "一発トーナメント";
  }
  return "決勝トーナメント";
}
