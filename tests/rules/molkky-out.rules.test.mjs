/**
 * molkkyOutResolutions Firestore Rules テスト
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";
import { doc, setDoc, serverTimestamp, Timestamp } from "firebase/firestore";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rules = readFileSync(resolve(__dirname, "../../firestore.rules"), "utf8");

const PROJECT_ID = "smatournament-molkky-out-rules-test";
const OPERATOR_UID = "operator-molkky-out-test";
const TOURNAMENT_ID = "molkky-out-tournament";

function tournamentRef(db, tournamentId) {
  return doc(db, "tournaments", tournamentId);
}

function molkkyRef(db, tournamentId) {
  return doc(db, "tournaments", tournamentId, "molkkyOutResolutions", "current");
}

function advancementRef(db, tournamentId) {
  return doc(db, "tournaments", tournamentId, "finalsAdvancement", "current");
}

async function seed(testEnv) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "operators", OPERATOR_UID), {
      email: "operator@test.local",
      enabled: true,
      createdAt: new Date(),
    });
    await setDoc(tournamentRef(db, TOURNAMENT_ID), {
      name: "Molkky Out Rules Test",
      status: "open",
      eventDate: "2026-08-01",
      venue: "Test Venue",
      entryDeadline: Timestamp.fromDate(new Date("2099-01-01T00:00:00Z")),
      maxTeams: 32,
      teamSize: 4,
      courtCount: 2,
      entryCount: 0,
      confirmedCount: 0,
      createdBy: OPERATOR_UID,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });
}

async function run() {
  const testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules, host: "127.0.0.1", port: 8090 },
  });

  try {
    await seed(testEnv);
    const operatorDb = testEnv.authenticatedContext(OPERATOR_UID).firestore();
    const strangerDb = testEnv.authenticatedContext("stranger").firestore();

    await assertSucceeds(
      setDoc(molkkyRef(operatorDb, TOURNAMENT_ID), {
        blockGroups: [
          {
            blockId: "A",
            entryIds: ["e1", "e2"],
            orderedEntryIds: ["e2", "e1"],
          },
        ],
        wildcardGroups: [],
        updatedAt: serverTimestamp(),
      })
    );

    await assertFails(
      setDoc(molkkyRef(strangerDb, TOURNAMENT_ID), {
        blockGroups: [],
        wildcardGroups: [],
        updatedAt: serverTimestamp(),
      })
    );

    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(advancementRef(db, TOURNAMENT_ID), {
        finalized: true,
        finalTeamCount: 8,
        qualifiers: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });

    await assertFails(
      setDoc(molkkyRef(operatorDb, TOURNAMENT_ID), {
        blockGroups: [],
        wildcardGroups: [],
        updatedAt: serverTimestamp(),
      })
    );

    console.log("molkky-out.rules.test.mjs: all passed");
  } finally {
    await testEnv.cleanup();
  }
}

await run();
