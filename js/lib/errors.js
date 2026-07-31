/**
 * エラー分類と日本語メッセージ
 */

export const ErrorCodes = {
  CONFIG_UNCONFIGURED: "config/unconfigured",
  OPERATOR_NOT_REGISTERED: "operator/not-registered",
  TOURNAMENT_MANAGE_DENIED: "tournament/manage-denied",
  AUTH_INVALID_CREDENTIALS: "auth/invalid-credentials",
  NETWORK: "network/error",
  PERMISSION_DENIED: "permission-denied",
  TOURNAMENT_NOT_FOUND: "tournament/not-found",
  TOURNAMENT_DELETED: "tournament/deleted",
  TOURNAMENT_STRUCTURE_LOCKED: "tournament/structure-locked",
  TOURNAMENT_PUBLIC_VIEW_DISABLED: "tournament/public-view-disabled",
  TOURNAMENT_PUBLIC_SNAPSHOT_NOT_READY: "tournament/public-snapshot-not-ready",
  INVALID_TOURNAMENT_ID: "tournament/invalid-id",
  ENTRY_NOT_FOUND: "entry/not-found",
  ENTRY_NOT_PENDING: "entry/not-pending",
  ENTRY_NOT_OPEN: "entry/not-open",
  QUALIFYING_SCHEDULE_INVALID: "qualifying-schedule/invalid",
  QUALIFYING_SCHEDULE_ALREADY_FINALIZED: "qualifying-schedule/already-finalized",
  QUALIFYING_SCHEDULE_NO_BLOCK_DRAW: "qualifying-schedule/no-block-draw",
  QUALIFYING_SCHEDULE_BLOCK_DRAW_NOT_FINALIZED: "qualifying-schedule/block-draw-not-finalized",
  QUALIFYING_MATCH_RESULT_NO_SCHEDULE: "qualifying-match-result/no-schedule",
  QUALIFYING_MATCH_RESULT_INVALID_MATCH: "qualifying-match-result/invalid-match",
  QUALIFYING_MATCH_RESULT_INVALID_INPUT: "qualifying-match-result/invalid-input",
  QUALIFYING_MATCH_RESULT_ADVANCEMENT_FINALIZED: "qualifying-match-result/advancement-finalized",
  QUALIFYING_MATCH_SESSION_NO_SCHEDULE: "qualifying-match-session/no-schedule",
  QUALIFYING_MATCH_SESSION_INVALID_MATCH: "qualifying-match-session/invalid-match",
  QUALIFYING_MATCH_SESSION_ALREADY_FINISHED: "qualifying-match-session/already-finished",
  FINALS_ADVANCEMENT_NO_SCHEDULE: "finals-advancement/no-schedule",
  FINALS_ADVANCEMENT_INCOMPLETE: "finals-advancement/incomplete",
  FINALS_ADVANCEMENT_ALREADY_FINALIZED: "finals-advancement/already-finalized",
  MOLKKY_OUT_INVALID: "molkky-out/invalid",
  MOLKKY_OUT_ADVANCEMENT_FINALIZED: "molkky-out/advancement-finalized",
  FINALS_BRACKET_NO_ADVANCEMENT: "finals-bracket/no-advancement",
  FINALS_BRACKET_ADVANCEMENT_NOT_FINALIZED: "finals-bracket/advancement-not-finalized",
  FINALS_BRACKET_ALREADY_FINALIZED: "finals-bracket/already-finalized",
  FINALS_BRACKET_CANNOT_REGENERATE: "finals-bracket/cannot-regenerate",
  SINGLE_ELIMINATION_BRACKET_ALREADY_CREATED: "single-elimination-bracket/already-created",
  SINGLE_ELIMINATION_BRACKET_ORPHAN_DATA: "single-elimination-bracket/orphan-data",
  FINALS_BRACKET_INVALID_QUALIFIERS: "finals-bracket/invalid-qualifiers",
  FINALS_MATCH_SESSION_NO_BRACKET: "finals-match-session/no-bracket",
  FINALS_MATCH_SESSION_INVALID_MATCH: "finals-match-session/invalid-match",
  FINALS_MATCH_SESSION_ALREADY_FINISHED: "finals-match-session/already-finished",
  FINALS_MATCH_SESSION_NOT_READY: "finals-match-session/not-ready",
  FINALS_MATCH_SESSION_BYE_MATCH: "finals-match-session/bye-match",
  FINALS_MATCH_RESULT_NO_BRACKET: "finals-match-result/no-bracket",
  FINALS_MATCH_RESULT_INVALID_MATCH: "finals-match-result/invalid-match",
  FINALS_MATCH_RESULT_INVALID_INPUT: "finals-match-result/invalid-input",
  FINALS_MATCH_RESULT_NOT_STARTED: "finals-match-result/not-started",
  FINALS_MATCH_RESULT_MODIFY_BLOCKED: "finals-match-result/modify-blocked",
  FINALS_MATCH_RESULT_INVALID_BYE: "finals-match-result/invalid-bye",
  TOURNAMENT_NOT_OPEN: "tournament/not-open",
  TOURNAMENT_RESULTS_NO_ADVANCEMENT: "tournament-results/no-advancement",
  TOURNAMENT_RESULTS_INCOMPLETE: "tournament-results/incomplete",
  TOURNAMENT_RESULTS_ALREADY_FINALIZED: "tournament-results/already-finalized",
  BLOCK_DRAW_ALREADY_FINALIZED: "block-draw/already-finalized",
  BLOCK_DRAW_ALREADY_EXISTS: "block-draw/already-exists",
  BLOCK_DRAW_INVALID_CONFIGURATION: "block-draw/invalid-configuration",
  BLOCK_DRAW_INVALID_RESULT: "block-draw/invalid-result",
  BLOCK_DRAW_NO_CONFIRMED_ENTRIES: "block-draw/no-confirmed-entries",
  BLOCK_DRAW_NOT_EDITABLE: "block-draw/not-editable",
  BLOCK_DRAW_NOT_DRAFT: "block-draw/not-draft",
  BLOCK_DRAW_INVALID_EDIT: "block-draw/invalid-edit",
  BLOCK_DRAW_ENTRY_MISMATCH: "block-draw/entry-mismatch",
  INVALID_MATCH_ID: "match/invalid-id",
  CONSOLATION_BRACKET_UNSUPPORTED_FORMAT: "consolation-bracket/unsupported-format",
  CONSOLATION_BRACKET_ADVANCEMENT_NOT_FINALIZED: "consolation-bracket/advancement-not-finalized",
  CONSOLATION_BRACKET_MAIN_BRACKET_NOT_FINALIZED: "consolation-bracket/main-bracket-not-finalized",
  CONSOLATION_BRACKET_NOT_ENOUGH_PARTICIPANTS: "consolation-bracket/not-enough-participants",
  CONSOLATION_BRACKET_ALREADY_CREATED: "consolation-bracket/already-created",
  CONSOLATION_BRACKET_TOURNAMENT_COMPLETED: "consolation-bracket/tournament-completed",
  CONSOLATION_BRACKET_INELIGIBLE: "consolation-bracket/ineligible",
  BRACKET_INVALID_KIND: "bracket/invalid-kind",
};

