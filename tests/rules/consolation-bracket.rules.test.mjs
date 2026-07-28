/**
 * consolation bracket Firestore Rules テスト
 */
import assert from "node:assert/strict";
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
  deleteDoc,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import {
  buildConsolationBracket,
  buildPersistedConsolationBracket,
} from "../../js/domain/consolation-bracket.js";
import { buildConsolationByeMatchResultPayload } from "../../js/domain/consolation-bracket.js";
import { ensureFinalsTeamWithSeed } from "../../js/domain/finals-match-result-payload.js";
import { getByeWinnerTeam } from "../../js/domain/finals-match-bye.js";
import { listByeMatchesNeedingResults } from "../../js/domain/finals-match-progress.js";
import { BracketKind } from "../../js/domain/bracket-collections.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rules = readFileSync(resolve(__dirname, "../../firestore.rules"), "utf8");

const PROJECT_ID = "smatournament-consolation-rules-test";
const OPERATOR_UID = "operator-consolation-test";
const OTHER_UID = "other-user-consolation";
const QUALIFYING_ID = "qualifying-consolation";
const BAD_MODE_ID = "bad-mode-consolation";
const BAD_KIND_ID = "bad-kind-consolation";
const SINGLE_ELIM_ID = "single-elim-consolation";
const LEGACY_ID = "legacy-consolation";
const NO_ADVANCEMENT_ID = "no-advancement-consolation";
const NO_MAIN_BRACKET_ID = "no-main-bracket-consolation";
const CLOSED_ID = "closed-consolation";
const ONE_TEAM_ID = "one-team-consolation";
const ALREADY_CREATED_ID = "already-created-consolation";
const SESSIONS_ID = "sessions-consolation";
const PII_ID = "pii-consolation";

function tournamentRef(db, tournamentId) {
  return doc(db, "tournaments", tournamentId);
}

function mainBracketRef(db, tournamentId) {
  return doc(db, "tournaments", tournamentId, "finalsBracket", "current");
}

function advancementRef(db, tournamentId) {
  return doc(db, "tournaments", tournamentId, "finalsAdvancement", "current");
}

function consolationBracketRef(db, tournamentId) {
  return doc(db, "tournaments", tournamentId, "consolationBracket", "current");
}

function consolationSessionRef(db, tournamentId, matchId) {
  return doc(db, "tournaments", tournamentId, "consolationMatchSessions", matchId);
}

function consolationResultRef(db, tournamentId, matchId) {
  return doc(db, "tournaments", tournamentId, "consolationMatchResults", matchId);
}

function finalsSessionRef(db, tournamentId, matchId) {
  return doc(db, "tournaments", tournamentId, "finalsMatchSessions", matchId);
}

function finalsResultRef(db, tournamentId, matchId) {
  return doc(db, "tournaments", tournamentId, "finalsMatchResults", matchId);
}

function tournamentResultsRef(db, tournamentId) {
  return doc(db, "tournaments", tournamentId, "tournamentResults", "current");
}

