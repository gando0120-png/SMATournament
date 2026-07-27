/**
 * finalsAdvancement Firestore Rules テスト
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
  deleteDoc,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rules = readFileSync(resolve(__dirname, "../../firestore.rules"), "utf8");

const PROJECT_ID = "smatournament-finals-advancement-rules-test";
const OPERATOR_UID = "operator-finals-advancement-test";
const NEW_TOURNAMENT_ID = "new-format-tournament";
const LEGACY_TOURNAMENT_ID = "legacy-format-tournament";

function tournamentRef(db, tournamentId) {
  return doc(db, "tournaments", tournamentId);
}

function advancementRef(db, tournamentId) {
  return doc(db, "tournaments", tournamentId, "finalsAdvancement", "current");
}

function baseTournamentPayload(overrides = {}) {
  return {
    name: "Finals Advancement Rules Test",
    status: "open",
    eventDate: "2026-08-01",
    venue: "Test Venue",
    entryDeadline: Timestamp.fromDate(new Date("2099-01-01T00:00:00Z")),
    maxTeams: 64,
    teamSize: 4,
    courtCount: 2,
    entryCount: 0,
    confirmedCount: 0,
    createdBy: OPERATOR_UID,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function legacyAdvancementPayload() {
  return {
    finalized: true,
    finalTeamCount: 8,
    blockCount: 8,
    blockWinnerCount: 8,
    wildcardCount: 0,
    qualifiers: Array.from({ length: 8 }, (_, index) => ({
      entryId: `e-${index + 1}`,
      teamName: `Team ${index + 1}`,
      seed: index + 1,
      source: "block_winner",
    })),
    qualifyingMatchCount: 10,
    qualifyingFinishedMatchCount: 10,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

function newFormatAdvancementPayload(blockCount = 4, qualifiersPerBlock = 2) {
  const qualifierCount = blockCount * qualifiersPerBlock;
  return {
    finalized: true,
    mode: "fixed_block_qualifiers",
    blockCount,
    qualifiersPerBlock,
    qualifierCount,
    finalTeamCount: qualifierCount,
    qualifiers: Array.from({ length: qualifierCount }, (_, index) => ({
      entryId: `e-${index + 1}`,
      blockId: String.fromCharCode(65 + Math.floor(index / qualifiersPerBlock)),
      blockRank: (index % qualifiersPerBlock) + 1,
    })),
    qualifyingMatchCount: 10,
    qualifyingFinishedMatchCount: 10,
    finalizedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
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
    await setDoc(
      tournamentRef(db, NEW_TOURNAMENT_ID),
      baseTournamentPayload({
        tournamentFormat: "qualifying_and_finals",
        blockCount: 4,
        qualifiersPerBlock: 2,
      })
    );
    await setDoc(
      tournamentRef(db, LEGACY_TOURNAMENT_ID),
      baseTournamentPayload({ preferredBlockSize: 4 })
    );
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

    await assertSucceeds(
      setDoc(advancementRef(operatorDb, NEW_TOURNAMENT_ID), newFormatAdvancementPayload(4, 2))
    );

    await assertFails(
      setDoc(advancementRef(operatorDb, LEGACY_TOURNAMENT_ID), {
        ...newFormatAdvancementPayload(4, 2),
      })
    );

    await assertSucceeds(
      setDoc(advancementRef(operatorDb, LEGACY_TOURNAMENT_ID), legacyAdvancementPayload())
    );

    await assertFails(
      setDoc(doc(operatorDb, "tournaments", NEW_TOURNAMENT_ID, "finalsAdvancement", "bad-mode"), {
        ...newFormatAdvancementPayload(4, 2),
        mode: "legacy",
      })
    );

    await assertFails(
      setDoc(doc(operatorDb, "tournaments", NEW_TOURNAMENT_ID, "finalsAdvancement", "bad-count"), {
        ...newFormatAdvancementPayload(4, 2),
        blockCount: 8,
      })
    );

    await assertFails(
      updateDoc(advancementRef(operatorDb, NEW_TOURNAMENT_ID), {
        updatedAt: serverTimestamp(),
      })
    );

    await assertFails(deleteDoc(advancementRef(operatorDb, NEW_TOURNAMENT_ID)));

    console.log("finals-advancement.rules.test.mjs: all passed");
  } finally {
    await testEnv.cleanup();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
