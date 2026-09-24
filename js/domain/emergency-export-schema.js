/**
 * EmergencyExportV1 共通定数（DOM / Firestore 非依存）
 */

export const EMERGENCY_EXPORT_SCHEMA_VERSION = 1;
export const EMERGENCY_EXPORT_TYPE = "emergency-ops";
export const EMERGENCY_EXPORT_SOURCE = "firestore";
export const EMERGENCY_EXPORT_RANKING_LOGIC_ID = "sma-qualifying-standings-v1";

export const EMERGENCY_EXPORT_NOTES_JA =
  "source が大会進行の正です。derived は非常時の理解用補助であり、Firestore へ書き戻してはいけません。個人情報・認証情報は含みません。";

export const EmergencyExportPiiPolicy = Object.freeze({
  includesEmail: false,
  includesPersonNames: false,
  includesAuthSecrets: false,
  includesPublicSnapshot: false,
});

export const EmergencyExportPhase = Object.freeze({
  REGISTRATION: "registration",
  BLOCK_DRAW_DRAFT: "block_draw_draft",
  QUALIFYING_SCHEDULED: "qualifying_scheduled",
  QUALIFYING_IN_PROGRESS: "qualifying_in_progress",
  AWAITING_MOLKKY_OUT: "awaiting_molkky_out",
  AWAITING_ADVANCEMENT: "awaiting_advancement",
  FINALS_IN_PROGRESS: "finals_in_progress",
  CONSOLATION_IN_PROGRESS: "consolation_in_progress",
  LOSS_BAND_IN_PROGRESS: "loss_band_in_progress",
  COMPLETED: "completed",
});

export const EMERGENCY_EXPORT_PHASE_LABELS_JA = Object.freeze({
  [EmergencyExportPhase.REGISTRATION]: "受付・編成前",
  [EmergencyExportPhase.BLOCK_DRAW_DRAFT]: "ブロック抽選（未確定）",
  [EmergencyExportPhase.QUALIFYING_SCHEDULED]: "予選組合せ確定",
  [EmergencyExportPhase.QUALIFYING_IN_PROGRESS]: "予選進行中",
  [EmergencyExportPhase.AWAITING_MOLKKY_OUT]: "モルックアウト待ち",
  [EmergencyExportPhase.AWAITING_ADVANCEMENT]: "決勝進出確定待ち",
  [EmergencyExportPhase.FINALS_IN_PROGRESS]: "決勝進行中",
  [EmergencyExportPhase.CONSOLATION_IN_PROGRESS]: "下位トーナメント進行中",
  [EmergencyExportPhase.LOSS_BAND_IN_PROGRESS]: "敗戦帯進行中",
  [EmergencyExportPhase.COMPLETED]: "大会終了",
});

export const EmergencyExportIntegritySeverity = Object.freeze({
  ERROR: "ERROR",
  WARNING: "WARNING",
  INFO: "INFO",
});

export const EmergencyExportIntegrityCode = Object.freeze({
  ENTRY_MISSING_FOR_SCHEDULE: "ENTRY_MISSING_FOR_SCHEDULE",
  ENTRY_MISSING_FOR_DRAW: "ENTRY_MISSING_FOR_DRAW",
  ORPHAN_QUALIFYING_RESULT: "ORPHAN_QUALIFYING_RESULT",
  ORPHAN_FINALS_RESULT: "ORPHAN_FINALS_RESULT",
  ADVANCEMENT_BRACKET_MISMATCH: "ADVANCEMENT_BRACKET_MISMATCH",
  STANDINGS_INPUT_INCOMPLETE: "STANDINGS_INPUT_INCOMPLETE",
  ADVANCEMENT_WITHOUT_COMPLETE_QUALIFYING: "ADVANCEMENT_WITHOUT_COMPLETE_QUALIFYING",
  PLAYER_SUBMISSION_CONFLICT: "PLAYER_SUBMISSION_CONFLICT",
  MOLKKY_OUT_UNRESOLVED: "MOLKKY_OUT_UNRESOLVED",
  TEAM_NAME_STALE: "TEAM_NAME_STALE",
  SESSION_WITHOUT_SCHEDULE: "SESSION_WITHOUT_SCHEDULE",
  PLAYER_SUBMISSION_AWAITING: "PLAYER_SUBMISSION_AWAITING",
  TEAM_NUMBER_UNASSIGNED: "TEAM_NUMBER_UNASSIGNED",
  SESSION_AND_RESULT: "SESSION_AND_RESULT",
  CONFIRMED_COUNT_MISMATCH: "CONFIRMED_COUNT_MISMATCH",
  DUMMY_IN_LIVE_EVENT: "DUMMY_IN_LIVE_EVENT",
});

