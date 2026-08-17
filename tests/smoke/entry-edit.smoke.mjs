/**
 * エントリー編集 UI / overlay スモーク
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { validateEntryProfileInput } from "../../js/domain/entry-profile.js";
import {
  buildEntryTeamNameLookup,
  overlayEntryTeamNames,
} from "../../js/domain/entry-team-name-overlay.js";
import { buildPublicTournamentView } from "../../js/domain/public-tournament-view.js";
import { EntryStatus } from "../../js/domain/constants.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");

const entriesPage = readFileSync(resolve(root, "js/ui/pages/tournament-entries-page.js"), "utf8");
assert.match(entriesPage, /openEntryEditDialog/);
assert.match(entriesPage, /updateEntryProfile/);
assert.match(entriesPage, /エントリー情報を更新しました/);

const editDialog = readFileSync(resolve(root, "js/ui/components/entry-edit-dialog.js"), "utf8");
assert.match(editDialog, /entryEdit_teamName/);
assert.match(editDialog, /validateEntryProfileInput/);

const entryService = readFileSync(resolve(root, "js/services/entry-service.js"), "utf8");
assert.match(entryService, /export async function updateEntryProfile/);
assert.match(entryService, /withPublicSnapshotRebuild/);

const rules = readFileSync(resolve(root, "firestore.rules"), "utf8");
assert.match(rules, /validEntryProfileUpdate/);
assert.match(rules, /validEntryConfirmUpdate\(\)/);

// 公開ビューは entry 最新名を対戦表・順位に反映する
const view = buildPublicTournamentView({
  tournament: {
    id: "t1",
    name: "Test",
    status: "open",
    tournamentFormat: "qualifying_and_finals",
    teamSize: 1,
    courtCount: 2,
  },
  entries: [
    {
      id: "e1",
      teamName: "最新名",
      representativeName: "R",
      status: EntryStatus.CONFIRMED,
    },
  ],
  schedule: {
    finalized: true,
    blocks: [
      {
        blockId: "A",
        blockName: "A",
        teams: [{ entryId: "e1", teamName: "古い名", symbol: "A1" }],
        rounds: [
          {
            roundNumber: 1,
            matches: [
              {
                matchId: "m1",
                homeEntryId: "e1",
                awayEntryId: null,
                homeTeamName: "古い名",
                awayTeamName: "—",
                team1: { entryId: "e1", teamName: "古い名" },
                team2: { entryId: null, teamName: "—" },
              },
            ],
          },
        ],
      },
    ],
  },
  qualifyingResultsMap: new Map([
    [
      "m1",
      {
        matchId: "m1",
        status: "finished",
        team1: { entryId: "e1", teamName: "古い名" },
        team2: { entryId: "x", teamName: "相手" },
        team1Stats: { setWins: 2, setDraws: 0, setLosses: 0, totalScore: 20 },
        team2Stats: { setWins: 0, setDraws: 0, setLosses: 2, totalScore: 5 },
        sets: [
          { setNumber: 1, team1Score: 10, team2Score: 2, result: "team1" },
          { setNumber: 2, team1Score: 10, team2Score: 3, result: "team1" },
        ],
      },
    ],
  ]),
});

const scheduleMatch = view.sections.qualifying.schedule.blocks[0].rounds[0].matches[0];
assert.equal(scheduleMatch.team1.teamName, "最新名");

const standingRow = view.sections.qualifying.standings.blocks[0]?.rows?.[0];
if (standingRow) {
  assert.equal(standingRow.teamName, "最新名");
}

const validation = validateEntryProfileInput(
  { teamName: "A", representativeName: "B", email: "c@d.com" },
  1
);
assert.equal(validation.valid, true);

const lookup = buildEntryTeamNameLookup([{ id: "e1", teamName: "最新名" }]);
assert.equal(
  overlayEntryTeamNames({ entryId: "e1", teamName: "旧" }, lookup).teamName,
  "最新名"
);

console.log("entry-edit.smoke: ok");
