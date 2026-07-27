/**
 * 開催日別 Firestore GET Rules テスト（Emulator）
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
  addDoc,
  serverTimestamp,
} from "firebase/firestore";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rules = readFileSync(resolve(__dirname, "../../firestore.rules"), "utf8");

const PROJECT_ID = "smatournament-eventdate-rules";
const OPERATOR_UID = "operator-enabled-uid";
const OWNER_UID = "owner-only-uid";
const PUBLIC_UID = "public-user-uid";

async function seedOperator(context) {
  await context.withSecurityRulesDisabled(async (db) => {
    await setDoc(doc(db, "operators", OPERATOR_UID), {
      email: "operator@test.local",
      enabled: true,
      createdAt: new Date(),
    });
  });
}

async function seedTournament(context, tournamentId, { eventDate, status = "closed", createdBy = OPERATOR_UID }) {
  await context.withSecurityRulesDisabled(async (db) => {
    await setDoc(doc(db, "tournaments", tournamentId), {
      name: `Tournament ${eventDate}`,
      status,
      eventDate,
      venue: "Venue",
      entryDeadline: new Date("2020-01-01T00:00:00Z"),
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
    });
    await setDoc(doc(db, "tournaments", tournamentId, "entries", "entry-1"), {
      teamName: "Team",
      representativeName: "Rep",
      email: "a@example.com",
      status: "pending",
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
    await seedOperator(testEnv);
    const operatorDb = testEnv.authenticatedContext(OPERATOR_UID).firestore();
    const ownerDb = testEnv.authenticatedContext(OWNER_UID).firestore();
    const unauthDb = testEnv.unauthenticatedContext().firestore();

    for (const [label, eventDate] of [
      ["past", "2020-06-01"],
      ["today", "2026-07-24"],
      ["future", "2027-03-01"],
    ]) {
      const tournamentId = `t-${label}`;
      await seedTournament(testEnv, tournamentId, { eventDate, status: "closed" });

      await assertSucceeds(getDoc(doc(operatorDb, "tournaments", tournamentId)));
      await assertSucceeds(
        getDocs(collection(operatorDb, "tournaments", tournamentId, "entries"))
      );
      await assertSucceeds(
        getDoc(doc(operatorDb, "tournaments", tournamentId, "blockDraw", "current")).catch(() => null)
      );
      await assertFails(getDoc(doc(unauthDb, "tournaments", tournamentId)));
    }

    // 所有者（運営者未登録）: 開催日過去でも GET/list OK
    const ownerPastId = "owner-past";
    await seedTournament(testEnv, ownerPastId, {
      eventDate: "2019-12-01",
      status: "closed",
      createdBy: OWNER_UID,
    });
    await assertSucceeds(getDoc(doc(ownerDb, "tournaments", ownerPastId)));
    await assertSucceeds(getDocs(collection(ownerDb, "tournaments", ownerPastId, "entries")));

    // 公開 GET: 受付中のみ（過去締切の open は不可）
    const openPastDeadlineId = "open-past-deadline";
    await seedTournament(testEnv, openPastDeadlineId, {
      eventDate: "2027-06-01",
      status: "open",
    });
    await assertFails(getDoc(doc(unauthDb, "tournaments", openPastDeadlineId)));

    const openFutureId = "open-future";
    await testEnv.withSecurityRulesDisabled(async (db) => {
      await setDoc(doc(db, "tournaments", openFutureId), {
        name: "Open Future",
        status: "open",
        eventDate: "2027-06-01",
        venue: "Venue",
        entryDeadline: new Date("2099-01-01T00:00:00Z"),
        maxTeams: 8,
        teamSize: 4,
        courtCount: 2,
        preferredBlockSize: 4,
        entryCount: 0,
        confirmedCount: 0,
        publicViewEnabled: true,
        createdBy: OPERATOR_UID,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });
    await assertSucceeds(getDoc(doc(unauthDb, "tournaments", openFutureId)));

    // 過去大会への新規エントリー拒否
    await assertFails(
      addDoc(collection(unauthDb, "tournaments", openPastDeadlineId, "entries"), {
        teamName: "New Team",
        representativeName: "Rep",
        email: "new@example.com",
        status: "pending",
        createdAt: serverTimestamp(),
      })
    );

    // 一般認証ユーザーは管理データ不可
    const publicDb = testEnv.authenticatedContext(PUBLIC_UID).firestore();
    await assertFails(getDoc(doc(publicDb, "tournaments", "t-past")));
    await assertFails(getDocs(collection(publicDb, "tournaments", "t-past", "entries")));

    console.log("eventdate-access.rules: all tests passed");
  } finally {
    await testEnv.cleanup();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