export const EmergencyExportMatchPhase = Object.freeze({
  QUALIFYING: "qualifying",
  FINALS: "finals",
  CONSOLATION: "consolation",
  LOSS_BAND: "lossBand",
  LOSS_BAND_EXCHANGE: "lossBandExchange",
});

/** JSON に出してはいけないキー（ネスト含む検査・除去用） */
export const EMERGENCY_EXPORT_FORBIDDEN_KEYS = Object.freeze([
  "email",
  "comment",
  "representativeName",
  "member2",
  "member3",
  "member4",
  "token",
  "teamToken",
  "tokenHash",
  "tokenHashPrefix",
  "createdBy",
  "clientRequestId",
  "authMethod",
  "privateMemo",
  "operatorUid",
]);

/** 取得しても JSON に載せないサブコレクション */
export const EMERGENCY_EXPORT_EXCLUDED_COLLECTIONS = Object.freeze([
  "entryAccessTokens",
  "publicSnapshot",
  "entryCompletionGuidance",
  "testSimulation",
]);

/** JSON の source に載せてよいサブコレクション */
export const EMERGENCY_EXPORT_ALLOWED_COLLECTIONS = Object.freeze([
  "entries",
  "blockDraw",
  "qualifyingSchedules",
  "qualifyingMatchResults",
  "qualifyingMatchSessions",
  "molkkyOutResolutions",
  "finalsAdvancement",
  "finalsBracket",
  "finalsMatchResults",
  "finalsMatchSessions",
  "consolationBracket",
  "consolationMatchResults",
  "consolationMatchSessions",
  "lossBandState",
  "lossBandRounds",
  "lossBandMatchResults",
  "lossBandMatchSessions",
  "lossBandPlacements",
  "lossBandExchangeRounds",
  "lossBandExchangeMatchResults",
  "lossBandExchangeMatchSessions",
  "tournamentResults",
  "timeSchedule",
  "qualifyingResultSubmissions",
  "qualifyingMatchReconciliations",
]);

export const EMERGENCY_EXPORT_TOURNAMENT_KEYS = Object.freeze([
  "id",
  "name",
  "eventDate",
  "venue",
  "status",
  "closedAt",
  "isDeleted",
  "entryDeadline",
  "maxTeams",
  "teamSize",
  "minTeamSize",
  "maxTeamSize",
  "courtCount",
  "tournamentFormat",
  "preferredBlockSize",
  "blockCount",
  "qualifiersPerBlock",
  "finalTeamCount",
  "wildcardComparisonMode",
  "winsRequired",
  "finalsMatchRules",
  "matchFormat",
  "aggregateMatchRules",
  "bracketMatchConfig",
  "structureLocked",
  "publicViewEnabled",
  "participantResultEntryEnabled",
  "createdAt",
  "updatedAt",
]);

export const EMERGENCY_EXPORT_ENTRY_KEYS = Object.freeze([
  "entryId",
  "teamName",
  "status",
  "teamNumber",
  "isDummy",
  "dummyIndex",
  "createdAt",
  "updatedAt",
]);

export const EMERGENCY_EXPORT_SUBMISSION_KEYS = Object.freeze([
  "matchId",
  "entryId",
  "side",
  "set1OwnScore",
  "set2OwnScore",
  "set1FinishReason",
  "set2FinishReason",
  "status",
  "submittedAt",
  "updatedAt",
]);

export const EMERGENCY_EXPORT_RECONCILIATION_KEYS = Object.freeze([
  "matchId",
  "state",
  "submissions",
  "conflictSnapshot",
  "officialResultId",
  "updatedAt",
]);

export const EMERGENCY_EXPORT_TIME_SCHEDULE_KEYS = Object.freeze([
  "dayStartTime",
  "matchDurationMinutes",
  "matchIntervalMinutes",
  "qualifyingToFinalsIntervalMinutes",
  "overrides",
  "updatedAt",
]);

export const EMERGENCY_EXPORT_BLOCK_DRAW_KEYS = Object.freeze([
  "status",
  "blockCount",
  "preferredBlockSize",
  "distribution",
  "blocks",
  "createdAt",
  "updatedAt",
  "finalizedAt",
]);

