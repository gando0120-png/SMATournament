/**
 * Phase 6: 64チーム loss_band 内部 E2E（永続化オーケストレーション通し）
 */
import assert from "node:assert/strict";
import {
  EXPECTED_BAND_COUNTS_AT_ROUND_START,
  LOSS_BAND_TEAM_COUNT,
  LossBandMatchPurpose,
  buildPlacementRecords,
  buildValidatedLossBandMatchResult,
  expectedFinalPlacementCounts,
  formatLossBandTournamentStatusLabel,
  getActiveBandCounts,
  pairingsFromRoundDoc,
  planAfterLossBandMatchSaved,
  planLossBandInitialize,
  rebuildDomainStateFromCompletedRounds,
  validateRoundTeamUniqueness,
  canFinalizeLossBandTournament,
  buildPersistedLossBandTournamentResults,
  buildLossBandPublicSection,
  formatLossBandPlacementLabel,
} from "../../js/domain/loss-band/index.js";
import { RankingMode } from "../../js/domain/loss-band/constants.js";
import { MatchFormat } from "../../js/domain/aggregate-match-format.js";
import { TournamentFormat } from "../../js/domain/tournament-format.js";
import { TournamentStatus, EntryStatus } from "../../js/domain/constants.js";
import { buildBracketMatchConfigForSave } from "../../js/domain/bracket-match-config.js";
import {
  buildPublicTournamentSnapshot,
  buildPublicTournamentViewFromSnapshot,
} from "../../js/domain/public-tournament-snapshot.js";

function entryIds64() {
  return Array.from({ length: LOSS_BAND_TEAM_COUNT }, (_, i) =>
    `e${String(i + 1).padStart(2, "0")}`
  );
}

function team1WinsScoreInput() {
  return {
    set1Team1Score: 50,
    set1Team2Score: 10,
    set2Team1Score: 50,
    set2Team2Score: 20,
  };
}

function buildResultForMatch(match, matchNumber) {
  const built = buildValidatedLossBandMatchResult({
    match,
    matchNumber,
    team1: { entryId: match.team1EntryId, teamName: match.team1EntryId, seed: 1 },
    team2: { entryId: match.team2EntryId, teamName: match.team2EntryId, seed: 2 },
    scoreInput: team1WinsScoreInput(),
    winsRequired: 2,
  });
  assert.equal(built.valid, true, built.message);
  return built.data;
}

function completeRound(stateDoc, roundDoc, rematchAvoidance, priorCompletedRounds) {
  const pairings = pairingsFromRoundDoc(roundDoc);
  assert.equal(validateRoundTeamUniqueness(roundDoc), true);

  const entrySeen = new Set();
  for (const m of pairings.matches) {
    assert.equal(entrySeen.has(m.team1EntryId), false, `dup ${m.team1EntryId}`);
    assert.equal(entrySeen.has(m.team2EntryId), false, `dup ${m.team2EntryId}`);
    entrySeen.add(m.team1EntryId);
    entrySeen.add(m.team2EntryId);
  }

  let prior = [];
  let currentRoundDoc = roundDoc;
  let currentState = stateDoc;
  let lastPlan = null;

  for (let i = 0; i < pairings.matches.length; i += 1) {
    const match = pairings.matches[i];
    const result = buildResultForMatch(match, i + 1);
    lastPlan = planAfterLossBandMatchSaved({
      stateDoc: currentState,
      roundDoc: currentRoundDoc,
      priorCompletedResults: prior,
      priorCompletedRounds,
      newResult: result,
      rematchAvoidance,
    });
    prior = [...prior, result];
    currentRoundDoc = lastPlan.nextRoundDoc;
    currentState = lastPlan.nextStateDoc;
  }

  assert.equal(lastPlan.roundComplete, true);
  return { lastPlan, prior, stateDoc: currentState, roundDoc: currentRoundDoc };
}

function countByPlacement(records) {
  const map = new Map();
  for (const row of records) {
    map.set(row.placement, (map.get(row.placement) ?? 0) + 1);
  }
  return map;
}

