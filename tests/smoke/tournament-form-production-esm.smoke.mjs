/**
 * デプロイ後の本番 URL をたどり、編集ページ v2 ESM チェーンを検証する。
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
  return {
    url: res.url,
    text: await res.text(),
    cc: res.headers.get("cache-control"),
    status: res.status,
  };
}

function extractEntryScriptSrc(html) {
  const match = html.match(
    /<script[^>]*type=["']module["'][^>]*src=["']([^"']*tournament-edit-page-v2\.js[^"']*)["']/i
  );
  assert.ok(match, "tournament-edit-v2.html must include module script for edit-page-v2");
  return match[1];
}

function resolveUrl(fromUrl, specifier) {
  return new URL(specifier, fromUrl).href;
}

function extractFormImportSpecifier(editSource) {
  const match = editSource.match(
    /from\s*["']([^"']*tournament-form-v2\.js(?:\?[^"']*)?)["']/
  );
  assert.ok(match, "edit-page-v2 must import tournament-form-v2.js");
  return match[1];
}

const html = await fetchText(`${base}/tournament-edit-v2.html`);
assert.match(html.text, /name=["']app-build["']\s+content=["']20260731f["']/);
assert.doesNotMatch(html.text, /tournament-edit-page\.js(?!-v2)/);

const entrySrc = extractEntryScriptSrc(html.text);
const entryUrl = resolveUrl(html.url, entrySrc);
console.log("document URL:", html.url);
console.log("entry script URL:", entryUrl);
console.log("document Cache-Control:", html.cc);

const editPage = await fetchText(entryUrl);
assert.match(editPage.text, /\[tournament-edit\] build 20260731f/);
assert.doesNotMatch(editPage.text, /from\s*["']\.\.\/tournament-form\.js["']/);

const formSpecifier = extractFormImportSpecifier(editPage.text);
const formUrl = resolveUrl(entryUrl, formSpecifier);
console.log("static import specifier:", formSpecifier);
console.log("resolved form module URL:", formUrl);
console.log("entry Cache-Control:", editPage.cc);

assert.match(formUrl, /tournament-form-v2\.js/);
assert.doesNotMatch(formUrl, /tournament-form\.js$/);

const formModule = await fetchText(formUrl);
assert.match(
  formModule.text,
  /export\s+function\s+setFinalsWinsRequiredFieldsLocked/,
  `production form module missing export: ${formUrl}`
);
console.log("form Cache-Control:", formModule.cc);

// 旧 HTML は新 URL へ誘導
const legacy = await fetchText(`${base}/tournament-edit.html`);
assert.match(legacy.text, /tournament-edit-v2\.html/);

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
  const probeUrl = `${base}/tournament-edit-v2.html?id=smoke-probe-nonexistent`;
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
    /does not provide an export named\s*['"]setFinalsWinsRequiredFieldsLocked['"]/i
  );
  browserResult = result.status === 0 ? "ok" : `exit=${result.status}`;
}

console.log("tournament-form-production-esm.smoke.mjs: all passed");
console.log("form module has export: true");
console.log("browser:", browserResult);
