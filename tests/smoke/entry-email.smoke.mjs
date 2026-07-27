/**
 * 公開エントリー メール必須化 smoke test
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { validateEntryInput } from "../../js/domain/validators.js";
import { formatEntryEmailDisplay } from "../../js/domain/entry-members.js";
import { sanitizeEntryForPublic } from "../../js/domain/public-tournament-view.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rules = readFileSync(resolve(__dirname, "../../firestore.rules"), "utf8");
const entryHtml = readFileSync(resolve(__dirname, "../../entry.html"), "utf8");

assert.match(rules, /function validEntryEmail\(\)/);
assert.match(rules, /validEntryEmail\(\)/);
assert.match(rules, /'email'/);
assert.doesNotMatch(rules, /optionalEntryString\('email'\)/);

assert.match(entryHtml, /メールアドレス（必須）/);
assert.match(entryHtml, /大会運営からの連絡に使用します。/);
assert.match(entryHtml, /id="email"[^>]*required/);
assert.match(entryHtml, /type="email"/);

const emailIndex = entryHtml.indexOf('id="email"');
const teamNameIndex = entryHtml.indexOf('id="teamName"');
const representativeIndex = entryHtml.indexOf('id="representativeName"');
const memberFieldsIndex = entryHtml.indexOf('id="memberFields"');
assert.ok(emailIndex >= 0 && emailIndex < teamNameIndex);
assert.ok(teamNameIndex < representativeIndex);
assert.ok(representativeIndex < memberFieldsIndex);

const validationOrderProbe = validateEntryInput(
  { email: "", teamName: "", representativeName: "", member2: "" },
  2
);
assert.deepEqual(Object.keys(validationOrderProbe.errors), [
  "email",
  "teamName",
  "representativeName",
  "member2",
]);

const baseEntry = {
  teamName: "Team Alpha",
  representativeName: "Rep",
  member2: "M2",
  member3: "M3",
};

const missingEmail = validateEntryInput({ ...baseEntry, email: "" }, 3);
assert.equal(missingEmail.valid, false);
assert.equal(missingEmail.errors.email, "メールアドレスを入力してください");

const invalidEmail = validateEntryInput({ ...baseEntry, email: "not-an-email" }, 3);
assert.equal(invalidEmail.valid, false);
assert.equal(invalidEmail.errors.email, "正しいメールアドレスを入力してください");

const validEmail = validateEntryInput({ ...baseEntry, email: "team@example.com" }, 3);
assert.equal(validEmail.valid, true);
assert.equal(validEmail.values.email, "team@example.com");

const fourMemberEntry = validateEntryInput(
  {
    teamName: "Team Four",
    representativeName: "M1",
    member2: "M2",
    member3: "M3",
    member4: "M4",
    email: "four@example.com",
  },
  4
);
assert.equal(fourMemberEntry.valid, true);
assert.equal(fourMemberEntry.values.member4, "M4");

assert.equal(formatEntryEmailDisplay({ email: "a@b.c" }), "a@b.c");
assert.equal(formatEntryEmailDisplay({}), "未登録");
assert.equal(formatEntryEmailDisplay({ email: "   " }), "未登録");

const publicEntry = sanitizeEntryForPublic({
  id: "entry-1",
  teamName: "Team",
  representativeName: "Rep",
  email: "secret@example.com",
});
assert.equal(publicEntry.email, undefined);

console.log("entry-email.smoke: all tests passed");
