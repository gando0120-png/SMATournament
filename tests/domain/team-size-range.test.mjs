/**
 * 可変チーム人数（minTeamSize / maxTeamSize）ドメインテスト
 */
import assert from "node:assert/strict";
import {
  buildEntryMemberFirestorePayload,
  buildEntryMemberUpdateFields,
  formatTeamSizeRangeLabel,
  resolveTeamSizeRange,
} from "../../js/domain/entry-members.js";
import { validateEntryInput, validateTournamentInput } from "../../js/domain/validators.js";
import { validateEntryProfileInput } from "../../js/domain/entry-profile.js";

function tournamentInput(overrides = {}) {
  return {
    name: "人数テスト大会",
    eventDate: "2026-08-01",
    venue: "会場A",
    entryDeadline: "2026-07-31T23:59",
    maxTeams: "8",
    courtCount: "2",
    preferredBlockSize: "4",
    ...overrides,
  };
}

function entryInput(overrides = {}) {
  return {
    teamName: "Team",
    representativeName: "M1",
    email: "team@example.com",
    ...overrides,
  };
}

{
  const fixed = resolveTeamSizeRange({ teamSize: 3 });
  assert.deepEqual(fixed, { min: 3, max: 3, isRange: false });

  const range = resolveTeamSizeRange({ teamSize: 4, minTeamSize: 2, maxTeamSize: 4 });
  assert.deepEqual(range, { min: 2, max: 4, isRange: true });

  const invalidMin = resolveTeamSizeRange({ teamSize: 3, minTeamSize: 0, maxTeamSize: 4 });
  assert.deepEqual(invalidMin, { min: 3, max: 3, isRange: false });

  const missingMax = resolveTeamSizeRange({ teamSize: 3, minTeamSize: 2 });
  assert.deepEqual(missingMax, { min: 3, max: 3, isRange: false });

  const inverted = resolveTeamSizeRange({ teamSize: 3, minTeamSize: 4, maxTeamSize: 2 });
  assert.deepEqual(inverted, { min: 3, max: 3, isRange: false });
}

{
  assert.equal(formatTeamSizeRangeLabel({ teamSize: 3 }), "1チーム 3人");
  assert.equal(formatTeamSizeRangeLabel({ teamSize: 3 }, { prefix: false }), "3人");
  assert.equal(
    formatTeamSizeRangeLabel({ teamSize: 4, minTeamSize: 2, maxTeamSize: 4 }),
    "1チーム 2〜4人"
  );
  assert.equal(
    formatTeamSizeRangeLabel({ teamSize: 4, minTeamSize: 2, maxTeamSize: 4 }, { prefix: false }),
    "2〜4人"
  );
}

{
  const createdRange = validateTournamentInput(
    tournamentInput({ minTeamSize: "2", maxTeamSize: "4" })
  );
  assert.equal(createdRange.valid, true);
  assert.equal(createdRange.values.teamSize, 4);
  assert.equal(createdRange.values.minTeamSize, 2);
  assert.equal(createdRange.values.maxTeamSize, 4);

  const createdFixed = validateTournamentInput(
    tournamentInput({ minTeamSize: "3", maxTeamSize: "3" })
  );
  assert.equal(createdFixed.valid, true);
  assert.equal(createdFixed.values.teamSize, 3);
  assert.equal(createdFixed.values.minTeamSize, 3);
  assert.equal(createdFixed.values.maxTeamSize, 3);

  const inverted = validateTournamentInput(
    tournamentInput({ minTeamSize: "4", maxTeamSize: "2" })
  );
  assert.equal(inverted.valid, false);
  assert.ok(inverted.errors.maxTeamSize);

  const zero = validateTournamentInput(tournamentInput({ minTeamSize: "0", maxTeamSize: "4" }));
  assert.equal(zero.valid, false);
  assert.ok(zero.errors.minTeamSize);

  const five = validateTournamentInput(tournamentInput({ minTeamSize: "2", maxTeamSize: "5" }));
  assert.equal(five.valid, false);
  assert.ok(five.errors.maxTeamSize);

  const legacy = validateTournamentInput(tournamentInput({ teamSize: "3" }));
  assert.equal(legacy.valid, true);
  assert.equal(legacy.values.teamSize, 3);
  assert.equal(legacy.values.minTeamSize, undefined);
  assert.equal(legacy.values.maxTeamSize, undefined);
}

const rangeTournament = { teamSize: 4, minTeamSize: 2, maxTeamSize: 4 };

{
  const two = validateEntryInput(
    entryInput({ member2: "M2", selectedTeamSize: 2 }),
    rangeTournament
  );
  assert.equal(two.valid, true);
  assert.equal(two.values.member2, "M2");
  assert.equal(two.values.member3, undefined);
  assert.equal(two.values.member4, undefined);

  const three = validateEntryInput(
    entryInput({ member2: "M2", member3: "M3", selectedTeamSize: 3 }),
    rangeTournament
  );
  assert.equal(three.valid, true);
  assert.equal(three.values.member3, "M3");
  assert.equal(three.values.member4, undefined);

  const four = validateEntryInput(
    entryInput({
      member2: "M2",
      member3: "M3",
      member4: "M4",
      selectedTeamSize: 4,
    }),
    rangeTournament
  );
  assert.equal(four.valid, true);
  assert.equal(four.values.member4, "M4");

  const one = validateEntryInput(entryInput({ selectedTeamSize: 1 }), rangeTournament);
  assert.equal(one.valid, false);

  const onlyRep = validateEntryInput(entryInput(), rangeTournament);
  assert.equal(onlyRep.valid, false);
  assert.ok(onlyRep.errors.member2 || onlyRep.errors.selectedTeamSize);
}

{
  const fixed3 = 3;
  const ok = validateEntryInput(entryInput({ member2: "M2", member3: "M3" }), fixed3);
  assert.equal(ok.valid, true);

  const two = validateEntryInput(entryInput({ member2: "M2" }), fixed3);
  assert.equal(two.valid, false);
  assert.ok(two.errors.member3);

  const four = validateEntryInput(
    entryInput({ member2: "M2", member3: "M3", member4: "M4" }),
    fixed3
  );
  assert.equal(four.valid, false);
  assert.ok(four.errors.member4);
}

{
  const twoPayload = buildEntryMemberFirestorePayload(
    { member2: "M2", member3: "", member4: "" },
    4
  );
  assert.deepEqual(twoPayload, { member2: "M2" });
  assert.equal(Object.prototype.hasOwnProperty.call(twoPayload, "member3"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(twoPayload, "member4"), false);

  const fourPayload = buildEntryMemberFirestorePayload(
    { member2: "M2", member3: "M3", member4: "M4" },
    4
  );
  assert.deepEqual(fourPayload, { member2: "M2", member3: "M3", member4: "M4" });
}

{
  const updated = buildEntryMemberUpdateFields(
    { member2: "A2" },
    { min: 2, max: 4 },
    { member2: "Old2", member3: "Old3", member4: "Old4" }
  );
  assert.deepEqual(updated.set, { member2: "A2" });
  assert.deepEqual(updated.deleteKeys, ["member3", "member4"]);

  const profile = validateEntryProfileInput(
    entryInput({ member2: "A2", selectedTeamSize: 2 }),
    rangeTournament
  );
  assert.equal(profile.valid, true);
  assert.equal(profile.values.member3, undefined);
  assert.equal(profile.values.member4, undefined);
}

console.log("team-size-range domain tests: ok");
