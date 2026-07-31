/**
 * Chromium CDP で本番 edit-v2 ページを開き、
 * setFinalsWinsRequiredFieldsLocked の SyntaxError がないことと build ログを確認する。
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const base = (process.env.SMA_PRODUCTION_BASE || "https://smatournament-ce785.web.app").replace(
  /\/$/,
  ""
);
const pageUrl = `${base}/tournament-edit-v2.html?id=smoke-nonexistent`;

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

async function waitForJson(url, attempts = 50) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url);
      if (res.ok) return res.json();
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`CDP not ready: ${url}`);
}

function cdpCall(ws, id, method, params = {}) {
  return new Promise((resolve, reject) => {
    const onMessage = (event) => {
      let data;
      try {
        data = JSON.parse(typeof event === "string" ? event : event.data);
      } catch {
        return;
      }
      if (data.id === id) {
        ws.removeEventListener("message", onMessage);
        if (data.error) reject(new Error(JSON.stringify(data.error)));
        else resolve(data.result);
      }
    };
    ws.addEventListener("message", onMessage);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

const chromium = findChromiumExecutable();
if (!chromium) {
  console.error("Chromium not found");
  process.exit(1);
}
if (typeof WebSocket === "undefined") {
  console.error("WebSocket global not available");
  process.exit(1);
}

const port = 9222 + Math.floor(Math.random() * 200);
const profile = join(process.env.TEMP || "/tmp", `sma-cdp-${port}`);
mkdirSync(profile, { recursive: true });

const child = spawn(
  chromium,
  [
    `--remote-debugging-port=${port}`,
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { stdio: ["ignore", "pipe", "pipe"] }
);

const consoleMessages = [];
const networkRequests = [];
let exitCode = 1;

try {
  await waitForJson(`http://127.0.0.1:${port}/json/version`);
  const list = await waitForJson(`http://127.0.0.1:${port}/json/list`);
  const page = list.find((t) => t.type === "page") || list[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl);

  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", reject);
  });

  ws.addEventListener("message", (event) => {
    const data = JSON.parse(typeof event === "string" ? event : event.data);
    if (data.method === "Runtime.exceptionThrown") {
      const desc =
        data.params?.exceptionDetails?.exception?.description ||
        data.params?.exceptionDetails?.text ||
        "";
      consoleMessages.push(`EXCEPTION:${desc}`);
    }
    if (data.method === "Runtime.consoleAPICalled") {
      const text = (data.params?.args || [])
        .map((a) => a.value ?? a.description ?? "")
        .join(" ");
      consoleMessages.push(`CONSOLE:${data.params?.type}:${text}`);
    }
    if (data.method === "Network.requestWillBeSent") {
      const url = data.params?.request?.url || "";
      if (/tournament-edit|tournament-form/.test(url)) {
        networkRequests.push({
          url,
          initiator: data.params?.initiator?.type || "",
        });
      }
    }
    if (data.method === "Network.responseReceived") {
      const url = data.params?.response?.url || "";
      if (/tournament-edit|tournament-form/.test(url)) {
        networkRequests.push({
          url,
          status: data.params?.response?.status,
          fromDiskCache: data.params?.response?.fromDiskCache,
          fromPrefetchCache: data.params?.response?.fromPrefetchCache,
          cacheControl: data.params?.response?.headers?.["cache-control"]
            || data.params?.response?.headers?.["Cache-Control"],
        });
      }
    }
  });

  await cdpCall(ws, 1, "Runtime.enable");
  await cdpCall(ws, 2, "Page.enable");
  await cdpCall(ws, 3, "Network.enable");
  await cdpCall(ws, 4, "Page.navigate", { url: pageUrl });
  await new Promise((r) => setTimeout(r, 7000));

  const evalResult = await cdpCall(ws, 5, "Runtime.evaluate", {
    expression: `(async () => ({
      href: location.href,
      appBuild: document.querySelector('meta[name="app-build"]')?.content || null,
      requestedEditPage: performance.getEntriesByType('resource')
        .map(r => r.name)
        .filter(n => /tournament-edit-page/.test(n)),
      requestedForm: performance.getEntriesByType('resource')
        .map(r => r.name)
        .filter(n => /tournament-form/.test(n)),
      sw: typeof navigator.serviceWorker !== 'undefined'
        ? (await navigator.serviceWorker.getRegistrations()).map(x => x.scope)
        : [],
    }))()`,
    awaitPromise: true,
    returnByValue: true,
  });

  const pageState = evalResult?.result?.value;
  const joined = consoleMessages.join("\n");
  console.log("page state:", JSON.stringify(pageState, null, 2));
  console.log("network (filtered):", JSON.stringify(networkRequests, null, 2));
  console.log("console/exceptions:", joined || "(none)");

  const hasExportError =
    /does not provide an export named\s*['"]setFinalsWinsRequiredFieldsLocked['"]/i.test(
      joined
    );
  const hasBuild = /\[tournament-edit\] build 20260731d/.test(joined);
  const badLegacyEntry = (pageState?.requestedEditPage || []).some((u) =>
    /tournament-edit-page\.js(\?|$)/.test(u) && !/tournament-edit-page-v2\.js/.test(u)
  );
  const badLegacyForm = (pageState?.requestedForm || []).some((u) =>
    /tournament-form\.js(\?|$)/.test(u) && !/tournament-form-v2\.js/.test(u)
  );

  if (hasExportError) {
    console.error("FAIL: export SyntaxError still present");
    exitCode = 1;
  } else if (!hasBuild) {
    console.error("FAIL: missing build console info");
    exitCode = 1;
  } else if (badLegacyEntry || badLegacyForm) {
    console.error("FAIL: legacy module URL requested");
    exitCode = 1;
  } else {
    console.log("PASS: v2 chain loaded without export SyntaxError");
    console.log("serviceWorker registrations:", pageState?.sw?.length ? pageState.sw : "(none)");
    exitCode = 0;
  }

  ws.close();
} catch (error) {
  console.error("FAIL:", error);
  exitCode = 1;
} finally {
  child.kill();
  process.exit(exitCode);
}
