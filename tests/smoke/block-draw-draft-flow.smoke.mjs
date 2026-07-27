/**
 * blockDraw draft フロー smoke テスト
 */
import assert from "node:assert/strict";
import {
  distributeEntriesToFixedBlocks,
  validateGeneratedBlockDraw,
} from "../../js/domain/fixed-block-draw.js";
import {
  validateEditableBlockDraw,
  moveEntryBetweenBlocks,
  swapEntriesBetweenBlocks,
  detectConfirmedEntryMismatch,
  recalculateDistributionFromBlocks,
  formatBlockSizeImbalanceConfirmMessage,
} from "../../js/domain/block-draw-edit.js";
import { isBlockDrawDraft, isBlockDrawFinalized } from "../../js/domain/block-draw-state.js";
import { buildQualifyingScheduleFromBlockDraw } from "../../js/domain/qualifying-schedule.js";
import { validateQualifyingScheduleForSave } from "../../js/domain/qualifying-schedule-persist.js";
import { distributeEntriesToBlocks } from "../../js/domain/block-draw.js";
import { BlockDrawStatus } from "../../js/domain/constants.js";
import { usesNewFixedBlockDraw, TournamentFormat } from "../../js/domain/tournament-format.js";

const entries59 = Array.from({ length: 59 }, (_, index) => ({
  id: `e-${index + 1}`,
  teamName: `Team ${index + 1}`,
}));

const newTournament = {
  tournamentFormat: TournamentFormat.QUALIFYING_AND_FINALS,
  blockCount: 16,
  qualifiersPerBlock: 1,
};

const legacyTournament = { preferredBlockSize: 4 };

assert.equal(usesNewFixedBlockDraw(newTournament), true);

const autoDraw = distributeEntriesToFixedBlocks({
  entries: entries59,
  blockCount: 16,
  random: () => 0.42,
});

assert.equal(
  validateGeneratedBlockDraw({
    entries: entries59,
    blocks: autoDraw.blocks,
    blockCount: 16,
    distribution: autoDraw.distribution,
  }).valid,
  true
);

const draftDraw = {
  status: BlockDrawStatus.DRAFT,
  blockCount: autoDraw.blockCount,
  distribution: autoDraw.distribution,
  blocks: autoDraw.blocks,
};

assert.equal(isBlockDrawDraft(draftDraw), true);
assert.equal(isBlockDrawFinalized(draftDraw), false);

const editableValidation = validateEditableBlockDraw({
  confirmedEntryIds: entries59.map((entry) => entry.id),
  blocks: draftDraw.blocks,
  expectedBlockCount: 16,
});
assert.equal(editableValidation.valid, true);

const fourTeamBlock = draftDraw.blocks.find((block) => block.entryIds.length >= 4);
if (fourTeamBlock) {
  const targetBlock = draftDraw.blocks.find((block) => block.id !== fourTeamBlock.id);
  moveEntryBetweenBlocks(
    draftDraw.blocks.map((block) => ({ ...block, entryIds: [...block.entryIds] })),
    fourTeamBlock.id,
    fourTeamBlock.entryIds[0],
    targetBlock.id
  );
}

const imbalanceBlocks = draftDraw.blocks.map((block) => ({ ...block, entryIds: [...block.entryIds] }));
if (imbalanceBlocks[0].entryIds.length > 3 && imbalanceBlocks[1].entryIds.length === 3) {
  imbalanceBlocks[0].entryIds.push(imbalanceBlocks[1].entryIds.pop());
  imbalanceBlocks[0].entryIds.push(imbalanceBlocks[1].entryIds.pop());
}
const imbalanceValidation = validateEditableBlockDraw({
  confirmedEntryIds: entries59.map((entry) => entry.id),
  blocks: imbalanceBlocks,
  expectedBlockCount: 16,
});
if (imbalanceValidation.warnings.some((warning) => warning.code === "BLOCK_SIZE_IMBALANCE")) {
  assert.ok(formatBlockSizeImbalanceConfirmMessage(imbalanceValidation.warnings));
}

const redraw = distributeEntriesToFixedBlocks({
  entries: entries59,
  blockCount: 16,
  random: () => 0.9,
});
assert.equal(isBlockDrawDraft({ ...draftDraw, blocks: redraw.blocks }), true);

const mismatch = detectConfirmedEntryMismatch(
  draftDraw.blocks.flatMap((block) => block.entryIds),
  [...entries59, { id: "e-new", teamName: "Added" }]
);
assert.equal(mismatch.matches, false);

const finalizedDraw = {
  ...draftDraw,
  status: BlockDrawStatus.FINALIZED,
  finalizedAt: new Date(),
  distribution: recalculateDistributionFromBlocks(draftDraw.blocks, draftDraw.distribution),
};
assert.equal(isBlockDrawFinalized(finalizedDraw), true);

const schedule = buildQualifyingScheduleFromBlockDraw(finalizedDraw, entries59);
assert.equal(schedule.hasUnsupportedBlock, false);
const scheduleValidation = validateQualifyingScheduleForSave(schedule, finalizedDraw);
assert.equal(scheduleValidation.valid, true);

const legacyDraw = distributeEntriesToBlocks(entries59, legacyTournament.preferredBlockSize);
const legacyFinalized = {
  preferredBlockSize: legacyDraw.preferredBlockSize,
  blockCount: legacyDraw.blockCount,
  blocks: legacyDraw.blocks,
};
assert.equal(isBlockDrawFinalized(legacyFinalized), true);
assert.equal(isBlockDrawDraft(legacyFinalized), false);

const legacySchedule = buildQualifyingScheduleFromBlockDraw(legacyDraw, entries59);
assert.equal(legacySchedule.blocks.length, legacyDraw.blockCount);

const swapBlocks = swapEntriesBetweenBlocks(
  draftDraw.blocks.map((block) => ({ ...block, entryIds: [...block.entryIds] })),
  draftDraw.blocks[0].id,
  draftDraw.blocks[0].entryIds[0],
  draftDraw.blocks[1].id,
  draftDraw.blocks[1].entryIds[0]
);
assert.notEqual(
  swapBlocks.find((block) => block.id === draftDraw.blocks[0].id).entryIds[0],
  draftDraw.blocks[0].entryIds[0]
);

console.log("block-draw-draft-flow.smoke.mjs: all passed");
