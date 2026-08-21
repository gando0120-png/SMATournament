/**
 * エントリー完了案内の smoke（HTML 静的構造 + domain view）
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildEntryCompletionGuidanceView,
  ENTRY_COMPLETION_DEFAULT_LINK_LABEL,
} from "../../js/domain/entry-completion-guidance.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

const entryHtml = readFileSync(join(root, "entry.html"), "utf8");
assert.ok(entryHtml.includes('id="entryCompletionGuidance"'));
assert.ok(entryHtml.includes('id="entryCompletionGuidanceMessage"'));
assert.ok(entryHtml.includes('id="entryCompletionGuidanceUrlText"'));
assert.ok(entryHtml.includes('id="entryCompletionGuidanceLink"'));
assert.ok(entryHtml.includes('rel="noopener noreferrer"'));
assert.ok(entryHtml.includes("エントリーを受け付けました"));

const dashboardHtml = readFileSync(join(root, "tournament-dashboard.html"), "utf8");
assert.ok(dashboardHtml.includes('id="editEntryCompletionGuidanceBtn"'));
assert.ok(dashboardHtml.includes("エントリー後の案内を編集"));

const guidanceEditHtml = readFileSync(
  join(root, "tournament-entry-completion-guidance.html"),
  "utf8"
);
assert.ok(guidanceEditHtml.includes('id="entryCompletionMessage"'));
assert.ok(guidanceEditHtml.includes('id="entryCompletionLinkUrl"'));
assert.ok(guidanceEditHtml.includes('id="entryCompletionLinkLabel"'));
assert.ok(
  guidanceEditHtml.includes("js/ui/pages/tournament-entry-completion-guidance-page.js")
);

const newHtml = readFileSync(join(root, "tournament-new.html"), "utf8");
const editHtml = readFileSync(join(root, "tournament-edit-v2.html"), "utf8");
for (const html of [newHtml, editHtml]) {
  assert.ok(html.includes('id="entryCompletionMessage"'));
  assert.ok(html.includes('id="entryCompletionLinkUrl"'));
  assert.ok(html.includes('id="entryCompletionLinkLabel"'));
}

// XSS: view は生HTMLを解釈せず文字列のまま返す（UIは textContent で描画）
{
  const evil = '<img src=x onerror="alert(1)">\n<script>alert(2)</script>';
  const view = buildEntryCompletionGuidanceView({
    entryCompletionMessage: evil,
    entryCompletionLinkUrl: "javascript:alert(3)",
    entryCompletionLinkLabel: "<b>click</b>",
  });
  assert.equal(view.visible, true);
  assert.equal(view.message, evil);
  assert.equal(view.linkUrl, null);
  assert.equal(view.linkLabel, null);
}

{
  const view = buildEntryCompletionGuidanceView({
    entryCompletionLinkUrl: "https://example.com/x",
    entryCompletionLinkLabel: "",
  });
  assert.equal(view.linkLabel, ENTRY_COMPLETION_DEFAULT_LINK_LABEL);
  assert.equal(view.linkUrl, "https://example.com/x");
}

{
  const css = readFileSync(join(root, "css/components.css"), "utf8");
  assert.ok(css.includes(".entry-completion-guidance__url"));
  assert.ok(css.includes("overflow-wrap: anywhere"));
}

console.log("entry-completion-guidance.smoke.mjs: ok");
