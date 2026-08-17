/**
 * Phase 8 調査専用: BYE 込み loss-band 帯推移・R5固定マッピング可否
 * （本番 domain は変更しない）
 */
import assert from "node:assert/strict";

const R5_PLACEMENT_SPEC = [
  { lossCount: 0, outcome: "winner", placement: null, count: 2 },
  { lossCount: 0, outcome: "loser", placement: 3, count: 2 },
  { lossCount: 1, outcome: "winner", placement: 5, count: 8 },
  { lossCount: 1, outcome: "loser", placement: 13, count: 8 },
  { lossCount: 2, outcome: "winner", placement: 21, count: 12 },
  { lossCount: 2, outcome: "loser", placement: 33, count: 12 },
  { lossCount: 3, outcome: "winner", placement: 45, count: 8 },
  { lossCount: 3, outcome: "loser", placement: 53, count: 8 },
  { lossCount: 4, outcome: "winner", placement: 61, count: 2 },
  { lossCount: 4, outcome: "loser", placement: 63, count: 2 },
];

function makeIds(n) {
  return Array.from({ length: n }, (_, i) => `e${String(i + 1).padStart(3, "0")}`);
}

/**
 * 公平BYE: 過去BYE少 → entryId順
 * @param {string[]} ids sorted band
 * @param {Map<string, number>} byeCounts
 */
function pickByeEntryId(ids, byeCounts) {
  const sorted = [...ids].sort((a, b) => {
    const ca = byeCounts.get(a) ?? 0;
    const cb = byeCounts.get(b) ?? 0;
    if (ca !== cb) return ca - cb;
    return a.localeCompare(b, "en");
  });
  return sorted[0];
}

/**
 * 帯内ペアリング（BYE先決定 → 残りを entryId 順隣接）
 */
function pairBand(ids, byeCounts) {
  const sorted = [...ids].sort((a, b) => a.localeCompare(b, "en"));
  let byeEntryId = null;
  let playing = sorted;
  if (sorted.length % 2 === 1) {
    byeEntryId = pickByeEntryId(sorted, byeCounts);
    playing = sorted.filter((id) => id !== byeEntryId);
  }
  const pairs = [];
  for (let i = 0; i + 1 < playing.length; i += 2) {
    pairs.push([playing[i], playing[i + 1]]);
  }
  return { byeEntryId, pairs };
}

/**
 * team1 常勝の決定論シミュレーション
 */
function simulate(n, { rematchAvoidance = false } = {}) {
  const ids = makeIds(n);
  /** @type {Record<string, { lossCount: number, played: number, byes: number }>} */
  const teams = Object.fromEntries(
    ids.map((id) => [id, { lossCount: 0, played: 0, byes: 0 }])
  );
  const byeCounts = new Map(ids.map((id) => [id, 0]));
  /** @type {Array<[string, string]>} */
  const playedPairs = [];
  const rematchPairs = [];
  const rounds = [];

  for (let round = 1; round <= 5; round += 1) {
    /** @type {Record<number, string[]>} */
    const bands = {};
    for (const id of ids) {
      const lc = teams[id].lossCount;
      if (!bands[lc]) bands[lc] = [];
      bands[lc].push(id);
    }
    const bandCounts = Object.fromEntries(
      Object.keys(bands)
        .map(Number)
        .sort((a, b) => a - b)
        .map((k) => [k, bands[k].length])
    );

    let roundByes = 0;
    let roundMatches = 0;
    /** @type {Record<number, { size: number, byes: number, matches: number, byeIds: string[] }>} */
    const bandDetail = {};

    // apply results into next loss counts
    /** @type {Record<string, number>} */
    const nextLoss = {};
    for (const id of ids) nextLoss[id] = teams[id].lossCount;

    for (const lossCount of Object.keys(bands)
      .map(Number)
      .sort((a, b) => a - b)) {
      const bandIds = bands[lossCount];
      const { byeEntryId, pairs } = pairBand(bandIds, byeCounts);
      const byeIds = [];
      if (byeEntryId) {
        byeIds.push(byeEntryId);
        byeCounts.set(byeEntryId, (byeCounts.get(byeEntryId) ?? 0) + 1);
        teams[byeEntryId].byes += 1;
        roundByes += 1;
        // BYE: lossCount unchanged, not played
      }

      for (const [t1, t2] of pairs) {
        roundMatches += 1;
        const rematch = playedPairs.some(
          ([a, b]) =>
            (a === t1 && b === t2) || (a === t2 && b === t1)
        );
        if (rematch) rematchPairs.push([t1, t2, round, lossCount]);
        playedPairs.push([t1, t2]);
        teams[t1].played += 1;
        teams[t2].played += 1;
        // team1 wins
        nextLoss[t2] = teams[t2].lossCount + 1;
        // winner stays
      }

      bandDetail[lossCount] = {
        size: bandIds.length,
        byes: byeIds.length,
        matches: pairs.length,
        byeIds,
      };
    }

    for (const id of ids) {
      teams[id].lossCount = nextLoss[id];
    }

    rounds.push({
      round,
      bandCounts,
      bandDetail,
      roundByes,
      roundMatches,
    });
  }

  // R5 outcome pools: reconstruct last round from final loss? Better track R5 outcomes.
  // Re-simulate R5 outcomes by storing them during round 5.
  return { n, ids, teams, byeCounts, rounds, rematchPairs, playedPairs };
}

