/**
 * 対戦表確定後の参加辞退。エントリー status 以外は書かない。
 */
import { FieldValue } from "firebase-admin/firestore";
import { EntryStatus } from "../vendor/domain/constants.js";
import { evaluatePostScheduleWithdrawal } from "../vendor/domain/qualifying-withdrawal.js";

const BLOCKER_COLLECTIONS = [
  "qualifyingMatchResults",
  "qualifyingMatchSessions",
  "qualifyingResultSubmissions",
  "qualifyingMatchReconciliations",
  "finalsMatchResults",
  "finalsMatchSessions",
  "consolationMatchResults",
  "consolationMatchSessions",
  "lossBandMatchResults",
  "lossBandMatchSessions",
  "lossBandExchangeMatchResults",
  "lossBandExchangeMatchSessions",
];

const BLOCKER_DOCS = [
  ["finalsAdvancement", "current"],
  ["finalsBracket", "current"],
  ["consolationBracket", "current"],
  ["lossBandState", "current"],
  ["tournamentResults", "current"],
];

function tournamentRef(db, tournamentId) {
  return db.collection("tournaments").doc(tournamentId);
}

function throwDecision(decision) {
  const error = new Error(decision.message || "参加辞退できません。");
  error.code = decision.code || "failed-precondition";
  throw error;
}

async function readBlockers(reader, db, tournamentId) {
  const root = tournamentRef(db, tournamentId);
  const blockers = {};
  await Promise.all(
    BLOCKER_COLLECTIONS.map(async (name) => {
      const snap = await reader.get(root.collection(name).limit(1));
      blockers[name] = snap.empty !== true;
    })
  );
  await Promise.all(
    BLOCKER_DOCS.map(async ([collectionName, docId]) => {
      const snap = await reader.get(root.collection(collectionName).doc(docId));
      blockers[`${collectionName}/${docId}`] = snap.exists === true;
    })
  );
  return blockers;
}

function snapshotData(snap) {
  if (!snap?.exists) {
    return null;
  }
  return { id: snap.id, ...snap.data() };
}

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {{ tournamentId: string, entryId: string, dryRun?: boolean }} input
 */
export async function withdrawConfirmedEntryAfterSchedule(db, input) {
  const tournamentId = input.tournamentId;
  const entryId = input.entryId;
  const root = tournamentRef(db, tournamentId);
  const entryRef = root.collection("entries").doc(entryId);
  const drawRef = root.collection("blockDraw").doc("current");
  const scheduleRef = root.collection("qualifyingSchedules").doc("current");

  const previewReads = {
    async get(ref) {
      return ref.get();
    },
  };
  const [entrySnap, tournamentSnap, drawSnap, scheduleSnap, blockers] = await Promise.all([
    entryRef.get(),
    root.get(),
    drawRef.get(),
    scheduleRef.get(),
    readBlockers(previewReads, db, tournamentId),
  ]);

  if (!tournamentSnap.exists) {
    const error = new Error("大会が見つかりません。");
    error.code = "not-found";
    throw error;
  }
  if (!entrySnap.exists) {
    const error = new Error("エントリーが見つかりません。");
    error.code = "not-found";
    throw error;
  }

  const entry = { id: entrySnap.id, ...entrySnap.data() };
  const decision = evaluatePostScheduleWithdrawal({
    entry,
    tournament: snapshotData(tournamentSnap),
    blockDraw: snapshotData(drawSnap),
    schedule: snapshotData(scheduleSnap),
    blockers,
  });

  const preview = {
    tournamentId,
    entryId,
    teamName: entry.teamName || "",
    allowed: decision.allowed,
    alreadyApplied: decision.alreadyApplied === true,
    code: decision.code,
    message: decision.message,
    blockId: decision.blockId,
    blockName: decision.blockName,
    voidMatches: decision.voidMatches,
    applied: false,
  };

  if (input.dryRun === true) {
    return preview;
  }

  if (!decision.allowed && !decision.alreadyApplied) {
    throwDecision(decision);
  }

  let applied = false;
  let alreadyApplied = decision.alreadyApplied === true;

  if (!alreadyApplied) {
    await db.runTransaction(async (tx) => {
      const [liveEntry, liveTournament, liveDraw, liveSchedule, liveBlockers] = await Promise.all([
        tx.get(entryRef),
        tx.get(root),
        tx.get(drawRef),
        tx.get(scheduleRef),
        readBlockers(tx, db, tournamentId),
      ]);
      const liveDecision = evaluatePostScheduleWithdrawal({
        entry: liveEntry.exists ? { id: liveEntry.id, ...liveEntry.data() } : null,
        tournament: snapshotData(liveTournament),
        blockDraw: snapshotData(liveDraw),
        schedule: snapshotData(liveSchedule),
        blockers: liveBlockers,
      });
      if (liveDecision.alreadyApplied) {
        alreadyApplied = true;
        return;
      }
      if (!liveDecision.allowed) {
        throwDecision(liveDecision);
      }
      tx.update(entryRef, {
        status: EntryStatus.CANCELLED,
        updatedAt: FieldValue.serverTimestamp(),
        cancelledAt: FieldValue.serverTimestamp(),
      });
      applied = true;
    });
  }

  return {
    ...preview,
    allowed: true,
    alreadyApplied,
    applied,
    code: null,
    message: alreadyApplied && !applied ? "このチームはすでに参加辞退済みです。" : null,
  };
}
