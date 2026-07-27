/**
 * publicSnapshot Firestore Rules テスト
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";
import { doc, setDoc, getDoc, serverTimestamp } from "firebase/firestore";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rules = readFileSync(resolve(__dirname, "../../firestore.rules"), "utf8");

const PROJECT_ID = "smatournament-public-snapshot-rules-test";
const OPERATOR_UID = "operator-public-snapshot-test";
const PUBLIC_TOURNAMENT_ID = "public-tournament";
const PRIVATE_TOURNAMENT_ID = "private-tournament";

function tournamentRef(db, tournamentId) {
  return doc(db, "tournaments", tournamentId);
}

function snapshotRef(db, tournamentId) {
  return doc(db, "tournaments", tournamentId, "publicSnapshot", "current");
}

function legacySnapshotPayload() {
  return {
    schemaVersion: 2,
    tournament: {
      name: "Legacy Public",
      status: "open",
      statusLabel: "参加受付中",
      progressStatusLabel: "参加受付中",
      tournamentFormat: "legacy",
      formatLabel: "予選＋決勝（従来形式）",
      showFormatLabel: true,
      entryCount: 0,
      confirmedCount: 0,
      isDeleted: false,
    },
    registration: { visible: true, ready: false, emptyMessage: "なし", items: [] },
    qualifying: {
      visible: true,
      ready: false,
      blocks: { visible: true, ready: false, blocks: [] },
      schedule: { visible: true, ready: false, blocks: [] },
      standings: { visible: true, ready: false, blocks: [] },
    },
    advancement: { visible: true, ready: false, groups: [] },
    bracket: { visible: true, ready: false, rounds: [], title: "決勝トーナメント", showSeed: true },
    results: { visible: true, ready: false, placements: [], placementGroups: [] },
    qualifyingResults: [],
    finalsMatchResults: [],
    updatedAt: serverTimestamp(),
  };
}

function singleElimSnapshotPayload() {
  return {
    schemaVersion: 2,
    tournament: {
      name: "Single Elim Public",
      status: "open",
      statusLabel: "参加受付中",
      progressStatusLabel: "トーナメント進行中",
      tournamentFormat: "single_elimination",
      formatLabel: "一発トーナメント",
      showFormatLabel: true,
      teamCount: 3,
      bracketSize: 4,
      byeCount: 1,
      entryCount: 3,
      confirmedCount: 3,
      isDeleted: false,
    },
    registration: {
      visible: true,
      ready: true,
      items: [{ entryId: "e1", teamName: "T1", members: ["代表"] }],
    },
    qualifying: {
      visible: false,
      ready: false,
      blocks: { visible: false, ready: false, blocks: [] },
      schedule: { visible: false, ready: false, blocks: [] },
      standings: { visible: false, ready: false, blocks: [] },
    },
    advancement: { visible: false, ready: false, groups: [] },
    bracket: {
      visible: true,
      ready: true,
      title: "一発トーナメント",
      showSeed: false,
      rounds: [],
    },
    results: { visible: true, ready: false, placements: [], placementGroups: [] },
    qualifyingResults: [],
    finalsMatchResults: [],
    updatedAt: serverTimestamp(),
  };
}

async function seed(context) {
  await context.withSecurityRulesDisabled(async (rulesContext) => {
    const db = rulesContext.firestore();
    await setDoc(doc(db, "operators", OPERATOR_UID), {
      email: "operator@test.local",
      enabled: true,
      createdAt: new Date(),
    });
    await setDoc(tournamentRef(db, PUBLIC_TOURNAMENT_ID), {
      name: "Public Tournament",
      status: "open",
      publicViewEnabled: true,
      createdBy: OPERATOR_UID,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await setDoc(tournamentRef(db, PRIVATE_TOURNAMENT_ID), {
      name: "Private Tournament",
      status: "open",
      publicViewEnabled: false,
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
    const publicReaderDb = testEnv.unauthenticatedContext().firestore();

    await assertSucceeds(
      setDoc(snapshotRef(operatorDb, PUBLIC_TOURNAMENT_ID), legacySnapshotPayload())
    );

    await assertSucceeds(
      setDoc(snapshotRef(operatorDb, PUBLIC_TOURNAMENT_ID), singleElimSnapshotPayload())
    );

    await assertFails(
      setDoc(snapshotRef(publicReaderDb, PUBLIC_TOURNAMENT_ID), legacySnapshotPayload())
    );

    await assertSucceeds(getDoc(snapshotRef(publicReaderDb, PUBLIC_TOURNAMENT_ID)));

    await assertFails(getDoc(snapshotRef(publicReaderDb, PRIVATE_TOURNAMENT_ID)));

    console.log("public-snapshot.rules.test.mjs: all passed");
  } finally {
    await testEnv.cleanup();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