/**
 * より正確に R5 の winner/loser/bye プールを取るため、最終ラウンドを再走査
 */
function simulateWithR5Pools(n) {
  const ids = makeIds(n);
  const teams = Object.fromEntries(
    ids.map((id) => [id, { lossCount: 0, played: 0, byes: 0 }])
  );
  const byeCounts = new Map(ids.map((id) => [id, 0]));
  const playedPairs = [];
  const rematchPairs = [];
  const rounds = [];
  /** @type {Map<number, { winners: string[], losers: string[], byes: string[] }>} */
  let r5Pools = new Map();

  for (let round = 1; round <= 5; round += 1) {
    const bands = {};
    for (const id of ids) {
      const lc = teams[id].lossCount;
      if (!bands[lc]) bands[lc] = [];
      bands[lc].push(id);
    }
    const bandCounts = Object.fromEntries(
      Object.keys(bands)
        .map(Number)
        .sort((a, b) => a - b)
        .map((k) => [k, bands[k].length])
    );

    let roundByes = 0;
    let roundMatches = 0;
    const bandDetail = {};
    const nextLoss = {};
    for (const id of ids) nextLoss[id] = teams[id].lossCount;

    if (round === 5) {
      r5Pools = new Map();
    }

    for (const lossCount of Object.keys(bands)
      .map(Number)
      .sort((a, b) => a - b)) {
      const bandIds = bands[lossCount];
      const { byeEntryId, pairs } = pairBand(bandIds, byeCounts);
      const byeIds = [];
      if (byeEntryId) {
        byeIds.push(byeEntryId);
        byeCounts.set(byeEntryId, (byeCounts.get(byeEntryId) ?? 0) + 1);
        teams[byeEntryId].byes += 1;
        roundByes += 1;
      }

      const winners = [];
      const losers = [];
      for (const [t1, t2] of pairs) {
        roundMatches += 1;
        const rematch = playedPairs.some(
          ([a, b]) =>
            (a === t1 && b === t2) || (a === t2 && b === t1)
        );
        if (rematch) rematchPairs.push({ t1, t2, round, lossCount });
        playedPairs.push([t1, t2]);
        teams[t1].played += 1;
        teams[t2].played += 1;
        winners.push(t1);
        losers.push(t2);
        nextLoss[t2] = teams[t2].lossCount + 1;
      }

      bandDetail[lossCount] = {
        size: bandIds.length,
        byes: byeIds.length,
        matches: pairs.length,
        byeIds: [...byeIds],
      };

      if (round === 5) {
        r5Pools.set(lossCount, {
          winners: [...winners].sort((a, b) => a.localeCompare(b, "en")),
          losers: [...losers].sort((a, b) => a.localeCompare(b, "en")),
          byes: [...byeIds].sort((a, b) => a.localeCompare(b, "en")),
        });
      }
    }

    for (const id of ids) teams[id].lossCount = nextLoss[id];

    rounds.push({ round, bandCounts, bandDetail, roundByes, roundMatches });
  }

  // Check fixed R5_PLACEMENT_SPEC
  const fixedMappingErrors = [];
  for (const spec of R5_PLACEMENT_SPEC) {
    const pool = r5Pools.get(spec.lossCount);
    const got =
      spec.outcome === "winner"
        ? pool?.winners.length ?? 0
        : pool?.losers.length ?? 0;
    if (got !== spec.count) {
      fixedMappingErrors.push({
        lossCount: spec.lossCount,
        outcome: spec.outcome,
        expected: spec.count,
        got,
        byeInBand: pool?.byes.length ?? 0,
      });
    }
  }

  // Dynamic Olympic-style placement proposal:
  // order groups: lossAsc, then outcome rank winner < bye < loser
  // 0-loss winners → finalists (need exactly? or all undefeated winners?)
  const outcomeRank = { winner: 0, bye: 1, loser: 2 };
  const groups = [];
  for (const [lossCount, pool] of [...r5Pools.entries()].sort(
    (a, b) => a[0] - b[0]
  )) {
    for (const outcome of ["winner", "bye", "loser"]) {
      const list = pool[outcome === "winner" ? "winners" : outcome === "bye" ? "byes" : "losers"];
      if (list.length === 0) continue;
      groups.push({ lossCount, outcome, count: list.length, entryIds: list });
    }
  }
  groups.sort((a, b) => {
    if (a.lossCount !== b.lossCount) return a.lossCount - b.lossCount;
    return outcomeRank[a.outcome] - outcomeRank[b.outcome];
  });

  // finalists = 0-loss winners (may not be 2)
  const finalistGroup = groups.find(
    (g) => g.lossCount === 0 && g.outcome === "winner"
  );
  const finalistCount = finalistGroup?.count ?? 0;

  // assign placement starts after reserving 1,2 for final
  let nextRank = 3;
  const placementPlan = [];
  for (const g of groups) {
    if (g.lossCount === 0 && g.outcome === "winner") {
      placementPlan.push({
        ...g,
        placement: null,
        note: "finalists",
      });
      continue;
    }
    placementPlan.push({
      ...g,
      placement: nextRank,
      tied: g.count > 1,
    });
    nextRank += g.count;
  }

  const byeHist = [...byeCounts.entries()]
    .map(([id, c]) => ({ id, c }))
    .sort((a, b) => b.c - a.c || a.id.localeCompare(b.id));
  const maxByes = byeHist[0]?.c ?? 0;
  const minByes = byeHist[byeHist.length - 1]?.c ?? 0;
  const playedList = ids.map((id) => teams[id].played);
  const minPlayed = Math.min(...playedList);
  const maxPlayed = Math.max(...playedList);
  const guaranteed = 5;
  const exchangeNeeded = ids.filter((id) => teams[id].played < guaranteed).length;
  const exchangeDeficit = ids.reduce(
    (sum, id) => sum + Math.max(0, guaranteed - teams[id].played),
    0
  );

  // R5 bye teams exist?
  const r5ByeTotal = [...r5Pools.values()].reduce((s, p) => s + p.byes.length, 0);

  return {
    n,
    rounds: rounds.map((r) => ({
      round: r.round,
      bandCounts: r.bandCounts,
      byes: r.roundByes,
      matches: r.roundMatches,
      bandDetail: Object.fromEntries(
        Object.entries(r.bandDetail).map(([k, v]) => [
          k,
          { size: v.size, byes: v.byes, matches: v.matches },
        ])
      ),
    })),
    r5Pools: Object.fromEntries(
      [...r5Pools.entries()].map(([k, v]) => [
        k,
        {
          winners: v.winners.length,
          losers: v.losers.length,
          byes: v.byes.length,
        },
      ])
    ),
    fixedMappingOk: fixedMappingErrors.length === 0,
    fixedMappingErrors,
    finalistCount,
    r5ByeTotal,
    placementPlan: placementPlan.map((g) => ({
      lossCount: g.lossCount,
      outcome: g.outcome,
      count: g.count,
      placement: g.placement,
      note: g.note ?? null,
    })),
    byeStats: { maxByes, minByes, totalByes: rounds.reduce((s, r) => s + r.roundByes, 0) },
    playedStats: { minPlayed, maxPlayed, exchangeNeeded, exchangeDeficit },
    rematchCount: rematchPairs.length,
    placementRecordCount: n,
  };
}

