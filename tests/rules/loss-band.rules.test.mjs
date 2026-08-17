/**
 * loss-band Firestore Rules
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

const PROJECT_ID = "smatournament-loss-band-rules-test";
const OPERATOR_UID = "operator-lb-test";
const STRANGER_UID = "stranger-lb";
const TOURNAMENT_ID = "lb-tournament-1";

function baseTournament(overrides = {}) {
  return {
    name: "Loss Band Rules Test",
    status: "open",
    eventDate: "2026-08-01",
    venue: "Test Venue",
    entryDeadline: Timestamp.fromDate(new Date("2099-01-01T00:00:00Z")),
    maxTeams: 64,
    teamSize: 4,
    courtCount: 2,
    entryCount: 64,
    confirmedCount: 64,
    publicViewEnabled: false,
    createdBy: OPERATOR_UID,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    tournamentFormat: "single_elimination",
    winsRequired: 2,
    ...overrides,
  };
}

function entryIds64() {
  return Array.from({ length: 64 }, (_, i) => `e${String(i + 1).padStart(2, "0")}`);
}

function statePayload(overrides = {}) {
  return {
    version: 1,
    teamCount: 64,
    bracketSize: 64,
    entryIds: entryIds64(),
    currentRound: 1,
    currentRoundId: "r1",
    completedRankingRound: 0,
    status: "active",
    rankingMode: "loss_band",
    rematchAvoidance: true,
    thirdPlaceMatch: false,
    exchangeMatches: false,
    exchangeRoundNumber: 0,
    guaranteedMatchCount: 5,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  };
}

function roundPayload(overrides = {}) {
  return {
    roundId: "r1",
    roundNumber: 1,
    status: "open",
    bands: {
      "0": {
        lossCount: 0,
        matchIds: ["lb-r1-l0-m1"],
        pairs: [
          {
            matchId: "lb-r1-l0-m1",
            team1EntryId: "e01",
            team2EntryId: "e02",
          },
        ],
      },
    },
    matchIds: ["lb-r1-l0-m1"],
    pairingVersion: "rematch-avoidance-v1",
    rematchAvoidance: true,
    rematchCount: 0,
    completedMatchIds: [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  };
}

function team(entryId, seed) {
  return { entryId, teamName: entryId, seed };
}

function sessionPayload(overrides = {}) {
  return {
    matchId: "lb-r1-l0-m1",
    roundNumber: 1,
    matchNumber: 1,
    lossBand: 0,
    team1EntryId: "e01",
    team2EntryId: "e02",
    matchPurpose: "ranking",
    status: "playing",
    team1: team("e01", 1),
    team2: team("e02", 2),
    startedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  };
}

function resultPayload(overrides = {}) {
  const t1 = team("e01", 1);
  const t2 = team("e02", 2);
  return {
    matchId: "lb-r1-l0-m1",
    roundNumber: 1,
    matchNumber: 1,
    status: "finished",
    resolution: "played",
    lossBand: 0,
    team1EntryId: "e01",
    team2EntryId: "e02",
    matchPurpose: "ranking",
    team1: t1,
    team2: t2,
    winner: t1,
    loser: t2,
    winnerSide: "team1",
    sets: [
      { setNumber: 1, team1Score: 50, team2Score: 10, winner: "team1" },
      { setNumber: 2, team1Score: 50, team2Score: 20, winner: "team1" },
    ],
    team1SetWins: 2,
    team2SetWins: 0,
    winsRequired: 2,
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
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await setDoc(doc(db, "tournaments", TOURNAMENT_ID), baseTournament());
    });

    const operator = testEnv.authenticatedContext(OPERATOR_UID);
    const stranger = testEnv.authenticatedContext(STRANGER_UID);
    const unauth = testEnv.unauthenticatedContext();
    const opDb = operator.firestore();
    const strangerDb = stranger.firestore();
    const unauthDb = unauth.firestore();

    const statePath = doc(opDb, "tournaments", TOURNAMENT_ID, "lossBandState", "current");
    const roundPath = doc(opDb, "tournaments", TOURNAMENT_ID, "lossBandRounds", "r1");
    const sessionPath = doc(
      opDb,
      "tournaments",
      TOURNAMENT_ID,
      "lossBandMatchSessions",
      "lb-r1-l0-m1"
    );
    const resultPath = doc(
      opDb,
      "tournaments",
      TOURNAMENT_ID,
      "lossBandMatchResults",
      "lb-r1-l0-m1"
    );

    await assertSucceeds(setDoc(statePath, statePayload()));
    await assertSucceeds(setDoc(roundPath, roundPayload()));
    await assertSucceeds(setDoc(sessionPath, sessionPayload()));
    await assertSucceeds(setDoc(resultPath, resultPayload()));

    // BYE result create（運営バッチ）
    const byeResultPath = doc(
      opDb,
      "tournaments",
      TOURNAMENT_ID,
      "lossBandMatchResults",
      "lb-r1-l0-bye"
    );
    await assertSucceeds(
      setDoc(byeResultPath, {
        matchId: "lb-r1-l0-bye",
        roundNumber: 1,
        status: "finished",
        resolution: "bye",
        isBye: true,
        lossBand: 0,
        team1EntryId: "e03",
        team2EntryId: null,
        team2: null,
        loser: null,
        team1: team("e03", 3),
        winner: team("e03", 3),
        matchPurpose: "ranking",
        sets: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
    await assertFails(
      updateDoc(byeResultPath, {
        resolution: "played",
        updatedAt: serverTimestamp(),
      })
    );

    await assertFails(
      setDoc(doc(unauthDb, "tournaments", TOURNAMENT_ID, "lossBandState", "current"), statePayload())
    );
    await assertFails(
      setDoc(
        doc(strangerDb, "tournaments", TOURNAMENT_ID, "lossBandMatchResults", "x"),
        resultPayload({ matchId: "x" })
      )
    );

    // クライアント改ざん: rankingMode 変更不可
    await assertFails(
      updateDoc(statePath, {
        rankingMode: "single_elimination",
        updatedAt: serverTimestamp(),
      })
    );

    // ペアリング差し替え不可
    await assertFails(
      updateDoc(roundPath, {
        matchIds: ["tampered"],
        updatedAt: serverTimestamp(),
      })
    );

    // セッション finish は可
    await assertSucceeds(
      updateDoc(sessionPath, {
        status: "finished",
        finishedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    // 勝者を無関係チームに改ざん不可
    await assertFails(
      updateDoc(resultPath, {
        winner: team("e99", 9),
        updatedAt: serverTimestamp(),
      })
    );

    // placements create（運営）/ 未認証拒否 / update 禁止
    const placementsPath = doc(
      opDb,
      "tournaments",
      TOURNAMENT_ID,
      "lossBandPlacements",
      "current"
    );
    const placementsPayload = {
      version: 1,
      teamCount: 64,
      rankingMode: "loss_band",
      thirdPlaceMatch: false,
      status: "completed",
      placements: entryIds64().map((entryId, i) => ({
        entryId,
        placement: i + 1,
        isTied: false,
        tiedCount: 1,
        lossCount: 0,
      })),
      placementCounts: Object.fromEntries(
        entryIds64().map((_, i) => [String(i + 1), 1])
      ),
      championEntryId: "e01",
      runnerUpEntryId: "e02",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await assertSucceeds(setDoc(placementsPath, placementsPayload));
    await assertFails(
      setDoc(
        doc(unauthDb, "tournaments", TOURNAMENT_ID, "lossBandPlacements", "current"),
        placementsPayload
      )
    );
    await assertFails(
      updateDoc(placementsPath, { championEntryId: "e99", updatedAt: serverTimestamp() })
    );

    // completed 後の state 更新不可
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(
        doc(db, "tournaments", TOURNAMENT_ID, "lossBandState", "current"),
        {
          ...statePayload({
            status: "completed",
            currentRound: 6,
            currentRoundId: "final",
            completedRankingRound: 5,
          }),
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        }
      );
    });
    await assertFails(
      updateDoc(statePath, {
        status: "active",
        updatedAt: serverTimestamp(),
      })
    );

    console.log("loss-band rules tests: ok");
  } finally {
    await testEnv.cleanup();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
