/**
 * finalsBracket Firestore Rules テスト（一発TN含む）
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
  Timestamp,
} from "firebase/firestore";
import {
  buildPersistedSingleEliminationBracket,
  buildSingleEliminationBracket,
} from "../../js/domain/single-elimination-bracket.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rules = readFileSync(resolve(__dirname, "../../firestore.rules"), "utf8");

const PROJECT_ID = "smatournament-finals-bracket-rules-test";
const OPERATOR_UID = "operator-finals-bracket-test";
const SINGLE_ELIM_ID = "single-elim-tournament";
const SINGLE_ELIM_BAD_MODE_ID = "single-elim-bad-mode";
const SINGLE_ELIM_BAD_SIZE_ID = "single-elim-bad-size";
const SINGLE_ELIM_BAD_COUNT_ID = "single-elim-bad-count";
const QUALIFYING_ID = "qualifying-tournament";
const QUALIFYING_NO_ADV_ID = "qualifying-no-advancement";

function tournamentRef(db, tournamentId) {
  return doc(db, "tournaments", tournamentId);
}

function bracketRef(db, tournamentId) {
  return doc(db, "tournaments", tournamentId, "finalsBracket", "current");
}

function advancementRef(db, tournamentId) {
  return doc(db, "tournaments", tournamentId, "finalsAdvancement", "current");
}

function baseTournamentPayload(overrides = {}) {
  return {
    name: "Finals Bracket Rules Test",
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

function makeEntries(count) {
  return Array.from({ length: count }, (_, index) => ({
    entryId: `e-${index + 1}`,
    teamName: `Team ${index + 1}`,
  }));
}

function singleElimBracketPayload(teamCount, overrides = {}) {
  const preview = buildSingleEliminationBracket({
    entries: makeEntries(teamCount),
    random: () => 0.25,
  });
  return {
    ...buildPersistedSingleEliminationBracket(preview),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  };
}

function qualifyingBracketPayload() {
  return {
    finalized: true,
    bracketSize: 8,
    qualifierCount: 8,
    roundCount: 3,
    slots: Array.from({ length: 8 }, (_, index) => ({
      slotNumber: index + 1,
      seed: index + 1,
      entryId: index < 8 ? `e-${index + 1}` : null,
      teamName: index < 8 ? `Team ${index + 1}` : null,
      isBye: false,
    })),
    matches: [{ matchId: "final-r1-m1", roundNumber: 1, matchNumber: 1 }],
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
      tournamentRef(db, SINGLE_ELIM_ID),
      baseTournamentPayload({ tournamentFormat: "single_elimination" })
    );
    for (const tournamentId of [
      SINGLE_ELIM_BAD_MODE_ID,
      SINGLE_ELIM_BAD_SIZE_ID,
      SINGLE_ELIM_BAD_COUNT_ID,
    ]) {
      await setDoc(
        tournamentRef(db, tournamentId),
        baseTournamentPayload({ tournamentFormat: "single_elimination" })
      );
    }
    await setDoc(
      tournamentRef(db, QUALIFYING_ID),
      baseTournamentPayload({
        tournamentFormat: "qualifying_and_finals",
        blockCount: 4,
        qualifiersPerBlock: 2,
      })
    );
    await setDoc(
      tournamentRef(db, QUALIFYING_NO_ADV_ID),
      baseTournamentPayload({
        tournamentFormat: "qualifying_and_finals",
        blockCount: 4,
        qualifiersPerBlock: 2,
      })
    );
    await setDoc(
      advancementRef(db, QUALIFYING_ID),
      {
        finalized: true,
        mode: "fixed_block_qualifiers",
        blockCount: 4,
        qualifiersPerBlock: 2,
        qualifierCount: 8,
        qualifiers: makeEntries(8).map((entry, index) => ({
          entryId: entry.entryId,
          blockId: "A",
          blockRank: (index % 2) + 1,
        })),
        qualifyingMatchCount: 10,
        qualifyingFinishedMatchCount: 10,
        finalizedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      }
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
      setDoc(bracketRef(operatorDb, SINGLE_ELIM_ID), singleElimBracketPayload(5))
    );

    await assertFails(
      setDoc(bracketRef(operatorDb, SINGLE_ELIM_ID), singleElimBracketPayload(3))
    );

    await assertFails(
      setDoc(bracketRef(operatorDb, QUALIFYING_ID), singleElimBracketPayload(5))
    );

    await assertFails(
      setDoc(
        bracketRef(operatorDb, SINGLE_ELIM_BAD_MODE_ID),
        singleElimBracketPayload(5, { mode: "fixed_block_qualifiers" })
      )
    );

    await assertFails(
      setDoc(
        bracketRef(operatorDb, SINGLE_ELIM_BAD_SIZE_ID),
        singleElimBracketPayload(5, { bracketSize: 6, byeCount: 1 })
      )
    );

    await assertFails(
      setDoc(
        bracketRef(operatorDb, SINGLE_ELIM_BAD_COUNT_ID),
        singleElimBracketPayload(5, { teamCount: 1, qualifierCount: 1, byeCount: 7 })
      )
    );

    await assertFails(
      setDoc(bracketRef(operatorDb, QUALIFYING_NO_ADV_ID), qualifyingBracketPayload())
    );

    await assertSucceeds(
      setDoc(bracketRef(operatorDb, QUALIFYING_ID), qualifyingBracketPayload())
    );

    // 再生成 update（createdAt 維持）
    const createdSnap = await getDoc(bracketRef(operatorDb, QUALIFYING_ID));
    const createdAt = createdSnap.data().createdAt;
    await assertSucceeds(
      setDoc(bracketRef(operatorDb, QUALIFYING_ID), {
        ...qualifyingBracketPayload(),
        createdAt,
        updatedAt: serverTimestamp(),
        slots: Array.from({ length: 8 }, (_, index) => ({
          slotNumber: index + 1,
          seed: index + 1,
          entryId: `e-${8 - index}`,
          teamName: `Team ${8 - index}`,
          isBye: false,
        })),
      })
    );

    // createdAt を書き換える update は拒否
    await assertFails(
      setDoc(bracketRef(operatorDb, QUALIFYING_ID), {
        ...qualifyingBracketPayload(),
        createdAt: Timestamp.fromDate(new Date("2099-01-01T00:00:00Z")),
        updatedAt: serverTimestamp(),
      })
    );

    // BYE 結果のみ削除可
    const byeRef = doc(
      operatorDb,
      "tournaments",
      QUALIFYING_ID,
      "finalsMatchResults",
      "final-r1-m1"
    );
    await assertSucceeds(
      setDoc(byeRef, {
        matchId: "final-r1-m1",
        status: "finished",
        resolution: "bye",
        roundNumber: 1,
        matchNumber: 1,
        winner: { entryId: "e-1", teamName: "Team 1", seed: 1 },
        loser: null,
        sets: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
    await assertSucceeds(deleteDoc(byeRef));

    const playedRef = doc(
      operatorDb,
      "tournaments",
      QUALIFYING_ID,
      "finalsMatchResults",
      "final-r1-m2"
    );
    await assertSucceeds(
      setDoc(playedRef, {
        matchId: "final-r1-m2",
        status: "finished",
        resolution: "played",
        roundNumber: 1,
        matchNumber: 2,
        team1: { entryId: "e-1", teamName: "Team 1", seed: 1 },
        team2: { entryId: "e-2", teamName: "Team 2", seed: 2 },
        winner: { entryId: "e-1", teamName: "Team 1", seed: 1 },
        loser: { entryId: "e-2", teamName: "Team 2", seed: 2 },
        winnerSide: "team1",
        sets: [
          { setNumber: 1, team1Score: 50, team2Score: 10, winner: "team1" },
          { setNumber: 2, team1Score: 50, team2Score: 20, winner: "team1" },
        ],
        team1SetWins: 2,
        team2SetWins: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
    await assertFails(deleteDoc(playedRef));

    await assertFails(
      setDoc(
        doc(operatorDb, "tournaments", QUALIFYING_ID, "finalsBracket", "duplicate"),
        qualifyingBracketPayload()
      )
    );

    console.log("finals-bracket.rules.test.mjs: all passed");
  } finally {
    await testEnv.cleanup();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
