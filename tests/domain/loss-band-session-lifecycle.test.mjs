/**
 * loss-band session ready → playing → finished + Phase2 ロック判定
 */
import assert from "node:assert/strict";
import { MatchSessionStatus } from "../../js/domain/constants.js";
import {
  buildLossBandMatchSessionDoc,
  hasLossBandMatchSessionCreateShape,
  isLossBandNextRoundStartedForEditLock,
  isLossBandSessionStartedForLock,
  planAfterLossBandMatchSaved,
  planLossBandInitialize,
  resolveLossBandMatchSessionDisplay,
} from "../../js/domain/loss-band/index.js";

function entryIds(n) {
  return Array.from({ length: n }, (_, i) => `e${String(i + 1).padStart(3, "0")}`);
}

function playedResult(matchId, winnerId, loserId) {
  return {
    matchId,
    roundNumber: 1,
    matchNumber: 1,
    status: "finished",
    resolution: "played",
    lossBand: 0,
    team1EntryId: winnerId,
    team2EntryId: loserId,
    matchPurpose: "ranking",
    winner: { entryId: winnerId, teamName: winnerId, seed: 1 },
    loser: { entryId: loserId, teamName: loserId, seed: 2 },
    team1: { entryId: winnerId, teamName: winnerId, seed: 1 },
    team2: { entryId: loserId, teamName: loserId, seed: 2 },
    winnerSide: "team1",
    sets: [],
    team1SetWins: 2,
    team2SetWins: 0,
    winsRequired: 2,
  };
}

{
  const init = planLossBandInitialize(entryIds(32), {
    rematchAvoidance: true,
    thirdPlaceMatch: false,
    exchangeMatches: false,
  });
  assert.ok(init.matchPlans.length > 0);
  for (const { session } of init.matchPlans) {
    assert.equal(session.status, MatchSessionStatus.READY, "round生成 session は ready");
    assert.equal(hasLossBandMatchSessionCreateShape(session), true);
    assert.equal("startedAt" in session, false);
    assert.equal("finishedAt" in session, false);
  }

  const first = init.matchPlans[0];
  const named = buildLossBandMatchSessionDoc(
    first.match,
    first.matchNumber,
    { entryId: first.match.team1EntryId, teamName: "A" },
    { entryId: first.match.team2EntryId, teamName: "B" }
  );
  assert.equal(named.status, MatchSessionStatus.READY);

  // BYE は matchPlans に含まれない（人間 Start 対象外）
  const byeIds = new Set((init.roundDoc.byes || []).map((b) => b.matchId));
  for (const { session } of init.matchPlans) {
    assert.equal(byeIds.has(session.matchId), false);
  }
}

{
  const ready = { status: MatchSessionStatus.READY };
  const playing = { status: MatchSessionStatus.PLAYING, startedAt: "t" };
  const finished = { status: MatchSessionStatus.FINISHED };
  const legacyPlaying = { status: "playing", startedAt: "legacy" };

  assert.equal(isLossBandSessionStartedForLock(ready), false);
  assert.equal(isLossBandSessionStartedForLock(playing), true);
  assert.equal(isLossBandSessionStartedForLock(finished), true);
  assert.equal(isLossBandSessionStartedForLock(legacyPlaying), true, "旧 playing は開始済み");

  assert.equal(resolveLossBandMatchSessionDisplay(ready, null).label, "未開始");
  assert.equal(resolveLossBandMatchSessionDisplay(ready, null).canStart, true);
  assert.equal(resolveLossBandMatchSessionDisplay(ready, null).canEnterResult, false);
  assert.equal(resolveLossBandMatchSessionDisplay(playing, null).label, "試合中");
  assert.equal(resolveLossBandMatchSessionDisplay(playing, null).canEnterResult, true);
  assert.equal(resolveLossBandMatchSessionDisplay(finished, { id: "r" }).label, "完了");

  const nextIds = ["r2-m1", "r2-m2"];
  assert.equal(
    isLossBandNextRoundStartedForEditLock({
      nextRoundMatchIds: nextIds,
      sessionsMap: new Map([
        ["r2-m1", ready],
        ["r2-m2", ready],
      ]),
      resultsMap: new Map(),
    }),
    false,
    "readyのみなら前R未ロック"
  );
  assert.equal(
    isLossBandNextRoundStartedForEditLock({
      nextRoundMatchIds: nextIds,
      sessionsMap: new Map([
        ["r2-m1", playing],
        ["r2-m2", ready],
      ]),
      resultsMap: new Map(),
    }),
    true,
    "playingが1件あれば前Rロック"
  );
  assert.equal(
    isLossBandNextRoundStartedForEditLock({
      nextRoundMatchIds: nextIds,
      sessionsMap: new Map([
        ["r2-m1", ready],
        ["r2-m2", ready],
      ]),
      resultsMap: new Map([["r2-m2", { matchId: "r2-m2" }]]),
    }),
    true,
    "resultがあれば前Rロック"
  );
}

{
  // 次ラウンド生成計画の session も ready
  const init = planLossBandInitialize(entryIds(32), {
    rematchAvoidance: false,
    thirdPlaceMatch: false,
    exchangeMatches: false,
  });
  const results = [];
  for (const { match, matchNumber } of init.matchPlans) {
    results.push(
      playedResult(match.matchId, match.team1EntryId, match.team2EntryId)
    );
  }
  // complete round with all results — use planAfter on last match
  let stateDoc = init.stateDoc;
  let roundDoc = init.roundDoc;
  let prior = [];
  let lastPlan = null;
  for (let i = 0; i < results.length; i++) {
    lastPlan = planAfterLossBandMatchSaved({
      stateDoc,
      roundDoc,
      priorCompletedResults: prior,
      priorCompletedRounds: [],
      newResult: results[i],
      rematchAvoidance: false,
    });
    prior = [...prior, results[i]];
    stateDoc = lastPlan.nextStateDoc;
    roundDoc = lastPlan.nextRoundDoc;
  }
  assert.ok(lastPlan?.nextRoundPlan, "R1完了で次R生成");
  for (const { session } of lastPlan.nextRoundPlan.matchPlans) {
    assert.equal(session.status, MatchSessionStatus.READY, "次R session は ready");
  }
}

console.log("loss-band-session-lifecycle.test.mjs: ok");
