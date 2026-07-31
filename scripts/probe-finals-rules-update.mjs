import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  initializeTestEnvironment,
  assertSucceeds,
} from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc, serverTimestamp, Timestamp } from "firebase/firestore";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rules = readFileSync(resolve(__dirname, "../firestore.rules"), "utf8");
const OP = "op1";

const testEnv = await initializeTestEnvironment({
  projectId: `probe-fmr-${Date.now()}`,
  firestore: { rules, host: "127.0.0.1", port: 8090 },
});

const db = testEnv.authenticatedContext(OP).firestore();

function base(overrides = {}) {
  return {
    name: "SE",
    status: "draft",
    eventDate: "2026-08-01",
    venue: "V",
    entryDeadline: Timestamp.fromDate(new Date("2099-01-01T00:00:00Z")),
    maxTeams: 16,
    teamSize: 2,
    courtCount: 2,
    entryCount: 0,
    confirmedCount: 0,
    publicViewEnabled: true,
    createdBy: OP,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    tournamentFormat: "single_elimination",
    winsRequired: 2,
    ...overrides,
  };
}

async function seed(id, data, subdocs = []) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const d = ctx.firestore();
    await setDoc(doc(d, "operators", OP), {
      email: "a@b.c",
      enabled: true,
      createdAt: new Date(),
    });
    await setDoc(doc(d, "tournaments", id), data);
    for (const [segments, body] of subdocs) {
      await setDoc(doc(d, ...segments), body);
    }
  });
}

async function tryUpdate(id, label) {
  try {
    await assertSucceeds(
      updateDoc(doc(db, "tournaments", id), {
        name: "SE",
        eventDate: "2026-08-01",
        venue: "V",
        entryDeadline: Timestamp.fromDate(new Date("2099-01-01T00:00:00Z")),
        courtCount: 2,
        maxTeams: 16,
        teamSize: 2,
        winsRequired: 2,
        finalsMatchRules: {
          defaultWinsRequired: 2,
          roundOverrides: { final: 3 },
        },
        updatedAt: serverTimestamp(),
      })
    );
    console.log(`${label}: SUCCESS`);
  } catch {
    console.log(`${label}: FAIL`);
  }
}

try {
  await seed("a", base());
  await tryUpdate("a", "A no extras");

  await seed("b", base({ preferredBlockSize: 4 }));
  await tryUpdate("b", "B SE+preferredBlockSize");

  await seed("c", base({ structureLocked: false }));
  await tryUpdate("c", "C structureLocked false");

  await seed("d", base(), [
    [["tournaments", "d", "finalsBracket", "current"], { matches: [], bracketSize: 0 }],
  ]);
  await tryUpdate("d", "D empty finalsBracket");

  await seed("e", base(), [
    [["tournaments", "e", "finalsAdvancement", "current"], { teams: [] }],
  ]);
  await tryUpdate("e", "E empty finalsAdvancement");

  // wins-only payload
  await seed("f", base());
  try {
    await assertSucceeds(
      updateDoc(doc(db, "tournaments", "f"), {
        winsRequired: 2,
        finalsMatchRules: {
          defaultWinsRequired: 2,
          roundOverrides: { final: 3 },
        },
        updatedAt: serverTimestamp(),
      })
    );
    console.log("F wins-only payload: SUCCESS");
  } catch {
    console.log("F wins-only payload: FAIL");
  }
} finally {
  await testEnv.cleanup();
}
