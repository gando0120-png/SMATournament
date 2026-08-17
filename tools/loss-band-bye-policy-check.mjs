/**
 * Phase 8 方針検証: winner+BYE 同帯 / Olympic / 決勝2人
 */
function makeIds(n) {
  return Array.from({ length: n }, (_, i) => `e${String(i + 1).padStart(3, "0")}`);
}

function pickBye(ids, byeCounts) {
  return [...ids].sort((a, b) => {
    const d = (byeCounts.get(a) ?? 0) - (byeCounts.get(b) ?? 0);
    return d !== 0 ? d : a.localeCompare(b, "en");
  })[0];
}

function simulate(n) {
  const ids = makeIds(n);
  const loss = Object.fromEntries(ids.map((id) => [id, 0]));
  const byeCounts = new Map(ids.map((id) => [id, 0]));
  const played = Object.fromEntries(ids.map((id) => [id, 0]));
  let r5 = null;

  for (let round = 1; round <= 5; round += 1) {
    const bands = {};
    for (const id of ids) {
      const lc = loss[id];
      if (!bands[lc]) bands[lc] = [];
      bands[lc].push(id);
    }
    const next = { ...loss };
    const pools = {};

    for (const lc of Object.keys(bands).map(Number).sort((a, b) => a - b)) {
      const band = bands[lc];
      let playing = [...band].sort((a, b) => a.localeCompare(b, "en"));
      const byes = [];
      if (playing.length % 2 === 1) {
        const bye = pickBye(playing, byeCounts);
        byes.push(bye);
        byeCounts.set(bye, (byeCounts.get(bye) ?? 0) + 1);
        playing = playing.filter((id) => id !== bye);
      }
      const winners = [];
      const losers = [];
      for (let i = 0; i < playing.length; i += 2) {
        const t1 = playing[i];
        const t2 = playing[i + 1];
        played[t1] += 1;
        played[t2] += 1;
        winners.push(t1);
        losers.push(t2);
        next[t2] = loss[t2] + 1;
      }
      pools[lc] = {
        stayers: [...winners, ...byes].sort((a, b) => a.localeCompare(b, "en")),
        losers: [...losers].sort((a, b) => a.localeCompare(b, "en")),
        winners: winners.length,
        byes: byes.length,
        losersN: losers.length,
      };
    }
    Object.assign(loss, next);
    if (round === 5) r5 = pools;
  }

  // Olympic placement
  const finalists = r5[0]?.stayers ?? [];
  const groups = [];
  for (const lc of Object.keys(r5).map(Number).sort((a, b) => a - b)) {
    const p = r5[lc];
    if (lc === 0) {
      // finalists handled separately; losers are 3rd candidates
      if (p.losers.length) {
        groups.push({ lc, kind: "drop", ids: p.losers });
      }
      continue;
    }
    if (p.stayers.length) groups.push({ lc, kind: "stay", ids: p.stayers });
    if (p.losers.length) groups.push({ lc, kind: "drop", ids: p.losers });
  }

  const placement = {};
  let nextRank = 3;
  const plan = [];
  for (const g of groups) {
    plan.push({ placement: nextRank, count: g.ids.length, lc: g.lc, kind: g.kind });
    for (const id of g.ids) placement[id] = nextRank;
    nextRank += g.ids.length;
  }
  // finalists get 1/2 later — count check: placed + finalists === n
  const placedCount = Object.keys(placement).length + finalists.length;

  // Olympic integrity: unique ranks among non-finalists should be competition style
  const ranks = [...new Set(Object.values(placement))].sort((a, b) => a - b);

  return {
    n,
    finalistCount: finalists.length,
    r5Zero: r5[0],
    placedCount,
    nextRankAfter: nextRank,
    // after placing finalists as 1 and 2, max placement among others + gaps
    plan,
    ranks,
    exchangeNeeded: ids.filter((id) => played[id] < 5).length,
    maxBye: Math.max(...[...byeCounts.values()]),
  };
}

const badFinalists = [];
const badCount = [];
for (let n = 33; n <= 64; n += 1) {
  const r = simulate(n);
  if (r.finalistCount !== 2) badFinalists.push({ n, c: r.finalistCount, z: r.r5Zero });
  if (r.placedCount !== n) badCount.push({ n, placedCount: r.placedCount });
}

console.log("finalist≠2:", badFinalists.length ? JSON.stringify(badFinalists) : "none (33-64)");
console.log("placed≠N:", badCount.length ? JSON.stringify(badCount) : "none");

for (const n of [63, 60, 48, 33, 64]) {
  const r = simulate(n);
  console.log(`N=${n} finalists=${r.finalistCount} placed=${r.placedCount} exchange=${r.exchangeNeeded} maxBye=${r.maxBye}`);
  console.log("  plan", JSON.stringify(r.plan));
  console.log("  r5[0]", JSON.stringify(r.r5Zero));
}
