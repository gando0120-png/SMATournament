/**
 * loss_band 公開表示用セクション構築（内部 state / 管理情報は含めない）
 */
import { RankingMode, LossBandMatchPurpose } from "./constants.js";
import {
  formatLossBandTournamentStatusLabel,
  resolveMainRankingMode,
} from "./config.js";
import { formatLossBandPlacementLabel } from "./placements.js";
import {
  LossBandRoundStatus,
  LossBandTournamentStatus,
  pairingsFromRoundDoc,
} from "./persistence.js";
import { groupPlacementsByLabel } from "../tournament-results.js";
import { BracketKind } from "../bracket-collections.js";

function isHighlightedEntry(entryId, highlightEntryId) {
  return Boolean(entryId && highlightEntryId && entryId === highlightEntryId);
}

/**
 * @param {number|null|undefined} lossCount
 */
export function formatLossBandBandLabel(lossCount) {
  if (!Number.isInteger(lossCount) || lossCount < 0) {
    return "敗戦帯";
  }
  return `${lossCount}敗帯`;
}

/**
 * @param {object|null|undefined} roundDoc
 */
export function formatLossBandPublicRoundLabel(roundDoc) {
  if (!roundDoc) return "—";
  const purpose = roundDoc.matchPurpose;
  if (purpose === LossBandMatchPurpose.FINAL || roundDoc.roundId === "final") {
    return "決勝";
  }
  if (
    purpose === LossBandMatchPurpose.THIRD_PLACE ||
    roundDoc.roundId === "third_place"
  ) {
    return "3位決定戦";
  }
  const n = roundDoc.roundNumber;
  if (Number.isInteger(n) && n >= 1 && n <= 5) {
    return `R${n}`;
  }
  return roundDoc.roundId ? String(roundDoc.roundId).toUpperCase() : "—";
}

/**
 * @param {Map<string, object>|null|undefined} resultsMap
 * @param {string} matchId
 */
function resultForMatch(resultsMap, matchId) {
  if (!resultsMap) return null;
  if (resultsMap instanceof Map) {
    return resultsMap.get(matchId) ?? null;
  }
  return resultsMap[matchId] ?? null;
}

/**
 * @param {string} entryId
 * @param {Map<string, string>|Record<string, string>|null} teamNameByEntryId
 * @param {string|null} highlightEntryId
 */
function publicTeam(entryId, teamNameByEntryId, highlightEntryId) {
  if (!entryId) {
    return { entryId: null, teamName: "—", highlighted: false };
  }
  let teamName = entryId;
  if (teamNameByEntryId instanceof Map) {
    teamName = teamNameByEntryId.get(entryId) ?? entryId;
  } else if (teamNameByEntryId && typeof teamNameByEntryId === "object") {
    teamName = teamNameByEntryId[entryId] ?? entryId;
  }
  return {
    entryId,
    teamName,
    highlighted: isHighlightedEntry(entryId, highlightEntryId),
  };
}

/**
 * @param {object} roundDoc
 * @param {Map<string, object>|null} resultsMap
 * @param {Map<string, string>|Record<string, string>|null} teamNameByEntryId
 * @param {string|null} highlightEntryId
 */
function buildPublicRound(roundDoc, resultsMap, teamNameByEntryId, highlightEntryId) {
  const pairings = pairingsFromRoundDoc(roundDoc);
  const purpose = roundDoc.matchPurpose ?? LossBandMatchPurpose.RANKING;
  const isSpecial =
    purpose === LossBandMatchPurpose.FINAL ||
    purpose === LossBandMatchPurpose.THIRD_PLACE;

  /** @type {Map<number, object[]>} */
  const bandsMap = new Map();

  for (const match of pairings.matches ?? []) {
    const result = resultForMatch(resultsMap, match.matchId);
    const completed = Boolean(
      result?.winner?.entryId || result?.status === "finished"
    );
    const lossCount = isSpecial ? null : (match.lossCount ?? 0);
    const bandKey = isSpecial ? -1 : lossCount;
    if (!bandsMap.has(bandKey)) {
      bandsMap.set(bandKey, []);
    }
    bandsMap.get(bandKey).push({
      matchId: match.matchId,
      lossCount: match.lossCount ?? null,
      team1: publicTeam(match.team1EntryId, teamNameByEntryId, highlightEntryId),
      team2: publicTeam(match.team2EntryId, teamNameByEntryId, highlightEntryId),
      status: completed ? "completed" : "open",
      winnerEntryId: result?.winner?.entryId ?? null,
      winner: result?.winner?.entryId
        ? publicTeam(result.winner.entryId, teamNameByEntryId, highlightEntryId)
        : null,
    });
  }

  const bandKeys = [...bandsMap.keys()].sort((a, b) => a - b);
  const bands = bandKeys.map((key) => {
    const matches = bandsMap.get(key) ?? [];
    const lossCount = key < 0 ? null : key;
    return {
      lossCount,
      label:
        lossCount == null
          ? formatLossBandPublicRoundLabel(roundDoc)
          : formatLossBandBandLabel(lossCount),
      matchCount: matches.length,
      completedCount: matches.filter((m) => m.status === "completed").length,
      matches,
    };
  });

  const allMatches = bands.flatMap((b) => b.matches);
  const completedCount = allMatches.filter((m) => m.status === "completed").length;

  return {
    roundId: roundDoc.roundId ?? roundDoc.id ?? null,
    roundNumber: roundDoc.roundNumber ?? null,
    roundLabel: formatLossBandPublicRoundLabel(roundDoc),
    matchPurpose: purpose,
    status: roundDoc.status ?? LossBandRoundStatus.OPEN,
    rematchAvoidance: roundDoc.rematchAvoidance === true,
    rematchCount: roundDoc.rematchCount ?? 0,
    matchCount: allMatches.length,
    completedCount,
    complete: roundDoc.status === LossBandRoundStatus.COMPLETE,
    bands,
  };
}

