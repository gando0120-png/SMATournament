/**
 * 下位トーナメント作成バッチの Rules テスト
 *
 * createConsolationBracket と同じ writeBatch 構造を検証する。
 * create は existsAfter/getAfter で同一 batch 内の bracket を参照できること。
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
  getDoc,
  setDoc,
  writeBatch,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import {
  buildConsolationBracket,
  buildPersistedConsolationBracket,
  buildConsolationByeMatchResultPayload,
} from "../../js/domain/consolation-bracket.js";
import { ensureFinalsTeamWithSeed } from "../../js/domain/finals-match-result-payload.js";
import { getByeWinnerTeam } from "../../js/domain/finals-match-bye.js";
import { listByeMatchesNeedingResults } from "../../js/domain/finals-match-progress.js";
import { BracketKind } from "../../js/domain/bracket-collections.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rules = readFileSync(resolve(__dirname, "../../firestore.rules"), "utf8");

const PROJECT_ID = "smatournament-consolation-batch-rules";
const OPERATOR_UID = "operator-consolation-batch";
const OTHER_UID = "other-user-consolation-batch";
const TOURNAMENT_ID = "prod-like-consolation-41";
const POWER_OF_TWO_ID = "consolation-exact-32";
const ISOLATED_ID = "consolation-isolated-writes";
const MINI_BATCH_ID = "consolation-mini-batch";

const MAIN_QUALIFIER_COUNT = 16;
const CONSOLATION_PARTICIPANT_COUNT = 41;
const POWER_OF_TWO_COUNT = 32;

function tournamentRef(db, tournamentId) {
  return doc(db, "tournaments", tournamentId);
}

function operatorRef(db, uid) {
  return doc(db, "operators", uid);
}

function advancementRef(db, tournamentId) {
  return doc(db, "tournaments", tournamentId, "finalsAdvancement", "current");
}

function mainBracketRef(db, tournamentId) {
  return doc(db, "tournaments", tournamentId, "finalsBracket", "current");
}

function consolationBracketRef(db, tournamentId) {
  return doc(db, "tournaments", tournamentId, "consolationBracket", "current");
}

function consolationResultRef(db, tournamentId, matchId) {
  return doc(db, "tournaments", tournamentId, "consolationMatchResults", matchId);
}

function consolationSessionRef(db, tournamentId, matchId) {
  return doc(db, "tournaments", tournamentId, "consolationMatchSessions", matchId);
}

function publicSnapshotRef(db, tournamentId) {
  return doc(db, "tournaments", tournamentId, "publicSnapshot", "current");
}

function makeParticipants(count, prefix = "p") {
  return Array.from({ length: count }, (_, index) => ({
    entryId: `${prefix}-${index + 1}`,
    teamName: `Consolation Team ${index + 1}`,
  }));
}

function makeQualifiers(count) {
  return Array.from({ length: count }, (_, index) => ({
    entryId: `q-${index + 1}`,
    teamName: `Qualifier ${index + 1}`,
    seed: index + 1,
    blockId: String.fromCharCode(65 + (index % 8)),
    blockRank: Math.floor(index / 8) + 1,
  }));
}

function mainBracketPayload(qualifierCount = MAIN_QUALIFIER_COUNT) {
  return {
    finalized: true,
    bracketSize: qualifierCount,
    qualifierCount,
    roundCount: Math.log2(qualifierCount),
    slots: Array.from({ length: qualifierCount }, (_, index) => ({
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

function advancementPayload(qualifierCount = MAIN_QUALIFIER_COUNT) {
  return {
    finalized: true,
    mode: "fixed_block_qualifiers",
    blockCount: 8,
    qualifiersPerBlock: 2,
    qualifierCount,
    qualifiers: makeQualifiers(qualifierCount),
    qualifyingMatchCount: 40,
    qualifyingFinishedMatchCount: 40,
    finalizedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function baseTournamentPayload(overrides = {}) {
  return {
    name: "Consolation Batch Rules",
    status: "open",
    eventDate: "2026-08-01",
    venue: "Test Venue",
    entryDeadline: Timestamp.fromDate(new Date("2099-01-01T00:00:00Z")),
    maxTeams: 64,
    teamSize: 4,
    courtCount: 4,
    entryCount: 57,
    confirmedCount: 57,
    tournamentFormat: "qualifying_and_finals",
    blockCount: 8,
    qualifiersPerBlock: 2,
    createdBy: OPERATOR_UID,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildConsolationCreateArtifacts(participantCount) {
  const preview = buildConsolationBracket(makeParticipants(participantCount), {
    random: () => 0.37,
  });
  assert.equal(preview.valid, true, preview.message);
  assert.ok(preview.bracket);

  const bracketPayload = {
    ...buildPersistedConsolationBracket(preview),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const byePayloads = listByeMatchesNeedingResults(preview.bracket).map((match) => {
    const winner = getByeWinnerTeam(match.team1, match.team2);
    return {
      matchId: match.matchId,
      payload: {
        ...buildConsolationByeMatchResultPayload(
          match,
          ensureFinalsTeamWithSeed(winner, match.matchNumber)
        ),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
    };
  });

  return { preview, bracketPayload, byePayloads };
}

function findReadyMatch(bracketPayload) {
  return (bracketPayload.matches ?? []).find(
    (match) =>
      match.team1?.entryId &&
      match.team2?.entryId &&
      !match.team1?.isBye &&
      !match.team2?.isBye
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
  return {
    matchId: match.matchId,
    roundNumber: match.roundNumber,
    matchNumber: match.matchNumber,
    status: "finished",
    resolution: "played",
    team1,
    team2,
    winner: team1,
    loser: team2,
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

async function seedTournament(db, tournamentId, overrides = {}) {
  await setDoc(
    tournamentRef(db, tournamentId),
    baseTournamentPayload(overrides.tournament)
  );
  await setDoc(advancementRef(db, tournamentId), advancementPayload());
  await setDoc(mainBracketRef(db, tournamentId), mainBracketPayload());
}

function commitCreateBatch(db, tournamentId, bracketPayload, byePayloads) {
  const batch = writeBatch(db);
  batch.set(consolationBracketRef(db, tournamentId), bracketPayload);
  for (const { matchId, payload } of byePayloads) {
    batch.set(consolationResultRef(db, tournamentId, matchId), payload);
  }
  return batch.commit();
}

async function run() {
  const testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules, host: "127.0.0.1", port: 8090 },
  });

  try {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(operatorRef(db, OPERATOR_UID), {
        email: "operator@test.local",
        enabled: true,
        createdAt: new Date(),
      });
      await seedTournament(db, TOURNAMENT_ID);
      await seedTournament(db, POWER_OF_TWO_ID);
      await seedTournament(db, ISOLATED_ID);
      await seedTournament(db, MINI_BATCH_ID);
    });

    const operatorDb = testEnv.authenticatedContext(OPERATOR_UID).firestore();
    const otherDb = testEnv.authenticatedContext(OTHER_UID).firestore();

    const prodLike = buildConsolationCreateArtifacts(CONSOLATION_PARTICIPANT_COUNT);
    assert.equal(prodLike.preview.bracket.bracketSize, 64);
    assert.equal(prodLike.preview.bracket.teamCount, 41);
    assert.equal(prodLike.preview.bracket.byeCount, 23);
    assert.equal(prodLike.byePayloads.length, 23);

    // ── allow: 41チーム / BYE23 の同一 batch ──
    await assertSucceeds(
      commitCreateBatch(
        operatorDb,
        TOURNAMENT_ID,
        prodLike.bracketPayload,
        prodLike.byePayloads
      )
    );

    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      const bracketSnap = await getDoc(consolationBracketRef(db, TOURNAMENT_ID));
      assert.equal(bracketSnap.exists(), true);
      assert.equal(bracketSnap.data().teamCount, 41);
      assert.equal(bracketSnap.data().byeCount, 23);
      const byeSnap = await getDoc(
        consolationResultRef(db, TOURNAMENT_ID, prodLike.byePayloads[0].matchId)
      );
      assert.equal(byeSnap.exists(), true);
      assert.equal(byeSnap.data().resolution, "bye");
    });

    // ── allow: 3チーム / BYE1 の同一 batch ──
    const mini = buildConsolationCreateArtifacts(3);
    assert.equal(mini.preview.bracket.bracketSize, 4);
    assert.ok(mini.byePayloads.length >= 1);
    await assertSucceeds(
      commitCreateBatch(
        operatorDb,
        MINI_BATCH_ID,
        mini.bracketPayload,
        [mini.byePayloads[0]]
      )
    );

    // ── allow: BYE0（32チーム）──
    const exact = buildConsolationCreateArtifacts(POWER_OF_TWO_COUNT);
    assert.equal(exact.byePayloads.length, 0);
    await assertSucceeds(
      commitCreateBatch(
        operatorDb,
        POWER_OF_TWO_ID,
        exact.bracketPayload,
        exact.byePayloads
      )
    );

    // ── deny: bracket なしの BYE create ──
    const orphanTournament = "consolation-orphan-bye";
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await seedTournament(ctx.firestore(), orphanTournament);
    });
    await assertFails(
      setDoc(
        consolationResultRef(operatorDb, orphanTournament, prodLike.byePayloads[0].matchId),
        prodLike.byePayloads[0].payload
      )
    );

    // ── deny: matchIds に無い matchId ──
    await assertFails(
      setDoc(
        consolationResultRef(operatorDb, TOURNAMENT_ID, "final-r9-m99"),
        {
          ...prodLike.byePayloads[0].payload,
          matchId: "final-r9-m99",
        }
      )
    );

    // ── deny: 非operator ──
    const noOpId = "consolation-non-operator";
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await seedTournament(ctx.firestore(), noOpId);
    });
    await assertFails(
      commitCreateBatch(otherDb, noOpId, mini.bracketPayload, [mini.byePayloads[0]])
    );
    await assertFails(
      setDoc(consolationBracketRef(otherDb, noOpId), mini.bracketPayload)
    );

    // ── deny: 大会 closed ──
    const closedId = "consolation-closed-batch";
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await seedTournament(ctx.firestore(), closedId, {
        tournament: { status: "closed" },
      });
    });
    await assertFails(
      commitCreateBatch(
        operatorDb,
        closedId,
        mini.bracketPayload,
        [mini.byePayloads[0]]
      )
    );

    // ── deny: 不正な BYE result（winner 欠落）──
    const badByeId = "consolation-bad-bye-payload";
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await seedTournament(ctx.firestore(), badByeId);
    });
    await assertSucceeds(
      setDoc(consolationBracketRef(operatorDb, badByeId), mini.bracketPayload)
    );
    await assertFails(
      setDoc(
        consolationResultRef(operatorDb, badByeId, mini.byePayloads[0].matchId),
        {
          ...mini.byePayloads[0].payload,
          winner: null,
        }
      )
    );

    // ── deny: 偽造 bracket と無関係 matchId を同一 batch ──
    const forgedId = "consolation-forged-match";
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await seedTournament(ctx.firestore(), forgedId);
    });
    const forgedBatch = writeBatch(operatorDb);
    forgedBatch.set(consolationBracketRef(operatorDb, forgedId), mini.bracketPayload);
    forgedBatch.set(
      consolationResultRef(operatorDb, forgedId, "final-r9-m99"),
      {
        ...mini.byePayloads[0].payload,
        matchId: "final-r9-m99",
      }
    );
    await assertFails(forgedBatch.commit());
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      const bracketSnap = await getDoc(consolationBracketRef(db, forgedId));
      assert.equal(bracketSnap.exists(), false, "forged batch must not partially save");
    });

    // ── deny: played 形式のスコアを残したまま resolution=bye で作成 ──
    const invalidPlayedAsByeId = "consolation-invalid-played-as-bye";
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await seedTournament(ctx.firestore(), invalidPlayedAsByeId);
    });
    const readyForInvalid = findReadyMatch(mini.bracketPayload);
    assert.ok(readyForInvalid);
    await assertSucceeds(
      setDoc(consolationBracketRef(operatorDb, invalidPlayedAsByeId), mini.bracketPayload)
    );
    const played = playedResultPayload(readyForInvalid);
    await assertFails(
      setDoc(consolationResultRef(operatorDb, invalidPlayedAsByeId, readyForInvalid.matchId), {
        ...played,
        resolution: "bye",
        loser: null,
        // sets を残す → validFinalsByeResult が sets.size()==0 を要求して拒否
      })
    );

    // ── allow: 既存 bracket への session / played result（回帰）──
    await assertSucceeds(
      setDoc(consolationBracketRef(operatorDb, ISOLATED_ID), mini.bracketPayload)
    );
    const readyMatch = findReadyMatch(mini.bracketPayload);
    assert.ok(readyMatch);
    await assertSucceeds(
      setDoc(
        consolationSessionRef(operatorDb, ISOLATED_ID, readyMatch.matchId),
        sessionPayload(readyMatch)
      )
    );
    await assertSucceeds(
      setDoc(
        consolationResultRef(operatorDb, ISOLATED_ID, readyMatch.matchId),
        playedResultPayload(readyMatch)
      )
    );

    // ── allow: publicSnapshot ──
    await assertSucceeds(
      setDoc(publicSnapshotRef(operatorDb, ISOLATED_ID), {
        version: 1,
        updatedAt: serverTimestamp(),
        tournament: { id: ISOLATED_ID, name: "x", status: "open" },
      })
    );

    console.log("consolation-bracket-create-batch.rules.test.mjs: all passed");
  } finally {
    await testEnv.cleanup();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
