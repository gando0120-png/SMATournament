/**
 * デプロイ後の本番 URL をたどり、編集ページ ESM の named export 整合を検証する。
 *
 * 環境変数:
 * - SMA_PRODUCTION_BASE (default: https://smatournament-ce785.web.app)
 * - SMA_SKIP_PRODUCTION_ESM=1 でスキップ
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

if (process.env.SMA_SKIP_PRODUCTION_ESM === "1") {
  console.log("tournament-form-production-esm.smoke.mjs: skipped");
  process.exit(0);
}

const base = (process.env.SMA_PRODUCTION_BASE || "https://smatournament-ce785.web.app").replace(
  /\/$/,
  ""
);

async function fetchText(url) {
  const res = await fetch(url, {
    cache: "no-store",
    headers: { pragma: "no-cache", "cache-control": "no-cache" },
  });
  assert.equal(res.status, 200, `expected 200 for ${url}, got ${res.status}`);
  return { url: res.url, text: await res.text(), cc: res.headers.get("cache-control") };
}

function extractEntryScriptSrc(html) {
  const match = html.match(
    /<script[^>]*type=["']module["'][^>]*src=["']([^"']*tournament-edit-page\.js[^"']*)["']/i
  );
  assert.ok(match, "tournament-edit.html must include module script for edit page");
  return match[1];
}

function resolveUrl(fromUrl, specifier) {
  return new URL(specifier, fromUrl).href;
}

function extractFormImportSpecifier(editSource) {
  const match = editSource.match(
    /from\s*["']([^"']*tournament-form(?:-v2)?\.js(?:\?[^"']*)?)["']/
  );
  assert.ok(match, "edit page must import tournament-form module");
  return match[1];
}

const html = await fetchText(`${base}/tournament-edit.html`);
const entrySrc = extractEntryScriptSrc(html.text);
const entryUrl = resolveUrl(html.url, entrySrc);
console.log("entry script URL:", entryUrl);

const editPage = await fetchText(entryUrl);
const formSpecifier = extractFormImportSpecifier(editPage.text);
const formUrl = resolveUrl(entryUrl, formSpecifier);
console.log("static import specifier:", formSpecifier);
console.log("resolved form module URL:", formUrl);

assert.match(
  formSpecifier,
  /tournament-form-v2\.js/,
  "edit page must import tournament-form-v2.js (not stale tournament-form.js alone)"
);

const formModule = await fetchText(formUrl);
assert.match(
  formModule.text,
  /export\s+function\s+setFinalsWinsRequiredFieldsLocked/,
  `production form module missing export: ${formUrl}`
);
assert.match(editPage.text, /setFinalsWinsRequiredFieldsLocked/);

function findChromiumExecutable() {
  const cacheRoot =
    process.env.PLAYWRIGHT_BROWSERS_PATH ||
    join(process.env.LOCALAPPDATA || "", "Temp", "cursor-sandbox-cache");
  const candidates = [];

  function walk(dir, depth = 0) {
    if (!dir || !existsSync(dir) || depth > 6) return;
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isFile() && /^(chrome|chromium)(-hardy)?\.exe$/i.test(entry.name)) {
        candidates.push(full);
      } else if (entry.isDirectory()) {
        walk(full, depth + 1);
      }
    }
  }
  walk(cacheRoot);
  return candidates[0] || null;
}

let browserResult = "skipped";
const chromium = findChromiumExecutable();
if (chromium) {
  const probeUrl = `${base}/tournament-edit.html?tournamentId=smoke-probe-nonexistent`;
  const result = spawnSync(
    chromium,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--dump-dom",
      "--virtual-time-budget=8000",
      probeUrl,
    ],
    { encoding: "utf8", timeout: 30000, maxBuffer: 10 * 1024 * 1024 }
  );
  const out = `${result.stdout || ""}\n${result.stderr || ""}`;
  assert.doesNotMatch(
    out,
    /does not provide an export named\s*['"]setFinalsWinsRequiredFieldsLocked['"]/i,
    "Chromium must not report missing setFinalsWinsRequiredFieldsLocked export"
  );
  assert.doesNotMatch(
    out,
    /SyntaxError/i,
    "Chromium dump must not include SyntaxError for edit page modules"
  );
  browserResult = result.status === 0 ? "ok" : `exit=${result.status}`;
}

console.log("tournament-form-production-esm.smoke.mjs: all passed");
console.log("form module has export: true");
console.log("browser:", browserResult);
