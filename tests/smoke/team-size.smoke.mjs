/**
 * 1チーム人数（teamSize）スモークテスト
 */
import assert from "node:assert/strict";
import { validateTournamentInput, validateEntryInput } from "../../js/domain/validators.js";
import {
  collectEntryMemberNames,
  getAdditionalMemberFieldKeys,
  normalizeTeamSize,
  buildEntryMemberFirestorePayload,
  resolveTeamSizeFromTournament,
} from "../../js/domain/entry-members.js";
import { sanitizeEntryForPublic } from "../../js/domain/public-tournament-view.js";
import { TournamentLimits } from "../../js/domain/constants.js";

assert.equal(TournamentLimits.teamSize.max, 4);

assert.equal(normalizeTeamSize(4), 4);
assert.equal(normalizeTeamSize(3), 3);
assert.equal(normalizeTeamSize(99), 4);
assert.equal(resolveTeamSizeFromTournament({ teamSize: "4" }), 4);
assert.equal(resolveTeamSizeFromTournament({ teamSize: 4 }), 4);
assert.equal(resolveTeamSizeFromTournament({ teamMemberCount: "3" }), 3);
assert.equal(resolveTeamSizeFromTournament({}), 1);
assert.equal(resolveTeamSizeFromTournament(null), 1);
assert.deepEqual(getAdditionalMemberFieldKeys(4), ["member2", "member3", "member4"]);
assert.deepEqual(getAdditionalMemberFieldKeys(3), ["member2", "member3"]);
assert.deepEqual(getAdditionalMemberFieldKeys(1), []);

const tournamentInput = {
  name: "4人制大会",
  eventDate: "2026-08-01",
  venue: "会場A",
  entryDeadline: "2026-07-31T23:59",
  maxTeams: "8",
  teamSize: "4",
  courtCount: "2",
  preferredBlockSize: "4",
};
const tournamentValidation = validateTournamentInput(tournamentInput);
assert.equal(tournamentValidation.valid, true);
assert.equal(tournamentValidation.values.teamSize, 4);

const oversizedTournament = validateTournamentInput({ ...tournamentInput, teamSize: "5" });
assert.equal(oversizedTournament.valid, false);
assert.ok(oversizedTournament.errors.teamSize);

const fourMemberEntry = {
  teamName: "Team Four",
  representativeName: "M1",
  member2: "M2",
  member3: "M3",
  member4: "M4",
  email: "four@example.com",
};
const fourMemberValidation = validateEntryInput(fourMemberEntry, 4);
assert.equal(fourMemberValidation.valid, true);
assert.equal(fourMemberValidation.values.member4, "M4");

const missingFourth = validateEntryInput(
  { ...fourMemberEntry, member4: "" },
  4
);
assert.equal(missingFourth.valid, false);
assert.ok(missingFourth.errors.member4);

const threeMemberValidation = validateEntryInput(
  {
    teamName: "Team Three",
    representativeName: "M1",
    member2: "M2",
    member3: "M3",
    email: "three@example.com",
  },
  3
);
assert.equal(threeMemberValidation.valid, true);
assert.equal(threeMemberValidation.values.member4, undefined);

const threeMemberMissing = validateEntryInput(
  {
    teamName: "Team Three",
    representativeName: "M1",
    member2: "M2",
  },
  3
);
assert.equal(threeMemberMissing.valid, false);
assert.ok(threeMemberMissing.errors.member3);

const soloValidation = validateEntryInput(
  { teamName: "Solo", representativeName: "Only", email: "solo@example.com" },
  1
);
assert.equal(soloValidation.valid, true);

const payload = buildEntryMemberFirestorePayload(fourMemberEntry, 4);
assert.deepEqual(payload, {
  member2: "M2",
  member3: "M3",
  member4: "M4",
});

const savedEntry = {
  id: "entry-1",
  teamName: "Team Four",
  representativeName: "M1",
  member2: "M2",
  member3: "M3",
  member4: "M4",
  status: "pending",
};
assert.deepEqual(collectEntryMemberNames(savedEntry), ["M1", "M2", "M3", "M4"]);

const publicEntry = sanitizeEntryForPublic(savedEntry);
assert.deepEqual(publicEntry.members, ["M1", "M2", "M3", "M4"]);

const legacyEntry = sanitizeEntryForPublic({
  id: "legacy",
  teamName: "Legacy",
  representativeName: "Rep",
  member2: "B",
  member3: "C",
});
assert.deepEqual(legacyEntry.members, ["Rep", "B", "C"]);

console.log("team-size.smoke: all tests passed");