function runFull({ thirdPlaceMatch, rematchAvoidance }) {
  const label = `3rd=${thirdPlaceMatch}/rematch=${rematchAvoidance}`;

  const config = buildBracketMatchConfigForSave(
    {
      matchFormat: MatchFormat.HEAD_TO_HEAD_SETS,
      winsRequired: 2,
      rankingMode: RankingMode.LOSS_BAND,
      maxTeams: 64,
      rematchAvoidance,
      thirdPlaceMatch,
      exchangeMatches: false,
      guaranteedMatchCount: 5,
      finalsMatchRules: { defaultWinsRequired: 2, roundOverrides: {} },
    },
    TournamentFormat.SINGLE_ELIMINATION
  );
  assert.equal(config.valid, true, `${label} config`);

  const entryIds = entryIds64();
  const init = planLossBandInitialize(entryIds, {
    rematchAvoidance,
    thirdPlaceMatch,
    exchangeMatches: false,
    guaranteedMatchCount: 5,
  });
  assert.equal(init.stateDoc.status, "active");
  assert.equal(formatLossBandTournamentStatusLabel("active"), "順位決定戦進行中");

  let stateDoc = init.stateDoc;
  let roundDoc = init.roundDoc;
  /** @type {Array<{ roundDoc: object, results: object[] }>} */
  const completedRounds = [];
  let rematchSum = 0;

  for (let round = 1; round <= 5; round += 1) {
    const rebuilt = rebuildDomainStateFromCompletedRounds(entryIds, completedRounds, {
      thirdPlaceMatch,
      rematchAvoidance,
    });
    assert.deepEqual(
      getActiveBandCounts(rebuilt),
      EXPECTED_BAND_COUNTS_AT_ROUND_START[round],
      `${label} R${round} bands`
    );

    rematchSum += roundDoc.rematchCount ?? 0;
    const { lastPlan, prior } = completeRound(
      stateDoc,
      roundDoc,
      rematchAvoidance,
      completedRounds
    );
    completedRounds.push({ roundDoc, results: prior });

    // 二重生成防止（完了ラウンドに再結果）
    assert.throws(() => {
      planAfterLossBandMatchSaved({
        stateDoc: lastPlan.nextStateDoc,
        roundDoc: lastPlan.nextRoundDoc,
        priorCompletedResults: prior,
        priorCompletedRounds: completedRounds.slice(0, -1),
        newResult: prior[0],
        rematchAvoidance,
      });
    });

    if (round < 5) {
      assert.ok(lastPlan.nextRoundPlan);
      stateDoc = lastPlan.nextStateDoc;
      roundDoc = lastPlan.nextRoundPlan.roundDoc;
    } else {
      assert.equal(lastPlan.nextStateDoc.status, "finals_pending");
      assert.equal(
        formatLossBandTournamentStatusLabel("finals_pending"),
        "決勝待ち"
      );
      const afterR5 = lastPlan.domainStateAfterRound;
      assert.equal(afterR5.finalists?.length, 2);
      const interim = buildPlacementRecords(afterR5);
      const interimCounts = countByPlacement(interim);
      if (!thirdPlaceMatch) {
        assert.equal(interimCounts.get(3), 2, "3位タイ");
      }
      assert.equal(interimCounts.get(5), 8);
      assert.equal(interimCounts.get(13), 8);
      assert.equal(interimCounts.get(21), 12);
      assert.equal(interimCounts.get(33), 12);
      assert.equal(interimCounts.get(45), 8);
      assert.equal(interimCounts.get(53), 8);
      assert.equal(interimCounts.get(61), 2);
      assert.equal(interimCounts.get(63), 2);

      stateDoc = lastPlan.nextStateDoc;
      roundDoc = lastPlan.nextRoundPlan.roundDoc;
    }
  }

  assert.equal(roundDoc.matchPurpose, LossBandMatchPurpose.FINAL);
  const finalDone = completeRound(stateDoc, roundDoc, rematchAvoidance, completedRounds);
  completedRounds.push({ roundDoc, results: finalDone.prior });

  let completedPlan = finalDone.lastPlan;

  if (thirdPlaceMatch) {
    assert.equal(completedPlan.nextStateDoc.status, "third_place_pending");
    stateDoc = completedPlan.nextStateDoc;
    roundDoc = completedPlan.nextRoundPlan.roundDoc;
    assert.equal(roundDoc.matchPurpose, LossBandMatchPurpose.THIRD_PLACE);
    const thirdDone = completeRound(stateDoc, roundDoc, rematchAvoidance, completedRounds);
    completedRounds.push({ roundDoc, results: thirdDone.prior });
    completedPlan = thirdDone.lastPlan;
  }

  assert.equal(completedPlan.nextStateDoc.status, "completed");
  assert.equal(formatLossBandTournamentStatusLabel("completed"), "完了");
  assert.ok(completedPlan.placementsDoc);
  const byPlacement = completedPlan.placementsDoc.byPlacement
    ? completedPlan.placementsDoc.byPlacement
    : null;

  // placements 配列形式
  const records = completedPlan.placementsDoc.placements || [];
  assert.equal(records.length, 64);
  const counts = countByPlacement(records);
  assert.equal(counts.get(1), 1);
  assert.equal(counts.get(2), 1);
  if (thirdPlaceMatch) {
    assert.equal(counts.get(3), 1);
    assert.equal(counts.get(4), 1);
  } else {
    assert.equal(counts.get(3), 2);
    const expected = expectedFinalPlacementCounts({ thirdPlaceMatch: false });
    for (const [placement, count] of expected) {
      assert.equal(counts.get(Number(placement)), count, `p${placement}`);
    }
  }

  // 標準 guaranteed=5・exchangeMatches=false → 交流戦なしで completed
  assert.equal(completedPlan.exchangeRoundPlan, null);
  void byPlacement;

  const teamNameByEntryId = Object.fromEntries(
    entryIds.map((id) => [id, `Team ${id}`])
  );
  const tournamentOpen = {
    id: "t-e2e-lb",
    name: "E2E Loss Band",
    status: TournamentStatus.OPEN,
    tournamentFormat: TournamentFormat.SINGLE_ELIMINATION,
    publicViewEnabled: true,
    maxTeams: 64,
    bracketMatchConfig: config.values.bracketMatchConfig,
  };

  const finalizePreview = canFinalizeLossBandTournament({
    tournament: tournamentOpen,
    lossBandState: completedPlan.nextStateDoc,
    placementsDoc: completedPlan.placementsDoc,
    teamNameByEntryId,
  });
  assert.equal(finalizePreview.canFinalize, true, `${label} canFinalize`);
  assert.equal(finalizePreview.placements.length, 64);
  const persisted = buildPersistedLossBandTournamentResults(
    finalizePreview,
    tournamentOpen
  );
  assert.equal(persisted.rankingMode, RankingMode.LOSS_BAND);
  assert.equal(persisted.placements.length, 64);

  const resultsMap = new Map();
  for (const cr of completedRounds) {
    for (const result of cr.results) {
      resultsMap.set(result.matchId, result);
    }
  }

  const allRoundDocs = completedRounds.map((c) => c.roundDoc);
  const publicSection = buildLossBandPublicSection({
    tournament: tournamentOpen,
    lossBandState: completedPlan.nextStateDoc,
    lossBandRounds: allRoundDocs,
    lossBandResultsMap: resultsMap,
    lossBandPlacements: completedPlan.placementsDoc,
    teamNameByEntryId,
  });
  assert.equal(publicSection.ready, true);
  assert.equal(publicSection.placements.ready, true);
  assert.equal(publicSection.placements.placements.length, 64);

  const entries = entryIds.map((id) => ({
    id,
    teamName: `Team ${id}`,
    status: EntryStatus.CONFIRMED,
  }));
  const closedTournament = {
    ...tournamentOpen,
    status: TournamentStatus.CLOSED,
  };
  const snapshot = buildPublicTournamentSnapshot({
    tournament: closedTournament,
    entries,
    tournamentResults: persisted,
    lossBandState: completedPlan.nextStateDoc,
    lossBandRounds: allRoundDocs,
    lossBandResultsMap: resultsMap,
    lossBandPlacements: completedPlan.placementsDoc,
  });
  assert.equal(snapshot.lossBand.visible, true);
  assert.equal(snapshot.results.ready, true);
  assert.equal(snapshot.results.placements.length, 64);
  assert.equal(snapshot.bracket.visible, false);

  for (const row of persisted.placements) {
    const pub = snapshot.results.placements.find((p) => p.entryId === row.entryId);
    assert.ok(pub, row.entryId);
    assert.equal(pub.placementLabel, row.placementLabel);
    assert.equal(
      row.placementLabel,
      formatLossBandPlacementLabel(row.placement, row.isTied)
    );
  }

  if (thirdPlaceMatch) {
    assert.equal(
      persisted.placements.find((p) => p.placement === 3).placementLabel,
      "3位"
    );
    assert.equal(
      persisted.placements.find((p) => p.placement === 4).placementLabel,
      "4位"
    );
  } else {
    assert.equal(
      persisted.placements.find((p) => p.placement === 3).placementLabel,
      "3位タイ"
    );
  }

  const view = buildPublicTournamentViewFromSnapshot(snapshot);
  assert.equal(view.finalResults.ready, true);
  assert.equal(view.lossBand.placements.placements.length, 64);

  return { rematchSum, label, thirdPlaceMatch, persisted };
}

{
  const bad = buildBracketMatchConfigForSave(
    {
      matchFormat: MatchFormat.HEAD_TO_HEAD_SETS,
      rankingMode: RankingMode.LOSS_BAND,
      maxTeams: 32,
      winsRequired: 2,
      finalsMatchRules: { defaultWinsRequired: 2, roundOverrides: {} },
    },
    TournamentFormat.SINGLE_ELIMINATION
  );
  assert.equal(bad.valid, false);
}

const off = runFull({ thirdPlaceMatch: false, rematchAvoidance: true });
const on = runFull({ thirdPlaceMatch: true, rematchAvoidance: true });

console.log(
  `loss-band-e2e OK: ${off.label} rematchSum=${off.rematchSum}; ${on.label} rematchSum=${on.rematchSum}`
);