export const EMERGENCY_EXPORT_SCHEDULE_KEYS = Object.freeze([
  "finalized",
  "sourceBlockDrawUpdatedAt",
  "blockCount",
  "totalMatchCount",
  "totalCourtsUsed",
  "blocks",
]);

export const EMERGENCY_EXPORT_MOLKKY_KEYS = Object.freeze([
  "blockGroups",
  "wildcardGroups",
  "updatedAt",
]);

export const EMERGENCY_EXPORT_ADVANCEMENT_KEYS = Object.freeze([
  "finalized",
  "mode",
  "blockCount",
  "qualifiersPerBlock",
  "qualifierCount",
  "finalTeamCount",
  "blockWinnerCount",
  "wildcardCount",
  "wildcardComparisonMode",
  "qualifiers",
  "blockGroups",
  "qualifyingMatchCount",
  "qualifyingFinishedMatchCount",
]);

export const EMERGENCY_EXPORT_BRACKET_KEYS = Object.freeze([
  "finalized",
  "bracketSize",
  "qualifierCount",
  "roundCount",
  "slots",
  "matches",
  "matchIds",
  "matchIdsList",
  "placementMode",
  "matchFormat",
  "aggregateMatchRules",
  "roundPlans",
  "mode",
  "bracketKind",
  "teamCount",
  "byeCount",
  "courtAssignment",
  "createdAt",
  "updatedAt",
]);

export const EMERGENCY_EXPORT_QUALIFYING_RESULT_KEYS = Object.freeze([
  "matchId",
  "blockId",
  "roundNumber",
  "courtNumber",
  "team1",
  "team2",
  "sets",
  "team1Stats",
  "team2Stats",
  "status",
  "createdAt",
  "updatedAt",
]);

export const EMERGENCY_EXPORT_SESSION_KEYS = Object.freeze([
  "matchId",
  "status",
  "startedAt",
  "updatedAt",
  "finishedAt",
  "roundNumber",
  "matchNumber",
  "team1",
  "team2",
]);

export const EMERGENCY_EXPORT_FINALS_RESULT_KEYS = Object.freeze([
  "matchId",
  "roundNumber",
  "matchNumber",
  "matchFormat",
  "status",
  "resolution",
  "team1",
  "team2",
  "winner",
  "loser",
  "sets",
  "team1SetWins",
  "team2SetWins",
  "winnerSide",
  "winsRequired",
  "source",
  "participantEntryIds",
  "scores",
  "totals",
  "rankingEntryIds",
  "qualifierEntryIds",
  "tieResolution",
  "setCount",
  "qualifiersCount",
  "createdAt",
  "updatedAt",
]);

export const EMERGENCY_EXPORT_LOSS_BAND_STATE_KEYS = Object.freeze([
  "version",
  "revision",
  "teamCount",
  "bracketSize",
  "entryIds",
  "currentRound",
  "currentRoundId",
  "completedRankingRound",
  "status",
  "phase",
  "rankingMode",
  "rematchAvoidance",
  "thirdPlaceMatch",
  "exchangeMatches",
  "exchangeRoundNumber",
  "guaranteedMatchCount",
  "finalists",
  "thirdPlaceFinalists",
  "teams",
  "matchLog",
  "updatedAt",
]);

export const EMERGENCY_EXPORT_LOSS_BAND_ROUND_KEYS = Object.freeze([
  "roundId",
  "roundNumber",
  "status",
  "matchPurpose",
  "bands",
  "pairs",
  "matchIds",
  "byes",
  "createdAt",
  "updatedAt",
]);

export const EMERGENCY_EXPORT_LOSS_BAND_PLACEMENTS_KEYS = Object.freeze([
  "version",
  "placements",
  "updatedAt",
]);

export const EMERGENCY_EXPORT_TOURNAMENT_RESULTS_KEYS = Object.freeze([
  "finalized",
  "tournamentId",
  "tournamentName",
  "tournamentStatus",
  "champion",
  "runnerUp",
  "placements",
  "qualifierCount",
  "bracketSize",
  "completedMatchCount",
  "expectedMatchCount",
  "hasConsolation",
  "consolationChampion",
  "consolationRunnerUp",
  "consolationPlacements",
  "consolationStatus",
  "createdAt",
  "updatedAt",
]);

export const EMERGENCY_EXPORT_TEAM_REF_KEYS = Object.freeze([
  "entryId",
  "teamName",
  "symbol",
  "seed",
  "blockId",
  "blockName",
  "blockRank",
  "isBye",
  "source",
]);
