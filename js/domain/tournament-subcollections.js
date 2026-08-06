/**
 * 大会ドキュメント配下の既知サブコレクション（削除・集計用）
 * admin-list-tournaments.mjs / firestore.rules と整合させる
 */
export const TOURNAMENT_SUBCOLLECTIONS = Object.freeze([
  "entries",
  "blockDraw",
  "qualifyingSchedules",
  "qualifyingMatchResults",
  "qualifyingMatchSessions",
  "qualifyingResultSubmissions",
  "qualifyingMatchReconciliations",
  "entryAccessTokens",
  "finalsAdvancement",
  "finalsBracket",
  "finalsMatchSessions",
  "finalsMatchResults",
  "tournamentResults",
  "publicSnapshot",
  "testSimulation",
  "molkkyOutResolutions",
]);
