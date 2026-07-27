/**
 * テスト大会一括削除 Rules テスト（クライアントからの大会 delete 拒否）
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  initializeTestEnvironment,
  assertFails,
} from "@firebase/rules-unit-testing";
import { doc, deleteDoc } from "firebase/firestore";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rules = readFileSync(resolve(__dirname, "../../firestore.rules"), "utf8");

const PROJECT_ID = "smatournament-cleanup-rules";
const OPERATOR_UID = "operator-enabled-uid";
const PUBLIC_UID = "public-user-uid";

async function seed(db) {
  await db.doc("operators/operator-enabled-uid").set({
    email: "operator@test.local",
    enabled: true,
    createdAt: new Date(),
  });

  for (const [tournamentId, name] of [
    ["t-e2e", "E2E"],
    ["t-normal", "通常大会"],
  ]) {
    await db.doc(`tournaments/${tournamentId}`).set({
      name,
      status: "open",
      eventDate: "2026-08-01",
      venue: "Test Venue",
      maxTeams: 64,
      teamSize: 1,
      courtCount: 2,
      entryCount: 0,
      confirmedCount: 0,
      createdBy: OPERATOR_UID,
      createdAt: new Date(),
      updatedAt: new Date(),
      entryDeadline: new Date("2099-01-01T00:00:00Z"),
    });
  }
}

const testEnv = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: { rules, host: "127.0.0.1", port: 8090 },
});

await testEnv.withSecurityRulesDisabled(async (context) => {
  await seed(context.firestore());
});

{
  const db = testEnv.authenticatedContext(PUBLIC_UID).firestore();
  await assertFails(deleteDoc(doc(db, "tournaments", "t-e2e")));
  await assertFails(deleteDoc(doc(db, "tournaments", "t-normal")));
}

{
  const db = testEnv.authenticatedContext(OPERATOR_UID).firestore();
  await assertFails(deleteDoc(doc(db, "tournaments", "t-e2e")));
  await assertFails(deleteDoc(doc(db, "tournaments", "t-normal")));
}

await testEnv.cleanup();

console.log("test-tournament-cleanup.rules.test.mjs: all passed");
