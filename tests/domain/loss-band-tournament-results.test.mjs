/**
 * Phase 7: loss_band → tournamentResults 変換・確定判定
 */
import assert from "node:assert/strict";
import { TournamentStatus } from "../../js/domain/constants.js";
import { RankingMode } from "../../js/domain/loss-band/constants.js";
import {
  buildLossBandTournamentResults,
  canFinalizeLossBandTournament,
  buildPersistedLossBandTournamentResults,
  LossBandTournamentStatus,
  formatLossBandPlacementLabel,
} from "../../js/domain/loss-band/index.js";
import { TournamentFinalizeReasonCode } from "../../js/domain/tournament-results.js";
import { LossBandCompletionReasonCode } from "../../js/domain/loss-band/completion.js";

function makePlacementsDoc({ thirdPlaceMatch = false } = {}) {
  const placements = [
    { entryId: "e01", placement: 1, isTied: false, tiedCount: 1, lossCount: 0 },
    { entryId: "e02", placement: 2, isTied: false, tiedCount: 1, lossCount: 0 },
  ];
  if (thirdPlaceMatch) {
    placements.push(
      { entryId: "e03", placement: 3, isTied: false, tiedCount: 1, lossCount: 1 },
      { entryId: "e04", placement: 4, isTied: false, tiedCount: 1, lossCount: 1 }
    );
  } else {
    placements.push(
      { entryId: "e03", placement: 3, isTied: true, tiedCount: 2, lossCount: 1 },
      { entryId: "e04", placement: 3, isTied: true, tiedCount: 2, lossCount: 1 }
    );
  }
  for (let i = 0; i < 8; i += 1) {
    placements.push({
      entryId: `e${String(5 + i).padStart(2, "0")}`,
      placement: 5,
      isTied: true,
      tiedCount: 8,
      lossCount: 1,
    });
  }
  return {
    teamCount: placements.length,
    rankingMode: RankingMode.LOSS_BAND,
    thirdPlaceMatch,
    status: LossBandTournamentStatus.COMPLETED,
    placements,
    placementCounts: thirdPlaceMatch
      ? { "1": 1, "2": 1, "3": 1, "4": 1, "5": 8 }
      : { "1": 1, "2": 1, "3": 2, "5": 8 },
    championEntryId: "e01",
    runnerUpEntryId: "e02",
  };
}

{
  const built = buildLossBandTournamentResults(makePlacementsDoc(), {
    teamNameByEntryId: { e01: "Alpha", e02: "Beta", e03: "Gamma", e04: "Delta" },
  });
  assert.equal(built.rankingMode, RankingMode.LOSS_BAND);
  assert.equal(built.champion.teamName, "Alpha");
  assert.equal(built.runnerUp.teamName, "Beta");
  assert.equal(built.placements[0].placementLabel, "1位");
  assert.equal(built.placements[1].placementLabel, "2位");
  assert.equal(built.placements[2].placementLabel, "3位タイ");
  assert.equal(built.placements[2].isTied, true);
  const five = built.placements.find((p) => p.placement === 5);
  assert.equal(five.placementLabel, "5位タイ");
  assert.ok(built.placementGroups.some((g) => g.label === "5位タイ"));
}

{
  const built = buildLossBandTournamentResults(
    makePlacementsDoc({ thirdPlaceMatch: true }),
    { teamNameByEntryId: { e03: "Gamma", e04: "Delta" } }
  );
  assert.equal(built.thirdPlaceMatch, true);
  assert.equal(
    built.placements.find((p) => p.entryId === "e03").placementLabel,
    "3位"
  );
  assert.equal(
    built.placements.find((p) => p.entryId === "e04").placementLabel,
    "4位"
  );
}

{
  const decision = canFinalizeLossBandTournament({
    tournament: { id: "t1", status: TournamentStatus.OPEN },
    lossBandState: { status: LossBandTournamentStatus.ACTIVE },
    placementsDoc: null,
  });
  assert.equal(decision.canFinalize, false);
  assert.equal(decision.lossBandReady, false);
  assert.equal(decision.reasonCode, LossBandCompletionReasonCode.R5_INCOMPLETE);
}

{
  const decision = canFinalizeLossBandTournament({
    tournament: { id: "t1", status: TournamentStatus.OPEN },
    lossBandState: { status: LossBandTournamentStatus.FINALS_PENDING },
    placementsDoc: null,
  });
  assert.equal(decision.canFinalize, false);
  assert.equal(decision.reasonCode, LossBandCompletionReasonCode.FINAL_INCOMPLETE);
}

{
  const decision = canFinalizeLossBandTournament({
    tournament: { id: "t1", status: TournamentStatus.OPEN },
    lossBandState: { status: LossBandTournamentStatus.THIRD_PLACE_PENDING },
    placementsDoc: null,
  });
  assert.equal(decision.canFinalize, false);
  assert.equal(
    decision.reasonCode,
    LossBandCompletionReasonCode.THIRD_PLACE_INCOMPLETE
  );
}

{
  const decision = canFinalizeLossBandTournament({
    tournament: { id: "t1", status: TournamentStatus.OPEN },
    lossBandState: { status: LossBandTournamentStatus.EXCHANGE_PENDING },
    placementsDoc: makePlacementsDoc(),
  });
  assert.equal(decision.canFinalize, false);
  assert.equal(decision.reasonCode, LossBandCompletionReasonCode.EXCHANGE_INCOMPLETE);
}

{
  const decision = canFinalizeLossBandTournament({
    tournament: { id: "t1", status: TournamentStatus.OPEN },
    lossBandState: { status: LossBandTournamentStatus.COMPLETED },
    placementsDoc: null,
  });
  assert.equal(decision.canFinalize, false);
  assert.match(decision.message, /順位/);
}

{
  const decision = canFinalizeLossBandTournament({
    tournament: { id: "t1", status: TournamentStatus.OPEN },
    lossBandState: { status: LossBandTournamentStatus.COMPLETED },
    placementsDoc: makePlacementsDoc(),
    teamNameByEntryId: { e01: "Alpha", e02: "Beta" },
  });
  assert.equal(decision.canFinalize, true);
  assert.equal(decision.lossBandReady, true);
  assert.equal(decision.champion.teamName, "Alpha");
  const persisted = buildPersistedLossBandTournamentResults(decision, {
    id: "t1",
    name: "LB Test",
  });
  assert.equal(persisted.finalized, true);
  assert.equal(persisted.rankingMode, RankingMode.LOSS_BAND);
  assert.equal(persisted.champion.teamName, "Alpha");
  assert.ok(persisted.placements.length >= 12);
}

{
  const decision = canFinalizeLossBandTournament({
    tournament: { id: "t1", status: TournamentStatus.CLOSED },
    lossBandState: { status: LossBandTournamentStatus.COMPLETED },
    placementsDoc: makePlacementsDoc(),
    existingResults: { finalized: true },
  });
  assert.equal(decision.canFinalize, false);
  assert.equal(decision.reasonCode, TournamentFinalizeReasonCode.ALREADY_FINALIZED);
}

assert.equal(formatLossBandPlacementLabel(61, true), "61位タイ");
assert.equal(formatLossBandPlacementLabel(63, true), "63位タイ");

console.log("loss-band-tournament-results.test.mjs: ok");
