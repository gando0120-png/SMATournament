/**
 * 運営エントリー編集 Firestore Rules テスト（Emulator）
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
  serverTimestamp,
} from "firebase/firestore";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rules = readFileSync(resolve(__dirname, "../../firestore.rules"), "utf8");

const PROJECT_ID = "smatournament-ce785";
const OPERATOR_UID = "operator-enabled-uid";
const PUBLIC_UID = "public-user-uid";
const TOURNAMENT_ID = "tournament-entry-profile";

function tournamentRef(db) {
  return doc(db, "tournaments", TOURNAMENT_ID);
}

function entryRef(db, entryId = "entry-1") {
  return doc(db, "tournaments", TOURNAMENT_ID, "entries", entryId);
}

async function seed(context) {
  await context.withSecurityRulesDisabled(async (rulesContext) => {
    const db = rulesContext.firestore();
    await setDoc(doc(db, "operators", OPERATOR_UID), {
      email: "operator@test.local",
      enabled: true,
      createdAt: new Date(),
    });
    await setDoc(tournamentRef(db), {
      name: "Entry Profile Tournament",
      status: "open",
      eventDate: "2026-08-01",
      venue: "Test Venue",
      maxTeams: 8,
      teamSize: 2,
      courtCount: 2,
      preferredBlockSize: 4,
      entryCount: 1,
      confirmedCount: 1,
      createdBy: OPERATOR_UID,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await setDoc(entryRef(db, "pending-entry"), {
      teamName: "Pending Team",
      representativeName: "Rep P",
      email: "pending@example.com",
      member2: "Member P",
      status: "pending",
      teamNumber: 3,
      createdAt: new Date(),
    });
    await setDoc(entryRef(db, "confirmed-entry"), {
      teamName: "Confirmed Team",
      representativeName: "Rep C",
      email: "confirmed@example.com",
      member2: "Member C",
      comment: "old",
      status: "confirmed",
      teamNumber: 7,
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
    await seed(testEnv);

    const unauthDb = testEnv.unauthenticatedContext().firestore();
    const publicDb = testEnv.authenticatedContext(PUBLIC_UID).firestore();
    const operatorDb = testEnv.authenticatedContext(OPERATOR_UID).firestore();

    // 未認証: プロフィール更新 NG
    await assertFails(
      updateDoc(entryRef(unauthDb, "confirmed-entry"), {
        teamName: "Hacked",
        updatedAt: serverTimestamp(),
      })
    );

    // 一般認証ユーザー: プロフィール更新 NG
    await assertFails(
      updateDoc(entryRef(publicDb, "confirmed-entry"), {
        teamName: "Hacked",
        representativeName: "Rep C",
        email: "confirmed@example.com",
        updatedAt: serverTimestamp(),
      })
    );

    // 運営: 申込中エントリーの表示情報更新 OK（status / teamNumber は不変）
    await assertSucceeds(
      updateDoc(entryRef(operatorDb, "pending-entry"), {
        teamName: "Pending Renamed",
        representativeName: "Rep P2",
        email: "pending2@example.com",
        member2: "Member P2",
        updatedAt: serverTimestamp(),
      })
    );

    // 運営: 承認済みエントリーの表示情報更新 OK
    await assertSucceeds(
      updateDoc(entryRef(operatorDb, "confirmed-entry"), {
        teamName: "Confirmed Renamed",
        representativeName: "Rep C2",
        email: "confirmed2@example.com",
        member2: "Member C2",
        comment: "new comment",
        updatedAt: serverTimestamp(),
      })
    );

    // comment: null（空ではないが非 string）は NG
    await assertFails(
      updateDoc(entryRef(operatorDb, "confirmed-entry"), {
        comment: null,
        updatedAt: serverTimestamp(),
      })
    );

    // Firestore の deleteField（フィールド削除）は許可
    const { deleteField } = await import("firebase/firestore");
    await assertSucceeds(
      updateDoc(entryRef(operatorDb, "confirmed-entry"), {
        comment: deleteField(),
        updatedAt: serverTimestamp(),
      })
    );

    // teamNumber 変更 NG
    await assertFails(
      updateDoc(entryRef(operatorDb, "confirmed-entry"), {
        teamNumber: 99,
        updatedAt: serverTimestamp(),
      })
    );

    // status と表示情報を同時変更は NG（confirm は status/updatedAt のみ）
    await assertFails(
      updateDoc(entryRef(operatorDb, "pending-entry"), {
        status: "confirmed",
        teamName: "Should Not Confirm With Rename",
        updatedAt: serverTimestamp(),
      })
    );

    // 空のチーム名 NG
    await assertFails(
      updateDoc(entryRef(operatorDb, "confirmed-entry"), {
        teamName: "",
        updatedAt: serverTimestamp(),
      })
    );

    // 参加承認（既存経路）OK
    await testEnv.withSecurityRulesDisabled(async (rulesContext) => {
      const db = rulesContext.firestore();
      await setDoc(entryRef(db, "to-confirm"), {
        teamName: "To Confirm",
        representativeName: "Rep",
        email: "c@example.com",
        status: "pending",
        createdAt: new Date(),
      });
    });
    await assertSucceeds(
      updateDoc(entryRef(operatorDb, "to-confirm"), {
        status: "confirmed",
        updatedAt: serverTimestamp(),
      })
    );

    console.log("entry-profile.rules.test: ok");
  } finally {
    await testEnv.cleanup();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
