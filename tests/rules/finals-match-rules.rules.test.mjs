/**
 * finalsMatchRules / 試合 winsRequired の Firestore Rules テスト
 *
 * 通常の settings update は式評価上限（1000）に達することがある。
 * 成功更新は、現行 Rules の安い専用パス
 * validFinalsAdvancementSettingsBeforeQualifyingStartUpdate
 * に乗る Q+F / open / blockDraw 済み大会で検証する。
 * 拒否ケースは専用パス外（SE / 実ブラケットあり）のまま残す。
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
const STRANGER_UID = "stranger-fmr";
const TOURNAMENT_ID = "fmr-tournament-1";

function seDraftTournament(overrides = {}) {
  return {
    name: "Rules Match Rules Test",
    status: "draft",
    eventDate: "2026-08-01",
    venue: "Test Venue",
    entryDeadline: Timestamp.fromDate(new Date("2099-01-01T00:00:00Z")),
    maxTeams: 8,
    teamSize: 4,
    courtCount: 2,
    entryCount: 0,
    confirmedCount: 0,
    publicViewEnabled: true,
    createdBy: OPERATOR_UID,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    tournamentFormat: "single_elimination",
    winsRequired: 2,
    ...overrides,
  };
}

function qfOpenTournament(overrides = {}) {
  return {
    name: "Rules Match Rules Test",
    status: "open",
    eventDate: "2026-08-01",
    venue: "Test Venue",
    entryDeadline: Timestamp.fromDate(new Date("2099-01-01T00:00:00Z")),
    maxTeams: 16,
    teamSize: 4,
    courtCount: 2,
    entryCount: 0,
    confirmedCount: 0,
    publicViewEnabled: true,
    createdBy: OPERATOR_UID,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    tournamentFormat: "qualifying_and_finals",
    blockCount: 4,
    qualifiersPerBlock: 1,
    finalTeamCount: 8,
    winsRequired: 2,
    ...overrides,
  };
}

function minimalBlockDraw() {
  return {
    status: "finalized",
    blockCount: 4,
    blocks: [
      { id: "A", name: "Aブロック", entryIds: ["e1", "e2", "e3"] },
      { id: "B", name: "Bブロック", entryIds: ["e4", "e5", "e6"] },
      { id: "C", name: "Cブロック", entryIds: ["e7", "e8", "e9"] },
      { id: "D", name: "Dブロック", entryIds: ["e10", "e11", "e12"] },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
    finalizedAt: new Date(),
  };
}

function finalOnly3Payload() {
  return {
    winsRequired: 2,
    finalsMatchRules: {
      defaultWinsRequired: 2,
      roundOverrides: { final: 3 },
    },
    updatedAt: serverTimestamp(),
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

async function seedQfOpenWithDraw(testEnv, tournamentId, tournamentOverrides = {}) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "tournaments", tournamentId), qfOpenTournament(tournamentOverrides));
    await setDoc(
      doc(db, "tournaments", tournamentId, "blockDraw", "current"),
      minimalBlockDraw()
    );
  });
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
    const strangerDb = testEnv.authenticatedContext(STRANGER_UID).firestore();

    // create 成功は emulator が update 規則も評価し 1000 式に達するため admin seed。
    // 不正キーの拒否は create 規則側で担保する。
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, "tournaments", "create-ok"), {
        ...seDraftTournament(),
        structureLocked: false,
        finalsMatchRules: {
          defaultWinsRequired: 2,
          roundOverrides: { final: 3 },
        },
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });

    await assertFails(
      setDoc(doc(operatorDb, "tournaments", "create-bad-key"), {
        ...seDraftTournament(),
        structureLocked: false,
        finalsMatchRules: {
          defaultWinsRequired: 2,
          roundOverrides: { bogus: 3 },
        },
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    await seedQfOpenWithDraw(testEnv, "prod-like");
    await assertSucceeds(
      updateDoc(doc(operatorDb, "tournaments", "prod-like"), finalOnly3Payload())
    );

    await seedQfOpenWithDraw(testEnv, "all2", {
      structureLocked: false,
      finalsMatchRules: { defaultWinsRequired: 2, roundOverrides: {} },
    });
    await assertSucceeds(
      updateDoc(doc(operatorDb, "tournaments", "all2"), finalOnly3Payload())
    );

    await assertSucceeds(
      updateDoc(doc(operatorDb, "tournaments", "all2"), {
        winsRequired: 2,
        finalsMatchRules: { defaultWinsRequired: 2, roundOverrides: {} },
        updatedAt: serverTimestamp(),
      })
    );

    // 空ブラケットは hasMaterialFinalsBracket ではロックしない。
    // ただし専用パスは exists(finalsBracket) で弾くため、ここでは実ブラケット拒否と対で検証する。
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, "tournaments", TOURNAMENT_ID), seDraftTournament({ status: "open" }));
      await setDoc(doc(db, "tournaments", TOURNAMENT_ID, "finalsBracket", "current"), {
        finalized: true,
        bracketSize: 8,
        matches: [{ matchId: "r1-m1" }],
        updatedAt: serverTimestamp(),
      });
    });
    await assertFails(
      updateDoc(doc(operatorDb, "tournaments", TOURNAMENT_ID), {
        winsRequired: 3,
        finalsMatchRules: { defaultWinsRequired: 3, roundOverrides: {} },
        updatedAt: serverTimestamp(),
      })
    );

    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, "tournaments", "consolation-lock"), seDraftTournament());
      await setDoc(doc(db, "tournaments", "consolation-lock", "consolationBracket", "current"), {
        bracketSize: 4,
        matches: [{ matchId: "c-r1-m1" }],
      });
    });
    await assertFails(
      updateDoc(doc(operatorDb, "tournaments", "consolation-lock"), finalOnly3Payload())
    );

    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, "tournaments", "bad-values"), seDraftTournament());
    });
    await assertFails(
      updateDoc(doc(operatorDb, "tournaments", "bad-values"), {
        finalsMatchRules: {
          defaultWinsRequired: 2,
          roundOverrides: { bogus: 3 },
        },
        updatedAt: serverTimestamp(),
      })
    );
    await assertFails(
      updateDoc(doc(operatorDb, "tournaments", "bad-values"), {
        winsRequired: 5,
        finalsMatchRules: {
          defaultWinsRequired: 5,
          roundOverrides: {},
        },
        updatedAt: serverTimestamp(),
      })
    );

    await assertFails(
      updateDoc(doc(strangerDb, "tournaments", "prod-like"), {
        venue: "Hacked",
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
