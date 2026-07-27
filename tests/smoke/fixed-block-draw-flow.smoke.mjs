/**
 * 新形式ブロック抽選 smoke テスト
 */
import assert from "node:assert/strict";
import { distributeEntriesToBlocks } from "../../js/domain/block-draw.js";
import {
  distributeEntriesToFixedBlocks,
  validateGeneratedBlockDraw,
} from "../../js/domain/fixed-block-draw.js";
import { buildQualifyingScheduleFromBlockDraw } from "../../js/domain/qualifying-schedule.js";
import { validateBlockConfiguration } from "../../js/domain/block-configuration.js";
import { usesNewFixedBlockDraw } from "../../js/domain/tournament-format.js";
import { TournamentFormat } from "../../js/domain/tournament-format.js";

const entries = Array.from({ length: 59 }, (_, index) => ({
  id: `e-${index + 1}`,
  teamName: `Team ${index + 1}`,
}));

const newTournament = {
  tournamentFormat: TournamentFormat.QUALIFYING_AND_FINALS,
  blockCount: 16,
  qualifiersPerBlock: 1,
};

const legacyTournament = {
  preferredBlockSize: 4,
};

assert.equal(usesNewFixedBlockDraw(newTournament), true);
assert.equal(usesNewFixedBlockDraw(legacyTournament), false);
assert.equal(usesNewFixedBlockDraw({ tournamentFormat: TournamentFormat.SINGLE_ELIMINATION }), false);

const config = validateBlockConfiguration({
  teamCount: entries.length,
  blockCount: newTournament.blockCount,
  qualifiersPerBlock: newTournament.qualifiersPerBlock,
});
assert.equal(config.valid, true);

const newDraw = distributeEntriesToFixedBlocks({
  entries,
  blockCount: newTournament.blockCount,
  random: () => 0.42,
});
assert.equal(
  validateGeneratedBlockDraw({
    entries,
    blocks: newDraw.blocks,
    blockCount: newTournament.blockCount,
    distribution: newDraw.distribution,
  }).valid,
  true
);

const schedule = buildQualifyingScheduleFromBlockDraw(newDraw, entries);
assert.equal(schedule.hasUnsupportedBlock, false);
assert.equal(schedule.blocks.length, 16);

const legacyDraw = distributeEntriesToBlocks(entries, legacyTournament.preferredBlockSize);
assert.equal(legacyDraw.preferredBlockSize, 4);
assert.equal(legacyDraw.blockCount, 15);
assert.equal(legacyDraw.blocks.length, 15);

const legacySchedule = buildQualifyingScheduleFromBlockDraw(legacyDraw, entries);
assert.equal(legacySchedule.blocks.length, 15);

console.log("fixed-block-draw-flow.smoke.mjs: all passed");
