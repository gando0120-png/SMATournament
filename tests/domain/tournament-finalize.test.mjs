/**
 * 大会終了条件（下位トーナメント対応）Domain テスト
 */
import assert from "node:assert/strict";
import { buildFinalsBracket } from "../../js/domain/finals-bracket.js";
import {
  buildConsolationBracket,
  buildConsolationByeMatchResultPayload,
  buildPersistedConsolationBracket,
} from "../../js/domain/consolation-bracket.js";
import {
  FinalsMatchResolution,
  MatchResultStatus,
  TournamentStatus,
} from "../../js/domain/constants.js";
import {
  canFinalizeTournament,
  TournamentFinalizeReasonCode,
  validateTournamentCompletion,
  getTournamentResultParticipants,
} from "../../js/domain/tournament-results.js";
import { listByeMatchesNeedingResults } from "../../js/domain/finals-match-progress.js";
import { getByeWinnerTeam } from "../../js/domain/finals-match-bye.js";
import { ensureFinalsTeamWithSeed } from "../../js/domain/finals-match-result-payload.js";
import { buildSingleEliminationBracket } from "../../js/domain/single-elimination-bracket.js";

function makeQualifiers(count) {
  return Array.from({ length: count }, (_, index) => ({
    entryId: `entry-${index + 1}`,
    teamName: `Team ${index + 1}`,
    seed: index + 1,
    blockId: "A",
    blockName: "A",
  }));
}

function buildResultsMapTeam1Wins(bracket) {
  const resultsMap = new Map();
  const sortedMatches = [...(bracket.matches ?? [])].sort(
    (a, b) => a.roundNumber - b.roundNumber || a.matchNumber - b.matchNumber
  );

  for (const match of sortedMatches) {
    let team1 = match.team1;
    let team2 = match.team2;

    if (match.roundNumber > 1) {
      const feeder1 = bracket.matches.find(
        (m) => m.nextMatchId === match.matchId && m.nextTeamSlot === "team1"
      );
      const feeder2 = bracket.matches.find(
        (m) => m.nextMatchId === match.matchId && m.nextTeamSlot === "team2"
      );
      team1 = (feeder1 && resultsMap.get(feeder1.matchId)?.winner) ?? team1;
      team2 = (feeder2 && resultsMap.get(feeder2.matchId)?.winner) ?? team2;
    }

    if (team1?.isBye && team2?.entryId) {
      resultsMap.set(match.matchId, {
        status: MatchResultStatus.FINISHED,
        resolution: FinalsMatchResolution.BYE,
        winner: team2,
        team1,
        team2,
      });
      continue;
    }

    if (team2?.isBye && team1?.entryId) {
      resultsMap.set(match.matchId, {
        status: MatchResultStatus.FINISHED,
        resolution: FinalsMatchResolution.BYE,
        winner: team1,
        team1,
        team2,
      });
      continue;
    }

    if (!team1?.entryId || !team2?.entryId) {
      continue;
    }

    resultsMap.set(match.matchId, {
      status: MatchResultStatus.FINISHED,
      resolution: FinalsMatchResolution.PLAYED,
      winner: team1,
      loser: team2,
      team1,
      team2,
    });
  }

  return resultsMap;
}

function buildMainComplete() {
  const qualifiers = makeQualifiers(8);
  const { bracket } = buildFinalsBracket(qualifiers, { expectedCount: 8 });
  const finalizedBracket = { ...bracket, finalized: true };
  const resultsMap = buildResultsMapTeam1Wins(finalizedBracket);
  return { qualifiers, bracket: finalizedBracket, resultsMap };
}

function buildConsolationComplete(participantCount = 5) {
  const participants = Array.from({ length: participantCount }, (_, index) => ({
    entryId: `p-${index + 1}`,
    teamName: `P ${index + 1}`,
  }));
  const preview = buildConsolationBracket(participants, { random: () => 0.42 });
  const bracket = buildPersistedConsolationBracket(preview);
  const resultsMap = new Map();

  for (const match of listByeMatchesNeedingResults(preview.bracket)) {
    const winner = ensureFinalsTeamWithSeed(
      getByeWinnerTeam(match.team1, match.team2),
      match.matchNumber
    );
    resultsMap.set(match.matchId, buildConsolationByeMatchResultPayload(match, winner));
  }

  for (const match of preview.bracket.matches) {
    if (resultsMap.has(match.matchId)) {
      continue;
    }

    let team1 = match.team1;
    let team2 = match.team2;
    if (match.roundNumber > 1) {
      const feeder1 = preview.bracket.matches.find(
        (m) => m.nextMatchId === match.matchId && m.nextTeamSlot === "team1"
      );
      const feeder2 = preview.bracket.matches.find(
        (m) => m.nextMatchId === match.matchId && m.nextTeamSlot === "team2"
      );
      team1 = (feeder1 && resultsMap.get(feeder1.matchId)?.winner) ?? team1;
      team2 = (feeder2 && resultsMap.get(feeder2.matchId)?.winner) ?? team2;
    }

    if (!team1?.entryId || !team2?.entryId) {
      continue;
    }

    resultsMap.set(match.matchId, {
      matchId: match.matchId,
      status: MatchResultStatus.FINISHED,
      resolution: FinalsMatchResolution.PLAYED,
      winner: team1,
      loser: team2,
      team1,
      team2,
    });
  }

  return { bracket, resultsMap };
}

