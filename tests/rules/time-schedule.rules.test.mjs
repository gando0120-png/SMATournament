/**
 * 大会スケジュールサブコレクションの Rules
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
} from "firebase/firestore";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rules = readFileSync(resolve(__dirname, "../../firestore.rules"), "utf8");

const PROJECT_ID = "smatournament-time-schedule";
const OPERATOR_UID = "operator-schedule";
const TOURNAMENT_ID = "t-schedule";

function tournamentPayload(overrides = {}) {
  return {
    name: "Schedule Tournament",
    status: "open",
    eventDate: "2099-09-01",
    venue: "Venue",
    entryDeadline: new Date("2099-12-01T00:00:00Z"),
    maxTeams: 8,
    teamSize: 2,
    courtCount: 2,
    preferredBlockSize: 4,
    entryCount: 0,
    confirmedCount: 0,
    createdBy: OPERATOR_UID,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  };
}

function scheduleRef(db, tournamentId = TOURNAMENT_ID) {
  return doc(db, "tournaments", tournamentId, "timeSchedule", "current");
}

function validPayload() {
  return {
    dayStartTime: "09:00",
    matchDurationMinutes: 20,
    matchIntervalMinutes: 5,
    qualifyingToFinalsIntervalMinutes: 60,
    overrides: {
      qualifyingRounds: {},
      qualifyingMatches: {},
      finalsRounds: {},
      finalsMatches: {},
    },
    updatedAt: serverTimestamp(),
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
      await setDoc(doc(db, "tournaments", TOURNAMENT_ID), tournamentPayload());
    });

    const opDb = testEnv.authenticatedContext(OPERATOR_UID).firestore();
    const unauthDb = testEnv.unauthenticatedContext().firestore();

    await assertSucceeds(setDoc(scheduleRef(opDb), validPayload()));
    await assertSucceeds(getDoc(scheduleRef(opDb)));
    await assertFails(getDoc(scheduleRef(unauthDb)));
    await assertFails(setDoc(scheduleRef(unauthDb), validPayload()));

    await assertSucceeds(
      setDoc(scheduleRef(opDb), {
        ...validPayload(),
        overrides: {
          qualifyingRounds: { "2": "09:40", "4": "11:00" },
          qualifyingMatches: { "qualifying-A-R3-M1": "10:20" },
          finalsRounds: { "2": "13:45" },
          finalsMatches: { "final-r2-m1": "14:00" },
        },
      })
    );

    await assertFails(
      setDoc(scheduleRef(opDb), {
        ...validPayload(),
        extraField: true,
      })
    );

    await assertFails(
      setDoc(scheduleRef(opDb), {
        ...validPayload(),
        overrides: {
          ...validPayload().overrides,
          unknownBucket: {},
        },
      })
    );

    await assertFails(
      setDoc(scheduleRef(opDb), {
        ...validPayload(),
        overrides: {
          qualifyingRounds: { "2": "25:00" },
          qualifyingMatches: {},
          finalsRounds: {},
          finalsMatches: {},
        },
      })
    );

    await assertFails(
      setDoc(scheduleRef(opDb), {
        ...validPayload(),
        overrides: {
          qualifyingRounds: { "2": "9:40" },
          qualifyingMatches: {},
          finalsRounds: {},
          finalsMatches: {},
        },
      })
    );

    await assertFails(
      setDoc(scheduleRef(opDb), {
        ...validPayload(),
        matchDurationMinutes: 0,
      })
    );

    await assertSucceeds(deleteDoc(scheduleRef(opDb)));
    await assertFails(deleteDoc(scheduleRef(unauthDb)));

    console.log("time-schedule.rules.test.mjs: ok");
  } finally {
    await testEnv.cleanup();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
