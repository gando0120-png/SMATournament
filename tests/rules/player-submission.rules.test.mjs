/**
 * プレイヤー提出コレクション Rules スモーク（構文・禁止パターン）
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, serverTimestamp, Timestamp } from "firebase/firestore";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rules = readFileSync(join(__dirname, "../../firestore.rules"), "utf8");
const PROJECT_ID = "smatournament-player-submission-rules";
const OPERATOR_UID = "op-player-sub";
const TOURNAMENT_ID = "t-player-sub-1";

async function seed(context) {
  await context.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "operators", OPERATOR_UID), {
      email: "op@test.local",
      enabled: true,
      createdAt: new Date(),
    });
    await setDoc(doc(db, "tournaments", TOURNAMENT_ID), {
      name: "Player Sub Test",
      status: "open",
      eventDate: "2026-08-30",
      venue: "Venue",
      entryDeadline: Timestamp.fromDate(new Date("2099-01-01T00:00:00Z")),
      maxTeams: 16,
      teamSize: 2,
      courtCount: 2,
      entryCount: 0,
      confirmedCount: 0,
      tournamentFormat: "qualifying_and_finals",
      blockCount: 4,
      qualifiersPerBlock: 1,
      finalTeamCount: 4,
      participantResultEntryEnabled: true,
      createdBy: OPERATOR_UID,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
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
    const anonDb = testEnv.unauthenticatedContext().firestore();

    await assertSucceeds(
      getDoc(doc(operatorDb, "tournaments", TOURNAMENT_ID, "entryAccessTokens", "e1"))
    );
    await assertFails(
      setDoc(doc(operatorDb, "tournaments", TOURNAMENT_ID, "entryAccessTokens", "e1"), {
        tokenHash: "abc",
        entryId: "e1",
      })
    );
    await assertFails(
      setDoc(doc(anonDb, "tournaments", TOURNAMENT_ID, "qualifyingResultSubmissions", "m1_e1"), {
        matchId: "m1",
        entryId: "e1",
      })
    );
    await assertFails(
      setDoc(doc(anonDb, "tournaments", TOURNAMENT_ID, "qualifyingMatchResults", "m1"), {
        matchId: "m1",
        status: "finished",
      })
    );

    await assertSucceeds(
      setDoc(
        doc(operatorDb, "tournaments", TOURNAMENT_ID),
        { participantResultEntryEnabled: false, updatedAt: serverTimestamp() },
        { merge: true }
      )
    );

    console.log("player-submission.rules.test.mjs: all passed");
  } finally {
    await testEnv.cleanup();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
