/**
 * 公開エントリーフォーム向け Firestore 操作ログ（一時診断用）
 */

/**
 * @param {string} operation
 * @param {string} path
 * @param {unknown} error
 */
export function logEntryFirestoreFailure(operation, path, error) {
  console.error(`[entry] ${operation} failed`, path, error?.code ?? "(no code)", error);
}

/**
 * @param {string} operation
 * @param {string} path
 * @param {object} [detail]
 */
export function logEntryFirestoreSuccess(operation, path, detail) {
  console.info(`[entry] ${operation} ok`, path, detail ?? "");
}
