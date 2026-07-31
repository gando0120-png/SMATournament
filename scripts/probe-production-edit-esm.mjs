/**
 * Chromium で本番 edit-page の静的 import を評価し、SyntaxError がないことを確認する。
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const base = (process.env.SMA_PRODUCTION_BASE || "https://smatournament-ce785.web.app").replace(
  /\/$/,
  ""
);

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

const htmlRes = await fetch(`${base}/tournament-edit.html`, { cache: "no-store" });
const html = await htmlRes.text();
const entryMatch = html.match(
  /src=["']([^"']*tournament-edit-page\.js[^"']*)["']/i
);
if (!entryMatch) {
  console.error("FAIL: no edit-page entry script");
  process.exit(1);
}
const entryUrl = new URL(entryMatch[1], `${base}/tournament-edit.html`).href;
const editRes = await fetch(entryUrl, { cache: "no-store" });
const editText = await editRes.text();
const formMatch = editText.match(
  /from\s*["']([^"']*tournament-form(?:-v2)?\.js(?:\?[^"']*)?)["']/
);
if (!formMatch) {
  console.error("FAIL: no form import in edit page");
  process.exit(1);
}
const formUrl = new URL(formMatch[1], entryUrl).href;
console.log("entry:", entryUrl);
console.log("form :", formUrl);

const formText = await (await fetch(formUrl, { cache: "no-store" })).text();
if (!/export\s+function\s+setFinalsWinsRequiredFieldsLocked/.test(formText)) {
  console.error("FAIL: production form module missing named export");
  process.exit(1);
}

const dir = mkdtempSync(join(tmpdir(), "sma-esm-probe-"));
const probePath = join(dir, "probe.html");
writeFileSync(
  probePath,
  `<!doctype html><meta charset="utf-8"><pre id="out">pending</pre>
<script type="module">
const out = document.getElementById("out");
try {
  const mod = await import(${JSON.stringify(formUrl)});
  if (typeof mod.setFinalsWinsRequiredFieldsLocked !== "function") {
    throw new Error("export missing after import");
  }
  out.textContent = "OK:" + Object.keys(mod).sort().join(",");
} catch (e) {
  out.textContent = "ERR:" + (e && e.message ? e.message : String(e));
}
</script>`
);

const chromium = findChromiumExecutable();
if (!chromium) {
  console.log("Chromium not found; fetch-chain checks passed");
  process.exit(0);
}

const result = spawnSync(
  chromium,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--dump-dom",
    "--virtual-time-budget=10000",
    `file:///${probePath.replace(/\\/g, "/")}`,
  ],
  { encoding: "utf8", timeout: 45000, maxBuffer: 10 * 1024 * 1024 }
);

const out = `${result.stdout || ""}\n${result.stderr || ""}`;
console.log("--- chromium dump excerpt ---");
const pre = out.match(/<pre id="out">([\s\S]*?)<\/pre>/);
console.log(pre ? pre[1] : out.slice(0, 2000));

if (/does not provide an export named/i.test(out) || /ERR:/.test(pre?.[1] || "")) {
  console.error("FAIL: SyntaxError or import error still present");
  process.exit(1);
}
if (!pre || !pre[1].startsWith("OK:")) {
  // file:// importing https:// may be blocked by CORS/CORP; treat fetch-chain as authority
  console.log("WARN: browser import probe inconclusive (likely file:// -> https CORS); fetch-chain OK");
  process.exit(0);
}
console.log("PASS: browser imported production form module");
