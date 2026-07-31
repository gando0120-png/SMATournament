/**
 * 大会作成/編集の分割日付フィールド smoke
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  composeDateTimeLocal,
  parsePastedDate,
  splitDateString,
} from "../../js/domain/date-parts.js";
import { validateTournamentInput } from "../../js/domain/validators.js";
import { TournamentFormat } from "../../js/domain/tournament-format.js";
import { formatTimestampForDateTimeLocal } from "../../js/ui/tournament-form-v2.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

function read(rel) {
  return readFileSync(join(root, rel), "utf8");
}

const newHtml = read("tournament-new.html");
const editHtml = read("tournament-edit-v2.html");
const newPage = read("js/ui/pages/tournament-new-page.js");
const formV2 = read("js/ui/tournament-form-v2.js");
const componentSrc = read("js/ui/components/date-parts-field.js");
const dateFieldsSrc = read("js/ui/tournament-date-fields.js");
const css = read("css/components.css");

assert.match(newHtml, /data-date-parts=["']eventDate["']/);
assert.match(newHtml, /data-date-parts=["']entryDeadline["']/);
assert.match(newHtml, /id=["']entryDeadlineTime["']/);
assert.match(newHtml, /type=["']hidden["']/);
assert.match(newHtml, /id=["']eventDate["']/);
assert.doesNotMatch(newHtml, /type=["']date["']/);
assert.doesNotMatch(newHtml, /type=["']datetime-local["']/);

assert.match(editHtml, /data-date-parts=["']eventDate["']/);
assert.match(editHtml, /id=["']entryDeadlineTime["']/);
assert.doesNotMatch(editHtml, /type=["']datetime-local["']/);

assert.match(newPage, /initTournamentDateFields/);
assert.match(formV2, /initTournamentDateFields/);
assert.match(formV2, /readEventDateValue|getTournamentDateFieldControllers/);
assert.match(componentSrc, /compositionstart/);
assert.match(componentSrc, /parsePastedDate/);
assert.match(componentSrc, /focusNextFrom/);
assert.match(componentSrc, /digits\.length === maxLen && digits\.length > beforeLen/);
assert.match(dateFieldsSrc, /composeDateTimeLocal/);
assert.match(dateFieldsSrc, /getNextFocusElement:\s*\(\)\s*=>\s*timeInput/);
assert.match(css, /\.date-parts-field__row/);

// 貼り付け3形式
for (const raw of ["20260831", "2026/08/31", "2026-08-31"]) {
  const parsed = parsePastedDate(raw);
  assert.equal(parsed.valid, true);
  assert.equal(parsed.value, "2026-08-31");
}

// 保存payload相当
assert.equal(composeDateTimeLocal("2026-07-31", "23:59"), "2026-07-31T23:59");
const restoredLocal = formatTimestampForDateTimeLocal(new Date(2027, 2, 14, 18, 30));
assert.equal(restoredLocal, "2027-03-14T18:30");
assert.deepEqual(splitDateString(restoredLocal.slice(0, 10)), {
  year: "2027",
  month: "03",
  day: "14",
});

const payload = validateTournamentInput({
  name: "日付分割テスト",
  eventDate: "2026-08-01",
  venue: "会場A",
  entryDeadline: "2026-07-31T23:59",
  maxTeams: "8",
  teamSize: "4",
  courtCount: "2",
  tournamentFormat: TournamentFormat.SINGLE_ELIMINATION,
});
assert.equal(payload.valid, true);
assert.equal(payload.values.eventDate, "2026-08-01");
assert.ok(payload.values.entryDeadline instanceof Date);

const invalid = validateTournamentInput({
  name: "不正日付",
  eventDate: "2026-02-30",
  venue: "会場A",
  entryDeadline: "2026-02-01T12:00",
  maxTeams: "8",
  teamSize: "4",
  courtCount: "2",
  tournamentFormat: TournamentFormat.SINGLE_ELIMINATION,
});
assert.equal(invalid.valid, false);
assert.match(invalid.errors.eventDate, /存在しない日付/);

console.log("tournament-date-parts.smoke.mjs: all passed");
