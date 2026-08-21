/**
 * Phase 2: loss-band ranking correction — functions 側の import / ドメイン連携
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LOSS_BAND_RESULT_EDIT_LOCKED_MESSAGE,
  assessLossBandRankingResultCorrection,
  planCorrectLossBandRankingResult,
} from "../vendor/domain/loss-band/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

{
  const indexJs = readFileSync(resolve(root, "index.js"), "utf8");
  assert.match(indexJs, /correctLossBandRankingResultCallable/);
  assert.match(indexJs, /correctLossBandRankingResult/);

  const impl = readFileSync(
    resolve(root, "src/loss-band-ranking-result-correction.js"),
    "utf8"
  );
  assert.match(impl, /planCorrectLossBandRankingResult/);
  assert.match(impl, /rebuildPublicSnapshotAdmin/);
  assert.match(impl, /expectedRevision/);
  assert.match(impl, /runTransaction/);
}

{
  assert.equal(
    typeof assessLossBandRankingResultCorrection,
    "function"
  );
  assert.equal(typeof planCorrectLossBandRankingResult, "function");
  assert.equal(
    LOSS_BAND_RESULT_EDIT_LOCKED_MESSAGE,
    "次のラウンドが開始されているため修正できません"
  );
}

console.log("loss-band-ranking-result-correction.functions.test.mjs: ok");
