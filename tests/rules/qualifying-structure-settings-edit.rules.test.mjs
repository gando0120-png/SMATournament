/**
 * 抽選確定前の予選構成更新 Firestore Rules テスト
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

const PROJECT_ID = "smatournament-qualifying-structure-settings-rules";
const OPERATOR_UID = "operator-qualifying-structure";
const STRANGER_UID = "stranger-qualifying-structure";

function tournamentRef(db, tournamentId) {
  return doc(db, "tournaments", tournamentId);
}

function blockDrawRef(db, tournamentId) {
  return doc(db, "tournaments", tournamentId, "blockDraw", "current");
}

function scheduleRef(db, tournamentId) {
  return doc(db, "tournaments", tournamentId, "qualifyingSchedules", "current");
}

function baseTournament(overrides = {}) {
  return {
    name: "Qualifying Structure Rules Test",
    status: "open",
    eventDate: "2026-09-01",
    venue: "Test Venue",
    entryDeadline: Timestamp.fromDate(new Date("2099-01-01T00:00:00Z")),
    maxTeams: 32,
    teamSize: 4,
    minTeamSize: 2,
    maxTeamSize: 4,
    courtCount: 2,
    entryCount: 10,
    confirmedCount: 10,
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

function draftDraw() {
  return {
    status: "draft",
    blockCount: 6,
    blocks: Array.from({ length: 6 }, (_, index) => ({
      id: String.fromCharCode(65 + index),
      name: `${String.fromCharCode(65 + index)}ブロック`,
      entryIds: ["e1", "e2", "e3"],
    })),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function finalizedDraw() {
  return {
    ...draftDraw(),
    status: "finalized",
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
    if (extras.blockDraw) {
      await setDoc(blockDrawRef(db, tournamentId), extras.blockDraw);
    }
    if (extras.schedule) {
      await setDoc(scheduleRef(db, tournamentId), extras.schedule);
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

    await seedTournament(testEnv, "locked-no-draw", { structureLocked: true });
    await assertSucceeds(
      updateDoc(tournamentRef(operatorDb, "locked-no-draw"), {
        blockCount: 7,
        qualifiersPerBlock: 2,
        finalTeamCount: 16,
        updatedAt: serverTimestamp(),
      })
    );

    await assertFails(
      updateDoc(tournamentRef(operatorDb, "locked-no-draw"), {
        maxTeams: 24,
        updatedAt: serverTimestamp(),
      })
    );
    await assertFails(
      updateDoc(tournamentRef(operatorDb, "locked-no-draw"), {
        teamSize: 3,
        updatedAt: serverTimestamp(),
      })
    );

    await seedTournament(testEnv, "draft-still-present", {}, { blockDraw: draftDraw() });
    await assertFails(
      updateDoc(tournamentRef(operatorDb, "draft-still-present"), {
        blockCount: 7,
        updatedAt: serverTimestamp(),
      })
    );

    await seedTournament(testEnv, "finalized-draw", {}, { blockDraw: finalizedDraw() });
    await assertFails(
      updateDoc(tournamentRef(operatorDb, "finalized-draw"), {
        blockCount: 7,
        updatedAt: serverTimestamp(),
      })
    );

    await seedTournament(
      testEnv,
      "has-schedule",
      {},
      {
        schedule: {
          finalized: true,
          blockCount: 6,
          totalMatchCount: 12,
          blocks: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      }
    );
    await assertFails(
      updateDoc(tournamentRef(operatorDb, "has-schedule"), {
        blockCount: 7,
        updatedAt: serverTimestamp(),
      })
    );

    await seedTournament(
      testEnv,
      "has-advancement",
      {},
      { advancement: { finalized: true, qualifiers: [] } }
    );
    await assertFails(
      updateDoc(tournamentRef(operatorDb, "has-advancement"), {
        blockCount: 7,
        updatedAt: serverTimestamp(),
      })
    );

    await seedTournament(
      testEnv,
      "has-bracket",
      {},
      { finalsBracket: { finalized: true, bracketSize: 8, matches: [{ matchId: "m1" }] } }
    );
    await assertFails(
      updateDoc(tournamentRef(operatorDb, "has-bracket"), {
        blockCount: 7,
        updatedAt: serverTimestamp(),
      })
    );

    await seedTournament(
      testEnv,
      "has-consolation",
      {},
      { consolationBracket: { finalized: true, matches: [{ matchId: "m1" }] } }
    );
    await assertFails(
      updateDoc(tournamentRef(operatorDb, "has-consolation"), {
        blockCount: 7,
        updatedAt: serverTimestamp(),
      })
    );

    await seedTournament(testEnv, "closed-tournament", { status: "closed" });
    await assertFails(
      updateDoc(tournamentRef(operatorDb, "closed-tournament"), {
        blockCount: 7,
        updatedAt: serverTimestamp(),
      })
    );

    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      const se = baseTournament({
        tournamentFormat: "single_elimination",
        structureLocked: true,
      });
      delete se.blockCount;
      delete se.qualifiersPerBlock;
      delete se.finalTeamCount;
      delete se.wildcardComparisonMode;
      await setDoc(tournamentRef(db, "single-elim"), se);

      const legacy = baseTournament({
        structureLocked: true,
        preferredBlockSize: 4,
      });
      delete legacy.tournamentFormat;
      delete legacy.blockCount;
      delete legacy.qualifiersPerBlock;
      delete legacy.finalTeamCount;
      delete legacy.wildcardComparisonMode;
      await setDoc(tournamentRef(db, "legacy-format"), legacy);
    });
    await assertFails(
      updateDoc(tournamentRef(operatorDb, "single-elim"), {
        blockCount: 7,
        updatedAt: serverTimestamp(),
      })
    );
    await assertFails(
      updateDoc(tournamentRef(operatorDb, "legacy-format"), {
        blockCount: 7,
        updatedAt: serverTimestamp(),
      })
    );

    await seedTournament(testEnv, "name-immutable", { structureLocked: true });
    await assertFails(
      updateDoc(tournamentRef(operatorDb, "name-immutable"), {
        name: "Hacked",
        blockCount: 7,
        updatedAt: serverTimestamp(),
      })
    );

    await assertFails(
      updateDoc(tournamentRef(strangerDb, "locked-no-draw"), {
        blockCount: 8,
        updatedAt: serverTimestamp(),
      })
    );

    console.log("qualifying-structure-settings-edit.rules.test.mjs: all passed");
  } finally {
    await testEnv.cleanup();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
