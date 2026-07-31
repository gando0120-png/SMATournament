/**
 * multiTeamTotal の Firestore Rules テスト
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

const PROJECT_ID = "smatournament-multi-team-rules-test";
const OPERATOR_UID = "operator-mt-test";
const TOURNAMENT_ID = "mt-tournament-1";

function baseTournament(overrides = {}) {
  return {
    name: "Multi Team Rules Test",
    status: "open",
    eventDate: "2026-08-01",
    venue: "Test Venue",
    entryDeadline: Timestamp.fromDate(new Date("2099-01-01T00:00:00Z")),
    maxTeams: 8,
    teamSize: 4,
    courtCount: 2,
    entryCount: 0,
    confirmedCount: 4,
    publicViewEnabled: true,
    createdBy: OPERATOR_UID,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    tournamentFormat: "single_elimination",
    winsRequired: 2,
    matchFormat: "multiTeamTotal",
    aggregateMatchRules: {
      teamCount: 4,
      setCount: 2,
      qualifiersCount: 2,
      rankingMethod: "totalScoreDesc",
      tieBreakMethod: "manual",
    },
    ...overrides,
  };
}

function multiResult(overrides = {}) {
  return {
    matchId: "mt-r1-m1",
    roundNumber: 1,
    matchNumber: 1,
    matchFormat: "multiTeamTotal",
    status: "finished",
    resolution: "played",
    participantEntryIds: ["a", "b", "c", "d"],
    scores: {
      a: [50, 21],
      b: [38, 50],
      c: [25, 42],
      d: [17, 30],
    },
    totals: { a: 71, b: 88, c: 67, d: 47 },
    rankingEntryIds: ["b", "a", "c", "d"],
    qualifierEntryIds: ["b", "a"],
    tieResolution: null,
    setCount: 2,
    qualifiersCount: 2,
    updatedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    ...overrides,
  };
}

async function seedBase() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "operators", OPERATOR_UID), {
      uid: OPERATOR_UID,
      createdAt: serverTimestamp(),
    });
    await setDoc(doc(db, "tournaments", TOURNAMENT_ID), baseTournament());
    await setDoc(doc(db, "tournaments", TOURNAMENT_ID, "finalsBracket", "current"), {
      mode: "single_elimination",
      matchFormat: "multiTeamTotal",
      finalized: true,
      teamCount: 4,
      bracketSize: 4,
      roundCount: 1,
      slots: [
        { slotIndex: 0, entryId: "a", teamName: "A", seed: 1 },
        { slotIndex: 1, entryId: "b", teamName: "B", seed: 2 },
        { slotIndex: 2, entryId: "c", teamName: "C", seed: 3 },
        { slotIndex: 3, entryId: "d", teamName: "D", seed: 4 },
      ],
      matches: [{ matchId: "mt-r1-m1", matchFormat: "multiTeamTotal" }],
      aggregateMatchRules: {
        teamCount: 4,
        setCount: 2,
        qualifiersCount: 2,
        rankingMethod: "totalScoreDesc",
        tieBreakMethod: "manual",
      },
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });
}

let testEnv = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: { rules },
});
await seedBase();

{
  const db = testEnv.authenticatedContext(OPERATOR_UID).firestore();
  await assertSucceeds(
    setDoc(
      doc(db, "tournaments", TOURNAMENT_ID, "finalsMatchResults", "mt-r1-m1"),
      multiResult()
    )
  );
}

{
  const db = testEnv.authenticatedContext(OPERATOR_UID).firestore();
  await assertFails(
    setDoc(
      doc(db, "tournaments", TOURNAMENT_ID, "finalsMatchResults", "mt-r1-m2"),
      multiResult({
        matchId: "mt-r1-m2",
        qualifierEntryIds: ["b", "a", "c"],
      })
    )
  );
}

{
  // 最終ラウンド相当: qualifierEntryIds 省略可
  const db = testEnv.authenticatedContext(OPERATOR_UID).firestore();
  const { qualifierEntryIds: _omit, ...withoutQualifiers } = multiResult({
    matchId: "mt-final",
    roundNumber: 2,
  });
  await assertSucceeds(
    setDoc(
      doc(db, "tournaments", TOURNAMENT_ID, "finalsMatchResults", "mt-final"),
      withoutQualifiers
    )
  );
}

{
  const db = testEnv.authenticatedContext(OPERATOR_UID).firestore();
  await assertFails(
    updateDoc(doc(db, "tournaments", TOURNAMENT_ID), {
      matchFormat: "headToHeadSets",
      updatedAt: serverTimestamp(),
    })
  );
}

{
  // ブラケット未作成なら試合形式変更可
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "tournaments", "mt-unlocked"), baseTournament({
      status: "draft",
      confirmedCount: 0,
    }));
  });
  const db = testEnv.authenticatedContext(OPERATOR_UID).firestore();
  await assertSucceeds(
    updateDoc(doc(db, "tournaments", "mt-unlocked"), {
      matchFormat: "headToHeadSets",
      updatedAt: serverTimestamp(),
    })
  );
}

await testEnv.cleanup();
console.log("multi-team-match.rules.test.mjs: all passed");
