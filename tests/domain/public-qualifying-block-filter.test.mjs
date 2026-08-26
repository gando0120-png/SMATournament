/**
 * 公開ページ予選ブロック選択フィルタのドメインテスト
 */
import assert from "node:assert/strict";
import {
  collectQualifyingBlockOptions,
  filterQualifyingSectionByBlockId,
  findQualifyingBlockIdForEntry,
  resolveInitialQualifyingBlockId,
  shouldShowQualifyingBlockSelect,
  shouldRenderQualifyingBlockUi,
} from "../../js/domain/public-qualifying-block-filter.js";

const fourBlockQualifying = {
  visible: true,
  ready: true,
  blocks: {
    visible: true,
    ready: true,
    blocks: [
      { blockId: "A", blockName: "Aブロック", teams: [{ entryId: "e1" }] },
      { blockId: "B", blockName: "Bブロック", teams: [{ entryId: "e2" }] },
      { blockId: "C", blockName: "Cブロック", teams: [{ entryId: "e3" }] },
      { blockId: "D", blockName: "Dブロック", teams: [{ entryId: "e4" }] },
    ],
  },
  standings: {
    visible: true,
    ready: true,
    label: "暫定順位",
    blocks: [
      {
        blockId: "A",
        blockName: "Aブロック",
        rows: [{ entryId: "e1", teamName: "Team A1", rank: 1 }],
      },
      {
        blockId: "B",
        blockName: "Bブロック",
        rows: [{ entryId: "e2", teamName: "Team B1", rank: 1 }],
      },
      {
        blockId: "C",
        blockName: "Cブロック",
        rows: [{ entryId: "e3", teamName: "Team C1", rank: 1 }],
      },
      {
        blockId: "D",
        blockName: "Dブロック",
        rows: [{ entryId: "e4", teamName: "Team D1", rank: 1 }],
      },
    ],
  },
  schedule: {
    visible: true,
    ready: true,
    blocks: [
      {
        blockId: "A",
        blockName: "Aブロック",
        rounds: [
          {
            roundLabel: "第1節",
            matches: [
              {
                team1: { entryId: "e1", teamName: "Team A1" },
                team2: { entryId: "e1b", teamName: "Team A2" },
                result: { setLines: [], summary: "—" },
                statusLabel: "未開始",
                courtNumber: 1,
              },
            ],
          },
        ],
      },
      {
        blockId: "B",
        blockName: "Bブロック",
        rounds: [
          {
            roundLabel: "第1節",
            matches: [
              {
                team1: { entryId: "e2", teamName: "Team B1" },
                team2: { entryId: "e2b", teamName: "Team B2" },
                result: { setLines: [], summary: "—" },
                statusLabel: "未開始",
                courtNumber: 1,
              },
            ],
          },
        ],
      },
      {
        blockId: "C",
        blockName: "Cブロック",
        rounds: [],
      },
      {
        blockId: "D",
        blockName: "Dブロック",
        rounds: [],
      },
    ],
  },
};

// 1. 複数ブロック → select 候補
{
  const options = collectQualifyingBlockOptions(fourBlockQualifying);
  assert.equal(options.length, 4);
  assert.deepEqual(
    options.map((b) => b.blockId),
    ["A", "B", "C", "D"]
  );
  assert.equal(shouldShowQualifyingBlockSelect(options), true);
  assert.equal(shouldRenderQualifyingBlockUi(fourBlockQualifying), true);
}

// 2. 初期表示は最初のブロック
{
  const options = collectQualifyingBlockOptions(fourBlockQualifying);
  assert.equal(resolveInitialQualifyingBlockId(options), "A");
}

// 3. B 選択 → B の順位表だけ
{
  const filtered = filterQualifyingSectionByBlockId(
    fourBlockQualifying.standings,
    "B"
  );
  assert.equal(filtered.blocks.length, 1);
  assert.equal(filtered.blocks[0].blockId, "B");
  assert.equal(filtered.blocks[0].rows[0].entryId, "e2");
}

// 4. 対戦結果も B だけ
{
  const filtered = filterQualifyingSectionByBlockId(
    fourBlockQualifying.schedule,
    "B"
  );
  assert.equal(filtered.blocks.length, 1);
  assert.equal(filtered.blocks[0].blockId, "B");
  assert.equal(filtered.blocks[0].rounds[0].matches[0].team1.entryId, "e2");
}

// 5. 1 ブロック
{
  const one = {
    visible: true,
    blocks: {
      ready: true,
      blocks: [{ blockId: "A", blockName: "Aブロック", teams: [] }],
    },
  };
  const options = collectQualifyingBlockOptions(one);
  assert.equal(options.length, 1);
  assert.equal(shouldShowQualifyingBlockSelect(options), false);
  assert.equal(resolveInitialQualifyingBlockId(options), "A");
}

// 6. ブロックなし大会
{
  assert.equal(shouldRenderQualifyingBlockUi({ visible: false }), false);
  assert.equal(shouldRenderQualifyingBlockUi(null), false);
  assert.deepEqual(collectQualifyingBlockOptions({ visible: true }), []);
}

// URL / highlight 優先
{
  const options = collectQualifyingBlockOptions(fourBlockQualifying);
  assert.equal(
    resolveInitialQualifyingBlockId(options, { urlBlockId: "C" }),
    "C"
  );
  assert.equal(
    resolveInitialQualifyingBlockId(options, {
      preferredBlockId: "B",
      urlBlockId: "C",
    }),
    "B"
  );
  assert.equal(
    resolveInitialQualifyingBlockId(options, {
      urlBlockId: "Z",
      highlightBlockId: "D",
    }),
    "D"
  );
  assert.equal(findQualifyingBlockIdForEntry(fourBlockQualifying, "e3"), "C");
}

// 旧データ風: standings のみ
{
  const standingsOnly = {
    visible: true,
    standings: {
      ready: true,
      blocks: [
        { blockId: "X", blockName: "X", rows: [] },
        { blockId: "Y", blockName: "Y", rows: [] },
      ],
    },
  };
  assert.deepEqual(
    collectQualifyingBlockOptions(standingsOnly).map((b) => b.blockId),
    ["X", "Y"]
  );
}

console.log("public-qualifying-block-filter.test.mjs: ok");
