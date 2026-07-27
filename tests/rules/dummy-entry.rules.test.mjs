/**
 * ダミー参加者 Firestore Rules テスト（Emulator）
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";
import {
  doc,
  setDoc,
  deleteDoc,
  serverTimestamp,
} from "firebase/firestore";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rules = readFileSync(resolve(__dirname, "../../firestore.rules"), "utf8");

const PROJECT_ID = "smatournament-dummy-entry-rules";
const OPERATOR_UID = "operator-enabled-uid";
const PUBLIC_UID = "public-user-uid";
const TEST_TOURNAMENT_ID = "tournament-e2e-test";
const NORMAL_TOURNAMENT_ID = "tournament-normal";

function tournamentRef(db, tournamentId = TEST_TOURNAMENT_ID) {
  return doc(db, "tournaments", tournamentId);
}

function entryRef(db, entryId, tournamentId = TEST_TOURNAMENT_ID) {
  return doc(db, "tournaments", tournamentId, "entries", entryId);
}

function blockDrawRef(db, tournamentId = TEST_TOURNAMENT_ID) {
  return doc(db, "tournaments", tournamentId, "blockDraw", "current");
}

function validDummyEntryPayload(overrides = {}) {
  return {
    teamName: "ダミーチーム01",
    representativeName: "ダミー代表01",
    email: "dummy-001@example.invalid",
    status: "confirmed",
    isDummy: true,
    dummyBatchId: "batch-123",
    dummyIndex: 1,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  };
}

async function seedTournament(testEnv, tournamentId, name) {
  await testEnv.withSecurityRulesDisabled(async (rulesContext) => {
    const db = rulesContext.firestore();
    await setDoc(tournamentRef(db, tournamentId), {
      name,
      status: "open",
      eventDate: "2026-08-01",
      venue: "Test Venue",
      maxTeams: 64,
      teamSize: 1,
      courtCount: 2,
      preferredBlockSize: 4,
      entryCount: 0,
      confirmedCount: 0,
      createdBy: OPERATOR_UID,
      createdAt: new Date(),
      updatedAt: new Date(),
      entryDeadline: new Date("2099-01-01T00:00:00Z"),
    });
    await setDoc(doc(db, "operators", OPERATOR_UID), {
      email: "operator@test.local",
      enabled: true,
      createdAt: new Date(),
    });
  });
}

async function run() {
  const testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules, host: "127.0.0.1", port: 8090 },
  });

  try {
    await seedTournament(testEnv, TEST_TOURNAMENT_ID, "[E2E] Dummy Rules Test");
    await seedTournament(testEnv, NORMAL_TOURNAMENT_ID, "通常大会");

    const operatorDb = testEnv.authenticatedContext(OPERATOR_UID).firestore();
    const publicDb = testEnv.authenticatedContext(PUBLIC_UID).firestore();
    const unauthDb = testEnv.unauthenticatedContext().firestore();

    await assertSucceeds(setDoc(entryRef(operatorDb, "dummy-1"), validDummyEntryPayload()));
    await assertFails(setDoc(entryRef(publicDb, "dummy-public"), validDummyEntryPayload()));
    await assertFails(setDoc(entryRef(unauthDb, "dummy-unauth"), validDummyEntryPayload()));
    await assertFails(
      setDoc(entryRef(operatorDb, "dummy-normal", NORMAL_TOURNAMENT_ID), validDummyEntryPayload())
    );
    await assertFails(
      setDoc(
        entryRef(operatorDb, "dummy-bad-email"),
        validDummyEntryPayload({ email: "real-user@example.com" })
      )
    );
    await assertFails(
      setDoc(
        entryRef(operatorDb, "dummy-not-flagged"),
        validDummyEntryPayload({ isDummy: false })
      )
    );

    await assertSucceeds(deleteDoc(entryRef(operatorDb, "dummy-1")));

    await testEnv.withSecurityRulesDisabled(async (rulesContext) => {
      const db = rulesContext.firestore();
      await setDoc(entryRef(db, "real-entry"), {
        teamName: "実チーム",
        representativeName: "代表",
        email: "real@example.com",
        status: "confirmed",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });
    await assertFails(deleteDoc(entryRef(operatorDb, "real-entry")));

    await testEnv.withSecurityRulesDisabled(async (rulesContext) => {
      const db = rulesContext.firestore();
      await setDoc(blockDrawRef(db), { status: "draft", blockCount: 4, blocks: [] });
    });
    await assertFails(setDoc(entryRef(operatorDb, "dummy-locked"), validDummyEntryPayload()));

    console.log("dummy-entry.rules.test.mjs: all passed");
  } finally {
    await testEnv.cleanup();
  }
}

run();
