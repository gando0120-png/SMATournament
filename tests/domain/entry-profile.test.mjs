/**
 * 運営エントリー編集・teamName overlay ドメインテスト
 */
import assert from "node:assert/strict";
import { validateEntryProfileInput } from "../../js/domain/entry-profile.js";
import {
  buildEntryTeamNameLookup,
  overlayEntryTeamNames,
  overlayEntryTeamNamesInMap,
  resolveLiveTeamName,
} from "../../js/domain/entry-team-name-overlay.js";

// ── validateEntryProfileInput ──
{
  const ok = validateEntryProfileInput(
    {
      teamName: "  Alpha  ",
      representativeName: " 代表 ",
      email: " team@example.com ",
      member2: " 二番 ",
      comment: " メモ ",
    },
    2
  );
  assert.equal(ok.valid, true);
  assert.equal(ok.values.teamName, "Alpha");
  assert.equal(ok.values.representativeName, "代表");
  assert.equal(ok.values.email, "team@example.com");
  assert.equal(ok.values.member2, "二番");
  assert.equal(ok.values.comment, "メモ");
}

{
  const missingTeam = validateEntryProfileInput(
    {
      teamName: "   ",
      representativeName: "代表",
      email: "a@b.com",
    },
    1
  );
  assert.equal(missingTeam.valid, false);
  assert.ok(missingTeam.errors.teamName);
}

{
  const badEmail = validateEntryProfileInput(
    {
      teamName: "T",
      representativeName: "R",
      email: "not-an-email",
    },
    1
  );
  assert.equal(badEmail.valid, false);
  assert.ok(badEmail.errors.email);
}

{
  const needMember = validateEntryProfileInput(
    {
      teamName: "T",
      representativeName: "R",
      email: "a@b.com",
      member2: "",
    },
    3
  );
  assert.equal(needMember.valid, false);
  assert.ok(needMember.errors.member2);
  assert.ok(needMember.errors.member3);
}

{
  const clearComment = validateEntryProfileInput(
    {
      teamName: "T",
      representativeName: "R",
      email: "a@b.com",
      comment: "   ",
    },
    1
  );
  assert.equal(clearComment.valid, true);
  assert.equal(clearComment.values.comment, "");
}

// ── overlayEntryTeamNames ──
{
  const lookup = buildEntryTeamNameLookup([
    { id: "e1", teamName: "新チームA" },
    { entryId: "e2", teamName: " 新チームB " },
  ]);
  assert.equal(lookup.get("e1"), "新チームA");
  assert.equal(lookup.get("e2"), "新チームB");

  const schedule = {
    blocks: [
      {
        rounds: [
          {
            matches: [
              {
                matchId: "m1",
                homeEntryId: "e1",
                awayEntryId: "e2",
                homeTeamName: "旧A",
                awayTeamName: "旧B",
                team1: { entryId: "e1", teamName: "旧A" },
                team2: { entryId: "e2", teamName: "旧B" },
              },
            ],
            byes: [{ entryId: "e1", teamName: "旧A" }],
          },
        ],
      },
    ],
  };

  const overlaid = overlayEntryTeamNames(schedule, lookup);
  const match = overlaid.blocks[0].rounds[0].matches[0];
  assert.equal(match.homeTeamName, "新チームA");
  assert.equal(match.awayTeamName, "新チームB");
  assert.equal(match.team1.teamName, "新チームA");
  assert.equal(match.team2.teamName, "新チームB");
  assert.equal(overlaid.blocks[0].rounds[0].byes[0].teamName, "新チームA");
  // 元オブジェクトは不変（参照が変わっている）
  assert.notEqual(overlaid, schedule);
  assert.equal(schedule.blocks[0].rounds[0].matches[0].homeTeamName, "旧A");
}

{
  const lookup = buildEntryTeamNameLookup([{ id: "e1", teamName: "Live" }]);
  const bracket = {
    slots: [{ entryId: "e1", teamName: "Stale", seed: 1 }],
    matches: [
      {
        team1: { entryId: "e1", teamName: "Stale", seed: 1 },
        winner: { entryId: "e1", teamName: "Stale", seed: 1 },
      },
    ],
  };
  const overlaid = overlayEntryTeamNames(bracket, lookup);
  assert.equal(overlaid.slots[0].teamName, "Live");
  assert.equal(overlaid.matches[0].team1.teamName, "Live");
  assert.equal(overlaid.matches[0].winner.teamName, "Live");
}

{
  const lookup = buildEntryTeamNameLookup([{ id: "e1", teamName: "Live" }]);
  const map = new Map([
    ["m1", { team1: { entryId: "e1", teamName: "Old" }, score: 10 }],
  ]);
  const overlaidMap = overlayEntryTeamNamesInMap(map, lookup);
  assert.equal(overlaidMap.get("m1").team1.teamName, "Live");
  assert.equal(overlaidMap.get("m1").score, 10);
  assert.equal(map.get("m1").team1.teamName, "Old");
}

{
  const lookup = buildEntryTeamNameLookup([{ id: "e1", teamName: "Live" }]);
  assert.equal(resolveLiveTeamName("e1", "Old", lookup), "Live");
  assert.equal(resolveLiveTeamName("missing", "Old", lookup), "Old");
}

console.log("entry-profile / entry-team-name-overlay domain tests: ok");
