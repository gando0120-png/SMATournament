/**
 * EmergencyExportV1 source 組み立て・シリアライズ（DOM / Firestore 非依存）
 */
import {
  EMERGENCY_EXPORT_ADVANCEMENT_KEYS,
  EMERGENCY_EXPORT_ALLOWED_COLLECTIONS,
  EMERGENCY_EXPORT_BLOCK_DRAW_KEYS,
  EMERGENCY_EXPORT_BRACKET_KEYS,
  EMERGENCY_EXPORT_ENTRY_KEYS,
  EMERGENCY_EXPORT_EXCLUDED_COLLECTIONS,
  EMERGENCY_EXPORT_FINALS_RESULT_KEYS,
  EMERGENCY_EXPORT_FORBIDDEN_KEYS,
  EMERGENCY_EXPORT_LOSS_BAND_PLACEMENTS_KEYS,
  EMERGENCY_EXPORT_LOSS_BAND_ROUND_KEYS,
  EMERGENCY_EXPORT_LOSS_BAND_STATE_KEYS,
  EMERGENCY_EXPORT_MOLKKY_KEYS,
  EMERGENCY_EXPORT_NOTES_JA,
  EMERGENCY_EXPORT_QUALIFYING_RESULT_KEYS,
  EMERGENCY_EXPORT_RANKING_LOGIC_ID,
  EMERGENCY_EXPORT_RECONCILIATION_KEYS,
  EMERGENCY_EXPORT_SCHEDULE_KEYS,
  EMERGENCY_EXPORT_SCHEMA_VERSION,
  EMERGENCY_EXPORT_SESSION_KEYS,
  EMERGENCY_EXPORT_SOURCE,
  EMERGENCY_EXPORT_SUBMISSION_KEYS,
  EMERGENCY_EXPORT_TEAM_REF_KEYS,
  EMERGENCY_EXPORT_TIME_SCHEDULE_KEYS,
  EMERGENCY_EXPORT_TOURNAMENT_KEYS,
  EMERGENCY_EXPORT_TOURNAMENT_RESULTS_KEYS,
  EMERGENCY_EXPORT_TYPE,
  EmergencyExportPiiPolicy,
} from "./emergency-export-schema.js";
import { buildEmergencyExportDerived } from "./emergency-export-derived.js";
import { buildEmergencyExportIntegrity } from "./emergency-export-integrity.js";

const FORBIDDEN_KEY_SET = new Set(EMERGENCY_EXPORT_FORBIDDEN_KEYS);

/**
 * @param {unknown} value
 */
export function isFirestoreTimestamp(value) {
  if (value == null || typeof value !== "object") {
    return false;
  }
  if (typeof value.toDate === "function") {
    return true;
  }
  if (typeof value.seconds === "number" && "nanoseconds" in value) {
    return true;
  }
  if (typeof value._seconds === "number") {
    return true;
  }
  return false;
}

/**
 * @param {unknown} value
 */
function isDocumentReferenceLike(value) {
  if (value == null || typeof value !== "object") {
    return false;
  }
  const name = value.constructor?.name;
  if (name === "DocumentReference") {
    return true;
  }
  return (
    typeof value.path === "string" &&
    typeof value.id === "string" &&
    value.firestore != null &&
    typeof value.withConverter === "function"
  );
}

/**
 * @param {unknown} value
 * @returns {string|null}
 */
export function serializeTimestamp(value) {
  if (value == null) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  }
  if (typeof value.toDate === "function") {
    try {
      const date = value.toDate();
      if (date instanceof Date && !Number.isNaN(date.getTime())) {
        return date.toISOString();
      }
    } catch {
      // fall through
    }
  }
  const seconds =
    typeof value.seconds === "number"
      ? value.seconds
      : typeof value._seconds === "number"
        ? value._seconds
        : null;
  const nanos =
    typeof value.nanoseconds === "number"
      ? value.nanoseconds
      : typeof value._nanoseconds === "number"
        ? value._nanoseconds
        : 0;
  if (seconds == null) {
    return null;
  }
  return new Date(seconds * 1000 + Math.floor(nanos / 1e6)).toISOString();
}

/**
 * @param {unknown} value
 * @returns {unknown}
 */
export function serializeJsonValue(value) {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (value instanceof Date || isFirestoreTimestamp(value)) {
    return serializeTimestamp(value);
  }
  if (isDocumentReferenceLike(value)) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => serializeJsonValue(item))
      .filter((item) => item !== undefined);
  }
  if (value instanceof Map) {
    const object = {};
    for (const [key, nested] of value.entries()) {
      if (FORBIDDEN_KEY_SET.has(String(key))) {
        continue;
      }
      const serialized = serializeJsonValue(nested);
      if (serialized !== undefined) {
        object[String(key)] = serialized;
      }
    }
    return object;
  }
  if (typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      if (isFirestoreTimestamp(value)) {
        return serializeTimestamp(value);
      }
      if (isDocumentReferenceLike(value)) {
        return undefined;
      }
    }
    const object = {};
    for (const [key, nested] of Object.entries(value)) {
      if (FORBIDDEN_KEY_SET.has(key)) {
        continue;
      }
      const serialized = serializeJsonValue(nested);
      if (serialized !== undefined) {
        object[key] = serialized;
      }
    }
    return object;
  }
  return undefined;
}

