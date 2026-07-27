/**
 * blockDraw Firestore Rules テスト（Sprint 4: draft / update / delete）
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

const PROJECT_ID = "smatournament-block-draw-rules-test";
const OPERATOR_UID = "operator-block-draw-test";
const NEW_TOURNAMENT_ID = "new-format-tournament";
const NEW_MISMATCH_TOURNAMENT_ID = "new-format-mismatch";
const LEGACY_TOURNAMENT_ID = "legacy-format-tournament";
const FINALIZED_TOURNAMENT_ID = "finalized-tournament";

function tournamentRef(db, tournamentId) {
  return doc(db, "tournaments", tournamentId);
}

function blockDrawRef(db, tournamentId) {
  return doc(db, "tournaments", tournamentId, "blockDraw", "current");
}

function baseTournamentPayload(overrides = {}) {
  return {
    name: "Block Draw Rules Test",
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

function newFormatBlockDrawDraftPayload(blockCount = 4) {
  const blocks = Array.from({ length: blockCount }, (_, index) => ({
    id: index < 26 ? String.fromCharCode(65 + index) : `A${String.fromCharCode(65 + index - 26)}`,
    name: `Block ${index + 1}`,
    entryIds: [`e-${index * 3 + 1}`, `e-${index * 3 + 2}`, `e-${index * 3 + 3}`],
  }));

  return {
    status: "draft",
    blockCount,
    distribution: {
      baseSize: 3,
      largerBlockCount: 0,
      smallerBlockCount: blockCount,
      minBlockSize: 3,
      maxBlockSize: 3,
      largerBlockIds: [],
    },
    blocks,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

function newFormatBlockDrawFinalizedPayload(blockCount = 4) {
  return {
    ...newFormatBlockDrawDraftPayload(blockCount),
    status: "finalized",
    finalizedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

function legacyBlockDrawPayload() {
  return {
    preferredBlockSize: 4,
    blockCount: 2,
    blocks: [
      { id: "A", name: "Aブロック", entryIds: ["e1", "e2", "e3"] },
      { id: "B", name: "Bブロック", entryIds: ["e4", "e5", "e6"] },
    ],
    updatedAt: serverTimestamp(),
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

async function seedTournaments(context) {
  await context.withSecurityRulesDisabled(async (rulesContext) => {
    const db = rulesContext.firestore();
    await setDoc(
      tournamentRef(db, NEW_TOURNAMENT_ID),
      baseTournamentPayload({
        tournamentFormat: "qualifying_and_finals",
        blockCount: 4,
        qualifiersPerBlock: 1,
      })
    );
    await setDoc(
      tournamentRef(db, NEW_MISMATCH_TOURNAMENT_ID),
      baseTournamentPayload({
        tournamentFormat: "qualifying_and_finals",
        blockCount: 4,
        qualifiersPerBlock: 1,
      })
    );
    await setDoc(
      tournamentRef(db, LEGACY_TOURNAMENT_ID),
      baseTournamentPayload({
        maxTeams: 8,
        preferredBlockSize: 4,
      })
    );
    await setDoc(
      tournamentRef(db, FINALIZED_TOURNAMENT_ID),
      baseTournamentPayload({
        tournamentFormat: "qualifying_and_finals",
        blockCount: 4,
        qualifiersPerBlock: 1,
      })
    );
    await setDoc(
      blockDrawRef(db, FINALIZED_TOURNAMENT_ID),
      newFormatBlockDrawFinalizedPayload(4)
    );
  });
}

async function run() {
  const testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules, host: "127.0.0.1", port: 8090 },
  });

  try {
    await seedOperator(testEnv);
    await seedTournaments(testEnv);
    const operatorDb = testEnv.authenticatedContext(OPERATOR_UID).firestore();

    await assertSucceeds(
      setDoc(blockDrawRef(operatorDb, NEW_TOURNAMENT_ID), newFormatBlockDrawDraftPayload(4))
    );

    await assertFails(
      setDoc(blockDrawRef(operatorDb, NEW_MISMATCH_TOURNAMENT_ID), newFormatBlockDrawDraftPayload(8))
    );

    await assertFails(
      setDoc(blockDrawRef(operatorDb, NEW_MISMATCH_TOURNAMENT_ID), newFormatBlockDrawFinalizedPayload(4))
    );

    await assertFails(
      setDoc(doc(operatorDb, "tournaments", NEW_TOURNAMENT_ID, "blockDraw", "bad-blocks"), {
        ...newFormatBlockDrawDraftPayload(4),
        blocks: newFormatBlockDrawDraftPayload(4).blocks.slice(0, 2),
      })
    );

    const draftPayload = newFormatBlockDrawDraftPayload(4);
    const updatedBlocks = draftPayload.blocks.map((block, index) =>
      index === 0
        ? { ...block, entryIds: [...block.entryIds, "e-extra"] }
        : block
    );

    await assertSucceeds(
      updateDoc(blockDrawRef(operatorDb, NEW_TOURNAMENT_ID), {
        blocks: updatedBlocks,
        distribution: {
          ...draftPayload.distribution,
          maxBlockSize: 4,
          minBlockSize: 3,
          largerBlockIds: ["A"],
          blockSizeDifference: 1,
        },
        updatedAt: serverTimestamp(),
      })
    );

    await assertSucceeds(
      updateDoc(blockDrawRef(operatorDb, NEW_TOURNAMENT_ID), {
        status: "finalized",
        finalizedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    await assertFails(
      updateDoc(blockDrawRef(operatorDb, NEW_TOURNAMENT_ID), {
        status: "draft",
        updatedAt: serverTimestamp(),
      })
    );

    await assertFails(
      updateDoc(blockDrawRef(operatorDb, FINALIZED_TOURNAMENT_ID), {
        updatedAt: serverTimestamp(),
      })
    );

    await assertSucceeds(
      setDoc(blockDrawRef(operatorDb, LEGACY_TOURNAMENT_ID), legacyBlockDrawPayload())
    );

    await assertFails(
      updateDoc(blockDrawRef(operatorDb, LEGACY_TOURNAMENT_ID), {
        updatedAt: serverTimestamp(),
      })
    );

    await assertFails(
      updateDoc(blockDrawRef(operatorDb, LEGACY_TOURNAMENT_ID), {
        status: "finalized",
        updatedAt: serverTimestamp(),
      })
    );

    await assertFails(deleteDoc(blockDrawRef(operatorDb, LEGACY_TOURNAMENT_ID)));

    await setDoc(
      blockDrawRef(operatorDb, NEW_MISMATCH_TOURNAMENT_ID),
      newFormatBlockDrawDraftPayload(4)
    );

    await assertSucceeds(deleteDoc(blockDrawRef(operatorDb, NEW_MISMATCH_TOURNAMENT_ID)));

    await assertFails(deleteDoc(blockDrawRef(operatorDb, FINALIZED_TOURNAMENT_ID)));

    await assertFails(
      updateDoc(blockDrawRef(operatorDb, NEW_TOURNAMENT_ID), {
        blockCount: 8,
        updatedAt: serverTimestamp(),
      })
    );

    console.log("block-draw.rules.test.mjs: all passed");
  } finally {
    await testEnv.cleanup();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
