/**
 * 公開スナップショット再生成フック（循環 import 回避のため dynamic import）
 */

/**
 * @param {string} tournamentId
 * @returns {Promise<{ ok: true } | { ok: false, error: unknown }>}
 */
export async function notifyPublicSnapshotRebuild(tournamentId) {
  if (!tournamentId) {
    return { ok: false, error: new Error("tournamentId is required") };
  }

  try {
    const { rebuildPublicTournamentSnapshot } = await import(
      "../services/public-tournament-snapshot-service.js"
    );
    await rebuildPublicTournamentSnapshot(tournamentId);
    return { ok: true };
  } catch (error) {
    console.error("[publicSnapshot] rebuild failed", { tournamentId, error });
    return { ok: false, error };
  }
}

/**
 * @param {string} tournamentId
 * @param {object} result
 */
export async function withPublicSnapshotRebuild(tournamentId, result) {
  const snapshotRebuild = await notifyPublicSnapshotRebuild(tournamentId);
  return { ...result, snapshotRebuild };
}