/**
 * @param {object|null|undefined} value
 * @param {readonly string[]} keys
 */
export function pickAllowedFields(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const picked = {};
  for (const key of keys) {
    if (FORBIDDEN_KEY_SET.has(key)) {
      continue;
    }
    if (value[key] === undefined) {
      continue;
    }
    const serialized = serializeJsonValue(value[key]);
    if (serialized !== undefined) {
      picked[key] = serialized;
    }
  }
  return picked;
}

/**
 * @param {unknown} value
 * @returns {Record<string, object>}
 */
export function toIdMap(value) {
  if (!value) {
    return {};
  }
  if (value instanceof Map) {
    const object = {};
    for (const [key, nested] of value.entries()) {
      object[String(key)] = nested;
    }
    return object;
  }
  if (Array.isArray(value)) {
    const object = {};
    for (const item of value) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const id = item.matchId ?? item.roundId ?? item.entryId ?? item.id;
      if (id) {
        object[String(id)] = item;
      }
    }
    return object;
  }
  if (typeof value === "object") {
    return { ...value };
  }
  return {};
}

/**
 * @param {Record<string, object>} map
 * @param {readonly string[]} keys
 */
function pickMap(map, keys) {
  const object = {};
  for (const [id, doc] of Object.entries(map)) {
    const picked = pickAllowedFields(doc, keys);
    if (picked) {
      object[id] = picked;
    }
  }
  return object;
}

function pickTeamRef(value) {
  if (!value || typeof value !== "object") {
    return value ?? null;
  }
  return pickAllowedFields(value, EMERGENCY_EXPORT_TEAM_REF_KEYS);
}

function withTeamRefs(doc) {
  if (!doc || typeof doc !== "object") {
    return doc;
  }
  const next = { ...doc };
  for (const key of ["team1", "team2", "winner", "loser", "champion", "runnerUp"]) {
    if (next[key] != null && typeof next[key] === "object") {
      next[key] = pickTeamRef(next[key]);
    }
  }
  return next;
}

/**
 * @param {object} input
 */
