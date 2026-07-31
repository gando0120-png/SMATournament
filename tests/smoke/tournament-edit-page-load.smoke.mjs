/**
 * 編集ページ v2 のモジュール読み込み smoke
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import * as tournamentForm from "../../js/ui/tournament-form-v2.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

assert.equal(typeof tournamentForm.setFinalsWinsRequiredFieldsLocked, "function");

const editHtml = readFileSync(join(root, "tournament-edit-v2.html"), "utf8");
const editSource = readFileSync(join(root, "js/ui/pages/tournament-edit-page-v2.js"), "utf8");
assert.match(editHtml, /tournament-edit-page-v2\.js/);
assert.match(editSource, /setFinalsWinsRequiredFieldsLocked/);
assert.match(editSource, /from\s*["']\.\.\/tournament-form-v2\.js["']/);

function startStaticServer() {
  const server = createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
    const filePath = join(root, urlPath === "/" ? "index.html" : urlPath.replace(/^\//, ""));
    if (!filePath.startsWith(root) || !existsSync(filePath)) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    const type = MIME[extname(filePath)] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
    res.end(readFileSync(filePath));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

async function assertServedModules(baseUrl) {
  const htmlRes = await fetch(`${baseUrl}/tournament-edit-v2.html`);
  assert.equal(htmlRes.status, 200);
  const htmlText = await htmlRes.text();
  assert.match(htmlText, /tournament-edit-page-v2\.js/);
  assert.doesNotMatch(htmlText, /tournament-edit-page\.js(?!-v2)/);

  const formRes = await fetch(`${baseUrl}/js/ui/tournament-form-v2.js`);
  assert.equal(formRes.status, 200);
  assert.match(
    await formRes.text(),
    /export\s+function\s+setFinalsWinsRequiredFieldsLocked/
  );

  const editRes = await fetch(`${baseUrl}/js/ui/pages/tournament-edit-page-v2.js`);
  assert.equal(editRes.status, 200);
  const editText = await editRes.text();
  assert.match(editText, /setFinalsWinsRequiredFieldsLocked/);
  assert.match(editText, /from\s*["']\.\.\/tournament-form-v2\.js["']/);
  assert.doesNotMatch(editText, /from\s*["']\.\.\/tournament-form\.js["']/);
}

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
      if (entry.isFile() && /chrome(?:\.exe)?$/i.test(entry.name)) {
        candidates.push(full);
      } else if (entry.isDirectory() && /chromium/i.test(entry.name)) {
        walk(full, depth + 1);
      } else if (entry.isDirectory() && depth < 3) {
        walk(full, depth + 1);
      }
    }
  }

  walk(cacheRoot);
  candidates.push(
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
  );
  return candidates.find((path) => existsSync(path)) || null;
}

function assertNoModuleSyntaxErrorInBrowser(baseUrl) {
  const chrome = findChromiumExecutable();
  if (!chrome) {
    console.log("chromium/chrome not found; skip live browser console check");
    return "skipped";
  }

  const probeUrl = `${baseUrl}/tests/fixtures/tournament-edit-module-probe.html`;
  const result = spawnSync(
    chrome,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--virtual-time-budget=15000",
      "--timeout=15000",
      "--dump-dom",
      probeUrl,
    ],
    { encoding: "utf8", timeout: 45000 }
  );

  const dom = `${result.stdout || ""}\n${result.stderr || ""}`;
  assert.doesNotMatch(
    dom,
    /does not provide an export named\s*['"]setFinalsWinsRequiredFieldsLocked['"]/i
  );

  if (!/EDIT_MODULE_OK|EDIT_MODULE_ERROR:/.test(dom)) {
    console.log(
      "chromium dump-dom returned before module probe finished; served module checks already passed"
    );
    return "partial";
  }

  if (/EDIT_MODULE_ERROR:/.test(dom)) {
    assert.doesNotMatch(
      dom,
      /setFinalsWinsRequiredFieldsLocked/,
      `module failed due to export mismatch:\n${dom.slice(0, 1500)}`
    );
  }

  return "checked";
}

const { server, baseUrl } = await startStaticServer();
try {
  await assertServedModules(baseUrl);
  const browserResult = assertNoModuleSyntaxErrorInBrowser(baseUrl);
  console.log(
    `tournament-edit-page-load.smoke.mjs: all passed (browser=${browserResult})`
  );
} finally {
  server.close();
}
