/**
 * tournament-form(-v2).js の named export と、利用側 named import の整合性
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as tournamentFormShim from "../../js/ui/tournament-form.js";
import * as tournamentFormV2 from "../../js/ui/tournament-form-v2.js";
import * as finalsMatchRulesForm from "../../js/ui/finals-match-rules-form.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

const EXPECTED_FORM_EXPORTS = [
  "applyTournamentValidationErrors",
  "formatTimestampForDateTimeLocal",
  "populateTournamentForm",
  "readTournamentCreateFormInput",
  "readTournamentFormInput",
  "setFinalsWinsRequiredFieldsLocked",
  "setTournamentStructureFieldsLocked",
];

for (const name of EXPECTED_FORM_EXPORTS) {
  assert.equal(
    typeof tournamentFormV2[name],
    "function",
    `tournament-form-v2.js must export function ${name}`
  );
  assert.equal(
    typeof tournamentFormShim[name],
    "function",
    `tournament-form.js shim must re-export function ${name}`
  );
}

assert.equal(typeof finalsMatchRulesForm.initFinalsMatchRulesForm, "function");

/**
 * @param {string} source
 * @param {RegExp} modulePattern
 */
function extractNamedImportsByPattern(source, modulePattern) {
  const pattern = new RegExp(
    `import\\s*\\{([^}]*)\\}\\s*from\\s*["'](${modulePattern.source})["']`,
    "g"
  );
  const names = [];
  const specifiers = [];
  for (const match of source.matchAll(pattern)) {
    specifiers.push(match[2]);
    const body = match[1]
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    for (const part of body.split(",")) {
      const token = part.trim();
      if (!token) continue;
      const imported = token.split(/\s+as\s+/i)[0].trim();
      if (imported) names.push(imported);
    }
  }
  return { names, specifiers };
}

const FORM_IMPORT_PATTERN = /\.\.\/tournament-form-v2\.js(?:\?[^"']*)?/;

const consumers = [
  "js/ui/pages/tournament-edit-page-v2.js",
  "js/ui/pages/tournament-new-page.js",
];

for (const relativePath of consumers) {
  const source = readFileSync(join(root, relativePath), "utf8");
  const { names, specifiers } = extractNamedImportsByPattern(source, FORM_IMPORT_PATTERN);
  assert.ok(names.length > 0, `${relativePath} should import from tournament-form-v2.js`);
  assert.ok(specifiers.length > 0, `${relativePath} missing form specifier`);
  for (const name of names) {
    assert.equal(
      typeof tournamentFormV2[name],
      "function",
      `${relativePath} imports '${name}' but tournament-form-v2.js does not export it`
    );
  }
}

const editSource = readFileSync(join(root, "js/ui/pages/tournament-edit-page-v2.js"), "utf8");
assert.match(editSource, /setFinalsWinsRequiredFieldsLocked/);
assert.match(editSource, /initFinalsMatchRulesForm/);
assert.ok(
  extractNamedImportsByPattern(editSource, FORM_IMPORT_PATTERN).names.includes(
    "setFinalsWinsRequiredFieldsLocked"
  )
);

assert.ok(
  Object.prototype.hasOwnProperty.call(tournamentFormV2, "setFinalsWinsRequiredFieldsLocked")
);

console.log("tournament-form-exports.smoke.mjs: all passed");
console.log("exports:", Object.keys(tournamentFormV2).sort().join(", "));
