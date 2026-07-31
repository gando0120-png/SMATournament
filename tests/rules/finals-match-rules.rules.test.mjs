/**
 * finalsMatchRules / 試合 winsRequired の Firestore Rules テスト
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

const PROJECT_ID = "smatournament-finals-match-rules-test";
const OPERATOR_UID = "operator-fmr-test";
const TOURNAMENT_ID = "fmr-tournament-1";

function baseTournament(overrides = {}) {
  return {
    name: "Rules Match Rules Test",
    status: "open",
    eventDate: "2026-08-01",
    venue: "Test Venue",
    entryDeadline: Timestamp.fromDate(new Date("2099-01-01T00:00:00Z")),
    maxTeams: 8,
    teamSize: 4,
    courtCount: 2,
    entryCount: 0,
    confirmedCount: 0,
    structureLocked: false,
    publicViewEnabled: true,
    createdBy: OPERATOR_UID,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    tournamentFormat: "single_elimination",
    winsRequired: 2,
    finalsMatchRules: {
      defaultWinsRequired: 2,
      roundOverrides: { final: 3 },
    },
    ...overrides,
  };
}

function playedResult(overrides = {}) {
  const team = { entryId: "e1", teamName: "A", seed: 1 };
  const team2 = { entryId: "e2", teamName: "B", seed: 2 };
  return {
    matchId: "final-r3-m1",
    roundNumber: 3,
    matchNumber: 1,
    status: "finished",
    resolution: "played",
    team1: team,
    team2: team2,
    winner: team,
    loser: team2,
    winnerSide: "team1",
    sets: [
      { setNumber: 1, team1Score: 50, team2Score: 10, winner: "team1" },
      { setNumber: 2, team1Score: 50, team2Score: 20, winner: "team1" },
      { setNumber: 3, team1Score: 50, team2Score: 30, winner: "team1" },
    ],
    team1SetWins: 3,
    team2SetWins: 0,
    winsRequired: 3,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  };
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
        createdAt: new Date(),
      });
    });

    const operatorDb = testEnv.authenticatedContext(OPERATOR_UID).firestore();

    await assertSucceeds(
      setDoc(doc(operatorDb, "tournaments", "create-ok"), {
        ...baseTournament({ status: "draft" }),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    await assertFails(
      setDoc(doc(operatorDb, "tournaments", "create-bad-key"), {
        ...baseTournament({ status: "draft" }),
        finalsMatchRules: {
          defaultWinsRequired: 2,
          roundOverrides: { bogus: 3 },
        },
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, "tournaments", TOURNAMENT_ID), baseTournament());
    });

    await assertSucceeds(
      updateDoc(doc(operatorDb, "tournaments", TOURNAMENT_ID), {
        name: "Rules Match Rules Test",
        eventDate: "2026-08-01",
        venue: "Test Venue",
        entryDeadline: Timestamp.fromDate(new Date("2099-01-01T00:00:00Z")),
        courtCount: 2,
        maxTeams: 8,
        teamSize: 4,
        winsRequired: 2,
        finalsMatchRules: {
          defaultWinsRequired: 2,
          roundOverrides: { final: 3, semifinal: 3 },
        },
        updatedAt: serverTimestamp(),
      })
    );

    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, "tournaments", TOURNAMENT_ID, "finalsBracket", "current"), {
        finalized: true,
        bracketSize: 8,
        updatedAt: serverTimestamp(),
      });
    });

    await assertFails(
      updateDoc(doc(operatorDb, "tournaments", TOURNAMENT_ID), {
        name: "Rules Match Rules Test",
        eventDate: "2026-08-01",
        venue: "Test Venue",
        entryDeadline: Timestamp.fromDate(new Date("2099-01-01T00:00:00Z")),
        courtCount: 2,
        winsRequired: 3,
        finalsMatchRules: {
          defaultWinsRequired: 3,
          roundOverrides: {},
        },
        updatedAt: serverTimestamp(),
      })
    );

    await assertSucceeds(
      setDoc(
        doc(operatorDb, "tournaments", TOURNAMENT_ID, "finalsMatchResults", "final-r3-m1"),
        playedResult()
      )
    );

    await assertFails(
      setDoc(
        doc(operatorDb, "tournaments", TOURNAMENT_ID, "finalsMatchResults", "final-r3-m2"),
        playedResult({
          matchId: "final-r3-m2",
          winsRequired: 2,
          sets: [
            { setNumber: 1, team1Score: 50, team2Score: 10, winner: "team1" },
            { setNumber: 2, team1Score: 50, team2Score: 20, winner: "team1" },
            { setNumber: 3, team1Score: 50, team2Score: 30, winner: "team1" },
            { setNumber: 4, team1Score: 50, team2Score: 40, winner: "team1" },
          ],
          team1SetWins: 4,
          team2SetWins: 0,
        })
      )
    );

    console.log("finals-match-rules.rules.test.mjs: all passed");
  } finally {
    await testEnv.cleanup();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