const sizes = [63, 60, 48, 33, 64];
const reports = sizes.map((n) => simulateWithR5Pools(n));

for (const r of reports) {
  console.log("\n========== N=" + r.n + " ==========");
  console.log("rounds:");
  for (const round of r.rounds) {
    console.log(
      `  R${round.round}: bands=${JSON.stringify(round.bandCounts)} byes=${round.byes} matches=${round.matches}`
    );
  }
  console.log("r5Pools:", JSON.stringify(r.r5Pools));
  console.log("fixed R5_PLACEMENT_SPEC applicable?", r.fixedMappingOk);
  if (!r.fixedMappingOk) {
    console.log("  mismatches:", JSON.stringify(r.fixedMappingErrors));
  }
  console.log("finalistCount (0-loss R5 winners):", r.finalistCount);
  console.log("r5ByeTotal:", r.r5ByeTotal);
  console.log("dynamic placement plan:", JSON.stringify(r.placementPlan));
  console.log("byeStats:", r.byeStats);
  console.log("playedStats:", r.playedStats);
  console.log("rematchCount:", r.rematchCount);
  console.log("placementRecordCount:", r.placementRecordCount);
}

// Sanity: 64 should match fixed mapping under this pairing (may differ from production pairing!)
{
  const r64 = reports.find((r) => r.n === 64);
  // With naive adjacent pairing + team1 wins, band evolution should match EXPECTED for 64 if no BYEs
  assert.equal(r64.rounds[0].byes, 0);
  assert.deepEqual(r64.rounds[0].bandCounts, { 0: 64 });
  assert.deepEqual(r64.rounds[1].bandCounts, { 0: 32, 1: 32 });
  console.log("\n64 baseline bye-free band evolution: OK");
  console.log("64 fixedMappingOk:", r64.fixedMappingOk);
}

console.log("\n=== VERDICT ===");
const broken = reports.filter((r) => r.n !== 64 && !r.fixedMappingOk);
console.log(
  `Current R5_PLACEMENT_SPEC fails for: ${broken.map((r) => r.n).join(", ") || "(none)"}`
);
const finalistIssues = reports.filter((r) => r.n !== 64 && r.finalistCount !== 2);
console.log(
  `finalistCount !== 2 for: ${finalistIssues.map((r) => `${r.n}→${r.finalistCount}`).join(", ") || "(none)"}`
);
const r5ByeIssues = reports.filter((r) => r.n !== 64 && r.r5ByeTotal > 0);
console.log(
  `R5 BYE teams for: ${r5ByeIssues.map((r) => `${r.n}→${r.r5ByeTotal}`).join(", ") || "(none)"}`
);