export function buildEmergencyExportSource(input) {
  const tournament = input.tournament ?? null;
  const tournamentId = input.tournamentId ?? tournament?.id ?? null;
  const sourceTournament = tournament
    ? pickAllowedFields({ ...tournament, id: tournamentId }, EMERGENCY_EXPORT_TOURNAMENT_KEYS)
    : null;

  const entries = Array.isArray(input.entries) ? input.entries : [];
  const sourceEntries = entries.map((entry) => {
    const entryId = entry?.entryId ?? entry?.id;
    return pickAllowedFields(
      {
        ...entry,
        entryId,
        isDummy: entry?.isDummy === true,
        dummyIndex: Number.isInteger(entry?.dummyIndex) ? entry.dummyIndex : null,
        teamNumber: Number.isInteger(Number(entry?.teamNumber))
          ? Number(entry.teamNumber)
          : null,
      },
      EMERGENCY_EXPORT_ENTRY_KEYS
    );
  });

  const qualifyingResults = pickMap(
    toIdMap(input.qualifyingMatchResults),
    EMERGENCY_EXPORT_QUALIFYING_RESULT_KEYS
  );
  const qualifyingSessions = pickMap(
    toIdMap(input.qualifyingMatchSessions),
    EMERGENCY_EXPORT_SESSION_KEYS
  );
  const finalsResults = {};
  for (const [id, doc] of Object.entries(toIdMap(input.finalsMatchResults))) {
    finalsResults[id] = withTeamRefs(pickAllowedFields(doc, EMERGENCY_EXPORT_FINALS_RESULT_KEYS));
  }
  const finalsSessions = pickMap(toIdMap(input.finalsMatchSessions), EMERGENCY_EXPORT_SESSION_KEYS);
  const consolationResults = {};
  for (const [id, doc] of Object.entries(toIdMap(input.consolationMatchResults))) {
    consolationResults[id] = withTeamRefs(
      pickAllowedFields(doc, EMERGENCY_EXPORT_FINALS_RESULT_KEYS)
    );
  }
  const consolationSessions = pickMap(
    toIdMap(input.consolationMatchSessions),
    EMERGENCY_EXPORT_SESSION_KEYS
  );

  const submissions = {};
  for (const [id, doc] of Object.entries(toIdMap(input.qualifyingResultSubmissions))) {
    const picked = pickAllowedFields(doc, EMERGENCY_EXPORT_SUBMISSION_KEYS);
    if (picked) {
      submissions[id] = picked;
    }
  }
  const reconciliations = {};
  for (const [id, doc] of Object.entries(toIdMap(input.qualifyingMatchReconciliations))) {
    const picked = pickAllowedFields(doc, EMERGENCY_EXPORT_RECONCILIATION_KEYS);
    if (picked) {
      reconciliations[id] = picked;
    }
  }

  const lossBandRounds = pickMap(toIdMap(input.lossBandRounds), EMERGENCY_EXPORT_LOSS_BAND_ROUND_KEYS);
  const exchangeRounds = pickMap(
    toIdMap(input.lossBandExchangeRounds),
    EMERGENCY_EXPORT_LOSS_BAND_ROUND_KEYS
  );

  return {
    tournament: sourceTournament,
    entries: sourceEntries,
    blockDraw: pickAllowedFields(input.blockDraw, EMERGENCY_EXPORT_BLOCK_DRAW_KEYS),
    qualifyingSchedule: pickAllowedFields(input.qualifyingSchedule, EMERGENCY_EXPORT_SCHEDULE_KEYS),
    qualifyingMatchResults: qualifyingResults,
    qualifyingMatchSessions: qualifyingSessions,
    molkkyOutResolutions: pickAllowedFields(input.molkkyOutResolutions, EMERGENCY_EXPORT_MOLKKY_KEYS),
    finalsAdvancement: pickAllowedFields(input.finalsAdvancement, EMERGENCY_EXPORT_ADVANCEMENT_KEYS),
    finalsBracket: pickAllowedFields(input.finalsBracket, EMERGENCY_EXPORT_BRACKET_KEYS),
    finalsMatchResults: finalsResults,
    finalsMatchSessions: finalsSessions,
    consolationBracket: pickAllowedFields(input.consolationBracket, EMERGENCY_EXPORT_BRACKET_KEYS),
    consolationMatchResults: consolationResults,
    consolationMatchSessions: consolationSessions,
    lossBand: {
      state: pickAllowedFields(input.lossBandState, EMERGENCY_EXPORT_LOSS_BAND_STATE_KEYS),
      rounds: lossBandRounds,
      matchResults: pickMap(toIdMap(input.lossBandMatchResults), EMERGENCY_EXPORT_FINALS_RESULT_KEYS),
      matchSessions: pickMap(toIdMap(input.lossBandMatchSessions), EMERGENCY_EXPORT_SESSION_KEYS),
      placements: pickAllowedFields(
        input.lossBandPlacements,
        EMERGENCY_EXPORT_LOSS_BAND_PLACEMENTS_KEYS
      ),
      exchangeRounds,
      exchangeMatchResults: pickMap(
        toIdMap(input.lossBandExchangeMatchResults),
        EMERGENCY_EXPORT_FINALS_RESULT_KEYS
      ),
      exchangeMatchSessions: pickMap(
        toIdMap(input.lossBandExchangeMatchSessions),
        EMERGENCY_EXPORT_SESSION_KEYS
      ),
    },
    tournamentResults: withTeamRefs(
      pickAllowedFields(input.tournamentResults, EMERGENCY_EXPORT_TOURNAMENT_RESULTS_KEYS)
    ),
    timeSchedule: pickAllowedFields(input.timeSchedule, EMERGENCY_EXPORT_TIME_SCHEDULE_KEYS),
    playerPipeline: {
      submissions,
      reconciliations,
    },
  };
}

/**
 * @param {unknown} value
 * @param {Set<string>} found
 */
export function collectForbiddenKeys(value, found = new Set()) {
  if (value == null || typeof value !== "object") {
    return found;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectForbiddenKeys(item, found));
    return found;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_KEY_SET.has(key)) {
      found.add(key);
    }
    collectForbiddenKeys(nested, found);
  }
  return found;
}

/**
 * @param {object} input
 */
function buildExportMeta(input, source) {
  const exportedAt =
    serializeTimestamp(input.exportedAt ?? new Date()) ?? new Date().toISOString();
  return {
    schemaVersion: EMERGENCY_EXPORT_SCHEMA_VERSION,
    exportedAt,
    projectId: input.projectId ?? null,
    tournamentId: input.tournamentId ?? source.tournament?.id ?? null,
    tournamentName: source.tournament?.name ?? null,
    eventDate: source.tournament?.eventDate ?? null,
    source: EMERGENCY_EXPORT_SOURCE,
    exportType: EMERGENCY_EXPORT_TYPE,
    applicationRevision: input.applicationRevision ?? null,
    rankingLogicId: EMERGENCY_EXPORT_RANKING_LOGIC_ID,
    piiPolicy: { ...EmergencyExportPiiPolicy },
    notesJa: EMERGENCY_EXPORT_NOTES_JA,
  };
}

/**
 * EmergencyExportV1 ドキュメントを組み立てる。書き込みは行わない。
 * @param {object} input
 */
export function buildEmergencyExport(input) {
  const source = buildEmergencyExportSource(input);
  const derivedCore = buildEmergencyExportDerived(input, source);
  const integrityChecks = buildEmergencyExportIntegrity(input, source, derivedCore);
  return {
    exportMeta: buildExportMeta(input, source),
    source,
    derived: {
      ...derivedCore,
      integrityChecks,
    },
  };
}

export {
  EMERGENCY_EXPORT_ALLOWED_COLLECTIONS,
  EMERGENCY_EXPORT_EXCLUDED_COLLECTIONS,
  EmergencyExportPiiPolicy,
};
