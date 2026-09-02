/**
 * 抽選確定後・予選開始前の進出条件更新 Firestore Rules テスト
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

const PROJECT_ID = "smatournament-advancement-settings-edit-rules";
const OPERATOR_UID = "operator-advancement-settings";
const STRANGER_UID = "stranger-advancement-settings";

function tournamentRef(db, tournamentId) {
  return doc(db, "tournaments", tournamentId);
}

function blockDrawRef(db, tournamentId) {
  return doc(db, "tournaments", tournamentId, "blockDraw", "current");
}

function baseTournament(overrides = {}) {
  return {
    name: "Advancement Settings Rules Test",
    status: "open",
    eventDate: "2026-09-01",
    venue: "Test Venue",
    entryDeadline: Timestamp.fromDate(new Date("2099-01-01T00:00:00Z")),
    maxTeams: 22,
    teamSize: 4,
    courtCount: 2,
    entryCount: 22,
    confirmedCount: 22,
    publicViewEnabled: true,
    createdBy: OPERATOR_UID,
    createdAt: new Date(),
    updatedAt: new Date(),
    tournamentFormat: "qualifying_and_finals",
    blockCount: 6,
    qualifiersPerBlock: 1,
    finalTeamCount: 8,
    wildcardComparisonMode: "normalized",
    matchFormat: "headToHeadSets",
    structureLocked: true,
    ...overrides,
  };
}

function finalizedDraw() {
  return {
    status: "finalized",
    blockCount: 6,
    blocks: Array.from({ length: 6 }, (_, index) => ({
      id: String.fromCharCode(65 + index),
      name: `${String.fromCharCode(65 + index)}ブロック`,
      entryIds: ["e1", "e2", "e3"],
    })),
    createdAt: new Date(),
    updatedAt: new Date(),
    finalizedAt: new Date(),
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

async function seedTournament(testEnv, tournamentId, tournamentOverrides = {}, extras = {}) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(tournamentRef(db, tournamentId), baseTournament(tournamentOverrides));
    if (extras.blockDraw !== false) {
      await setDoc(blockDrawRef(db, tournamentId), extras.blockDraw ?? finalizedDraw());
    }
    if (extras.schedule) {
      await setDoc(
        doc(db, "tournaments", tournamentId, "qualifyingSchedules", "current"),
        extras.schedule
      );
    }
    if (extras.advancement) {
      await setDoc(
        doc(db, "tournaments", tournamentId, "finalsAdvancement", "current"),
        extras.advancement
      );
    }
    if (extras.finalsBracket) {
      await setDoc(
        doc(db, "tournaments", tournamentId, "finalsBracket", "current"),
        extras.finalsBracket
      );
    }
    if (extras.consolationBracket) {
      await setDoc(
        doc(db, "tournaments", tournamentId, "consolationBracket", "current"),
        extras.consolationBracket
      );
    }
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

    await seedTournament(testEnv, "draft-before", { structureLocked: false }, { blockDraw: false });
    await assertSucceeds(
      updateDoc(tournamentRef(operatorDb, "draft-before"), {
        qualifiersPerBlock: 2,
        finalTeamCount: 16,
        updatedAt: serverTimestamp(),
      })
    );

    await seedTournament(testEnv, "finalized-ok", {}, {
      schedule: {
        finalized: true,
        blocks: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    await assertSucceeds(
      updateDoc(tournamentRef(operatorDb, "finalized-ok"), {
        qualifiersPerBlock: 2,
        finalTeamCount: 16,
        updatedAt: serverTimestamp(),
      })
    );

    await seedTournament(testEnv, "prod-shape-ok", {
      entryCount: 0,
      confirmedCount: 0,
      participantResultEntryEnabled: true,
      winsRequired: 2,
      matchFormat: "headToHeadSets",
      finalsMatchRules: {
        defaultWinsRequired: 2,
        roundOverrides: {},
      },
      bracketMatchConfig: {
        main: {
          enabled: true,
          matchFormat: "headToHeadSets",
          finalsMatchRules: {
            defaultWinsRequired: 2,
            roundOverrides: {},
          },
          aggregateMatchRules: null,
          winsRequired: 2,
        },
        consolation: {
          enabled: true,
          matchFormat: "headToHeadSets",
          finalsMatchRules: {
            defaultWinsRequired: 2,
            roundOverrides: {},
          },
          aggregateMatchRules: null,
          winsRequired: 2,
        },
      },
    }, {
      schedule: {
        finalized: true,
        blocks: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    await assertSucceeds(
      updateDoc(tournamentRef(operatorDb, "prod-shape-ok"), {
        qualifiersPerBlock: 2,
        finalTeamCount: 16,
        updatedAt: serverTimestamp(),
      })
    );

    await seedTournament(testEnv, "block-count-locked");
    await assertFails(
      updateDoc(tournamentRef(operatorDb, "block-count-locked"), {
        blockCount: 8,
        qualifiersPerBlock: 2,
        finalTeamCount: 16,
        updatedAt: serverTimestamp(),
      })
    );

    await seedTournament(testEnv, "overflow-invalid");
    await assertFails(
      updateDoc(tournamentRef(operatorDb, "overflow-invalid"), {
        qualifiersPerBlock: 2,
        finalTeamCount: 8,
        updatedAt: serverTimestamp(),
      })
    );

    await seedTournament(testEnv, "stranger-denied");
    await assertFails(
      updateDoc(tournamentRef(strangerDb, "stranger-denied"), {
        qualifiersPerBlock: 2,
        finalTeamCount: 16,
        updatedAt: serverTimestamp(),
      })
    );

    await seedTournament(
      testEnv,
      "has-advancement",
      {},
      {
        advancement: {
          finalized: true,
          mode: "rank_band_wildcards",
          blockCount: 6,
          qualifiersPerBlock: 1,
          qualifierCount: 8,
          finalTeamCount: 8,
          wildcardCount: 2,
          qualifiers: Array.from({ length: 8 }, (_, index) => ({
            entryId: `e-${index + 1}`,
            seed: index + 1,
          })),
          qualifyingMatchCount: 30,
          qualifyingFinishedMatchCount: 30,
          createdAt: new Date(),
          updatedAt: new Date(),
          finalizedAt: new Date(),
        },
      }
    );
    await assertFails(
      updateDoc(tournamentRef(operatorDb, "has-advancement"), {
        qualifiersPerBlock: 2,
        finalTeamCount: 16,
        updatedAt: serverTimestamp(),
      })
    );

    await seedTournament(
      testEnv,
      "has-bracket",
      {},
      {
        finalsBracket: {
          finalized: true,
          bracketSize: 8,
          matches: [{ matchId: "final-r1-m1" }],
          slots: [],
        },
      }
    );
    await assertFails(
      updateDoc(tournamentRef(operatorDb, "has-bracket"), {
        qualifiersPerBlock: 2,
        finalTeamCount: 16,
        updatedAt: serverTimestamp(),
      })
    );

    await seedTournament(
      testEnv,
      "has-consolation",
      {},
      {
        consolationBracket: {
          finalized: true,
          mode: "consolation",
          bracketSize: 8,
          matches: [{ matchId: "final-r1-m1" }],
        },
      }
    );
    await assertFails(
      updateDoc(tournamentRef(operatorDb, "has-consolation"), {
        qualifiersPerBlock: 2,
        finalTeamCount: 16,
        updatedAt: serverTimestamp(),
      })
    );

    console.log("finals-advancement-settings-edit.rules.test.mjs: all passed");
  } finally {
    await testEnv.cleanup();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
