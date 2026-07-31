/**
 * 複数チーム試合の次ラウンド進行（表示時解決・非破壊）
 */
import { MatchFormat } from "./aggregate-match-format.js";

/**
 * @param {object|null|undefined} team
 * @param {object|null|undefined} fromParticipant
 */
function toParticipant(team, fromParticipant = null) {
  const entryId = team?.entryId || team;
  if (typeof entryId !== "string" || !entryId) {
    return null;
  }
  return {
    entryId,
    teamName: team?.teamName ?? fromParticipant?.teamName ?? "—",
    seed: team?.seed ?? fromParticipant?.seed ?? null,
    isBye: false,
  };
}

/**
 * 試合結果の進出者を次試合スロットへ反映した新しい matches 配列を返す（非破壊）
 * @param {object} params
 */
export function applyMultiTeamMatchAdvancement({
  bracket,
  match,
  result,
  entryMap = {},
} = {}) {
  if (!bracket || !Array.isArray(bracket.matches) || !match?.matchId) {
    return { matches: bracket?.matches || [], changedMatchIds: [] };
  }

  const qualifierIds = result?.qualifierEntryIds || [];
  if (!Array.isArray(qualifierIds) || qualifierIds.length === 0) {
    return { matches: bracket.matches, changedMatchIds: [] };
  }

  if (!match.nextMatchId || match.nextSlotStart == null) {
    return { matches: bracket.matches, changedMatchIds: [] };
  }

  const getEntry = (id) => {
    if (entryMap instanceof Map) return entryMap.get(id);
    return entryMap[id];
  };

  const sourceParticipants = match.participants || [];
  const qualifiers = qualifierIds
    .map((id) => {
      const fromMatch = sourceParticipants.find((p) => p.entryId === id);
      const fromMap = getEntry(id);
      return toParticipant(fromMap || fromMatch || { entryId: id }, fromMatch);
    })
    .filter(Boolean);

  const matches = bracket.matches.map((m) => ({
    ...m,
    participants: (m.participants || []).map((p) => ({ ...p })),
    participantEntryIds: [...(m.participantEntryIds || [])],
  }));

  const next = matches.find((m) => m.matchId === match.nextMatchId);
  if (!next) {
    return { matches: bracket.matches, changedMatchIds: [] };
  }

  const start = Number(match.nextSlotStart);
  const span = Number(match.nextQualifierSpan || match.qualifiersCount || qualifiers.length);
  for (let i = 0; i < Math.min(span, qualifiers.length); i += 1) {
    const slot = start + i;
    if (slot < 0 || slot >= next.participants.length) continue;
    const already = next.participants.some(
      (p, idx) => idx !== slot && p.entryId === qualifiers[i].entryId
    );
    if (already) continue;
    next.participants[slot] = qualifiers[i];
  }

  next.participantEntryIds = next.participants.map((p) => p.entryId).filter(Boolean);
  const filled = next.participants.every((p) => typeof p.entryId === "string" && p.entryId);
  if (filled) {
    next.status = next.status === "completed" ? next.status : "ready";
  }

  return { matches, changedMatchIds: [next.matchId] };
}

/**
 * ブラケット＋結果から試合参加者を解決（H2H の resolveFinalsMatchTeams 相当）
 * @param {object} params
 */
export function resolveMultiTeamMatchParticipants({ match, bracket, resultsMap } = {}) {
  const base = (match?.participants || []).map((p) => ({ ...p }));
  if (base.length === 0) {
    return [];
  }
  if (base.every((p) => typeof p.entryId === "string" && p.entryId)) {
    return base;
  }

  const getResult = (matchId) => {
    if (!resultsMap) return null;
    if (resultsMap instanceof Map) return resultsMap.get(matchId);
    return resultsMap[matchId];
  };

  const feeders = (bracket?.matches || []).filter((m) => m.nextMatchId === match.matchId);
  for (const feeder of feeders) {
    const result = getResult(feeder.matchId);
    if (!result?.qualifierEntryIds?.length) continue;
    const start = Number(feeder.nextSlotStart ?? 0);
    const span = Number(
      feeder.nextQualifierSpan || feeder.qualifiersCount || result.qualifierEntryIds.length
    );
    const feederParticipants = resolveMultiTeamMatchParticipants({
      match: feeder,
      bracket,
      resultsMap,
    });
    for (let i = 0; i < Math.min(span, result.qualifierEntryIds.length); i += 1) {
      const slot = start + i;
      if (slot < 0 || slot >= base.length) continue;
      if (base[slot]?.entryId) continue;
      const entryId = result.qualifierEntryIds[i];
      const from = feederParticipants.find((p) => p.entryId === entryId);
      base[slot] = toParticipant(from || { entryId }, from);
    }
  }

  return base;
}

/**
 * @param {object} match
 * @param {object|null} [bracket]
 * @param {Map|Record|null} [resultsMap]
 */
export function isMultiTeamMatchReady(match, bracket = null, resultsMap = null) {
  const parts =
    bracket && resultsMap
      ? resolveMultiTeamMatchParticipants({ match, bracket, resultsMap })
      : match?.participants || [];
  if (parts.length < 2) return false;
  return parts.every((p) => typeof p.entryId === "string" && p.entryId);
}
