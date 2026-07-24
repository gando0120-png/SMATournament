/**
 * ドメイン定数（ステータス・制約値）
 */

export const TournamentStatus = {
  DRAFT: "draft",
  OPEN: "open",
  CLOSED: "closed",
  ARCHIVED: "archived",
};

export const EntryStatus = {
  PENDING: "pending",
  APPLIED: "applied",
  CONFIRMED: "confirmed",
  WAITLISTED: "waitlisted",
  CANCELLED: "cancelled",
};

export const DEFAULT_PREFERRED_BLOCK_SIZE = 4;

export const TournamentLimits = {
  name: { minLength: 1, maxLength: 100 },
  venue: { minLength: 1, maxLength: 200 },
  maxTeams: { min: 2, max: 999 },
  teamSize: { min: 1, max: 20 },
  courtCount: { min: 1, max: 99 },
  preferredBlockSize: { min: 2, max: 20 },
};

export const TournamentStatusLabels = {
  [TournamentStatus.DRAFT]: "下書き",
  [TournamentStatus.OPEN]: "受付中",
  [TournamentStatus.CLOSED]: "締切",
  [TournamentStatus.ARCHIVED]: "アーカイブ",
};

export const EntryStatusLabels = {
  [EntryStatus.PENDING]: "申込中",
  [EntryStatus.APPLIED]: "申込済",
  [EntryStatus.CONFIRMED]: "参加確定",
  [EntryStatus.WAITLISTED]: "キャンセル待ち",
  [EntryStatus.CANCELLED]: "キャンセル",
};

export const BlockDrawStatus = {
  DRAFT: "draft",
  FINALIZED: "finalized",
};

export const BLOCK_DRAW_DOC_ID = "current";

export const QUALIFYING_SCHEDULE_DOC_ID = "current";

export const FINALS_ADVANCEMENT_DOC_ID = "current";

export const FINALS_BRACKET_DOC_ID = "current";

export const TOURNAMENT_RESULTS_DOC_ID = "current";

/** MVP: 決勝トーナメント進出人数（大会作成フォーム未対応の間の既定値） */
export const DEFAULT_FINAL_TEAM_COUNT = 8;

export const FinalsQualifierSource = {
  BLOCK_WINNER: "block_winner",
  WILDCARD: "wildcard",
};

export const FinalsMatchStatus = {
  PENDING: "pending",
  FINISHED: "finished",
};

export const FinalsMatchResolution = {
  PLAYED: "played",
  BYE: "bye",
};

export const FINALS_MATCH_SETS_TO_WIN = 2;
export const FINALS_MATCH_MAX_SETS = 3;

export const MatchStatus = {
  WAITING: "waiting",
};

export const MatchResultStatus = {
  FINISHED: "finished",
};

export const MatchSessionStatus = {
  PLAYING: "playing",
  FINISHED: "finished",
};

export const SetResult = {
  TEAM1: "team1",
  TEAM2: "team2",
  DRAW: "draw",
};

export const QUALIFYING_MATCH_SET_COUNT = 2;

export const SET_WINNING_SCORE = 50;

export function getTournamentStatusLabel(status) {
  return TournamentStatusLabels[status] ?? status ?? "—";
}

export function getEntryStatusLabel(status) {
  return EntryStatusLabels[status] ?? status ?? "—";
}

/** 公開ページ向け大会ステータス表示 */
export const PublicTournamentStatusLabels = {
  [TournamentStatus.DRAFT]: "準備中",
  [TournamentStatus.OPEN]: "参加受付中",
  [TournamentStatus.CLOSED]: "大会終了",
  [TournamentStatus.ARCHIVED]: "アーカイブ",
};

export const PublicTournamentProgressStatusLabels = {
  inProgress: "大会進行中",
};

export const FinalsQualifierSourceLabels = {
  [FinalsQualifierSource.BLOCK_WINNER]: "ブロック1位",
  [FinalsQualifierSource.WILDCARD]: "ワイルドカード",
};

/** 新規大会の公開設定デフォルト */
export const DEFAULT_PUBLIC_VIEW_ENABLED = true;

/** 将来のプレイヤー結果入力（今回は常に false） */
export const DEFAULT_PARTICIPANT_RESULT_ENTRY_ENABLED = false;
