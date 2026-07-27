/**
 * 公開エントリー Firestore Rules テスト（Emulator）
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

const PROJECT_ID = "smatournament-public-entry-rules";
const OPERATOR_UID = "operator-enabled-uid";
const OWNER_UID = "owner-only-uid";
const PUBLIC_UID = "public-user-uid";
const TOURNAMENT_ID = "tournament-entry-open";

function tournamentRef(db) {
  return doc(db, "tournaments", TOURNAMENT_ID);
}

function entriesCol(db) {
  return collection(db, "tournaments", TOURNAMENT_ID, "entries");
}

function entryRef(db, entryId = "entry-1") {
  return doc(db, "tournaments", TOURNAMENT_ID, "entries", entryId);
}

function validPublicEntryPayload(overrides = {}) {
  return {
    teamName: "Team Alpha",
    representativeName: "Rep Name",
    email: "team@example.com",
    status: "pending",
    createdAt: serverTimestamp(),
    ...overrides,
  };
}

async function seedOpenTournament(context, { createdBy = OPERATOR_UID, entryDeadline = new Date("2099-01-01T00:00:00Z"), omitEntryDeadline = false } = {}) {
  await context.withSecurityRulesDisabled(async (db) => {
    const payload = {
      name: "Public Entry Tournament",
      status: "open",
      eventDate: "2026-08-01",
      venue: "Test Venue",
      maxTeams: 8,
      teamSize: 3,
      courtCount: 2,
      preferredBlockSize: 4,
      entryCount: 0,
      confirmedCount: 0,
      createdBy,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    if (!omitEntryDeadline) {
      payload.entryDeadline = entryDeadline;
    }
    await setDoc(tournamentRef(db), payload);
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
    await seedOpenTournament(testEnv);

    const unauthDb = testEnv.unauthenticatedContext().firestore();
    const publicDb = testEnv.authenticatedContext(PUBLIC_UID).firestore();
    const operatorDb = testEnv.authenticatedContext(OPERATOR_UID).firestore();

    // ── 未認証: 受付中大会を get できる（isEntryOpen） ──
    await assertSucceeds(getDoc(tournamentRef(unauthDb)));

    // ── 未認証: エントリー新規作成 OK ──
    await assertSucceeds(addDoc(entriesCol(unauthDb), validPublicEntryPayload()));

    // ── 未認証: email なし create NG ──
    await assertFails(
      addDoc(
        entriesCol(unauthDb),
        validPublicEntryPayload({
          email: undefined,
        })
      )
    );

    // ── 未認証: email 空文字 create NG ──
    await assertFails(
      addDoc(
        entriesCol(unauthDb),
        validPublicEntryPayload({
          email: "",
        })
      )
    );

    // ── 一般参加者: 一覧取得 NG ──
    await assertFails(getDocs(entriesCol(publicDb)));

    // ── 一般参加者: 既存エントリー get NG ──
    await assertFails(getDoc(entryRef(publicDb, "any-entry")));

    // ── 一般参加者: 更新 NG ──
    await testEnv.withSecurityRulesDisabled(async (db) => {
      await setDoc(entryRef(db, "entry-update-test"), {
        teamName: "Team B",
        representativeName: "Rep B",
        status: "pending",
        createdAt: new Date(),
      });
    });
    await assertFails(
      updateDoc(entryRef(publicDb, "entry-update-test"), {
        status: "confirmed",
        updatedAt: serverTimestamp(),
      })
    );

    // ── 運営者: 一覧取得 OK ──
    await assertSucceeds(getDocs(entriesCol(operatorDb)));

    // ── 受付終了（draft）: 未認証 get / create NG ──
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (db) => {
      await setDoc(tournamentRef(db), {
        name: "Draft Tournament",
        status: "draft",
        eventDate: "2026-08-01",
        venue: "Test Venue",
        entryDeadline: new Date("2099-01-01T00:00:00Z"),
        maxTeams: 8,
        teamSize: 3,
        courtCount: 2,
        preferredBlockSize: 4,
        entryCount: 0,
        confirmedCount: 0,
        createdBy: OPERATOR_UID,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });
    await assertFails(getDoc(tournamentRef(unauthDb)));
    await assertFails(addDoc(entriesCol(unauthDb), validPublicEntryPayload()));

    // ── 所有者（運営者登録なし）: エントリー閲覧・承認 OK ──
    await testEnv.clearFirestore();
    await seedOpenTournament(testEnv, { createdBy: OWNER_UID });
    await testEnv.withSecurityRulesDisabled(async (db) => {
      await setDoc(entryRef(db, "owner-confirm-entry"), {
        teamName: "Team Owner",
        representativeName: "Rep Owner",
        status: "pending",
        createdAt: new Date(),
      });
    });
    const ownerDb = testEnv.authenticatedContext(OWNER_UID).firestore();
    await assertSucceeds(getDocs(entriesCol(ownerDb)));
    await assertSucceeds(
      updateDoc(entryRef(ownerDb, "owner-confirm-entry"), {
        status: "confirmed",
        updatedAt: serverTimestamp(),
      })
    );

    // ── 既存エントリー（email なし）: 運営者 get / 承認 OK ──
    await testEnv.withSecurityRulesDisabled(async (db) => {
      await setDoc(entryRef(db, "legacy-no-email"), {
        teamName: "Legacy Team",
        representativeName: "Legacy Rep",
        status: "pending",
        createdAt: new Date(),
      });
    });
    await assertSucceeds(getDoc(entryRef(ownerDb, "legacy-no-email")));
    await assertSucceeds(
      updateDoc(entryRef(ownerDb, "legacy-no-email"), {
        status: "confirmed",
        updatedAt: serverTimestamp(),
      })
    );

    // ── 未認証: 4人制エントリー create OK ──
    await assertSucceeds(
      addDoc(
        entriesCol(unauthDb),
        validPublicEntryPayload({
          member2: "M2",
          member3: "M3",
          member4: "M4",
        })
      )
    );

    // ── 受付終了（closed）: create NG ──
    await testEnv.withSecurityRulesDisabled(async (db) => {
      await updateDoc(tournamentRef(db), {
        status: "closed",
        closedAt: new Date(),
        updatedAt: new Date(),
      });
    });
    await assertFails(
      addDoc(
        entriesCol(unauthDb),
        validPublicEntryPayload({
          teamName: "Late Team",
        })
      )
    );

    // ── isEntryOpen: entryDeadline フィールドなし → get/create 許可 ──
    await testEnv.clearFirestore();
    await seedOpenTournament(testEnv, { omitEntryDeadline: true });
    await assertSucceeds(getDoc(tournamentRef(unauthDb)));
    await assertSucceeds(addDoc(entriesCol(unauthDb), validPublicEntryPayload()));

    // ── isEntryOpen: entryDeadline null → get/create 許可 ──
    await testEnv.clearFirestore();
    await seedOpenTournament(testEnv, { entryDeadline: null });
    await assertSucceeds(getDoc(tournamentRef(unauthDb)));
    await assertSucceeds(addDoc(entriesCol(unauthDb), validPublicEntryPayload()));

    // ── isEntryOpen: 未来 Timestamp → get/create 許可 ──
    await testEnv.clearFirestore();
    await seedOpenTournament(testEnv, { entryDeadline: new Date("2099-01-01T00:00:00Z") });
    await assertSucceeds(getDoc(tournamentRef(unauthDb)));
    await assertSucceeds(addDoc(entriesCol(unauthDb), validPublicEntryPayload()));

    // ── isEntryOpen: 過去 Timestamp → get/create 拒否 ──
    await testEnv.clearFirestore();
    await seedOpenTournament(testEnv, { entryDeadline: new Date("2020-01-01T00:00:00Z") });
    await assertFails(getDoc(tournamentRef(unauthDb)));
    await assertFails(addDoc(entriesCol(unauthDb), validPublicEntryPayload()));

    // ── isEntryOpen: entryDeadline が string → get/create 拒否 ──
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (db) => {
      await setDoc(tournamentRef(db), {
        name: "Invalid Deadline Type",
        status: "open",
        eventDate: "2026-08-01",
        venue: "Test Venue",
        entryDeadline: "2099-01-01T00:00:00Z",
        maxTeams: 8,
        teamSize: 3,
        courtCount: 2,
        preferredBlockSize: 4,
        entryCount: 0,
        confirmedCount: 0,
        createdBy: OPERATOR_UID,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });
    await assertFails(getDoc(tournamentRef(unauthDb)));
    await assertFails(addDoc(entriesCol(unauthDb), validPublicEntryPayload()));

    // ── isEntryOpen: status closed → get/create 拒否 ──
    await testEnv.clearFirestore();
    await seedOpenTournament(testEnv, { entryDeadline: new Date("2099-01-01T00:00:00Z") });
    await testEnv.withSecurityRulesDisabled(async (db) => {
      await updateDoc(tournamentRef(db), {
        status: "closed",
        closedAt: new Date(),
        updatedAt: new Date(),
      });
    });
    await assertFails(getDoc(tournamentRef(unauthDb)));
    await assertFails(addDoc(entriesCol(unauthDb), validPublicEntryPayload()));

    console.log("public-entry.rules: all tests passed");
  } finally {
    await testEnv.cleanup();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
