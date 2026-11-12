/**
 * 辞退 Callable 本体。Firestore は偽物。エントリー以外を書かないことと、二重実行を見る。
 */
import assert from "node:assert/strict";
import { withdrawConfirmedEntryAfterSchedule } from "../src/qualifying-withdrawal.js";

function createStore() {
  const docs = new Map();
  const writes = [];

  function snap(path) {
    const data = docs.has(path) ? docs.get(path) : undefined;
    return {
      id: path.split("/").pop(),
      exists: data !== undefined,
      data() {
        return data;
      },
    };
  }

  function ref(path) {
    return {
      path,
      id: path.split("/").pop(),
      get: async () => snap(path),
      collection(name) {
        return collection(`${path}/${name}`);
      },
    };
  }

  function collection(path) {
    return {
      path,
      doc(id) {
        return ref(`${path}/${id}`);
      },
      limit() {
        return {
          async get() {
            const prefix = `${path}/`;
            const found = [...docs.keys()].filter((key) => {
              if (!key.startsWith(prefix)) {
                return false;
              }
              return !key.slice(prefix.length).includes("/");
            });
            return {
              empty: found.length === 0,
              docs: found.map((key) => snap(key)),
            };
          },
        };
      },
    };
  }

  const db = {
    collection(name) {
      return collection(name);
    },
    async runTransaction(fn) {
      const tx = {
        get(target) {
          return target.get();
        },
        update(target, patch) {
          writes.push({ path: target.path, patch });
          const current = docs.get(target.path) || {};
          docs.set(target.path, { ...current, ...patch, status: patch.status });
        },
      };
      await fn(tx);
    },
  };

  return { docs, writes, db };
}

const schedule = {
  finalized: true,
  blocks: [
    {
      blockId: "A",
      blockName: "A",
      rounds: [
        {
          roundNumber: 1,
          matches: [
            {
              matchId: "qualifying-A-R1-M1",
              courtNumber: 1,
              team1: { entryId: "e1", teamName: "甲" },
              team2: { entryId: "e2", teamName: "乙" },
            },
            {
              matchId: "qualifying-A-R1-M2",
              courtNumber: 2,
              team1: { entryId: "e3", teamName: "丙" },
              team2: { entryId: "e4", teamName: "丁" },
            },
          ],
        },
      ],
    },
  ],
};

function seed(store) {
  store.docs.set("tournaments/t1", { id: "t1", status: "open", name: "検証" });
  store.docs.set("tournaments/t1/entries/e1", {
    teamName: "甲",
    status: "confirmed",
  });
  store.docs.set("tournaments/t1/blockDraw/current", {
    status: "finalized",
    blocks: [{ id: "A", name: "A", entryIds: ["e1", "e2", "e3", "e4"] }],
  });
  store.docs.set("tournaments/t1/qualifyingSchedules/current", structuredClone(schedule));
}

const store = createStore();
seed(store);
const scheduleBefore = JSON.stringify(store.docs.get("tournaments/t1/qualifyingSchedules/current"));
const drawBefore = JSON.stringify(store.docs.get("tournaments/t1/blockDraw/current"));
const otherEntryBefore = JSON.stringify(store.docs.get("tournaments/t1/entries/e1"));

const preview = await withdrawConfirmedEntryAfterSchedule(store.db, {
  tournamentId: "t1",
  entryId: "e1",
  dryRun: true,
});
assert.equal(preview.allowed, true);
assert.equal(preview.applied, false);
assert.equal(store.writes.length, 0);
assert.deepEqual(preview.voidMatches.map((match) => match.matchId), ["qualifying-A-R1-M1"]);

const applied = await withdrawConfirmedEntryAfterSchedule(store.db, {
  tournamentId: "t1",
  entryId: "e1",
  dryRun: false,
});
assert.equal(applied.applied, true);
assert.equal(store.writes.length, 1);
assert.equal(store.writes[0].path, "tournaments/t1/entries/e1");
assert.equal(store.writes[0].patch.status, "cancelled");
assert.equal(store.docs.get("tournaments/t1/entries/e1").status, "cancelled");
assert.equal(JSON.stringify(store.docs.get("tournaments/t1/qualifyingSchedules/current")), scheduleBefore);
assert.equal(JSON.stringify(store.docs.get("tournaments/t1/blockDraw/current")), drawBefore);

const second = await withdrawConfirmedEntryAfterSchedule(store.db, {
  tournamentId: "t1",
  entryId: "e1",
  dryRun: false,
});
assert.equal(second.alreadyApplied, true);
assert.equal(second.applied, false);
assert.equal(store.writes.length, 1);

store.docs.set("tournaments/t1/entries/e1", JSON.parse(otherEntryBefore));
store.docs.set("tournaments/t1/qualifyingMatchResults/qualifying-A-R1-M2", { status: "finished" });
await assert.rejects(
  () =>
    withdrawConfirmedEntryAfterSchedule(store.db, {
      tournamentId: "t1",
      entryId: "e1",
      dryRun: false,
    }),
  (error) => error.code === "entry/withdrawal-started"
);
assert.equal(store.docs.get("tournaments/t1/entries/e1").status, "confirmed");
assert.equal(JSON.stringify(store.docs.get("tournaments/t1/qualifyingSchedules/current")), scheduleBefore);

console.log("qualifying-withdrawal.functions.test.mjs: ok");