/**
 * @param {object|null|undefined} placementsDoc
 * @param {Map<string, string>|Record<string, string>|null} teamNameByEntryId
 * @param {string|null} highlightEntryId
 */
function buildPublicPlacements(placementsDoc, teamNameByEntryId, highlightEntryId) {
  const rows = Array.isArray(placementsDoc?.placements)
    ? placementsDoc.placements
    : [];
  if (rows.length === 0) {
    return {
      ready: false,
      placements: [],
      placementGroups: [],
      champion: null,
      runnerUp: null,
    };
  }

  const placements = rows
    .filter((row) => row?.entryId && Number.isInteger(row.placement))
    .map((row) => {
      const isTied = row.isTied === true || (row.tiedCount ?? 1) > 1;
      const team = publicTeam(row.entryId, teamNameByEntryId, highlightEntryId);
      return {
        entryId: row.entryId,
        teamName: team.teamName,
        placement: row.placement,
        placementLabel: formatLossBandPlacementLabel(row.placement, isTied),
        isTied,
        tiedCount: row.tiedCount ?? (isTied ? 2 : 1),
        lossCount: row.lossCount ?? null,
        highlighted: team.highlighted,
      };
    })
    .sort((a, b) => {
      if (a.placement !== b.placement) return a.placement - b.placement;
      return String(a.entryId).localeCompare(String(b.entryId), "en");
    });

  const placementGroups = groupPlacementsByLabel(placements, {
    bracketKind: BracketKind.MAIN,
  }).map((group) => ({
    ...group,
    items: group.items.map((item) => ({
      ...item,
      highlighted: isHighlightedEntry(item.entryId, highlightEntryId),
    })),
  }));

  const championRow = placements.find((p) => p.placement === 1) ?? null;
  const runnerUpRow = placements.find((p) => p.placement === 2) ?? null;

  return {
    ready: true,
    placements,
    placementGroups,
    champion: championRow
      ? {
          entryId: championRow.entryId,
          teamName: championRow.teamName,
          highlighted: championRow.highlighted,
        }
      : null,
    runnerUp: runnerUpRow
      ? {
          entryId: runnerUpRow.entryId,
          teamName: runnerUpRow.teamName,
          highlighted: runnerUpRow.highlighted,
        }
      : null,
  };
}

/**
 * @param {object[]} exchangeRounds
 * @param {Map<string, object>|null} resultsMap
 * @param {Map<string, string>|Record<string, string>|null} teamNameByEntryId
 * @param {string|null} highlightEntryId
 */
