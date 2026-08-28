/**
 * 組み合わせ帳票 ViewModel（DOM / Firestore 非依存）
 *
 * 既存の抽選データ → 提出用レイアウト用の純データ。
 * 順位表・結果・スケジュール・時刻は含めない。
 */
import { isBlockDrawFinalized } from "./block-draw-state.js";
import { sortBlocksByBlockId } from "./block-order.js";
import {
  buildEntryTeamNameLookup,
  resolveLiveTeamName,
} from "./entry-team-name-overlay.js";
import { groupBracketMatchesByRound } from "./finals-bracket-display.js";
import { isByeTeam, isPendingTeam } from "./finals-match-bye.js";
import { isMultiTeamBracket } from "./multi-team-bracket.js";
import {
  hasCreatedSingleEliminationBracket,
  isSingleEliminationBracket,
} from "./single-elimination-bracket.js";
import { resolveTournamentFormat } from "./tournament-format.js";

export const COMBINATION_SHEET_SCHEMA_VERSION = 1;

export const CombinationSheetType = {
  QUALIFYING_BLOCKS: "qualifying_blocks",
  SINGLE_ELIMINATION_BRACKET: "single_elimination_bracket",
};

export const CombinationSheetUrlType = {
  QUALIFYING: "qualifying",
  SINGLE_ELIMINATION: "single-elimination",
};

export const CombinationSheetErrorCode = {
  TOURNAMENT_INVALID: "combination-sheet/tournament-invalid",
  BLOCK_DRAW_NOT_FINALIZED: "combination-sheet/block-draw-not-finalized",
  BLOCK_DRAW_INVALID: "combination-sheet/block-draw-invalid",
  BRACKET_NOT_CREATED: "combination-sheet/bracket-not-created",
  BRACKET_UNSUPPORTED: "combination-sheet/bracket-unsupported",
  BRACKET_INVALID: "combination-sheet/bracket-invalid",
};

export const CombinationSheetPageSize = {
  A4: "A4",
};

export const CombinationSheetOrientation = {
  PORTRAIT: "portrait",
  LANDSCAPE: "landscape",
};

export const CombinationSheetLayout = {
  BLOCKS: "blocks",
  BRACKET: "bracket",
  ROUND_LIST: "round-list",
};

/** 予選ブロック帳票: 1ページあたりのブロック数（2列×2行） */
export const QUALIFYING_BLOCKS_PER_PAGE = 4;

/** 一発TN帳票: 1ページに載せる試合数の上限（読みやすさ優先） */
export const SINGLE_ELIMINATION_MATCHES_PER_PAGE = 8;

const MISSING_TEAM_NAME = "（名称未設定）";
const BYE_DISPLAY_NAME = "BYE";
const PENDING_DISPLAY_NAME = "未定";

/**
 * @param {unknown} value
 * @returns {"qualifying"|"single-elimination"|null}
 */
export function parseCombinationSheetUrlType(value) {
  if (value === CombinationSheetUrlType.QUALIFYING) {
    return CombinationSheetUrlType.QUALIFYING;
  }
  if (value === CombinationSheetUrlType.SINGLE_ELIMINATION) {
    return CombinationSheetUrlType.SINGLE_ELIMINATION;
  }
  return null;
}

/**
 * @param {object|null|undefined} blockDraw
 */
export function canBuildQualifyingBlocksCombinationSheet(blockDraw) {
  return isBlockDrawFinalized(blockDraw);
}

/**
 * @param {object|null|undefined} bracket
 */
export function canBuildSingleEliminationCombinationSheet(bracket) {
  return hasCreatedSingleEliminationBracket(bracket) && !isMultiTeamBracket(bracket);
}

/**
 * @param {unknown} eventDate
 * @returns {string}
 */
