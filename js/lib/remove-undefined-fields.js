/**
 * Firestore updateDoc 向けに undefined を再帰除去する。
 * null / "" / 0 / false は保持する。
 * @param {unknown} value
 * @returns {unknown}
 */
export function removeUndefinedFields(value) {
  if (Array.isArray(value)) {
    return value
      .map(removeUndefinedFields)
      .filter((item) => item !== undefined);
  }

  if (value && typeof value === "object") {
    // Timestamp / Date / FieldValue 等はそのまま通す
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      return value;
    }

    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, removeUndefinedFields(item)])
    );
  }

  return value;
}

/**
 * オブジェクト内に undefined が残っていないか検査する。
 * @param {unknown} value
 * @param {string} [path]
 * @returns {string[]} 見つかったパス一覧
 */
export function findUndefinedFieldPaths(value, path = "") {
  if (value === undefined) {
    return [path || "(root)"];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      findUndefinedFieldPaths(item, path ? `${path}[${index}]` : `[${index}]`)
    );
  }
  if (value && typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      return [];
    }
    return Object.entries(value).flatMap(([key, item]) =>
      findUndefinedFieldPaths(item, path ? `${path}.${key}` : key)
    );
  }
  return [];
}
