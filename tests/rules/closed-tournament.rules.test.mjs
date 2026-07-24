/**
 * Firestore Rules 統合テスト（Emulator）
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
  serverTimestamp,
} from "firebase/firestore";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rules = readFileSync(resolve(__dirname, "../../firestore.rules"), "utf8");

const PROJECT_ID = "smatournament-rules-test";
const OPERATOR_UID = "operator-test-uid";
const TOURNAMENT_ID = "tournament-test-1";

function tournamentRef(db) {
  return doc(db, "tournaments", TOURNAMENT_ID);
}

function blockDrawRef(db) {
  return doc(db, "tournaments", TOURNAMENT_ID, "blockDraw", "current");
}

function resultsRef(db) {
  return doc(db, "tournaments", TOURNAMENT_ID, "tournamentResults", "current");
}

function entryRef(db, entryId = "entry-1") {
  return doc(db, "tournaments", TOURNAMENT_ID, "entries", entryId);
}

async function seedOpenTournament(context) {
  await context.withSecurityRulesDisabled(async (db) => {
    await setDoc(tournamentRef(db), {
      name: "Rules Test Tournament",
      status: "open",
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
    await setDoc(doc(db, "operators", OPERATOR_UID), {
      email: "operator@test.local",
      createdAt: new Date(),
    });
  });
}

async function seedClosedTournament(context) {
  await seedOpenTournament(context);
  await context.withSecurityRulesDisabled(async (db) => {
    await updateDoc(tournamentRef(db), {
      status: "closed",
      closedAt: new Date(),
      updatedAt: new Date(),
    });
  });
}

function minimalBlockDrawPayload() {
  return {
    status: "finalized",
    preferredBlockSize: 4,
    blockCount: 2,
    blocks: [
      { id: "A", name: "A", entryIds: ["e1", "e2", "e3", "e4"] },
      { id: "B", name: "B", entryIds: ["e5", "e6", "e7", "e8"] },
    ],
    finalizedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

async function run() {
  const testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules, host: "127.0.0.1", port: 8080 },
  });

  try {
    // ── closed: block draw create denied ──
    await seedClosedTournament(testEnv);
    const operatorDb = testEnv.authenticatedContext(OPERATOR_UID).firestore();
    await assertFails(setDoc(blockDrawRef(operatorDb), minimalBlockDrawPayload()));

    // ── closed: entry confirm denied ──
    await testEnv.withSecurityRulesDisabled(async (db) => {
      await setDoc(entryRef(db), {
        teamName: "Team A",
        representativeName: "Rep",
        status: "pending",
        createdAt: new Date(),
      });
    });
    await assertFails(
      updateDoc(entryRef(operatorDb), {
        status: "confirmed",
        updatedAt: serverTimestamp(),
      })
    );

    // ── open: block draw create once ──
    await testEnv.clearFirestore();
    await seedOpenTournament(testEnv);
    await assertSucceeds(setDoc(blockDrawRef(operatorDb), minimalBlockDrawPayload()));
    await assertFails(setDoc(blockDrawRef(operatorDb), minimalBlockDrawPayload()));

    // ── open: block draw update denied ──
    await assertFails(
      updateDoc(blockDrawRef(operatorDb), {
        preferredBlockSize: 3,
        updatedAt: serverTimestamp(),
      })
    );

    // ── open → closed update allowed for operator ──
    await assertSucceeds(
      updateDoc(tournamentRef(operatorDb), {
        status: "closed",
        closedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    // ── closed: qualifying result create denied ──
    await assertFails(
      setDoc(doc(operatorDb, "tournaments", TOURNAMENT_ID, "qualifyingMatchResults", "m1"), {
        matchId: "m1",
        blockId: "A",
        roundNumber: 1,
        courtNumber: 1,
        team1: { entryId: "e1", teamName: "T1" },
        team2: { entryId: "e2", teamName: "T2" },
        sets: [],
        team1Stats: { setWins: 0, setDraws: 0, setLosses: 0, totalScore: 0 },
        team2Stats: { setWins: 0, setDraws: 0, setLosses: 0, totalScore: 0 },
        status: "finished",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    // ── finals advancement blocks qualifying result create on open tournament ──
    await testEnv.clearFirestore();
    await seedOpenTournament(testEnv);
    await testEnv.withSecurityRulesDisabled(async (db) => {
      await setDoc(doc(db, "tournaments", TOURNAMENT_ID, "finalsAdvancement", "current"), {
        finalized: true,
        finalTeamCount: 8,
        blockCount: 2,
        blockWinnerCount: 2,
        wildcardCount: 6,
        qualifiers: [],
        qualifyingMatchCount: 1,
        qualifyingFinishedMatchCount: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });
    await assertFails(
      setDoc(doc(operatorDb, "tournaments", TOURNAMENT_ID, "qualifyingMatchResults", "m2"), {
        matchId: "m2",
        blockId: "A",
        roundNumber: 1,
        courtNumber: 1,
        team1: { entryId: "e1", teamName: "T1" },
        team2: { entryId: "e2", teamName: "T2" },
        sets: [],
        team1Stats: { setWins: 0, setDraws: 0, setLosses: 0, totalScore: 0 },
        team2Stats: { setWins: 0, setDraws: 0, setLosses: 0, totalScore: 0 },
        status: "finished",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    // ── tournamentResults create denied when closed ──
    await assertFails(
      setDoc(resultsRef(operatorDb), {
        finalized: true,
        tournamentId: TOURNAMENT_ID,
        tournamentName: "Test",
        tournamentStatus: "closed",
        champion: { entryId: "e1", teamName: "T1", seed: 1 },
        runnerUp: { entryId: "e2", teamName: "T2", seed: 2 },
        placements: [],
        qualifierCount: 8,
        bracketSize: 8,
        completedMatchCount: 7,
        expectedMatchCount: 7,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    console.log("closed-tournament.rules: all tests passed");
  } finally {
    await testEnv.cleanup();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
