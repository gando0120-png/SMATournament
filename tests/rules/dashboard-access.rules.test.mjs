/**
 * 大会管理ダッシュボード Firestore GET/list Rules テスト（Emulator）
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
  getDoc,
  collection,
  getDocs,
  query,
  orderBy,
} from "firebase/firestore";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rules = readFileSync(resolve(__dirname, "../../firestore.rules"), "utf8");

const PROJECT_ID = "smatournament-dashboard-access-rules";
const OPERATOR_UID = "operator-enabled-uid";
const OWNER_UID = "owner-only-uid";
const PUBLIC_UID = "public-user-uid";
const TOURNAMENT_ID = "dashboard-access-target";

function tournamentRef(db) {
  return doc(db, "tournaments", TOURNAMENT_ID);
}

async function seedTournament(context, { createdBy = OPERATOR_UID, isDeleted } = {}) {
  await context.withSecurityRulesDisabled(async (db) => {
    const payload = {
      name: "Dashboard Access Tournament",
      status: "draft",
      eventDate: "2026-09-01",
      venue: "Venue A",
      entryDeadline: new Date("2099-01-01T00:00:00Z"),
      maxTeams: 8,
      teamSize: 4,
      courtCount: 2,
      preferredBlockSize: 4,
      entryCount: 0,
      confirmedCount: 0,
      publicViewEnabled: true,
      createdBy,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    if (isDeleted === false) {
      payload.isDeleted = false;
    }
    await setDoc(tournamentRef(db), payload);
    await setDoc(doc(db, "operators", OPERATOR_UID), {
      email: "operator@test.local",
      enabled: true,
      createdAt: new Date(),
    });
    await setDoc(doc(db, "tournaments", TOURNAMENT_ID, "entries", "entry-1"), {
      teamName: "Team A",
      representativeName: "Rep",
      email: "team@example.com",
      status: "pending",
      createdAt: new Date(),
    });
    await setDoc(doc(db, "tournaments", TOURNAMENT_ID, "blockDraw", "current"), {
      status: "finalized",
      blocks: [],
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
    await seedTournament(testEnv);
    const operatorDb = testEnv.authenticatedContext(OPERATOR_UID).firestore();
    const ownerDb = testEnv.authenticatedContext(OWNER_UID).firestore();
    const publicDb = testEnv.authenticatedContext(PUBLIC_UID).firestore();
    const unauthDb = testEnv.unauthenticatedContext().firestore();

    // 既存大会（isDeleted なし）
    await assertSucceeds(getDoc(tournamentRef(operatorDb)));
    await assertFails(getDoc(tournamentRef(publicDb)));
    await assertFails(getDoc(tournamentRef(unauthDb)));

    // entries list
    await assertSucceeds(
      getDocs(
        query(
          collection(operatorDb, "tournaments", TOURNAMENT_ID, "entries"),
          orderBy("createdAt", "desc")
        )
      )
    );
    await assertFails(
      getDocs(collection(publicDb, "tournaments", TOURNAMENT_ID, "entries"))
    );

    // current docs
    await assertSucceeds(
      getDoc(doc(operatorDb, "tournaments", TOURNAMENT_ID, "blockDraw", "current"))
    );

    // 所有者 GET
    await testEnv.clearFirestore();
    await seedTournament(testEnv, { createdBy: OWNER_UID });
    await assertSucceeds(getDoc(tournamentRef(ownerDb)));
    await assertSucceeds(
      getDocs(collection(ownerDb, "tournaments", TOURNAMENT_ID, "entries"))
    );

    // isDeleted false 明示
    await testEnv.clearFirestore();
    await seedTournament(testEnv, { isDeleted: false });
    await assertSucceeds(getDoc(tournamentRef(operatorDb)));

    console.log("dashboard-access.rules: all tests passed");
  } finally {
    await testEnv.cleanup();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
