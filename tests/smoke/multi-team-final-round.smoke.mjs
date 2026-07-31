/**
 * multiTeamTotal 最終ラウンド表示・完了ゲート smoke
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { MatchFormat } from "../../js/domain/aggregate-match-format.js";
import {
  buildMultiTeamBracket,
  getMultiTeamMatchTitle,
  getMultiTeamRoundLabel,
  isMultiTeamFinalMatch,
} from "../../js/domain/multi-team-bracket.js";
import { groupBracketMatchesByRound } from "../../js/domain/finals-bracket-display.js";
import { getMultiTeamFinalPlacementLabel } from "../../js/domain/multi-team-placements.js";
import {
  buildMultiTeamMatchResultPayload,
  validateMultiTeamMatchResultInput,
} from "../../js/domain/multi-team-match-result.js";
import { canFinalizeTournament } from "../../js/domain/tournament-results.js";
import { MatchResultStatus } from "../../js/domain/constants.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");

function read(rel) {
  return readFileSync(resolve(root, rel), "utf8");
}

function entries(n) {
  return Array.from({ length: n }, (_, i) => ({
    entryId: `e${i + 1}`,
    teamName: `T${i + 1}`,
  }));
}

const built = buildMultiTeamBracket({
  entries: entries(8),
  aggregateMatchRules: { teamCount: 4, qualifiersCount: 2 },
  random: () => 0.25,
});

const grouped = groupBracketMatchesByRound(built.bracket);
assert.equal(grouped[0].roundLabel, "準決勝", "第1ラウンド見出しは準決勝");
assert.equal(grouped[1].roundLabel, "決勝", "第2ラウンド見出しは決勝");
assert.equal(getMultiTeamRoundLabel(built.bracket, 1), "準決勝");
assert.equal(getMultiTeamRoundLabel(built.bracket, 2), "決勝");

const finalMatch = built.bracket.matches.find((m) => isMultiTeamFinalMatch(m));
const sfMatch = built.bracket.matches.find((m) => m.roundNumber === 1);
assert.equal(getMultiTeamMatchTitle(finalMatch, built.bracket), "決勝");
assert.match(getMultiTeamMatchTitle(sfMatch, built.bracket), /^準決勝 第\d+組$/);

assert.equal(getMultiTeamFinalPlacementLabel(1), "優勝");
assert.equal(getMultiTeamFinalPlacementLabel(2), "準優勝");
assert.equal(getMultiTeamFinalPlacementLabel(3), "3位");
assert.equal(getMultiTeamFinalPlacementLabel(4), "4位");

const finalIds = ["a", "b", "c", "d"];
const finalValidated = validateMultiTeamMatchResultInput({
  participantEntryIds: finalIds,
  scores: {
    a: [50, 50],
    b: [48, 48],
    c: [44, 44],
    d: [36, 36],
  },
  qualifiersCount: 2,
  isFinalRound: true,
});
assert.equal(finalValidated.valid, true);
const finalPayload = buildMultiTeamMatchResultPayload({
  match: {
    matchId: "final",
    roundNumber: 2,
    matchNumber: 1,
    nextMatchId: null,
    qualifiersCount: 2,
    participantEntryIds: finalIds,
  },
  validated: finalValidated.values,
});
assert.equal("qualifierEntryIds" in finalPayload, false);

/** @type {Map<string, object>} */
const resultsMap = new Map();
for (const sf of built.bracket.matches.filter((m) => m.roundNumber === 1)) {
  const ids = sf.participantEntryIds;
  resultsMap.set(sf.matchId, {
    matchFormat: MatchFormat.MULTI_TEAM_TOTAL,
    status: MatchResultStatus.FINISHED,
    resolution: "played",
    rankingEntryIds: ids,
    qualifierEntryIds: ids.slice(0, 2),
    participantEntryIds: ids,
  });
}

const ranking = built.bracket.matches
  .filter((m) => m.roundNumber === 1)
  .flatMap((m) => m.participantEntryIds.slice(0, 2));
resultsMap.set(finalMatch.matchId, {
  matchFormat: MatchFormat.MULTI_TEAM_TOTAL,
  status: MatchResultStatus.FINISHED,
  resolution: "played",
  rankingEntryIds: ranking,
  participantEntryIds: ranking,
  totals: Object.fromEntries(ranking.map((id, i) => [id, 100 - i])),
});

const finalize = canFinalizeTournament({
  tournament: { status: "open" },
  bracket: { ...built.bracket, finalized: true },
  resultsMap,
  qualifiers: entries(8),
  advancement: null,
});
assert.equal(finalize.canFinalize, true, finalize.message);

// UI / rules ソース確認
const viewSrc = read("js/ui/components/finals-bracket-view.js");
assert.match(viewSrc, /isMultiTeamFinalMatch/);
assert.match(viewSrc, /getMultiTeamFinalPlacementLabel/);
assert.match(viewSrc, /!isFinal && qCount/);

const dialogSrc = read("js/ui/components/multi-team-match-result-dialog.js");
assert.match(dialogSrc, /isFinalRound/);
assert.match(dialogSrc, /最終順位/);

const rulesSrc = read("firestore.rules");
assert.match(rulesSrc, /!\('qualifierEntryIds' in data\)/);

const resultsSrc = read("js/domain/tournament-results.js");
assert.match(resultsSrc, /resultsByMatchId: resultsMap/);
assert.doesNotMatch(resultsSrc, /resultsMapByMatchId/);

console.log("multi-team-final-round.smoke.mjs: all passed");