function baseTournamentPayload(overrides = {}) {
  return {
    name: "Consolation Rules Test",
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

function makeParticipants(count, prefix = "p") {
  return Array.from({ length: count }, (_, index) => ({
    entryId: `${prefix}-${index + 1}`,
    teamName: `Team ${index + 1}`,
  }));
}

function makeQualifiers(count) {
  return Array.from({ length: count }, (_, index) => ({
    entryId: `q-${index + 1}`,
    teamName: `Qualifier ${index + 1}`,
    seed: index + 1,
    blockId: "A",
    blockRank: 1,
  }));
}

function consolationBracketPayload(participantCount, overrides = {}) {
  const preview = buildConsolationBracket(makeParticipants(participantCount), {
    random: () => 0.25,
  });
  return {
    ...buildPersistedConsolationBracket(preview),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  };
}

function mainBracketPayload() {
  return {
    finalized: true,
    bracketSize: 8,
    qualifierCount: 8,
    roundCount: 3,
    slots: Array.from({ length: 8 }, (_, index) => ({
      slotNumber: index + 1,
      seed: index + 1,
      entryId: `q-${index + 1}`,
      teamName: `Q ${index + 1}`,
      isBye: false,
    })),
    matches: [{ matchId: "final-r1-m1", roundNumber: 1, matchNumber: 1 }],
    matchIds: ["final-r1-m1"],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

function advancementPayload() {
  return {
    finalized: true,
    mode: "fixed_block_qualifiers",
    blockCount: 4,
    qualifiersPerBlock: 2,
    qualifierCount: 8,
    qualifiers: makeQualifiers(8),
    qualifyingMatchCount: 10,
    qualifyingFinishedMatchCount: 10,
    finalizedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function findReadyMatch(bracketPayload) {
  return (bracketPayload.matches ?? []).find(
    (match) => match.team1?.entryId && match.team2?.entryId && !match.team1?.isBye && !match.team2?.isBye
  );
}

function normalizeTeamForRules(team, fallbackSeed) {
  return {
    entryId: team.entryId,
    teamName: team.teamName ?? "Team",
    seed: Number.isInteger(team.seed) ? team.seed : fallbackSeed,
  };
}

function sessionPayload(match) {
  return {
    matchId: match.matchId,
    roundNumber: match.roundNumber,
    matchNumber: match.matchNumber,
    status: "playing",
    team1: normalizeTeamForRules(match.team1, 1),
    team2: normalizeTeamForRules(match.team2, 2),
    startedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

function playedResultPayload(match) {
  const team1 = normalizeTeamForRules(match.team1, 1);
  const team2 = normalizeTeamForRules(match.team2, 2);
  const winner = team1;
  const loser = team2;
  return {
    matchId: match.matchId,
    roundNumber: match.roundNumber,
    matchNumber: match.matchNumber,
    status: "finished",
    resolution: "played",
    team1,
    team2,
    winner,
    loser,
    winnerSide: "team1",
    sets: [
      { setNumber: 1, team1Score: 21, team2Score: 10, winner: "team1" },
      { setNumber: 2, team1Score: 21, team2Score: 12, winner: "team1" },
    ],
    team1SetWins: 2,
    team2SetWins: 0,
    bracketKind: BracketKind.CONSOLATION,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

async function seedQualifyingTournament(db, tournamentId, overrides = {}) {
  await setDoc(tournamentRef(db, tournamentId), baseTournamentPayload({
    tournamentFormat: "qualifying_and_finals",
    blockCount: 4,
    qualifiersPerBlock: 2,
    ...overrides.tournament,
  }));
  if (overrides.skipAdvancement !== true) {
    await setDoc(advancementRef(db, tournamentId), advancementPayload());
  }
  if (overrides.skipMainBracket !== true) {
    await setDoc(mainBracketRef(db, tournamentId), mainBracketPayload());
  }
  if (overrides.tournamentResults) {
    await setDoc(tournamentResultsRef(db, tournamentId), overrides.tournamentResults);
  }
  if (overrides.consolationBracket) {
    await setDoc(consolationBracketRef(db, tournamentId), overrides.consolationBracket);
  }
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
    await setDoc(advancementRef(db, SINGLE_ELIM_ID), advancementPayload());
    await setDoc(mainBracketRef(db, SINGLE_ELIM_ID), mainBracketPayload());

    await setDoc(
      tournamentRef(db, LEGACY_ID),
      baseTournamentPayload()
    );
    await setDoc(advancementRef(db, LEGACY_ID), advancementPayload());
    await setDoc(mainBracketRef(db, LEGACY_ID), mainBracketPayload());

    await seedQualifyingTournament(db, QUALIFYING_ID);
    await seedQualifyingTournament(db, BAD_MODE_ID);
    await seedQualifyingTournament(db, BAD_KIND_ID);
    await seedQualifyingTournament(db, SESSIONS_ID);
    await seedQualifyingTournament(db, PII_ID);
    await seedQualifyingTournament(db, NO_ADVANCEMENT_ID, { skipAdvancement: true });
    await seedQualifyingTournament(db, NO_MAIN_BRACKET_ID, { skipMainBracket: true });
    await seedQualifyingTournament(db, CLOSED_ID, {
      tournament: { status: "closed" },
    });
    await seedQualifyingTournament(db, ONE_TEAM_ID);
    await seedQualifyingTournament(db, ALREADY_CREATED_ID, {
      consolationBracket: consolationBracketPayload(2),
    });
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
    const unauthDb = testEnv.unauthenticatedContext().firestore();
    const otherDb = testEnv.authenticatedContext(OTHER_UID).firestore();

    const validPayload = consolationBracketPayload(3);

    // ── consolationBracket create ─────────────────────────────
    await assertSucceeds(
      setDoc(consolationBracketRef(operatorDb, QUALIFYING_ID), validPayload)
    );

    await assertFails(setDoc(consolationBracketRef(unauthDb, BAD_MODE_ID), validPayload));
    await assertFails(setDoc(consolationBracketRef(otherDb, BAD_KIND_ID), validPayload));

    await assertFails(
      setDoc(consolationBracketRef(operatorDb, SINGLE_ELIM_ID), consolationBracketPayload(2))
    );
    await assertFails(
      setDoc(consolationBracketRef(operatorDb, LEGACY_ID), consolationBracketPayload(2))
    );
    await assertFails(
      setDoc(consolationBracketRef(operatorDb, NO_ADVANCEMENT_ID), consolationBracketPayload(2))
    );
    await assertFails(
      setDoc(consolationBracketRef(operatorDb, NO_MAIN_BRACKET_ID), consolationBracketPayload(2))
    );
    await assertFails(
      setDoc(consolationBracketRef(operatorDb, CLOSED_ID), consolationBracketPayload(2))
    );
    await assertFails(
      setDoc(consolationBracketRef(operatorDb, ALREADY_CREATED_ID), consolationBracketPayload(2))
    );
    await assertFails(
      setDoc(consolationBracketRef(operatorDb, ONE_TEAM_ID), {
        ...consolationBracketPayload(2),
        teamCount: 1,
        byeCount: 1,
      })
    );
    await assertFails(
      setDoc(
        consolationBracketRef(operatorDb, BAD_MODE_ID),
        consolationBracketPayload(2, { mode: "single_elimination" })
      )
    );
    await assertFails(
      setDoc(
        consolationBracketRef(operatorDb, BAD_KIND_ID),
        consolationBracketPayload(2, { bracketKind: "main" })
      )
    );
    await assertFails(
      setDoc(
        consolationBracketRef(operatorDb, PII_ID),
        { ...consolationBracketPayload(2), email: "secret@test.local" }
      )
    );

    await assertFails(
      updateDoc(consolationBracketRef(operatorDb, QUALIFYING_ID), { teamCount: 99 })
    );
    await assertFails(deleteDoc(consolationBracketRef(operatorDb, QUALIFYING_ID)));

    // tournamentResults 確定後
    await testEnv.withSecurityRulesDisabled(async (rulesContext) => {
      const db = rulesContext.firestore();
      const trId = "tournament-results-block";
      await seedQualifyingTournament(db, trId);
      await setDoc(tournamentResultsRef(db, trId), {
        finalized: true,
        tournamentId: trId,
        tournamentStatus: "closed",
        tournamentName: "Done",
        champion: { entryId: "q-1", teamName: "A", seed: 1 },
        runnerUp: { entryId: "q-2", teamName: "B", seed: 2 },
        placements: [],
        qualifierCount: 8,
        bracketSize: 8,
        completedMatchCount: 7,
        expectedMatchCount: 7,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });
    await assertFails(
      setDoc(
        consolationBracketRef(operatorDb, "tournament-results-block"),
        consolationBracketPayload(2)
      )
    );

    // ── sessions / results on created bracket ─────────────────
    await assertSucceeds(
      setDoc(consolationBracketRef(operatorDb, SESSIONS_ID), consolationBracketPayload(3))
    );
    const createdBracket = consolationBracketPayload(3);
    const readyMatch = findReadyMatch(createdBracket);
    assert.ok(readyMatch, "expected a non-bye ready match");

    await assertSucceeds(
      setDoc(consolationSessionRef(operatorDb, SESSIONS_ID, readyMatch.matchId), sessionPayload(readyMatch))
    );
    await assertFails(
      setDoc(
        consolationSessionRef(operatorDb, SESSIONS_ID, "final-r9-m9"),
        sessionPayload({ ...readyMatch, matchId: "final-r9-m9" })
      )
    );
    await assertFails(
      setDoc(consolationSessionRef(operatorDb, CLOSED_ID, readyMatch.matchId), sessionPayload(readyMatch))
    );
    await assertFails(
      deleteDoc(consolationSessionRef(operatorDb, SESSIONS_ID, readyMatch.matchId))
    );

    await assertSucceeds(
      setDoc(consolationResultRef(operatorDb, SESSIONS_ID, readyMatch.matchId), playedResultPayload(readyMatch))
    );
    await assertFails(
      setDoc(
        consolationResultRef(operatorDb, SESSIONS_ID, "final-r9-m9"),
        playedResultPayload({ ...readyMatch, matchId: "final-r9-m9" })
      )
    );
    await assertFails(
      deleteDoc(consolationResultRef(operatorDb, SESSIONS_ID, readyMatch.matchId))
    );

    // BYE result
    const byeMatches = listByeMatchesNeedingResults(createdBracket);
    assert.ok(byeMatches.length >= 1, "expected at least one bye match");
    const byeMatch = byeMatches.find((match) => match.matchId !== readyMatch.matchId) ?? byeMatches[0];
    assert.notEqual(byeMatch.matchId, readyMatch.matchId, "bye match must differ from played match");
    const byeWinner = ensureFinalsTeamWithSeed(
      getByeWinnerTeam(byeMatch.team1, byeMatch.team2),
      byeMatch.matchNumber
    );
    const byePayload = {
      matchId: byeMatch.matchId,
      roundNumber: byeMatch.roundNumber,
      matchNumber: byeMatch.matchNumber,
      status: "finished",
      resolution: "bye",
      winner: {
        entryId: byeWinner.entryId,
        teamName: byeWinner.teamName ?? "Team",
        seed: byeWinner.seed ?? 1,
      },
      loser: null,
      sets: [],
      team1SetWins: 0,
      team2SetWins: 0,
      winnerSide: "team1",
      bracketKind: BracketKind.CONSOLATION,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await assertSucceeds(
      setDoc(consolationResultRef(operatorDb, SESSIONS_ID, byeMatch.matchId), byePayload)
    );

    const mainResultPayload = playedResultPayload(readyMatch);
    delete mainResultPayload.bracketKind;
    await assertSucceeds(
      setDoc(
        finalsSessionRef(operatorDb, SESSIONS_ID, readyMatch.matchId),
        sessionPayload(readyMatch)
      )
    );
    await assertSucceeds(
      setDoc(
        finalsResultRef(operatorDb, SESSIONS_ID, readyMatch.matchId),
        mainResultPayload
      )
    );

    console.log("consolation-bracket.rules.test.mjs: all passed");
  } finally {
    await testEnv.cleanup();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
