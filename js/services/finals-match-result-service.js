/**

 * 決勝試合結果 Firestore 操作（DOM 非依存）

 */

import {

  doc,

  getDoc,

  getDocs,

  collection,

  deleteDoc,

  runTransaction,

  serverTimestamp,

} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

import { getFirebaseDb, isFirebaseConfigured } from "../lib/firebase-app.js";

import { ConfigUnconfiguredError } from "../lib/errors.js";

import {

  FinalsMatchResolution,

  MatchResultStatus,

  MatchSessionStatus,

} from "../domain/constants.js";

import {

  BracketKind,

  resolveBracketCollections,

  resolveOptionsBracketKind,

} from "../domain/bracket-collections.js";

import {

  buildByeMatchResultPayload,

  buildPlayedFinalsMatchResultTeams,

  findBracketMatch,

  listByeMatchesNeedingResults,

  listDoubleByeMatches,

} from "../domain/finals-match-progress.js";

import { getByeWinnerTeam } from "../domain/finals-match-bye.js";

import { validateFinalsMatchResultInput } from "../domain/finals-match-result.js";

import { resolveMatchWinsRequired } from "../domain/finals-match-format.js";
import { tournamentViewForBracketRules } from "../domain/bracket-match-config.js";

import { getFinalsBracket } from "./finals-bracket-service.js";

import { getConsolationBracket } from "./consolation-bracket-service.js";

import { buildConsolationByeMatchResultPayload } from "../domain/consolation-bracket.js";

import {

  getFinalsMatchSessions,

  getFinalsMatchSession,

} from "./finals-match-session-service.js";

import { getTournament, requireOpenTournament } from "./tournament-service.js";

import { withPublicSnapshotRebuild } from "../lib/public-snapshot-hook.js";



function requireDb() {

  if (!isFirebaseConfigured()) {

    throw new ConfigUnconfiguredError();

  }

  const db = getFirebaseDb();

  if (!db) {

    throw new ConfigUnconfiguredError();

  }

  return db;

}



function mapResultDoc(docSnap) {

  return { id: docSnap.id, ...docSnap.data() };

}



/**

 * @param {string} bracketKind

 * @param {{ source?: 'default' | 'server' }} [options]

 */

async function getBracketForKind(tournamentId, bracketKind, options = {}) {

  if (bracketKind === BracketKind.CONSOLATION) {

    return getConsolationBracket(tournamentId, options);

  }

  return getFinalsBracket(tournamentId, options);

}



/**

 * @param {string} tournamentId

 * @param {string} bracketKind

 */

function resultsCollection(db, tournamentId, bracketKind) {

  const { results } = resolveBracketCollections(bracketKind);

  return collection(db, "tournaments", tournamentId, results);

}



/**

 * @param {string} tournamentId

 * @param {string} matchId

 * @param {string} bracketKind

 */

function resultDocRef(db, tournamentId, matchId, bracketKind) {

  const { results } = resolveBracketCollections(bracketKind);

  return doc(db, "tournaments", tournamentId, results, matchId);

}



/**

 * @param {string} tournamentId

 * @param {string} matchId

 * @param {string} bracketKind

 */

function sessionDocRef(db, tournamentId, matchId, bracketKind) {

  const { sessions } = resolveBracketCollections(bracketKind);

  return doc(db, "tournaments", tournamentId, sessions, matchId);

}



/**

 * @param {string} tournamentId

 * @param {{ bracketKind?: string }} [options]

 * @returns {Promise<Map<string, object>>}

 */

export async function getFinalsMatchResults(tournamentId, options = {}) {

  const bracketKind = resolveOptionsBracketKind(options);

  const db = requireDb();

  const snapshot = await getDocs(resultsCollection(db, tournamentId, bracketKind));

  const results = new Map();

  snapshot.docs.forEach((docSnap) => {

    results.set(docSnap.id, mapResultDoc(docSnap));

  });

  return results;

}



/**

 * BYE 自動結果のみ削除（再生成前の掃除）。played 結果がある場合は拒否。

 * @param {string} tournamentId

 * @param {{ bracketKind?: string }} [options]

 */

