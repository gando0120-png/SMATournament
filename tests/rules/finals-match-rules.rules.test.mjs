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
const STRANGER_UID = "stranger-fmr";
const TOURNAMENT_ID = "fmr-tournament-1";

function baseTournament(overrides = {}) {
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

    // create with finalsMatchRules ok / bad key
    await assertSucceeds(
      setDoc(doc(operatorDb, "tournaments", "create-ok"), {
        ...baseTournament(),
        structureLocked: false,
        finalsMatchRules: {
          defaultWinsRequired: 2,
          roundOverrides: { final: 3 },
        },
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    await assertFails(
      setDoc(doc(operatorDb, "tournaments", "create-bad-key"), {
        ...baseTournament(),
        structureLocked: false,
        finalsMatchRules: {
          defaultWinsRequired: 2,
          roundOverrides: { bogus: 3 },
        },
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    // 本番再現: structureLocked なし / finalsMatchRules なし / draft SE / エントリー0
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, "tournaments", "prod-like"), baseTournament());
    });

    await assertSucceeds(
      updateDoc(doc(operatorDb, "tournaments", "prod-like"), finalOnly3Payload())
    );

    // 全ラウンド2 → 決勝のみ3
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(
        doc(db, "tournaments", "all2"),
        baseTournament({
          structureLocked: false,
          finalsMatchRules: { defaultWinsRequired: 2, roundOverrides: {} },
        })
      );
    });
    await assertSucceeds(
      updateDoc(doc(operatorDb, "tournaments", "all2"), finalOnly3Payload())
    );

    // 決勝のみ3 → 全ラウンド2へ戻す
    await assertSucceeds(
      updateDoc(doc(operatorDb, "tournaments", "all2"), {
        winsRequired: 2,
        finalsMatchRules: { defaultWinsRequired: 2, roundOverrides: {} },
        updatedAt: serverTimestamp(),
      })
    );

    // 空ブラケットドキュメントがあっても勝利条件は更新可
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, "tournaments", "empty-bracket"), baseTournament());
      await setDoc(doc(db, "tournaments", "empty-bracket", "finalsBracket", "current"), {
        matches: [],
        bracketSize: 0,
      });
    });
    await assertSucceeds(
      updateDoc(doc(operatorDb, "tournaments", "empty-bracket"), finalOnly3Payload())
    );

    // SE に preferredBlockSize 残留していても変更しなければ更新可
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(
        doc(db, "tournaments", "se-pbs"),
        baseTournament({ preferredBlockSize: 4 })
      );
    });
    await assertSucceeds(
      updateDoc(doc(operatorDb, "tournaments", "se-pbs"), finalOnly3Payload())
    );

    // 拒否: 実ブラケット生成後
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, "tournaments", TOURNAMENT_ID), baseTournament({ status: "open" }));
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

    // 拒否: 下位ブラケット生成後
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, "tournaments", "consolation-lock"), baseTournament());
      await setDoc(doc(db, "tournaments", "consolation-lock", "consolationBracket", "current"), {
        bracketSize: 4,
        matches: [{ matchId: "c-r1-m1" }],
      });
    });
    await assertFails(
      updateDoc(doc(operatorDb, "tournaments", "consolation-lock"), finalOnly3Payload())
    );

    // 拒否: 不正キー / 不正値
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, "tournaments", "bad-values"), baseTournament());
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

    // 拒否: operators 未登録ユーザー
    await assertFails(
      updateDoc(doc(strangerDb, "tournaments", "prod-like"), {
        venue: "Hacked",
        updatedAt: serverTimestamp(),
      })
    );

    // 試合結果のセット数上限（既存）
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
