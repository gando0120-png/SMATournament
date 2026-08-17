/**
 * 敗戦帯ペアリング性能テスト（32チーム帯）
 */
import assert from "node:assert/strict";
import {
  pairEntryIdsWithRematchAvoidance,
  countRematchesInPairs,
} from "../../js/domain/loss-band/pairing.js";

const TEAM_COUNT = 32;
const BUDGET_MS = 2000;

function makeIds(n = TEAM_COUNT) {
  return Array.from({ length: n }, (_, i) => `t${String(i + 1).padStart(2, "0")}`);
}

function measure(label, fn) {
  const start = performance.now();
  const result = fn();
  const ms = performance.now() - start;
  console.log(`[perf] ${label}: ${ms.toFixed(1)}ms`);
  assert.ok(ms < BUDGET_MS, `${label} took ${ms.toFixed(1)}ms (budget ${BUDGET_MS}ms)`);
  return { result, ms };
}

function denseHistoryNearComplete(ids) {
  // ほぼ全対戦済み。未対戦エッジをわずかに残すが、完全マッチングは再戦必須。
  const history = {};
  for (const a of ids) {
    history[a] = ids.filter((b) => b !== a);
  }
  // 隣接ペアだけ未対戦にする → 再戦0の隣接マッチングが存在する
  // （厳しいが解あり）: 実際は「多い履歴」用に、未対戦をランダムでなく決定論的に間引く
  for (let i = 0; i < ids.length; i += 2) {
    const a = ids[i];
    const b = ids[i + 1];
    history[a] = history[a].filter((x) => x !== b);
    history[b] = history[b].filter((x) => x !== a);
  }
  return history;
}

function historyNoZeroRematchMatching(ids) {
  // 全ペア対戦済み → 再戦不可避（完全マッチングは必ず再戦）
  const history = {};
  for (const a of ids) {
    history[a] = ids.filter((b) => b !== a);
  }
  return history;
}

function historyHeavyPartial(ids) {
  // 各チームが半数以上と対戦済み（決定論: 次の 20 人）
  const history = {};
  for (let i = 0; i < ids.length; i += 1) {
    const a = ids[i];
    const opponents = [];
    for (let k = 1; k <= 20; k += 1) {
      opponents.push(ids[(i + k) % ids.length]);
    }
    history[a] = opponents;
  }
  return history;
}

{
  const ids = makeIds();

  measure("32 teams / no history", () => {
    const r = pairEntryIdsWithRematchAvoidance(ids, {});
    assert.equal(r.pairs.length, 16);
    assert.equal(r.rematchCount, 0);
    return r;
  });

  measure("32 teams / heavy partial history", () => {
    const history = historyHeavyPartial(ids);
    const r = pairEntryIdsWithRematchAvoidance(ids, history);
    assert.equal(r.pairs.length, 16);
    assert.equal(r.rematchCount, countRematchesInPairs(r.pairs, history));
    return r;
  });

  measure("32 teams / near-complete with rematch-0 adjacent edges", () => {
    const history = denseHistoryNearComplete(ids);
    const r = pairEntryIdsWithRematchAvoidance(ids, history);
    assert.equal(r.pairs.length, 16);
    assert.equal(r.rematchCount, 0);
    return r;
  });

  measure("32 teams / no rematch-0 matching (full history)", () => {
    const history = historyNoZeroRematchMatching(ids);
    const r = pairEntryIdsWithRematchAvoidance(ids, history);
    assert.equal(r.pairs.length, 16);
    assert.equal(r.rematchCount, 16);
    return r;
  });

  // 決定論維持
  const h = historyHeavyPartial(ids);
  const a = pairEntryIdsWithRematchAvoidance(ids, h);
  const b = pairEntryIdsWithRematchAvoidance([...ids].reverse(), h);
  assert.deepEqual(a.pairs, b.pairs);
}

console.log("loss-band pairing performance tests: ok");