function assertDecision(params, expected) {
  const decision = canFinalizeTournament(params);
  assert.equal(decision.canFinalize, expected.canFinalize, decision.message ?? "unexpected");
  if (expected.reasonCode) {
    assert.equal(decision.reasonCode, expected.reasonCode);
  }
  if (expected.message) {
    assert.equal(decision.message, expected.message);
  }
}

// ── ケース1: 下位なし ────────────────────────────────────────

{
  const main = buildMainComplete();
  assertDecision(
    {
      bracket: main.bracket,
      resultsMap: main.resultsMap,
      qualifiers: main.qualifiers,
      existingResults: null,
    },
    { canFinalize: true }
  );
}

// ── ケース2: 下位あり ────────────────────────────────────────

{
  const main = buildMainComplete();
  const consolation = buildConsolationComplete(5);

  assertDecision(
    {
      bracket: main.bracket,
      resultsMap: main.resultsMap,
      qualifiers: main.qualifiers,
      consolationBracket: consolation.bracket,
      consolationResultsMap: new Map(),
      existingResults: null,
    },
    {
      canFinalize: false,
      reasonCode: TournamentFinalizeReasonCode.CONSOLATION_INCOMPLETE,
      message: "下位トーナメントが未終了です。",
    }
  );

  assertDecision(
    {
      bracket: main.bracket,
      resultsMap: new Map(),
      qualifiers: main.qualifiers,
      consolationBracket: consolation.bracket,
      consolationResultsMap: consolation.resultsMap,
      existingResults: null,
    },
    {
      canFinalize: false,
      reasonCode: TournamentFinalizeReasonCode.MAIN_INCOMPLETE,
      message: "上位トーナメントが未終了です。",
    }
  );

  assertDecision(
    {
      bracket: main.bracket,
      resultsMap: main.resultsMap,
      qualifiers: main.qualifiers,
      consolationBracket: consolation.bracket,
      consolationResultsMap: consolation.resultsMap,
      existingResults: null,
    },
    { canFinalize: true }
  );
}

// ── single_elimination ───────────────────────────────────────

{
  const participants = makeQualifiers(4).map((q) => ({
    entryId: q.entryId,
    teamName: q.teamName,
  }));
  const generated = buildSingleEliminationBracket({ entries: participants, random: () => 0.42 });
  assert.equal(generated.canFinalize, true);
  const bracket = { ...generated.bracket, finalized: true };
  const resultsMap = buildResultsMapTeam1Wins(bracket);
  const singleParticipants = getTournamentResultParticipants(bracket, null);
  assertDecision(
    {
      bracket,
      resultsMap,
      qualifiers: singleParticipants,
      existingResults: null,
    },
    { canFinalize: true }
  );
}

// ── legacy / 下位未作成 ──────────────────────────────────────

{
  const main = buildMainComplete();
  const legacy = validateTournamentCompletion({
    bracket: main.bracket,
    resultsMap: main.resultsMap,
    qualifiers: main.qualifiers,
    existingResults: null,
  });
  assert.equal(legacy.canFinalize, true);
}

// ── 終了済み ─────────────────────────────────────────────────

{
  const main = buildMainComplete();
  assertDecision(
    {
      tournament: { status: TournamentStatus.CLOSED },
      bracket: main.bracket,
      resultsMap: main.resultsMap,
      qualifiers: main.qualifiers,
      existingResults: { finalized: true },
    },
    {
      canFinalize: false,
      reasonCode: TournamentFinalizeReasonCode.ALREADY_FINALIZED,
      message: "大会はすでに終了しています。",
    }
  );
}

console.log("tournament-finalize.test.mjs: all passed");
