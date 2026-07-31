/**
 * 互換 shim（旧 URL / テスト向け）。
 * ブラウザの大会 create/edit ページは tournament-form-v2.js を直接 import すること。
 */
export {
  applyTournamentValidationErrors,
  formatTimestampForDateTimeLocal,
  populateTournamentForm,
  readTournamentCreateFormInput,
  readTournamentFormInput,
  setFinalsWinsRequiredFieldsLocked,
  setTournamentStructureFieldsLocked,
} from "./tournament-form-v2.js";
