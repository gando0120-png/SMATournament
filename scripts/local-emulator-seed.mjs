/**
 * 127.0.0.1 の Auth / Firestore Emulator に、抽選後辞退を試す大会を作る。
 * FIRESTORE_EMULATOR_HOST が無ければ本番には接続せず終了する。
 *
 * ログイン（Emulator のみ）:
 *   email: local-operator@example.com
 *   password: local-emulator-only
 */
import { createRequire } from "node:module";
import { buildQualifyingScheduleFromBlockDraw } from "../js/domain/qualifying-schedule.js";
import { buildPersistedQualifyingSchedule } from "../js/domain/qualifying-schedule-persist.js";

const require = createRequire(new URL("../functions/package.json", import.meta.url));
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");

const EMAIL = "local-operator@example.com";
const PASSWORD = "local-emulator-only";
const TOURNAMENT_ID = "local-withdrawal-demo";

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.error("Emulator の環境変数がありません。本番には接続しません。");
  process.exit(1);
}

const app = initializeApp({ projectId: "smatournament-ce785" });
const auth = getAuth(app);
const db = getFirestore(app);

let user;
try {
  user = await auth.getUserByEmail(EMAIL);
} catch (error) {
  if (error?.code !== "auth/user-not-found") {
    throw error;
  }
  user = await auth.createUser({ email: EMAIL, password: PASSWORD, emailVerified: true });
}

await db.collection("operators").doc(user.uid).set({ enabled: true });

const teams = [
  ["e1", "ローカルA"],
  ["e2", "ローカルB"],
  ["e3", "ローカルC"],
  ["e4", "ローカルD"],
];

const tournamentRef = db.collection("tournaments").doc(TOURNAMENT_ID);
await tournamentRef.set({
  name: "ローカル辞退確認",
  status: "open",
  eventDate: "2026-11-20",
  venue: "ローカル会場",
  tournamentFormat: "qualifying_and_finals",
  blockCount: 1,
  qualifiersPerBlock: 2,
  finalTeamCount: 2,
  maxTeams: 8,
  courtCount: 2,
  teamSize: 2,
  createdBy: user.uid,
  publicViewEnabled: true,
});

const entries = teams.map(([id, teamName], index) => ({
  id,
  teamName,
  status: "confirmed",
  teamNumber: index + 1,
}));

for (const entry of entries) {
  const { id, ...data } = entry;
  await tournamentRef.collection("entries").doc(id).set({
    ...data,
    createdAt: Timestamp.fromDate(new Date("2026-11-12T00:00:00Z")),
    updatedAt: Timestamp.fromDate(new Date("2026-11-12T00:00:00Z")),
  });
}

const blockDraw = {
  status: "finalized",
  preferredBlockSize: 4,
  blockCount: 1,
  blocks: [
    {
      id: "A",
      name: "Aブロック",
      entryIds: entries.map((entry) => entry.id),
    },
  ],
};
await tournamentRef.collection("blockDraw").doc("current").set(blockDraw);

const schedule = buildPersistedQualifyingSchedule(
  buildQualifyingScheduleFromBlockDraw(blockDraw, entries),
  blockDraw
);
await tournamentRef.collection("qualifyingSchedules").doc("current").set(schedule);

console.log(JSON.stringify({
  tournamentId: TOURNAMENT_ID,
  uid: user.uid,
  email: EMAIL,
  entries: entries.map((entry) => entry.teamName),
  matches: schedule.totalMatchCount,
  scheduleFinalized: schedule.finalized,
}, null, 2));