const AUTH_INVALID_CODES = new Set([
  "auth/invalid-credential",
  "auth/wrong-password",
  "auth/user-not-found",
  "auth/invalid-email",
  "auth/invalid-login-credentials",
]);

export function classifyError(error) {
  if (!error) {
    return { code: ErrorCodes.NETWORK, message: "予期しないエラーが発生しました。" };
  }

  if (error.code === ErrorCodes.CONFIG_UNCONFIGURED) {
    return {
      code: ErrorCodes.CONFIG_UNCONFIGURED,
      message: "Firebase 設定が未入力です。js/firebase-config.js を設定してください。",
    };
  }

  if (error.code === ErrorCodes.OPERATOR_NOT_REGISTERED) {
    return {
      code: ErrorCodes.OPERATOR_NOT_REGISTERED,
      message: "ログインは成功しましたが、運営者として有効化されていません。管理者に operators/{uid} の enabled: true 登録を依頼してください。",
    };
  }

  if (error.code === ErrorCodes.TOURNAMENT_MANAGE_DENIED) {
    return {
      code: ErrorCodes.TOURNAMENT_MANAGE_DENIED,
      message: "この大会を管理する権限がありません。運営者または大会作成者のみ操作できます。",
    };
  }

  if (error.code === ErrorCodes.TOURNAMENT_NOT_FOUND) {
    return {
      code: ErrorCodes.TOURNAMENT_NOT_FOUND,
      message: "大会が見つかりません。URL を確認してください。",
    };
  }

  if (error.code === ErrorCodes.TOURNAMENT_DELETED) {
    return {
      code: ErrorCodes.TOURNAMENT_DELETED,
      message: "この大会は削除されています。",
    };
  }

  if (error.code === ErrorCodes.TOURNAMENT_STRUCTURE_LOCKED) {
    return {
      code: ErrorCodes.TOURNAMENT_STRUCTURE_LOCKED,
      message: error.message || "エントリー開始後のため、人数・定員に関する設定は変更できません。",
    };
  }

  if (error.code === ErrorCodes.TOURNAMENT_PUBLIC_VIEW_DISABLED) {
    return {
      code: ErrorCodes.TOURNAMENT_PUBLIC_VIEW_DISABLED,
      message: "この大会は現在公開されていません。",
    };
  }

  if (error.code === ErrorCodes.TOURNAMENT_PUBLIC_SNAPSHOT_NOT_READY) {
    return {
      code: ErrorCodes.TOURNAMENT_PUBLIC_SNAPSHOT_NOT_READY,
      message: "公開情報はまだ準備されていません。大会運営者による更新をお待ちください。",
    };
  }

  if (error.code === ErrorCodes.INVALID_TOURNAMENT_ID) {
    return {
      code: ErrorCodes.INVALID_TOURNAMENT_ID,
      message: "大会 ID が不正です。一覧から大会を選択してください。",
    };
  }

  if (error.code === ErrorCodes.ENTRY_NOT_FOUND) {
    return {
      code: ErrorCodes.ENTRY_NOT_FOUND,
      message: "エントリーが見つかりません。",
    };
  }

  if (error.code === ErrorCodes.ENTRY_NOT_PENDING) {
    return {
      code: ErrorCodes.ENTRY_NOT_PENDING,
      message: "このエントリーはすでに処理済みです。",
    };
  }

  if (error.code === ErrorCodes.ENTRY_NOT_OPEN) {
    return {
      code: ErrorCodes.ENTRY_NOT_OPEN,
      message: error.message || "現在、エントリーを受け付けていません。",
    };
  }

  if (error.code === ErrorCodes.BLOCK_DRAW_ALREADY_FINALIZED) {
    return {
      code: ErrorCodes.BLOCK_DRAW_ALREADY_FINALIZED,
      message: "ブロック抽選はすでに確定済みです。",
    };
  }

  if (error.code === ErrorCodes.BLOCK_DRAW_INVALID_CONFIGURATION) {
    return {
      code: ErrorCodes.BLOCK_DRAW_INVALID_CONFIGURATION,
      message: error.message || "ブロック抽選の条件を満たしていません。",
    };
  }

  if (error.code === ErrorCodes.BLOCK_DRAW_INVALID_RESULT) {
    return {
      code: ErrorCodes.BLOCK_DRAW_INVALID_RESULT,
      message: error.message || "ブロック抽選結果が不正です。",
    };
  }

  if (error.code === ErrorCodes.BLOCK_DRAW_NO_CONFIRMED_ENTRIES) {
    return {
      code: ErrorCodes.BLOCK_DRAW_NO_CONFIRMED_ENTRIES,
      message: "参加承認済みのチームがありません。",
    };
  }

  if (error.code === ErrorCodes.BLOCK_DRAW_NOT_EDITABLE) {
    return {
      code: ErrorCodes.BLOCK_DRAW_NOT_EDITABLE,
      message: error.message || "ブロック抽選は編集できません。",
    };
  }

  if (error.code === ErrorCodes.BLOCK_DRAW_ENTRY_MISMATCH) {
    return {
      code: ErrorCodes.BLOCK_DRAW_ENTRY_MISMATCH,
      message: error.message || "確定エントリーが抽選後に変更されています。",
    };
  }

  if (error.code === ErrorCodes.BLOCK_DRAW_INVALID_EDIT) {
    return {
      code: ErrorCodes.BLOCK_DRAW_INVALID_EDIT,
      message: error.message || "ブロック配置が不正です。",
    };
  }

  if (error.code === "block-draw/source-too-small") {
    return {
      code: "block-draw/source-too-small",
      message: error.message || "移動後、移動元ブロックが2チーム以下になります。",
    };
  }

  if (error.code === "block-draw/destination-too-large") {
    return {
      code: "block-draw/destination-too-large",
      message: error.message || "移動後、移動先ブロックが9チーム以上になります。",
    };
  }

  if (error.code === "block-draw/same-block" || error.code === "block-draw/same-entry") {
    return {
      code: error.code,
      message: error.message || "この入替・移動はできません。",
    };
  }

  if (error.code === ErrorCodes.QUALIFYING_SCHEDULE_INVALID) {
    return {
      code: ErrorCodes.QUALIFYING_SCHEDULE_INVALID,
      message: error.message || "対戦表を確定できません。",
    };
  }

  if (error.code === ErrorCodes.QUALIFYING_SCHEDULE_ALREADY_FINALIZED) {
    return {
      code: ErrorCodes.QUALIFYING_SCHEDULE_ALREADY_FINALIZED,
      message: "対戦表はすでに確定済みです。",
    };
  }

  if (error.code === ErrorCodes.QUALIFYING_MATCH_RESULT_NO_SCHEDULE) {
    return {
      code: ErrorCodes.QUALIFYING_MATCH_RESULT_NO_SCHEDULE,
      message: "確定済みの予選対戦表がないため、結果を保存できません。",
    };
  }

  if (error.code === ErrorCodes.QUALIFYING_MATCH_RESULT_INVALID_MATCH) {
    return {
      code: ErrorCodes.QUALIFYING_MATCH_RESULT_INVALID_MATCH,
      message: "対戦表に存在しない試合です。",
    };
  }

  if (error.code === ErrorCodes.QUALIFYING_MATCH_RESULT_INVALID_INPUT) {
    return {
      code: ErrorCodes.QUALIFYING_MATCH_RESULT_INVALID_INPUT,
      message: error.message || "入力内容が不正です。",
    };
  }

  if (error.code === ErrorCodes.QUALIFYING_MATCH_RESULT_ADVANCEMENT_FINALIZED) {
    return {
      code: ErrorCodes.QUALIFYING_MATCH_RESULT_ADVANCEMENT_FINALIZED,
      message: "決勝進出チームが確定済みのため、予選結果は修正できません。",
    };
  }

  if (error.code === ErrorCodes.QUALIFYING_SCHEDULE_NO_BLOCK_DRAW) {
    return {
      code: ErrorCodes.QUALIFYING_SCHEDULE_NO_BLOCK_DRAW,
      message: "ブロック抽選が存在しません。",
    };
  }

  if (error.code === ErrorCodes.QUALIFYING_SCHEDULE_BLOCK_DRAW_NOT_FINALIZED) {
    return {
      code: ErrorCodes.QUALIFYING_SCHEDULE_BLOCK_DRAW_NOT_FINALIZED,
      message: "ブロック抽選が確定していません。",
    };
  }

  if (error.code === ErrorCodes.QUALIFYING_MATCH_SESSION_NO_SCHEDULE) {
    return {
      code: ErrorCodes.QUALIFYING_MATCH_SESSION_NO_SCHEDULE,
      message: "確定済みの予選対戦表がないため、試合を開始できません。",
    };
  }

  if (error.code === ErrorCodes.QUALIFYING_MATCH_SESSION_INVALID_MATCH) {
    return {
      code: ErrorCodes.QUALIFYING_MATCH_SESSION_INVALID_MATCH,
      message: "対戦表に存在しない試合です。",
    };
  }

  if (error.code === ErrorCodes.QUALIFYING_MATCH_SESSION_ALREADY_FINISHED) {
    return {
      code: ErrorCodes.QUALIFYING_MATCH_SESSION_ALREADY_FINISHED,
      message: "終了済みの試合は開始できません。",
    };
  }

  if (error.code === ErrorCodes.FINALS_ADVANCEMENT_NO_SCHEDULE) {
    return {
      code: ErrorCodes.FINALS_ADVANCEMENT_NO_SCHEDULE,
      message: "確定済みの予選対戦表がないため、決勝進出を確定できません。",
    };
  }

  if (error.code === ErrorCodes.FINALS_ADVANCEMENT_INCOMPLETE) {
    return {
      code: ErrorCodes.FINALS_ADVANCEMENT_INCOMPLETE,
      message: error.message || "予選結果が未入力の試合があります。",
    };
  }

  if (error.code === ErrorCodes.FINALS_ADVANCEMENT_ALREADY_FINALIZED) {
    return {
      code: ErrorCodes.FINALS_ADVANCEMENT_ALREADY_FINALIZED,
      message: "決勝進出はすでに確定済みです。",
    };
  }

  if (error.code === ErrorCodes.MOLKKY_OUT_INVALID) {
    return {
      code: ErrorCodes.MOLKKY_OUT_INVALID,
      message: error.message || "モルックアウト結果が不正です。",
    };
  }

  if (error.code === ErrorCodes.MOLKKY_OUT_ADVANCEMENT_FINALIZED) {
    return {
      code: ErrorCodes.MOLKKY_OUT_ADVANCEMENT_FINALIZED,
      message: "決勝進出確定後はモルックアウト結果を変更できません。",
    };
  }

  if (error.code === ErrorCodes.FINALS_BRACKET_NO_ADVANCEMENT) {
    return {
      code: ErrorCodes.FINALS_BRACKET_NO_ADVANCEMENT,
      message: "決勝進出が未確定のため、トーナメント表を作成できません。",
    };
  }

  if (error.code === ErrorCodes.FINALS_BRACKET_ADVANCEMENT_NOT_FINALIZED) {
    return {
      code: ErrorCodes.FINALS_BRACKET_ADVANCEMENT_NOT_FINALIZED,
      message: "先に決勝進出チームを確定してください。",
    };
  }

  if (error.code === ErrorCodes.FINALS_BRACKET_ALREADY_FINALIZED) {
    return {
      code: ErrorCodes.FINALS_BRACKET_ALREADY_FINALIZED,
      message: "決勝トーナメント表はすでに確定済みです。",
    };
  }

  if (error.code === ErrorCodes.FINALS_BRACKET_CANNOT_REGENERATE) {
    return {
      code: ErrorCodes.FINALS_BRACKET_CANNOT_REGENERATE,
      message: error.message || "決勝トーナメントを再生成できません。",
    };
  }

  if (error.code === ErrorCodes.SINGLE_ELIMINATION_BRACKET_ALREADY_CREATED) {
    return {
      code: ErrorCodes.SINGLE_ELIMINATION_BRACKET_ALREADY_CREATED,
      message: "一発トーナメント表はすでに作成済みです。",
    };
  }

  if (error.code === ErrorCodes.SINGLE_ELIMINATION_BRACKET_ORPHAN_DATA) {
    return {
      code: ErrorCodes.SINGLE_ELIMINATION_BRACKET_ORPHAN_DATA,
      message:
        error.message ||
        "決勝トーナメント表の不完全なデータが残っています。Firebase Console で finalsBracket/current を確認してください。",
    };
  }

  if (error.code === ErrorCodes.FINALS_BRACKET_INVALID_QUALIFIERS) {
    return {
      code: ErrorCodes.FINALS_BRACKET_INVALID_QUALIFIERS,
      message: error.message || "決勝進出データが不正です。",
    };
  }

  if (error.code === ErrorCodes.FINALS_MATCH_SESSION_NO_BRACKET) {
    return {
      code: ErrorCodes.FINALS_MATCH_SESSION_NO_BRACKET,
      message: "決勝トーナメントが未確定のため、試合を開始できません。",
    };
  }

  if (error.code === ErrorCodes.FINALS_MATCH_SESSION_INVALID_MATCH) {
    return {
      code: ErrorCodes.FINALS_MATCH_SESSION_INVALID_MATCH,
      message: "トーナメント表に存在しない試合です。",
    };
  }

  if (error.code === ErrorCodes.FINALS_MATCH_SESSION_ALREADY_FINISHED) {
    return {
      code: ErrorCodes.FINALS_MATCH_SESSION_ALREADY_FINISHED,
      message: "終了済みの試合は開始できません。",
    };
  }

  if (error.code === ErrorCodes.FINALS_MATCH_SESSION_NOT_READY) {
    return {
      code: ErrorCodes.FINALS_MATCH_SESSION_NOT_READY,
      message: error.message || "試合を開始できません。",
    };
  }

  if (error.code === ErrorCodes.FINALS_MATCH_SESSION_BYE_MATCH) {
    return {
      code: ErrorCodes.FINALS_MATCH_SESSION_BYE_MATCH,
      message: "BYE試合は自動進出します。",
    };
  }

  if (error.code === ErrorCodes.FINALS_MATCH_RESULT_NO_BRACKET) {
    return {
      code: ErrorCodes.FINALS_MATCH_RESULT_NO_BRACKET,
      message: "決勝トーナメントが未確定です。",
    };
  }

  if (error.code === ErrorCodes.FINALS_MATCH_RESULT_INVALID_MATCH) {
    return {
      code: ErrorCodes.FINALS_MATCH_RESULT_INVALID_MATCH,
      message: "トーナメント表に存在しない試合です。",
    };
  }

  if (error.code === ErrorCodes.FINALS_MATCH_RESULT_INVALID_INPUT) {
    return {
      code: ErrorCodes.FINALS_MATCH_RESULT_INVALID_INPUT,
      message: error.message || "入力内容が不正です。",
    };
  }

  if (error.code === ErrorCodes.FINALS_MATCH_RESULT_NOT_STARTED) {
    return {
      code: ErrorCodes.FINALS_MATCH_RESULT_NOT_STARTED,
      message: "試合を開始してから結果を入力してください。",
    };
  }

  if (error.code === ErrorCodes.FINALS_MATCH_RESULT_MODIFY_BLOCKED) {
    return {
      code: ErrorCodes.FINALS_MATCH_RESULT_MODIFY_BLOCKED,
      message: error.message || "この結果は修正できません。",
    };
  }

  if (error.code === ErrorCodes.FINALS_MATCH_RESULT_INVALID_BYE) {
    return {
      code: ErrorCodes.FINALS_MATCH_RESULT_INVALID_BYE,
      message: "BYE構造が不正です。",
    };
  }

  if (error.code === ErrorCodes.TOURNAMENT_NOT_OPEN) {
    return {
      code: ErrorCodes.TOURNAMENT_NOT_OPEN,
      message: error.message || "大会は終了済みのため、変更できません。",
    };
  }

  if (error.code === ErrorCodes.TOURNAMENT_RESULTS_NO_ADVANCEMENT) {
    return {
      code: ErrorCodes.TOURNAMENT_RESULTS_NO_ADVANCEMENT,
      message: "決勝進出が未確定のため、大会結果を確定できません。",
    };
  }

  if (error.code === ErrorCodes.TOURNAMENT_RESULTS_INCOMPLETE) {
    return {
      code: ErrorCodes.TOURNAMENT_RESULTS_INCOMPLETE,
      message: error.message || "大会を終了できる状態ではありません。",
    };
  }

  if (error.code === ErrorCodes.TOURNAMENT_RESULTS_ALREADY_FINALIZED) {
    return {
      code: ErrorCodes.TOURNAMENT_RESULTS_ALREADY_FINALIZED,
      message: "大会結果はすでに確定済みです。",
    };
  }

  if (error.code === ErrorCodes.INVALID_MATCH_ID) {
    return {
      code: ErrorCodes.INVALID_MATCH_ID,
      message: "試合 ID が不正です。",
    };
  }

  if (error.code === ErrorCodes.CONSOLATION_BRACKET_UNSUPPORTED_FORMAT) {
    return {
      code: ErrorCodes.CONSOLATION_BRACKET_UNSUPPORTED_FORMAT,
      message: "この大会形式では下位トーナメントを作成できません。",
    };
  }

  if (error.code === ErrorCodes.CONSOLATION_BRACKET_ADVANCEMENT_NOT_FINALIZED) {
    return {
      code: ErrorCodes.CONSOLATION_BRACKET_ADVANCEMENT_NOT_FINALIZED,
      message: "決勝進出者を確定してから、下位トーナメントを作成してください。",
    };
  }

  if (error.code === ErrorCodes.CONSOLATION_BRACKET_MAIN_BRACKET_NOT_FINALIZED) {
    return {
      code: ErrorCodes.CONSOLATION_BRACKET_MAIN_BRACKET_NOT_FINALIZED,
      message: "上位トーナメントを生成してから、下位トーナメントを作成してください。",
    };
  }

  if (error.code === ErrorCodes.CONSOLATION_BRACKET_NOT_ENOUGH_PARTICIPANTS) {
    return {
      code: ErrorCodes.CONSOLATION_BRACKET_NOT_ENOUGH_PARTICIPANTS,
      message: "下位トーナメント対象が2チーム未満のため作成できません。",
    };
  }

  if (error.code === ErrorCodes.CONSOLATION_BRACKET_ALREADY_CREATED) {
    return {
      code: ErrorCodes.CONSOLATION_BRACKET_ALREADY_CREATED,
      message: "下位トーナメントはすでに作成されています。",
    };
  }

  if (error.code === ErrorCodes.CONSOLATION_BRACKET_TOURNAMENT_COMPLETED) {
    return {
      code: ErrorCodes.CONSOLATION_BRACKET_TOURNAMENT_COMPLETED,
      message: "大会終了済みのため、下位トーナメントを作成できません。",
    };
  }

  if (error.code === ErrorCodes.CONSOLATION_BRACKET_INELIGIBLE) {
    return {
      code: ErrorCodes.CONSOLATION_BRACKET_INELIGIBLE,
      message: "現在、下位トーナメントを作成できません。",
    };
  }

  if (error.code === ErrorCodes.BRACKET_INVALID_KIND) {
    return {
      code: ErrorCodes.BRACKET_INVALID_KIND,
      message: "トーナメント種別が不正です。",
    };
  }

  if (AUTH_INVALID_CODES.has(error.code)) {
    return {
      code: ErrorCodes.AUTH_INVALID_CREDENTIALS,
      message: "メールアドレスまたはパスワードが違います。",
    };
  }

  if (error.code === "permission-denied" || error.code === "firestore/permission-denied") {
    return {
      code: ErrorCodes.PERMISSION_DENIED,
      message: "大会設定の更新が Firestore Rules で拒否されました。",
    };
  }

  if (error.code === "unauthenticated" || error.code === "auth/unauthenticated") {
    return {
      code: "unauthenticated",
      message: "ログイン状態を確認してください。",
    };
  }

  if (error.code === "invalid-argument" || error.code === "firestore/invalid-argument") {
    return {
      code: "invalid-argument",
      message: "保存データに不正な値があります。",
    };
  }

  if (
    error.code === "auth/network-request-failed" ||
    error.message?.includes("network") ||
    error.message?.includes("Failed to fetch") ||
    (error.name === "FirebaseError" && error.code?.includes("unavailable"))
  ) {
    return {
      code: ErrorCodes.NETWORK,
      message: "ネットワークエラーが発生しました。接続を確認して再度お試しください。",
    };
  }

  return {
    code: error.code || "unknown",
    message: error.message || "予期しないエラーが発生しました。",
  };
}