export async function deleteByeOnlyFinalsMatchResults(tournamentId, options = {}) {

  const bracketKind = resolveOptionsBracketKind(options);

  await requireOpenTournament(tournamentId);

  const resultsMap = await getFinalsMatchResults(tournamentId, { bracketKind });

  const played = [...resultsMap.values()].filter((result) => result.resolution === "played");

  if (played.length > 0) {

    const error = new Error("Cannot clear bye results while played results exist");

    error.code = "finals-bracket/cannot-regenerate";

    throw error;

  }



  const byeResults = [...resultsMap.values()].filter((result) => result.resolution === "bye");

  if (byeResults.length === 0) {

    return { deleted: 0 };

  }



  const db = requireDb();

  let deleted = 0;

  for (const result of byeResults) {

    await deleteDoc(resultDocRef(db, tournamentId, result.matchId ?? result.id, bracketKind));

    deleted += 1;

  }



  return { deleted };

}



/**

 * @param {string} tournamentId

 * @param {string} matchId

 * @param {{ bracketKind?: string }} [options]

 */

export async function getFinalsMatchResult(tournamentId, matchId, options = {}) {

  const bracketKind = resolveOptionsBracketKind(options);

  const db = requireDb();

  const snap = await getDoc(resultDocRef(db, tournamentId, matchId, bracketKind));

  if (!snap.exists()) {

    return null;

  }

  return mapResultDoc(snap);

}



/**

 * @param {string} tournamentId

 * @param {{ bracketKind?: string }} [options]

 */

export async function ensureFinalsByeResults(tournamentId, options = {}) {

  const bracketKind = resolveOptionsBracketKind(options);

  await requireOpenTournament(tournamentId);

  const bracket = await getBracketForKind(tournamentId, bracketKind);

  if (!bracket?.finalized) {

    return { created: 0 };

  }



  const doubleByeMatches = listDoubleByeMatches(bracket);

  if (doubleByeMatches.length > 0) {

    const error = new Error("Invalid double-bye match in bracket");

    error.code =

      bracketKind === BracketKind.CONSOLATION

        ? "consolation-match-result/invalid-bye"

        : "finals-match-result/invalid-bye";

    throw error;

  }



  const byeMatches = listByeMatchesNeedingResults(bracket);

  if (byeMatches.length === 0) {

    return { created: 0 };

  }



  const db = requireDb();

  let created = 0;



  for (const match of byeMatches) {

    const docRef = resultDocRef(db, tournamentId, match.matchId, bracketKind);

    const winner = getByeWinnerTeam(match.team1, match.team2);

    if (!winner) {

      continue;

    }



    const payload =

      bracketKind === BracketKind.CONSOLATION

        ? buildConsolationByeMatchResultPayload(match, winner)

        : buildByeMatchResultPayload(match, winner);



    const didCreate = await runTransaction(db, async (transaction) => {

      const snap = await transaction.get(docRef);

      if (snap.exists()) {

        return false;

      }



      transaction.set(docRef, {

        ...payload,

        createdAt: serverTimestamp(),

        updatedAt: serverTimestamp(),

      });

      return true;

    });



    if (didCreate) {

      created += 1;

    }

  }



  return { created };

}



/**

 * @param {string} tournamentId

 * @param {string} matchId

 * @param {object} input

 * @param {{ bracketKind?: string }} [options]

 */

