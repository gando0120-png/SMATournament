/**
 * 実UI write 再現: IAM bootstrap 不完全 session（roundNumber/lossBand 欠落）で
 * lossBandMatchSessions finish が Rules 拒否されることを固定する。
 *
 * 根拠大会: e2e-lb-ui-mswvli3t（scripts/e2e / _tmp-create-ui-open 系が
 * buildLossBandMatchSessionDoc を使わず session を書いた形状）
 *
 * 実行: firebase emulators:exec --only firestore "node tests/rules/loss-band-ui-write-repro.rules.test.mjs"
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
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
import { buildValidatedLossBandMatchResult } from "../../js/domain/loss-band/persistence.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rules = readFileSync(resolve(__dirname, "../../firestore.rules"), "utf8");
const FIXTURE_DIR = resolve(__dirname, "../fixtures/loss-band-ui-write");

const PROJECT_ID = "smatournament-lb-ui-write-repro";
const OPERATOR_UID = "operator-lb-ui";
const TOURNAMENT_ID = "e2e-lb-ui-repro";

const entryIds = Array.from({ length: 32 }, (_, i) =>
  `e${String(i + 1).padStart(3, "0")}`
);

function baseTournament() {
  return {
    name: "[E2E] loss-band UI open repro",
    status: "open",
    eventDate: "2099-12-31",
    venue: "E2E",
    maxTeams: 32,
    teamSize: 4,
    courtCount: 4,
    entryCount: 32,
    confirmedCount: 32,
    publicViewEnabled: true,
    createdBy: "e2e-script",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    tournamentFormat: "single_elimination",
    structureLocked: true,
  };
}

function stateDoc() {
  return {
    version: 1,
    teamCount: 32,
    bracketSize: 32,
    entryIds,
    currentRound: 1,
    currentRoundId: "r1",
    completedRankingRound: 0,
    status: "active",
    rankingMode: "loss_band",
    rematchAvoidance: true,
    thirdPlaceMatch: true,
    exchangeMatches: true,
    exchangeRoundNumber: 0,
    guaranteedMatchCount: 4,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  };
}

/** 本番 e2e-lb-ui-mswvli3t 相当: roundNumber / lossBand 欠落 */
function incompleteSessionDoc(matchId = "lb-r1-l0-m1") {
  return {
    matchId,
    matchNumber: 1,
    matchPurpose: "ranking",
    status: "playing",
    team1EntryId: "e001",
    team2EntryId: "e002",
    team1: { entryId: "e001", teamName: "UI Team 001", seed: 1 },
    team2: { entryId: "e002", teamName: "UI Team 002", seed: 2 },
    startedAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  };
}

function completeSessionDoc(matchId = "lb-r1-l0-m2") {
  return {
    ...incompleteSessionDoc(matchId),
    roundNumber: 1,
    lossBand: 0,
  };
}

function roundDoc() {
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
            team1EntryId: "e001",
            team2EntryId: "e002",
          },
        ],
        byeEntryId: null,
      },
    },
    matchIds: ["lb-r1-l0-m1"],
    byeMatchIds: [],
    byes: [],
    pairingVersion: "rematch-avoidance-v1",
    rematchAvoidance: true,
    rematchCount: 0,
    completedMatchIds: [],
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  };
}