/**
 * 公開エントリーフォーム向けエラー分類
 * @param {unknown} error
 */
export function classifyEntryError(error) {
  const classified = classifyError(error);
  const isPermissionDenied =
    classified.code === ErrorCodes.PERMISSION_DENIED ||
    error?.code === "permission-denied" ||
    error?.code === "firestore/permission-denied";

  if (isPermissionDenied) {
    return {
      code: ErrorCodes.PERMISSION_DENIED,
      message: "エントリーを送信できませんでした。受付状態または通信環境を確認してください。",
    };
  }
  return classified;
}

/**
 * エントリー管理画面向けエラー分類
 * @param {unknown} error
 */
export function classifyEntryAdminError(error) {
  const classified = classifyError(error);

  if (
    classified.code === ErrorCodes.PERMISSION_DENIED ||
    error?.code === "permission-denied" ||
    error?.code === "firestore/permission-denied"
  ) {
    return {
      code: ErrorCodes.PERMISSION_DENIED,
      message:
        "エントリー一覧を読み込めませんでした（permission-denied）。operators/{uid} の enabled が boolean true か、Security Rules がデプロイ済みか確認してください。",
    };
  }

  if (classified.code === ErrorCodes.TOURNAMENT_NOT_FOUND) {
    return classified;
  }

  if (
    error?.code === "auth/user-token-expired" ||
    error?.code === "auth/requires-recent-login"
  ) {
    return {
      code: "auth/session-expired",
      message: "ログインの有効期限が切れました。再度ログインしてください。",
    };
  }

  if (classified.code === ErrorCodes.NETWORK) {
    return classified;
  }

  return classified;
}