function buildPublicExchange(
  exchangeRounds,
  resultsMap,
  teamNameByEntryId,
  highlightEntryId
) {
  const rounds = (exchangeRounds ?? [])
    .slice()
    .sort(
      (a, b) => (a.exchangeRoundNumber ?? 0) - (b.exchangeRoundNumber ?? 0)
    )
    .map((roundDoc) => {
      const pairs = roundDoc.pairs ?? [];
      const matches = pairs.map((pair) => {
        const result = resultForMatch(resultsMap, pair.matchId);
        const completed = Boolean(
          result?.winner?.entryId || result?.status === "finished"
        );
        return {
          matchId: pair.matchId,
          team1: publicTeam(pair.team1EntryId, teamNameByEntryId, highlightEntryId),
          team2: publicTeam(pair.team2EntryId, teamNameByEntryId, highlightEntryId),
          status: completed ? "completed" : "open",
          winnerEntryId: result?.winner?.entryId ?? null,
          sitOutEntryId: roundDoc.sitOutEntryId ?? null,
        };
      });
      return {
        roundId: roundDoc.roundId ?? roundDoc.id ?? null,
        exchangeRoundNumber: roundDoc.exchangeRoundNumber ?? null,
        roundLabel: `交流戦 ${roundDoc.exchangeRoundNumber ?? ""}`.trim(),
        status: roundDoc.status ?? LossBandRoundStatus.OPEN,
        sitOutEntryId: roundDoc.sitOutEntryId ?? null,
        sitOut: roundDoc.sitOutEntryId
          ? publicTeam(roundDoc.sitOutEntryId, teamNameByEntryId, highlightEntryId)
          : null,
        matchCount: matches.length,
        completedCount: matches.filter((m) => m.status === "completed").length,
        complete: roundDoc.status === LossBandRoundStatus.COMPLETE,
        matches,
      };
    });

  return {
    visible: rounds.length > 0,
    ready: rounds.length > 0,
    note: "交流戦は順位には影響しません",
    rounds,
  };
}

/**
 * 公開用 loss_band セクション
 * @param {{
 *   tournament?: object|null,
 *   lossBandState?: object|null,
 *   lossBandRounds?: object[],
 *   lossBandResultsMap?: Map<string, object>|null,
 *   lossBandPlacements?: object|null,
 *   lossBandExchangeRounds?: object[],
 *   lossBandExchangeResultsMap?: Map<string, object>|null,
 *   teamNameByEntryId?: Map<string, string>|Record<string, string>|null,
 *   highlightEntryId?: string|null
 * }} params
 */
export function buildLossBandPublicSection(params = {}) {
  const {
    tournament = null,
    lossBandState = null,
    lossBandRounds = [],
    lossBandResultsMap = null,
    lossBandPlacements = null,
    lossBandExchangeRounds = [],
    lossBandExchangeResultsMap = null,
    teamNameByEntryId = null,
    highlightEntryId = null,
  } = params;

  if (resolveMainRankingMode(tournament) !== RankingMode.LOSS_BAND) {
    return {
      visible: false,
      ready: false,
      rankingMode: null,
      emptyMessage: null,
      status: null,
      statusLabel: null,
      currentRound: null,
      rounds: [],
      placements: { ready: false, placements: [], placementGroups: [] },
      exchange: { visible: false, ready: false, rounds: [] },
    };
  }

  if (!lossBandState) {
    return {
      visible: true,
      ready: false,
      rankingMode: RankingMode.LOSS_BAND,
      emptyMessage: "順位決定方式の対戦表はまだ作成されていません",
      status: null,
      statusLabel: "未開始",
      hint: "同じ敗戦数のチーム同士で対戦します",
      currentRound: null,
      rematchAvoidance: false,
      thirdPlaceMatch: false,
      exchangeMatches: false,
      rounds: [],
      placements: { ready: false, placements: [], placementGroups: [] },
      exchange: { visible: false, ready: false, rounds: [] },
    };
  }

  const rounds = (lossBandRounds ?? [])
    .slice()
    .sort((a, b) => (a.roundNumber ?? 0) - (b.roundNumber ?? 0))
    .map((roundDoc) =>
      buildPublicRound(
        roundDoc,
        lossBandResultsMap,
        teamNameByEntryId,
        highlightEntryId
      )
    );

  const placements = buildPublicPlacements(
    lossBandPlacements,
    teamNameByEntryId,
    highlightEntryId
  );

  const exchange = buildPublicExchange(
    lossBandExchangeRounds,
    lossBandExchangeResultsMap,
    teamNameByEntryId,
    highlightEntryId
  );

  const status = lossBandState.status ?? LossBandTournamentStatus.ACTIVE;
  const showHint =
    status === LossBandTournamentStatus.ACTIVE ||
    status === LossBandTournamentStatus.FINALS_PENDING;

  return {
    visible: true,
    ready: true,
    rankingMode: RankingMode.LOSS_BAND,
    emptyMessage: null,
    status,
    statusLabel: formatLossBandTournamentStatusLabel(status),
    hint: showHint ? "同じ敗戦数のチーム同士で対戦します" : null,
    currentRound: lossBandState.currentRound ?? null,
    currentRoundId: lossBandState.currentRoundId ?? null,
    rematchAvoidance: lossBandState.rematchAvoidance === true,
    thirdPlaceMatch: lossBandState.thirdPlaceMatch === true,
    exchangeMatches: lossBandState.exchangeMatches === true,
    completedRankingRound: lossBandState.completedRankingRound ?? 0,
    rounds,
    placements,
    exchange,
  };
}
