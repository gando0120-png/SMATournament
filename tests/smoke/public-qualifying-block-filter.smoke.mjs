/**
 * 公開予選ブロック選択スモーク（純関数）
 */
import assert from "node:assert/strict";
import {
  collectQualifyingBlockOptions,
  filterQualifyingSectionByBlockId,
  findStandingRowByEntryId,
  buildPublicTeamRecordCard,
  resolveStandingSetLosses,
  resolveInitialQualifyingBlockId,
  shouldRenderQualifyingBlockUi,
  shouldShowQualifyingBlockSelect,
} from "../../js/domain/public-qualifying-block-filter.js";

const qualifying = {
  visible: true,
  standings: {
    ready: true,
    blocks: [
      { blockId: "A", blockName: "Aブロック", rows: [{ entryId: "a1" }] },
      { blockId: "B", blockName: "Bブロック", rows: [{ entryId: "b1" }] },
    ],
  },
  schedule: {
    ready: true,
    blocks: [
      { blockId: "A", blockName: "Aブロック", rounds: [{ matches: [{ id: "mA" }] }] },
      { blockId: "B", blockName: "Bブロック", rounds: [{ matches: [{ id: "mB" }] }] },
    ],
  },
};

const options = collectQualifyingBlockOptions(qualifying);
assert.equal(shouldShowQualifyingBlockSelect(options), true);
assert.equal(resolveInitialQualifyingBlockId(options), "A");

const standingsB = filterQualifyingSectionByBlockId(qualifying.standings, "B");
const scheduleB = filterQualifyingSectionByBlockId(qualifying.schedule, "B");
assert.equal(standingsB.blocks.length, 1);
assert.equal(standingsB.blocks[0].blockId, "B");
assert.equal(scheduleB.blocks.length, 1);
assert.equal(scheduleB.blocks[0].rounds[0].matches[0].id, "mB");

assert.equal(shouldRenderQualifyingBlockUi({ visible: false }), false);
assert.equal(
  shouldShowQualifyingBlockSelect([{ blockId: "A", blockName: "A" }]),
  false
);

assert.equal(resolveStandingSetLosses({ setWins: 2, setDraws: 1, playedMatches: 5 }), 2);
const row = findStandingRowByEntryId(qualifying.standings, "b1");
assert.equal(row?.blockId, "B");
assert.equal(buildPublicTeamRecordCard({ ...row, setWins: 1, setDraws: 0, setLosses: 2, totalScore: 90, rank: 3 })?.setLosses, 2);

console.log("public-qualifying-block-filter.smoke.mjs: ok");