export class OperatorNotRegisteredError extends Error {
  constructor() {
    super("Operator not registered");
    this.code = ErrorCodes.OPERATOR_NOT_REGISTERED;
    this.name = "OperatorNotRegisteredError";
  }
}

export class TournamentManageDeniedError extends Error {
  constructor() {
    super("Tournament manage denied");
    this.code = ErrorCodes.TOURNAMENT_MANAGE_DENIED;
    this.name = "TournamentManageDeniedError";
  }
}

export class ConfigUnconfiguredError extends Error {
  constructor() {
    super("Firebase config unconfigured");
    this.code = ErrorCodes.CONFIG_UNCONFIGURED;
    this.name = "ConfigUnconfiguredError";
  }
}

export class TournamentNotFoundError extends Error {
  constructor() {
    super("Tournament not found");
    this.code = ErrorCodes.TOURNAMENT_NOT_FOUND;
    this.name = "TournamentNotFoundError";
  }
}

export class TournamentDeletedError extends Error {
  constructor() {
    super("Tournament deleted");
    this.code = ErrorCodes.TOURNAMENT_DELETED;
    this.name = "TournamentDeletedError";
  }
}

export class TournamentStructureLockedError extends Error {
  constructor(message = "Tournament structure is locked") {
    super(message);
    this.code = ErrorCodes.TOURNAMENT_STRUCTURE_LOCKED;
    this.name = "TournamentStructureLockedError";
  }
}

export class InvalidTournamentIdError extends Error {
  constructor() {
    super("Invalid tournament id");
    this.code = ErrorCodes.INVALID_TOURNAMENT_ID;
    this.name = "InvalidTournamentIdError";
  }
}

export class InvalidMatchIdError extends Error {
  constructor() {
    super("Invalid match id");
    this.code = ErrorCodes.INVALID_MATCH_ID;
    this.name = "InvalidMatchIdError";
  }
}

export class EntryNotFoundError extends Error {
  constructor() {
    super("Entry not found");
    this.code = ErrorCodes.ENTRY_NOT_FOUND;
    this.name = "EntryNotFoundError";
  }
}
