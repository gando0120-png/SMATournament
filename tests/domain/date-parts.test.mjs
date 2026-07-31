/**
 * 年・月・日分割日付ドメイン
 */
import assert from "node:assert/strict";
import {
  composeDateParts,
  composeDateTimeLocal,
  isValidCalendarDate,
  isValidCalendarDateString,
  normalizeDigits,
  parsePastedDate,
  splitDateString,
  splitDateTimeLocal,
  validateDatePartsInput,
} from "../../js/domain/date-parts.js";
import { validateTournamentInput } from "../../js/domain/validators.js";
import { TournamentFormat } from "../../js/domain/tournament-format.js";

assert.equal(normalizeDigits("２０２６"), "2026");
assert.equal(normalizeDigits("08月"), "08");

assert.equal(isValidCalendarDate(2026, 2, 28), true);
assert.equal(isValidCalendarDate(2028, 2, 29), true);
assert.equal(isValidCalendarDate(2026, 2, 29), false);
assert.equal(isValidCalendarDate(2026, 2, 30), false);
assert.equal(isValidCalendarDate(2026, 4, 31), false);
assert.equal(isValidCalendarDate(2026, 0, 1), false);
assert.equal(isValidCalendarDate(2026, 13, 1), false);
assert.equal(isValidCalendarDate(2026, 1, 0), false);

assert.equal(isValidCalendarDateString("2026-02-28"), true);
assert.equal(isValidCalendarDateString("2026-02-30"), false);

assert.deepEqual(splitDateString("2026-08-31"), {
  year: "2026",
  month: "08",
  day: "31",
});
assert.equal(composeDateParts({ year: "2026", month: "8", day: "31" }), "2026-08-31");
assert.equal(composeDateParts({ year: "2026", month: "2", day: "30" }), null);

for (const raw of ["20260831", "2026/08/31", "2026-08-31"]) {
  const parsed = parsePastedDate(raw);
  assert.equal(parsed.valid, true, raw);
  assert.equal(parsed.value, "2026-08-31");
}

assert.equal(parsePastedDate("2026-02-30").valid, false);
assert.equal(parsePastedDate("abcdefgh").valid, false);

assert.equal(composeDateTimeLocal("2026-07-31", "23:59"), "2026-07-31T23:59");
assert.deepEqual(splitDateTimeLocal("2026-07-31T23:59"), {
  date: "2026-07-31",
  time: "23:59",
});

const okParts = validateDatePartsInput(
  { year: "2026", month: "02", day: "28" },
  { required: true, label: "開催日" }
);
assert.equal(okParts.valid, true);
assert.equal(okParts.value, "2026-02-28");

const badParts = validateDatePartsInput(
  { year: "2026", month: "02", day: "30" },
  { required: true, label: "開催日" }
);
assert.equal(badParts.valid, false);
assert.match(badParts.message, /存在しない日付/);

const base = {
  name: "テスト大会",
  venue: "会場A",
  maxTeams: "8",
  teamSize: "4",
  courtCount: "2",
  tournamentFormat: TournamentFormat.SINGLE_ELIMINATION,
};

{
  const result = validateTournamentInput({
    ...base,
    eventDate: "2026-02-28",
    entryDeadline: "2026-02-27T12:00",
  });
  assert.equal(result.valid, true);
}

{
  const result = validateTournamentInput({
    ...base,
    eventDate: "2028-02-29",
    entryDeadline: "2028-02-28T12:00",
  });
  assert.equal(result.valid, true);
}

{
  const result = validateTournamentInput({
    ...base,
    eventDate: "2026-02-30",
    entryDeadline: "2026-02-01T12:00",
  });
  assert.equal(result.valid, false);
  assert.match(result.errors.eventDate, /存在しない日付/);
}

{
  const result = validateTournamentInput({
    ...base,
    eventDate: "2026-08-01",
    entryDeadline: "2026-02-30T12:00",
  });
  assert.equal(result.valid, false);
  assert.match(result.errors.entryDeadline, /存在しない日付/);
}

console.log("date-parts.test.mjs: all passed");