export async function saveFinalsMatchResult(tournamentId, matchId, input, options = {}) {

  const bracketKind = resolveOptionsBracketKind(options);

  await requireOpenTournament(tournamentId);

  const bracket = await getBracketForKind(tournamentId, bracketKind);

  if (!bracket?.finalized) {

    const error = new Error("Bracket not finalized");

    error.code =

      bracketKind === BracketKind.CONSOLATION

        ? "consolation-match-result/no-bracket"

        : "finals-match-result/no-bracket";

    throw error;

  }



  const match = findBracketMatch(bracket, matchId);

  if (!match) {

    const error = new Error("Match not found in bracket");

    error.code =

      bracketKind === BracketKind.CONSOLATION

        ? "consolation-match-result/invalid-match"

        : "finals-match-result/invalid-match";

    throw error;

  }



  const [session, existingResult] = await Promise.all([

    getFinalsMatchSession(tournamentId, matchId, { bracketKind }),

    getFinalsMatchResult(tournamentId, matchId, { bracketKind }),

  ]);



  const isInitialSave =

    session?.status === MatchSessionStatus.PLAYING && !existingResult;

  const isScoreEdit =

    existingResult?.status === MatchResultStatus.FINISHED &&

    existingResult?.resolution === FinalsMatchResolution.PLAYED &&

    (session?.status === MatchSessionStatus.FINISHED ||

      session?.status === MatchSessionStatus.PLAYING);



  if (!isInitialSave && !isScoreEdit) {

    const error = new Error("Match session not started");

    error.code =

      bracketKind === BracketKind.CONSOLATION

        ? "consolation-match-result/not-started"

        : "finals-match-result/not-started";

    throw error;

  }



  const tournament = await getTournament(tournamentId);

  const winsRequired = resolveMatchWinsRequired({
    tournament: tournamentViewForBracketRules(tournament, bracket),
    bracket,
    roundNumber: match.roundNumber,
  });

  const validation = validateFinalsMatchResultInput(input, { winsRequired });

  if (!validation.valid) {

    const error = new Error(validation.message);

    error.code =

      bracketKind === BracketKind.CONSOLATION

        ? "consolation-match-result/invalid-input"

        : "finals-match-result/invalid-input";

    throw error;

  }



  const team1 = session?.team1 ?? existingResult?.team1;

  const team2 = session?.team2 ?? existingResult?.team2;

  const { sets, team1SetWins, team2SetWins, winnerSide } = validation.data;

  const { winner, loser } = buildPlayedFinalsMatchResultTeams(team1, team2, winnerSide);



  const payload = {

    matchId,

    roundNumber: match.roundNumber,

    matchNumber: match.matchNumber,

    status: MatchResultStatus.FINISHED,

    resolution: FinalsMatchResolution.PLAYED,

    team1,

    team2,

    sets,

    team1SetWins,

    team2SetWins,

    winnerSide,

    winner,

    loser,

    winsRequired,

    updatedAt: serverTimestamp(),

  };



  if (bracketKind === BracketKind.CONSOLATION) {

    payload.bracketKind = BracketKind.CONSOLATION;

  }



  const db = requireDb();

  const docRef = resultDocRef(db, tournamentId, matchId, bracketKind);

  const sessionRef = sessionDocRef(db, tournamentId, matchId, bracketKind);



  await runTransaction(db, async (transaction) => {

    const resultSnap = await transaction.get(docRef);

    const sessionSnap = await transaction.get(sessionRef);

    const existing = resultSnap.exists() ? resultSnap.data() : null;



    if (existing?.resolution === FinalsMatchResolution.BYE) {

      throw Object.assign(new Error("BYE通過結果は修正できません。"), {

        code:

          bracketKind === BracketKind.CONSOLATION

            ? "consolation-match-result/modify-blocked"

            : "finals-match-result/modify-blocked",

      });

    }



    const oldWinnerId = existing?.winner?.entryId ?? null;

    if (oldWinnerId && oldWinnerId !== winner.entryId) {

      let nextMatchId = match.nextMatchId;

      while (nextMatchId) {

        const nextResultRef = resultDocRef(db, tournamentId, nextMatchId, bracketKind);

        const nextSessionRef = sessionDocRef(db, tournamentId, nextMatchId, bracketKind);

        const [nextResultSnap, nextSessionSnap] = await Promise.all([

          transaction.get(nextResultRef),

          transaction.get(nextSessionRef),

        ]);



        if (nextResultSnap.exists() || nextSessionSnap.exists()) {

          throw Object.assign(

            new Error("次の試合がすでに開始されているため、勝者が変わる修正はできません。"),

            {

              code:

                bracketKind === BracketKind.CONSOLATION

                  ? "consolation-match-result/modify-blocked"

                  : "finals-match-result/modify-blocked",

            }

          );

        }



        const nextMatch = findBracketMatch(bracket, nextMatchId);

        nextMatchId = nextMatch?.nextMatchId ?? null;

      }

    }



    if (resultSnap.exists()) {

      transaction.update(docRef, {

        ...payload,

        createdAt: resultSnap.data().createdAt,

      });

    } else {

      transaction.set(docRef, {

        ...payload,

        createdAt: serverTimestamp(),

      });

    }



    if (

      sessionSnap.exists() &&

      sessionSnap.data().status === MatchSessionStatus.PLAYING

    ) {

      transaction.update(sessionRef, {

        status: MatchSessionStatus.FINISHED,

        finishedAt: serverTimestamp(),

        updatedAt: serverTimestamp(),

      });

    }

  });



  const saved = await getDoc(docRef);

  return withPublicSnapshotRebuild(tournamentId, mapResultDoc(saved));

}



/**

 * @param {string} tournamentId

 * @param {{ bracketKind?: string }} [options]

 */

export async function loadFinalsMatchProgressData(tournamentId, options = {}) {

  const bracketKind = resolveOptionsBracketKind(options);

  const [bracket, resultsMap, sessionsMap] = await Promise.all([

    getBracketForKind(tournamentId, bracketKind),

    getFinalsMatchResults(tournamentId, { bracketKind }),

    getFinalsMatchSessions(tournamentId, { bracketKind }),

  ]);



  return { bracket, resultsMap, sessionsMap, bracketKind };

}


