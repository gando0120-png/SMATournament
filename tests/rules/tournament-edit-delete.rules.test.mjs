/**
 * 大会編集・論理削除 Firestore Rules テスト（Emulator）
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
  updateDoc,
  getDoc,
  collection,
  addDoc,
  getDocs,
  serverTimestamp,
} from "firebase/firestore";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rules = readFileSync(resolve(__dirname, "../../firestore.rules"), "utf8");

const PROJECT_ID = "smatournament-edit-delete-rules";
const OPERATOR_UID = "operator-enabled-uid";
const OWNER_UID = "owner-only-uid";
const PUBLIC_UID = "public-user-uid";
const TOURNAMENT_ID = "tournament-edit-target";

function tournamentRef(db) {
  return doc(db, "tournaments", TOURNAMENT_ID);
}

function entriesCol(db) {
  return collection(db, "tournaments", TOURNAMENT_ID, "entries");
}

async function seedDraftTournament(context, { createdBy = OPERATOR_UID, structureLocked = false } = {}) {
  await context.withSecurityRulesDisabled(async (db) => {
    await setDoc(tournamentRef(db), {
      name: "Editable Tournament",
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
      structureLocked,
      publicViewEnabled: true,
      createdBy,
      createdAt: new Date(),
      updatedAt: new Date(),
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
    await seedDraftTournament(testEnv);
    const operatorDb = testEnv.authenticatedContext(OPERATOR_UID).firestore();
    const ownerDb = testEnv.authenticatedContext(OWNER_UID).firestore();
    const publicDb = testEnv.authenticatedContext(PUBLIC_UID).firestore();
    const unauthDb = testEnv.unauthenticatedContext().firestore();

    // ── 既存大会（isDeleted なし）: 運営者 GET OK / 一般 GET NG ──
    await assertSucceeds(getDoc(tournamentRef(operatorDb)));
    await assertFails(getDoc(tournamentRef(publicDb)));
    await assertFails(getDoc(tournamentRef(unauthDb)));

    await assertSucceeds(
      updateDoc(tournamentRef(operatorDb), {
        name: "Updated Name",
        eventDate: "2026-09-02",
        venue: "Venue B",
        entryDeadline: new Date("2098-12-31T00:00:00Z"),
        maxTeams: 10,
        teamSize: 3,
        courtCount: 3,
        preferredBlockSize: 4,
        updatedAt: serverTimestamp(),
      })
    );

    // ── 所有者（運営者未登録）: 編集 OK ──
    await testEnv.clearFirestore();
    await seedDraftTournament(testEnv, { createdBy: OWNER_UID });
    await assertSucceeds(
      updateDoc(tournamentRef(ownerDb), {
        name: "Owner Updated",
        eventDate: "2026-09-03",
        venue: "Venue C",
        entryDeadline: new Date("2098-12-31T00:00:00Z"),
        maxTeams: 8,
        teamSize: 4,
        courtCount: 2,
        preferredBlockSize: 4,
        updatedAt: serverTimestamp(),
      })
    );

    // ── isDeleted false 明示: GET OK ──
    await testEnv.withSecurityRulesDisabled(async (db) => {
      await updateDoc(tournamentRef(db), { isDeleted: false, updatedAt: new Date() });
    });
    await assertSucceeds(getDoc(tournamentRef(operatorDb)));
    await assertSucceeds(getDoc(tournamentRef(ownerDb)));

    // ── 一般ユーザー: 編集 NG ──
    await assertFails(
      updateDoc(tournamentRef(publicDb), {
        name: "Hack",
        eventDate: "2026-09-03",
        venue: "Venue C",
        entryDeadline: new Date("2098-12-31T00:00:00Z"),
        maxTeams: 8,
        teamSize: 4,
        courtCount: 2,
        preferredBlockSize: 4,
        updatedAt: serverTimestamp(),
      })
    );

    // ── 構造ロック後: teamSize 変更 NG ──
    await testEnv.clearFirestore();
    await seedDraftTournament(testEnv, { structureLocked: true });
    await assertFails(
      updateDoc(tournamentRef(operatorDb), {
        name: "Locked Name OK",
        eventDate: "2026-09-04",
        venue: "Venue D",
        entryDeadline: new Date("2098-12-31T00:00:00Z"),
        maxTeams: 12,
        teamSize: 2,
        courtCount: 2,
        preferredBlockSize: 6,
        updatedAt: serverTimestamp(),
      })
    );
    await assertSucceeds(
      updateDoc(tournamentRef(operatorDb), {
        name: "Locked Name OK",
        eventDate: "2026-09-04",
        venue: "Venue D",
        entryDeadline: new Date("2098-12-31T00:00:00Z"),
        maxTeams: 8,
        teamSize: 4,
        courtCount: 3,
        preferredBlockSize: 4,
        updatedAt: serverTimestamp(),
      })
    );

    // ── 論理削除 OK ──
    await assertSucceeds(
      updateDoc(tournamentRef(operatorDb), {
        isDeleted: true,
        deletedAt: serverTimestamp(),
        deletedBy: OPERATOR_UID,
        updatedAt: serverTimestamp(),
      })
    );

    // ── 削除済み: 公開 get NG / 運営者 get OK ──
    await assertFails(getDoc(tournamentRef(unauthDb)));
    await assertSucceeds(getDoc(tournamentRef(operatorDb)));

    // ── 削除済み: エントリー create NG ──
    await testEnv.withSecurityRulesDisabled(async (db) => {
      await updateDoc(tournamentRef(db), { status: "open", updatedAt: new Date() });
    });
    await assertFails(
      addDoc(entriesCol(unauthDb), {
        teamName: "Team",
        representativeName: "Rep",
        status: "pending",
        createdAt: serverTimestamp(),
      })
    );

    // ── 削除済み: 再編集 NG ──
    await assertFails(
      updateDoc(tournamentRef(operatorDb), {
        name: "After Delete",
        eventDate: "2026-09-05",
        venue: "Venue E",
        entryDeadline: new Date("2098-12-31T00:00:00Z"),
        maxTeams: 8,
        teamSize: 4,
        courtCount: 2,
        preferredBlockSize: 4,
        updatedAt: serverTimestamp(),
      })
    );

    // ── 一覧: 運営者 list OK（クライアント側で isDeleted 除外） ──
    await assertSucceeds(getDocs(collection(operatorDb, "tournaments")));

    console.log("tournament-edit-delete.rules: all tests passed");
  } finally {
    await testEnv.cleanup();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
