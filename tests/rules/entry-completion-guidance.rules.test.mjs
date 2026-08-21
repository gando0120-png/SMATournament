/**
 * エントリー完了案内サブコレクションの Rules
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
  deleteDoc,
  serverTimestamp,
} from "firebase/firestore";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rules = readFileSync(resolve(__dirname, "../../firestore.rules"), "utf8");

const PROJECT_ID = "smatournament-entry-completion-guidance";
const OPERATOR_UID = "operator-guidance";
const TOURNAMENT_ID = "t-guidance";

function tournamentPayload(overrides = {}) {
  return {
    name: "Guidance Tournament",
    status: "open",
    eventDate: "2099-09-01",
    venue: "Venue",
    entryDeadline: new Date("2099-12-01T00:00:00Z"),
    maxTeams: 8,
    teamSize: 2,
    courtCount: 2,
    preferredBlockSize: 4,
    entryCount: 0,
    confirmedCount: 0,
    createdBy: OPERATOR_UID,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  };
}

function guidanceRef(db, tournamentId = TOURNAMENT_ID) {
  return doc(db, "tournaments", tournamentId, "entryCompletionGuidance", "current");
}

async function run() {
  const testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules, host: "127.0.0.1", port: 8090 },
  });

  try {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, "operators", OPERATOR_UID), {
        email: "op@test.local",
        enabled: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await setDoc(doc(db, "tournaments", TOURNAMENT_ID), tournamentPayload());
    });

    const opDb = testEnv.authenticatedContext(OPERATOR_UID).firestore();
    const unauthDb = testEnv.unauthenticatedContext().firestore();

    await assertSucceeds(
      setDoc(guidanceRef(opDb), {
        entryCompletionMessage: "集合は9時です。",
        entryCompletionLinkUrl: "https://line.me/ti/g2/example",
        entryCompletionLinkLabel: "LINEに参加",
        updatedAt: serverTimestamp(),
      })
    );

    await assertSucceeds(getDoc(guidanceRef(unauthDb)));

    await assertFails(
      setDoc(guidanceRef(unauthDb), {
        entryCompletionMessage: "hacked",
        entryCompletionLinkUrl: "https://evil.example",
        entryCompletionLinkLabel: "click",
        updatedAt: serverTimestamp(),
      })
    );

    await assertSucceeds(deleteDoc(guidanceRef(opDb)));

    await assertFails(deleteDoc(guidanceRef(unauthDb)));

    console.log("entry-completion-guidance.rules.test.mjs: ok");
  } finally {
    await testEnv.cleanup();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
