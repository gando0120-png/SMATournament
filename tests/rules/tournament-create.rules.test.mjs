/**
 * 大会作成 Firestore Rules テスト
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
  getDoc,
  setDoc,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rules = readFileSync(resolve(__dirname, "../../firestore.rules"), "utf8");

const PROJECT_ID = "smatournament-create-rules-test";
const OPERATOR_UID = "operator-create-test";
const LEGACY_TOURNAMENT_ID = "legacy-tournament-1";
const QUALIFYING_TOURNAMENT_ID = "qualifying-tournament-1";

function tournamentRef(db, tournamentId) {
  return doc(db, "tournaments", tournamentId);
}

async function createTournament(db, tournamentId, overrides = {}) {
  await setDoc(tournamentRef(db, tournamentId), baseTournamentPayload(overrides));
}

function baseTournamentPayload(overrides = {}) {
  return {
    name: "Create Rules Test",
    status: "draft",
    eventDate: "2026-08-01",
    venue: "Test Venue",
    entryDeadline: Timestamp.fromDate(new Date("2099-01-01T00:00:00Z")),
    maxTeams: 64,
    teamSize: 4,
    courtCount: 2,
    entryCount: 0,
    confirmedCount: 0,
    createdBy: OPERATOR_UID,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  };
}

async function seedOperator(context) {
  await context.withSecurityRulesDisabled(async (rulesContext) => {
    const db = rulesContext.firestore();
    await setDoc(doc(db, "operators", OPERATOR_UID), {
      email: "operator@test.local",
      enabled: true,
      createdAt: new Date(),
    });
  });
}

async function seedLegacyTournament(context) {
  await context.withSecurityRulesDisabled(async (rulesContext) => {
    const db = rulesContext.firestore();
    await setDoc(tournamentRef(db, LEGACY_TOURNAMENT_ID), {
      ...baseTournamentPayload({ maxTeams: 8 }),
      preferredBlockSize: 4,
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

    await assertSucceeds(
      createTournament(operatorDb, "qualifying-valid-1", {
        tournamentFormat: "qualifying_and_finals",
        blockCount: 16,
        qualifiersPerBlock: 1,
        finalTeamCount: 16,
      })
    );

    await assertSucceeds(
      createTournament(operatorDb, "qualifying-valid-wc", {
        tournamentFormat: "qualifying_and_finals",
        blockCount: 8,
        qualifiersPerBlock: 1,
        finalTeamCount: 16,
        maxTeams: 32,
      })
    );

    await assertFails(
      createTournament(operatorDb, "qualifying-invalid-block", {
        tournamentFormat: "qualifying_and_finals",
        blockCount: 12,
        qualifiersPerBlock: 1,
        finalTeamCount: 16,
      })
    );

    await assertFails(
      createTournament(operatorDb, "qualifying-invalid-qpb", {
        tournamentFormat: "qualifying_and_finals",
        blockCount: 16,
        qualifiersPerBlock: 3,
        finalTeamCount: 16,
      })
    );

    await assertFails(
      createTournament(operatorDb, "qualifying-invalid-overflow", {
        tournamentFormat: "qualifying_and_finals",
        blockCount: 8,
        qualifiersPerBlock: 2,
        finalTeamCount: 8,
        maxTeams: 32,
      })
    );

    await assertFails(
      createTournament(operatorDb, "qualifying-invalid-gt-max", {
        tournamentFormat: "qualifying_and_finals",
        blockCount: 8,
        qualifiersPerBlock: 1,
        finalTeamCount: 32,
        maxTeams: 16,
      })
    );

    await assertFails(
      createTournament(operatorDb, "qualifying-invalid-max", {
        tournamentFormat: "qualifying_and_finals",
        blockCount: 16,
        qualifiersPerBlock: 1,
        maxTeams: 47,
      })
    );

    await assertSucceeds(
      createTournament(operatorDb, "single-elim-valid-1", {
        tournamentFormat: "single_elimination",
      })
    );

    await assertFails(
      createTournament(operatorDb, "single-elim-invalid-block", {
        tournamentFormat: "single_elimination",
        blockCount: 16,
      })
    );

    await assertSucceeds(
      createTournament(operatorDb, "legacy-valid-1", {
        maxTeams: 8,
        preferredBlockSize: 4,
      })
    );

    await seedLegacyTournament(testEnv);
    await assertSucceeds(getDoc(tournamentRef(operatorDb, LEGACY_TOURNAMENT_ID)));

    console.log("tournament-create.rules.test.mjs: all passed");
  } finally {
    await testEnv.cleanup();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