function buildUiResultPayload(matchId = "lb-r1-l0-m1") {
  const built = buildValidatedLossBandMatchResult({
    match: {
      matchId,
      roundNumber: 1,
      lossCount: 0,
      team1EntryId: "e001",
      team2EntryId: "e002",
      purpose: "ranking",
    },
    matchNumber: 1,
    team1: { entryId: "e001", teamName: "UI Team 001", seed: 1 },
    team2: { entryId: "e002", teamName: "UI Team 002", seed: 2 },
    scoreInput: {
      set1Team1Score: 50,
      set1Team2Score: 10,
      set2Team1Score: 50,
      set2Team2Score: 20,
    },
    winsRequired: 2,
  });
  if (!built.valid) throw new Error(built.message);
  return {
    ...built.data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

function sessionFinishPatch() {
  return {
    status: "finished",
    finishedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

async function run() {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const resultFixture = buildUiResultPayload();
  writeFileSync(
    resolve(FIXTURE_DIR, "ui-result-payload.json"),
    JSON.stringify(
      {
        note: "saveLossBandMatchResult が create する lossBandMatchResults payload（timestamps は marker）",
        ...resultFixture,
        createdAt: "__serverTimestamp__",
        updatedAt: "__serverTimestamp__",
      },
      null,
      2
    )
  );
  writeFileSync(
    resolve(FIXTURE_DIR, "incomplete-session.json"),
    JSON.stringify(
      {
        note: "e2e-lb-ui-mswvli3t / e2e writeInit 不完全 session 形状",
        ...incompleteSessionDoc(),
        startedAt: "__timestamp__",
        updatedAt: "__timestamp__",
      },
      null,
      2
    )
  );
  writeFileSync(
    resolve(FIXTURE_DIR, "session-finish-update.json"),
    JSON.stringify(
      {
        note: "loss-band-service.js saveLossBandMatchResult の session update フィールド",
        updateMask: ["status", "finishedAt", "updatedAt"],
        ...sessionFinishPatch(),
        finishedAt: "__serverTimestamp__",
        updatedAt: "__serverTimestamp__",
      },
      null,
      2
    )
  );

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
      await setDoc(
        doc(db, "tournaments", TOURNAMENT_ID, "lossBandState", "current"),
        stateDoc()
      );
      await setDoc(
        doc(db, "tournaments", TOURNAMENT_ID, "lossBandRounds", "r1"),
        roundDoc()
      );
      await setDoc(
        doc(db, "tournaments", TOURNAMENT_ID, "lossBandMatchSessions", "lb-r1-l0-m1"),
        incompleteSessionDoc("lb-r1-l0-m1")
      );
      await setDoc(
        doc(db, "tournaments", TOURNAMENT_ID, "lossBandMatchSessions", "lb-r1-l0-m2"),
        completeSessionDoc("lb-r1-l0-m2")
      );
    });

    const opDb = testEnv.authenticatedContext(OPERATOR_UID).firestore();
    const incompleteSessionPath = doc(
      opDb,
      "tournaments",
      TOURNAMENT_ID,
      "lossBandMatchSessions",
      "lb-r1-l0-m1"
    );
    const completeSessionPath = doc(
      opDb,
      "tournaments",
      TOURNAMENT_ID,
      "lossBandMatchSessions",
      "lb-r1-l0-m2"
    );
    const resultPath = doc(
      opDb,
      "tournaments",
      TOURNAMENT_ID,
      "lossBandMatchResults",
      "lb-r1-l0-m1"
    );
    const roundPath = doc(
      opDb,
      "tournaments",
      TOURNAMENT_ID,
      "lossBandRounds",
      "r1"
    );
    const statePath = doc(
      opDb,
      "tournaments",
      TOURNAMENT_ID,
      "lossBandState",
      "current"
    );

    // 実UI transaction の各 write を個別再現
    await assertSucceeds(setDoc(resultPath, buildUiResultPayload("lb-r1-l0-m1")));
    await assertSucceeds(
      updateDoc(roundPath, {
        completedMatchIds: ["lb-r1-l0-m1"],
        updatedAt: serverTimestamp(),
      })
    );
    await assertSucceeds(
      updateDoc(statePath, {
        currentRound: 1,
        currentRoundId: "r1",
        completedRankingRound: 0,
        status: "active",
        updatedAt: serverTimestamp(),
      })
    );

    // ★ 拒否点: 不完全 session の finish（本番 UI 失敗の本体）
    // Rules: validLossBandMatchSessionFinishUpdate
    //   → data.roundNumber == old.roundNumber
    //   → old に roundNumber が無いため evaluation error → permission-denied
    await assertFails(updateDoc(incompleteSessionPath, sessionFinishPatch()));

    // 対照: 完全 session（Rules テストと同じ形状）は finish 可
    await assertSucceeds(updateDoc(completeSessionPath, sessionFinishPatch()));

    console.log("loss-band-ui-write-repro.rules.test.mjs: PASS");
    console.log("fixtures:", FIXTURE_DIR);
  } finally {
    await testEnv.cleanup();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