export function formatCombinationSheetEventDate(eventDate) {
  if (typeof eventDate !== "string") {
    return "—";
  }
  const trimmed = eventDate.trim();
  if (!trimmed) {
    return "—";
  }
  const iso = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    if (
      Number.isInteger(year) &&
      Number.isInteger(month) &&
      Number.isInteger(day) &&
      month >= 1 &&
      month <= 12 &&
      day >= 1 &&
      day <= 31
    ) {
      return `${year}年${month}月${day}日`;
    }
  }
  return trimmed;
}

/**
 * @param {object|null|undefined} tournament
 */
export function buildCombinationSheetTournament(tournament) {
  const name =
    typeof tournament?.name === "string" && tournament.name.trim()
      ? tournament.name.trim()
      : "（名称未設定）";
  const eventDate =
    typeof tournament?.eventDate === "string" && tournament.eventDate.trim()
      ? tournament.eventDate.trim()
      : "";
  const venue =
    typeof tournament?.venue === "string" && tournament.venue.trim()
      ? tournament.venue.trim()
      : "—";

  return {
    id: typeof tournament?.id === "string" ? tournament.id : null,
    name,
    eventDate: eventDate || null,
    eventDateLabel: formatCombinationSheetEventDate(eventDate || null),
    venue,
    format: resolveTournamentFormat(tournament),
  };
}

/**
 * @param {number} bracketSize
 * @returns {"portrait"|"landscape"}
 */
export function resolveSingleEliminationSheetOrientation(bracketSize) {
  if (Number.isInteger(bracketSize) && bracketSize >= 16) {
    return CombinationSheetOrientation.LANDSCAPE;
  }
  return CombinationSheetOrientation.PORTRAIT;
}

/**
 * @param {{ code: string, message: string }} error
 */
function fail(error) {
  return {
    ok: false,
    code: error.code,
    message: error.message,
    sheet: null,
  };
}

/**
 * @param {object} sheet
 */
function ok(sheet) {
  return {
    ok: true,
    code: null,
    message: null,
    sheet,
  };
}

/**
 * @param {unknown} tournament
 */
function requireTournament(tournament) {
  if (!tournament || typeof tournament !== "object") {
    return fail({
      code: CombinationSheetErrorCode.TOURNAMENT_INVALID,
      message: "大会データが不正です。",
    });
  }
  return null;
}

/**
 * @param {unknown} entryId
 * @param {Map<string, string>} nameLookup
 * @param {string|null|undefined} fallback
 */
function resolveSheetTeamName(entryId, nameLookup, fallback) {
  const live = resolveLiveTeamName(
    typeof entryId === "string" ? entryId : null,
    typeof fallback === "string" && fallback.trim() ? fallback.trim() : null,
    nameLookup
  );
  if (!live || live === "—") {
    return MISSING_TEAM_NAME;
  }
  return live;
}

/**
 * @param {object} tournament
 * @param {string} title
 * @param {object} summaryExtra
 * @param {"portrait"|"landscape"} orientation
 */
function buildSheetBase(tournament, title, summaryExtra, orientation) {
  return {
    schemaVersion: COMBINATION_SHEET_SCHEMA_VERSION,
    tournament: buildCombinationSheetTournament(tournament),
    summary: {
      title,
      ...summaryExtra,
    },
    page: {
      pageSize: CombinationSheetPageSize.A4,
      orientation,
    },
  };
}

/**
 * @param {object[]} items
 * @param {number} size
 */
