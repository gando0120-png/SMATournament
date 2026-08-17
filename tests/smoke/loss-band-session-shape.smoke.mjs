/**
 * bootstrap / builder が生成する lossBandMatchSessions が
 * Rules create 相当の必須フィールドをすべて持つことを検証する。
 */
import assert from "node:assert/strict";
import {
  planLossBandInitialize,
  buildLossBandMatchSessionDoc,
  hasLossBandMatchSessionCreateShape,
  LOSS_BAND_MATCH_SESSION_REQUIRED_FIELDS,
  validateLossBandMatchSessionStructure,
} from "../../js/domain/loss-band/index.js";

function entryIds(n) {
  return Array.from({ length: n }, (_, i) => `e${String(i + 1).padStart(3, "0")}`);
}

function run() {
  for (const teamCount of [32, 64]) {
    const init = planLossBandInitialize(entryIds(teamCount), {
      rematchAvoidance: true,
      thirdPlaceMatch: true,
      exchangeMatches: true,
    });
    assert.ok(init.matchPlans.length > 0);

    for (const { match, matchNumber, session } of init.matchPlans) {
      assert.equal(
        hasLossBandMatchSessionCreateShape(session),
        true,
        `${teamCount}: plan session missing fields ${session.matchId}`
      );
      for (const key of LOSS_BAND_MATCH_SESSION_REQUIRED_FIELDS) {
        assert.ok(key in session, `${teamCount}: missing ${key} on ${session.matchId}`);
      }

      const named = buildLossBandMatchSessionDoc(
        match,
        matchNumber,
        {
          entryId: match.team1EntryId,
          teamName: `Team ${match.team1EntryId}`,
        },
        {
          entryId: match.team2EntryId,
          teamName: `Team ${match.team2EntryId}`,
        }
      );
      assert.equal(hasLossBandMatchSessionCreateShape(named), true);
      assert.equal(validateLossBandMatchSessionStructure(named).valid, true);
      assert.equal(named.roundNumber, match.roundNumber);
      assert.equal(named.lossBand, match.lossCount ?? 0);
    }
  }

  // 旧 IAM 不完全形状は create shape / save guard ともに不合格
  const legacyIncomplete = {
    matchId: "lb-r1-l0-m1",
    matchNumber: 1,
    matchPurpose: "ranking",
    status: "playing",
    team1EntryId: "e001",
    team2EntryId: "e002",
    team1: { entryId: "e001", teamName: "A", seed: 1 },
    team2: { entryId: "e002", teamName: "B", seed: 2 },
  };
  assert.equal(hasLossBandMatchSessionCreateShape(legacyIncomplete), false);
  assert.equal(validateLossBandMatchSessionStructure(legacyIncomplete).valid, false);

  console.log("loss-band-session-shape.smoke.mjs: ok");
}

run();
