/**
 * 運営参加辞退 Firestore Rules テスト（Emulator）
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc, serverTimestamp } from "firebase/firestore";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rules = readFileSync(resolve(__dirname, "../../firestore.rules"), "utf8");

const PROJECT_ID = "smatournament-entry-cancel-rules";
const OPERATOR_UID = "operator-enabled-uid";
const PUBLIC_UID = "public-user-uid";
const TOURNAMENT_ID = "tournament-entry-cancel";

function tournamentRef(db) {
  return doc(db, "tournaments", TOURNAMENT_ID);
}

function entryRef(db, entryId) {
  return doc(db, "tournaments", TOURNAMENT_ID, "entries", entryId);
}

function blockDrawRef(db) {
  return doc(db, "tournaments", TOURNAMENT_ID, "blockDraw", "current");
}

function scheduleRef(db) {
  return doc(db, "tournaments", TOURNAMENT_ID, "qualifyingSchedules", "current");
}

async function seedTournament(context, overrides = {}) {
  await context.withSecurityRulesDisabled(async (rulesContext) => {
    const db = rulesContext.firestore();
    await setDoc(doc(db, "operators", OPERATOR_UID), {
      email: "operator@test.local",
      enabled: true,
      createdAt: new Date(),
    });
    await setDoc(tournamentRef(db), {
      name: "Entry Cancel Tournament",
      status: "open",
      eventDate: "2026-08-01",
      venue: "Test Venue",
      maxTeams: 8,
      teamSize: 2,
      courtCount: 2,
      preferredBlockSize: 4,
      entryCount: 2,
      confirmedCount: 1,
      createdBy: OPERATOR_UID,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    });
    await setDoc(entryRef(db, "pending-entry"), {
      teamName: "Pending Team",
      representativeName: "Rep P",
      email: "pending@example.com",
      status: "pending",
      createdAt: new Date(),
    });
    await setDoc(entryRef(db, "confirmed-entry"), {
      teamName: "Confirmed Team",
      representativeName: "Rep C",
      email: "confirmed@example.com",
      status: "confirmed",
      createdAt: new Date(),
    });
    await setDoc(entryRef(db, "cancelled-entry"), {
      teamName: "Already Cancelled",
      representativeName: "Rep X",
      email: "cancelled@example.com",
      status: "cancelled",
      createdAt: new Date(),
    });
  });
}

function cancelPayload() {
  return {
    status: "cancelled",
    updatedAt: serverTimestamp(),
    cancelledAt: serverTimestamp(),
  };
}

async function run() {
  const testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules, host: "127.0.0.1", port: 8090 },
  });

  try {
    await seedTournament(testEnv);

    const publicDb = testEnv.authenticatedContext(PUBLIC_UID).firestore();
    const operatorDb = testEnv.authenticatedContext(OPERATOR_UID).firestore();

    await assertSucceeds(
      updateDoc(entryRef(operatorDb, "pending-entry"), {
        status: "confirmed",
        updatedAt: serverTimestamp(),
      })
    );

    await testEnv.withSecurityRulesDisabled(async (rulesContext) => {
      const db = rulesContext.firestore();
      await setDoc(entryRef(db, "pending-entry"), {
        teamName: "Pending Team",
        representativeName: "Rep P",
        email: "pending@example.com",
        status: "pending",
        createdAt: new Date(),
      });
    });

    await assertSucceeds(updateDoc(entryRef(operatorDb, "confirmed-entry"), cancelPayload()));

    await testEnv.withSecurityRulesDisabled(async (rulesContext) => {
      const db = rulesContext.firestore();
      await setDoc(entryRef(db, "confirmed-entry"), {
        teamName: "Confirmed Team",
        representativeName: "Rep C",
        email: "confirmed@example.com",
        status: "confirmed",
        createdAt: new Date(),
      });
    });

    await assertFails(updateDoc(entryRef(publicDb, "confirmed-entry"), cancelPayload()));

    await assertFails(
      updateDoc(entryRef(operatorDb, "cancelled-entry"), {
        status: "confirmed",
        updatedAt: serverTimestamp(),
      })
    );

    await assertFails(updateDoc(entryRef(operatorDb, "pending-entry"), cancelPayload()));

    await assertFails(
      updateDoc(entryRef(operatorDb, "confirmed-entry"), {
        status: "pending",
        updatedAt: serverTimestamp(),
      })
    );

    await assertSucceeds(
      updateDoc(entryRef(operatorDb, "confirmed-entry"), {
        teamName: "Confirmed Renamed",
        representativeName: "Rep C2",
        email: "confirmed2@example.com",
        updatedAt: serverTimestamp(),
      })
    );

    await testEnv.withSecurityRulesDisabled(async (rulesContext) => {
      const db = rulesContext.firestore();
      await setDoc(blockDrawRef(db), {
        status: "finalized",
        blocks: [{ id: "A", entryIds: ["confirmed-entry"] }],
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });
    await assertFails(updateDoc(entryRef(operatorDb, "confirmed-entry"), cancelPayload()));

    await testEnv.withSecurityRulesDisabled(async (rulesContext) => {
      const db = rulesContext.firestore();
      await setDoc(blockDrawRef(db), {
        status: "draft",
        blocks: [{ id: "A", entryIds: ["confirmed-entry"] }],
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });
    await assertFails(updateDoc(entryRef(operatorDb, "confirmed-entry"), cancelPayload()));

    await testEnv.clearFirestore();
    await seedTournament(testEnv);
    await testEnv.withSecurityRulesDisabled(async (rulesContext) => {
      const db = rulesContext.firestore();
      await setDoc(scheduleRef(db), {
        finalized: true,
        blocks: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });
    const operatorDbAfterSchedule = testEnv.authenticatedContext(OPERATOR_UID).firestore();
    await assertFails(
      updateDoc(entryRef(operatorDbAfterSchedule, "confirmed-entry"), cancelPayload())
    );

    await testEnv.clearFirestore();
    await seedTournament(testEnv, { status: "closed" });
    const operatorDbClosed = testEnv.authenticatedContext(OPERATOR_UID).firestore();
    await assertFails(updateDoc(entryRef(operatorDbClosed, "confirmed-entry"), cancelPayload()));

    console.log("entry-cancel.rules.test: ok");
  } finally {
    await testEnv.cleanup();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