function chunkItems(items, size) {
  if (!Array.isArray(items) || items.length === 0) {
    return [[]];
  }
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

/**
 * 予選ブロック抽選結果の帳票 ViewModel
 * @param {{ tournament?: object|null, blockDraw?: object|null, entries?: Iterable<object>|null }} params
 */
export function buildQualifyingBlocksCombinationSheet({
  tournament = null,
  blockDraw = null,
  entries = null,
} = {}) {
  const tournamentError = requireTournament(tournament);
  if (tournamentError) {
    return tournamentError;
  }

  if (!canBuildQualifyingBlocksCombinationSheet(blockDraw)) {
    return fail({
      code: CombinationSheetErrorCode.BLOCK_DRAW_NOT_FINALIZED,
      message: "組み合わせがまだ確定していません。",
    });
  }

  if (!Array.isArray(blockDraw.blocks)) {
    return fail({
      code: CombinationSheetErrorCode.BLOCK_DRAW_INVALID,
      message: "ブロック抽選データが不正です。",
    });
  }

  const nameLookup = buildEntryTeamNameLookup(entries);
  const sortedBlocks = sortBlocksByBlockId(blockDraw.blocks, "id");
  const blocks = [];

  for (const block of sortedBlocks) {
    if (!block || typeof block !== "object") {
      continue;
    }
    const blockId = String(block.id ?? block.blockId ?? "").trim();
    const labelRaw = block.name ?? block.blockName;
    const label =
      typeof labelRaw === "string" && labelRaw.trim()
        ? labelRaw.trim()
        : blockId
          ? `${blockId}ブロック`
          : "ブロック";
    const entryIds = Array.isArray(block.entryIds) ? block.entryIds : [];
    const teams = [];

    for (const entryId of entryIds) {
      if (typeof entryId !== "string" || !entryId) {
        continue;
      }
      teams.push({
        position: teams.length + 1,
        entryId,
        name: resolveSheetTeamName(entryId, nameLookup, null),
      });
    }

    blocks.push({
      blockId: blockId || null,
      label,
      teams,
    });
  }

  if (blocks.length === 0) {
    return fail({
      code: CombinationSheetErrorCode.BLOCK_DRAW_INVALID,
      message: "ブロック抽選データが不正です。",
    });
  }

  const teamCount = blocks.reduce((sum, block) => sum + block.teams.length, 0);
  const blockChunks = chunkItems(blocks, QUALIFYING_BLOCKS_PER_PAGE);
  const pageCount = blockChunks.length;
  const pages = blockChunks.map((pageBlocks, index) => ({
    pageNumber: index + 1,
    pageCount,
    isContinuation: index > 0,
    heading: index > 0 ? "予選組み合わせ（続き）" : null,
    layout: CombinationSheetLayout.BLOCKS,
    blocks: pageBlocks,
    rounds: null,
  }));

  return ok({
    ...buildSheetBase(
      tournament,
      "予選組み合わせ",
      {
        teamCount,
        blockCount: blocks.length,
      },
      CombinationSheetOrientation.PORTRAIT
    ),
    type: CombinationSheetType.QUALIFYING_BLOCKS,
    blocks,
    pages,
  });
}

/**
 * @param {object|null|undefined} team
 * @param {Map<string, string>} nameLookup
 * @param {{ forcePending?: boolean }} [options]
 */
function toSheetTeam(team, nameLookup, options = {}) {
  if (options.forcePending || isPendingTeam(team)) {
    return {
      entryId: null,
      name: null,
      displayName: PENDING_DISPLAY_NAME,
      isBye: false,
      isPending: true,
    };
  }

  if (isByeTeam(team)) {
    return {
      entryId: null,
      name: null,
      displayName: BYE_DISPLAY_NAME,
      isBye: true,
      isPending: false,
    };
  }

  const entryId = typeof team?.entryId === "string" && team.entryId ? team.entryId : null;
  const fallback = typeof team?.teamName === "string" ? team.teamName : null;
  return {
    entryId,
    name: resolveSheetTeamName(entryId, nameLookup, fallback),
    displayName: resolveSheetTeamName(entryId, nameLookup, fallback),
    isBye: false,
    isPending: false,
  };
}

/**
 * @param {object} match
 * @param {Map<string, string>} nameLookup
 * @param {boolean} isFirstRound
 */
function toSheetMatch(match, nameLookup, isFirstRound) {
  return {
    matchId: typeof match.matchId === "string" ? match.matchId : null,
    matchNumber: Number.isInteger(match.matchNumber) ? match.matchNumber : null,
    nextMatchId: typeof match.nextMatchId === "string" ? match.nextMatchId : null,
    nextTeamSlot:
      match.nextTeamSlot === "team1" || match.nextTeamSlot === "team2"
        ? match.nextTeamSlot
        : null,
    team1: toSheetTeam(match.team1, nameLookup, { forcePending: !isFirstRound }),
    team2: toSheetTeam(match.team2, nameLookup, { forcePending: !isFirstRound }),
  };
}

/**
 * @param {object[]} rounds
 */
function paginateSingleEliminationRounds(rounds) {
  const firstRound = rounds[0] ?? null;
  const firstRoundMatchCount = firstRound?.matches?.length ?? 0;

  if (firstRoundMatchCount <= SINGLE_ELIMINATION_MATCHES_PER_PAGE) {
    return [
      {
        isContinuation: false,
        heading: null,
        layout: CombinationSheetLayout.BRACKET,
        rounds,
      },
    ];
  }

  const rawPages = [];
  for (const round of rounds) {
    const chunks = chunkItems(round.matches, SINGLE_ELIMINATION_MATCHES_PER_PAGE);
    for (const [chunkIndex, matches] of chunks.entries()) {
      rawPages.push({
        roundLabel: round.roundLabel,
        chunkIndex,
        chunkCount: chunks.length,
        matches,
        roundNumber: round.roundNumber,
      });
    }
  }

  const combined = [];
  for (const raw of rawPages) {
    const previous = combined[combined.length - 1];
    const canMerge =
      previous &&
      previous.matches.length + raw.matches.length <= SINGLE_ELIMINATION_MATCHES_PER_PAGE &&
      raw.matches.length < SINGLE_ELIMINATION_MATCHES_PER_PAGE &&
      previous.matches.length < SINGLE_ELIMINATION_MATCHES_PER_PAGE &&
      raw.roundNumber !== 1 &&
      previous.roundNumber !== 1;

    if (canMerge) {
      previous.matches = [
        ...previous.matches.map((match) => ({
          ...match,
          roundNumber: previous.roundNumber,
          roundLabel: previous.roundLabel,
        })),
        ...raw.matches.map((match) => ({
          ...match,
          roundNumber: raw.roundNumber,
          roundLabel: raw.roundLabel,
        })),
      ];
      previous.roundLabels = [...new Set([...(previous.roundLabels ?? [previous.roundLabel]), raw.roundLabel])];
      previous.roundLabel = previous.roundLabels.join(" / ");
      continue;
    }

    combined.push({
      roundNumber: raw.roundNumber,
      roundLabel: raw.roundLabel,
      roundLabels: [raw.roundLabel],
      chunkIndex: raw.chunkIndex,
      matches: raw.matches.map((match) => ({
        ...match,
        roundNumber: raw.roundNumber,
        roundLabel: raw.roundLabel,
      })),
    });
  }

  return combined.map((page, index) => {
    const roundsByNumber = new Map();
    for (const match of page.matches) {
      const roundNumber = match.roundNumber;
      if (!roundsByNumber.has(roundNumber)) {
        roundsByNumber.set(roundNumber, {
          roundNumber,
          roundLabel: match.roundLabel,
          matches: [],
        });
      }
      const { roundNumber: _roundNumber, roundLabel: _roundLabel, ...sheetMatch } = match;
      roundsByNumber.get(roundNumber).matches.push(sheetMatch);
    }

    const headingParts = [...roundsByNumber.values()].map((round) => round.roundLabel);
    return {
      isContinuation: index > 0,
      heading:
        index === 0 && headingParts.length === 1
          ? headingParts[0]
          : headingParts.length === 1
            ? `${headingParts[0]}（続き）`
            : headingParts.join(" / "),
      layout: CombinationSheetLayout.ROUND_LIST,
      rounds: [...roundsByNumber.values()],
    };
  });
}

/**
 * 一発トーナメント初期組み合わせの帳票 ViewModel
 * @param {{ tournament?: object|null, bracket?: object|null, entries?: Iterable<object>|null }} params
 */
export function buildSingleEliminationCombinationSheet({
  tournament = null,
  bracket = null,
  entries = null,
} = {}) {
  const tournamentError = requireTournament(tournament);
  if (tournamentError) {
    return tournamentError;
  }

  if (isMultiTeamBracket(bracket)) {
    return fail({
      code: CombinationSheetErrorCode.BRACKET_UNSUPPORTED,
      message: "この大会形式の組み合わせ帳票には未対応です。",
    });
  }

  if (!isSingleEliminationBracket(bracket) || !hasCreatedSingleEliminationBracket(bracket)) {
    return fail({
      code: CombinationSheetErrorCode.BRACKET_NOT_CREATED,
      message: "組み合わせがまだ確定していません。",
    });
  }

  if (!Array.isArray(bracket.matches) || bracket.matches.length === 0) {
    return fail({
      code: CombinationSheetErrorCode.BRACKET_INVALID,
      message: "トーナメント表データが不正です。",
    });
  }

  const nameLookup = buildEntryTeamNameLookup(entries);
  const groupedRounds = groupBracketMatchesByRound({
    ...bracket,
    matches: [...(bracket.matches ?? [])],
  });
  if (groupedRounds.length === 0) {
    return fail({
      code: CombinationSheetErrorCode.BRACKET_INVALID,
      message: "トーナメント表データが不正です。",
    });
  }

  const rounds = groupedRounds.map((round) => ({
    roundNumber: round.roundNumber,
    roundLabel: round.roundLabel,
    matches: round.matches.map((match) =>
      toSheetMatch(match, nameLookup, round.roundNumber === 1)
    ),
  }));

  const slots = (bracket.slots ?? []).map((slot, index) => {
    const slotNumber = Number.isInteger(slot?.slotNumber) ? slot.slotNumber : index + 1;
    if (slot?.isBye === true) {
      return {
        slotNumber,
        entryId: null,
        name: null,
        displayName: BYE_DISPLAY_NAME,
        isBye: true,
      };
    }
    const entryId = typeof slot?.entryId === "string" && slot.entryId ? slot.entryId : null;
    const fallback = typeof slot?.teamName === "string" ? slot.teamName : null;
    return {
      slotNumber,
      entryId,
      name: resolveSheetTeamName(entryId, nameLookup, fallback),
      displayName: resolveSheetTeamName(entryId, nameLookup, fallback),
      isBye: false,
    };
  });

  const orientation = resolveSingleEliminationSheetOrientation(bracket.bracketSize);
  const rawPages = paginateSingleEliminationRounds(rounds);
  const pageCount = rawPages.length;
  const pages = rawPages.map((page, index) => ({
    pageNumber: index + 1,
    pageCount,
    isContinuation: page.isContinuation,
    heading: page.heading,
    layout: page.layout,
    blocks: null,
    rounds: page.rounds,
  }));

  const teamCount =
    Number.isInteger(bracket.teamCount) && bracket.teamCount > 0
      ? bracket.teamCount
      : slots.filter((slot) => !slot.isBye).length;

  return ok({
    ...buildSheetBase(
      tournament,
      "トーナメント組み合わせ",
      {
        teamCount,
        bracketSize: bracket.bracketSize ?? null,
        byeCount: Number.isInteger(bracket.byeCount)
          ? bracket.byeCount
          : slots.filter((slot) => slot.isBye).length,
      },
      orientation
    ),
    type: CombinationSheetType.SINGLE_ELIMINATION_BRACKET,
    bracket: {
      bracketSize: bracket.bracketSize ?? null,
      teamCount,
      byeCount: Number.isInteger(bracket.byeCount)
        ? bracket.byeCount
        : slots.filter((slot) => slot.isBye).length,
      slots,
      rounds,
    },
    pages,
  });
}
