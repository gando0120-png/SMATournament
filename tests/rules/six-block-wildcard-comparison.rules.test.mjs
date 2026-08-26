/**
 * 6ブロック / wildcardComparisonMode の Firestore Rules テスト
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
  Timestamp,
} from "firebase/firestore";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rules = readFileSync(resolve(__dirname, "../../firestore.rules"), "utf8");

const PROJECT_ID = "smatournament-six-block-wc-rules-test";
const OPERATOR_UID = "operator-six-block-wc";
const STRANGER_UID = "stranger-six-block-wc";

function tournamentRef(db, tournamentId) {
  return doc(db, "tournaments", tournamentId);
}

function advancementRef(db, tournamentId) {
  return doc(db, "tournaments", tournamentId, "finalsAdvancement", "current");
}

function baseQualifying(overrides = {}) {
  return {
    name: "Six Block WC Rules Test",
    status: "open",
    eventDate: "2026-08-01",
    venue: "Test Venue",
    entryDeadline: Timestamp.fromDate(new Date("2099-01-01T00:00:00Z")),
    maxTeams: 22,
    teamSize: 4,
    courtCount: 2,
    entryCount: 0,
    confirmedCount: 0,
    publicViewEnabled: true,
    createdBy: OPERATOR_UID,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    tournamentFormat: "qualifying_and_finals",
    blockCount: 6,
    qualifiersPerBlock: 1,
    finalTeamCount: 8,
    wildcardComparisonMode: "normalized",
    matchFormat: "headToHeadSets",
    ...overrides,
  };
}

function sixBlockAdvancementPayload() {
  return {
    finalized: true,
    mode: "rank_band_wildcards",
    blockCount: 6,
    qualifiersPerBlock: 1,
    qualifierCount: 8,
    finalTeamCount: 8,
    blockWinnerCount: 6,
    wildcardCount: 2,
    wildcardComparisonMode: "normalized",
    qualifiers: Array.from({ length: 8 }, (_, index) => ({
      entryId: `e-${index + 1}`,
      teamName: `Team ${index + 1}`,
      blockId: String.fromCharCode(65 + (index % 6)),
      blockName: `${String.fromCharCode(65 + (index % 6))}ブロック`,
      blockRank: index < 6 ? 1 : 2,
      source: index < 6 ? "block_winner" : "wildcard",
      seed: index + 1,
    })),
    qualifyingMatchCount: 30,
    qualifyingFinishedMatchCount: 30,
    finalizedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

async function seedOperator(testEnv) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "operators", OPERATOR_UID), {
      email: "op@test.local",
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
    await seedOperator(testEnv);
    const operatorDb = testEnv.authenticatedContext(OPERATOR_UID).firestore();
    const strangerDb = testEnv.authenticatedContext(STRANGER_UID).firestore();
    const unauthDb = testEnv.unauthenticatedContext().firestore();

    // --- create: blockCount=6 許可 ---
    await assertSucceeds(
      setDoc(tournamentRef(operatorDb, "create-six-ok"), {
        ...baseQualifying({ status: "draft" }),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    // --- create: blockCount=5 / 7 拒否 ---
    await assertFails(
      setDoc(tournamentRef(operatorDb, "create-five-bad"), {
        ...baseQualifying({ status: "draft", blockCount: 5 }),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
    await assertFails(
      setDoc(tournamentRef(operatorDb, "create-seven-bad"), {
        ...baseQualifying({ status: "draft", blockCount: 7 }),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    // --- create: wildcardComparisonMode=normalized / raw 許可 ---
    await assertSucceeds(
      setDoc(tournamentRef(operatorDb, "create-wc-normalized"), {
        ...baseQualifying({ status: "draft", wildcardComparisonMode: "normalized" }),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
    await assertSucceeds(
      setDoc(tournamentRef(operatorDb, "create-wc-raw"), {
        ...baseQualifying({ status: "draft", wildcardComparisonMode: "raw" }),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    // --- create: 不正な比較モード拒否 ---
    await assertFails(
      setDoc(tournamentRef(operatorDb, "create-wc-bad"), {
        ...baseQualifying({ status: "draft", wildcardComparisonMode: "winrate" }),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    // --- settings update 用シード ---
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(
        tournamentRef(db, "settings-open"),
        baseQualifying({
          status: "open",
          wildcardComparisonMode: "raw",
          createdAt: new Date(),
          updatedAt: new Date(),
        })
      );
    });

    // --- settings: normalized へ更新可 ---
    await assertSucceeds(
      updateDoc(tournamentRef(operatorDb, "settings-open"), {
        wildcardComparisonMode: "normalized",
        updatedAt: serverTimestamp(),
      })
    );

    // --- settings: 不正値拒否 ---
    await assertFails(
      updateDoc(tournamentRef(operatorDb, "settings-open"), {
        wildcardComparisonMode: "average",
        updatedAt: serverTimestamp(),
      })
    );

    // --- 未認証 / 非運営者による設定変更拒否 ---
    await assertFails(
      updateDoc(tournamentRef(unauthDb, "settings-open"), {
        wildcardComparisonMode: "raw",
        updatedAt: serverTimestamp(),
      })
    );
    await assertFails(
      updateDoc(tournamentRef(strangerDb, "settings-open"), {
        wildcardComparisonMode: "raw",
        updatedAt: serverTimestamp(),
      })
    );

    // --- 進出確定（6ブロック + WC2）許可 ---
    await assertSucceeds(
      setDoc(advancementRef(operatorDb, "settings-open"), sixBlockAdvancementPayload())
    );

    // --- 進出確定後は wildcardComparisonMode 変更不可 ---
    await assertFails(
      updateDoc(tournamentRef(operatorDb, "settings-open"), {
        wildcardComparisonMode: "raw",
        updatedAt: serverTimestamp(),
      })
    );

    // --- 進出確定後でも名前など基本設定は更新可（回帰） ---
    await assertSucceeds(
      updateDoc(tournamentRef(operatorDb, "settings-open"), {
        name: "Six Block WC Rules Test Updated",
        updatedAt: serverTimestamp(),
      })
    );

    console.log("six-block-wildcard-comparison.rules.test.mjs: all passed");
  } finally {
    await testEnv.cleanup();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
