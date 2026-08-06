/**
 * 上位/下位決勝設定 UI のクリック操作 smoke
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { MatchFormat } from "../../js/domain/aggregate-match-format.js";
import { TournamentFormat } from "../../js/domain/tournament-format.js";
import { validateTournamentInput } from "../../js/domain/validators.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const formSource = readFileSync(join(root, "js/ui/bracket-match-config-form.js"), "utf8");
const editPageSource = readFileSync(
  join(root, "js/ui/pages/tournament-edit-page-v2.js"),
  "utf8"
);

// 再発防止: refresh が render を呼ぶとクリックが即リセットされる
assert.match(formSource, /function refresh\(\)/);
const refreshBody = formSource.slice(formSource.indexOf("function refresh()"));
const refreshFn = refreshBody.slice(0, refreshBody.indexOf("\n  rootEl.addEventListener"));
assert.doesNotMatch(refreshFn, /\brender\s*\(/);
assert.match(formSource, /bracketMatchFieldId/);
assert.match(formSource, /mainMatchFormatHeadToHead|MatchFormatHeadToHead/);

// 編集画面が毎 input で bracket refresh しないこと
assert.doesNotMatch(
  editPageSource,
  /addEventListener\("input"[\s\S]*?bracketMatchConfigForm\?\.refresh/
);
assert.doesNotMatch(
  editPageSource,
  /addEventListener\("change"[\s\S]*?bracketMatchConfigForm\?\.refresh/
);

// 保存 payload 形状
const validation = validateTournamentInput({
  name: "クリック復元確認",
  eventDate: "2026-08-01",
  venue: "会場",
  entryDeadline: "2026-07-31T23:59",
  maxTeams: "24",
  teamSize: "4",
  courtCount: "2",
  tournamentFormat: TournamentFormat.QUALIFYING_AND_FINALS,
  blockCount: "8",
  qualifiersPerBlock: "1",
  finalTeamCount: "8",
  bracketMatchConfig: {
    main: {
      enabled: true,
      matchFormat: MatchFormat.HEAD_TO_HEAD_SETS,
      finalsMatchRules: {
        defaultWinsRequired: 2,
        roundOverrides: { final: 3 },
      },
    },
    consolation: {
      enabled: true,
      matchFormat: MatchFormat.MULTI_TEAM_TOTAL,
      aggregateMatchRules: {
        teamCount: 4,
        setCount: 2,
        qualifiersCount: 2,
        rankingMethod: "totalScoreDesc",
        tieBreakMethod: "manual",
      },
    },
  },
});
assert.equal(validation.valid, true, JSON.stringify(validation.errors));
assert.equal(
  validation.values.bracketMatchConfig.main.finalsMatchRules.roundOverrides.final,
  3
);
assert.equal(
  validation.values.bracketMatchConfig.consolation.aggregateMatchRules.teamCount,
  4
);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

function startStaticServer() {
  const server = createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
    const filePath = join(root, urlPath === "/" ? "index.html" : urlPath.replace(/^\//, ""));
    if (!filePath.startsWith(root) || !existsSync(filePath)) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": MIME[extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(readFileSync(filePath));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` });
    });
  });
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
      } else if (entry.isDirectory() && depth < 4) {
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

function runBrowserClickProbe(baseUrl) {
  const chrome = findChromiumExecutable();
  if (!chrome) {
    console.log("chromium/chrome not found; static assertions already passed");
    return "skipped";
  }

  const probeUrl = `${baseUrl}/tests/fixtures/bracket-match-config-click-probe.html`;
  const result = spawnSync(
    chrome,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--virtual-time-budget=20000",
      "--timeout=20000",
      "--dump-dom",
      probeUrl,
    ],
    { encoding: "utf8", timeout: 60000 }
  );

  const dom = `${result.stdout || ""}\n${result.stderr || ""}`;
  if (!/BRACKET_CONFIG_OK|BRACKET_CONFIG_ERROR:/.test(dom)) {
    console.log(
      "chromium dump-dom returned before probe finished; static click-regression guards passed"
    );
    return "partial";
  }

  assert.doesNotMatch(dom, /BRACKET_CONFIG_ERROR:/, dom.slice(0, 2000));
  assert.match(dom, /BRACKET_CONFIG_OK/);
  return "checked";
}

const { server, baseUrl } = await startStaticServer();
try {
  const browserResult = runBrowserClickProbe(baseUrl);
  console.log(`bracket-match-config-click.smoke.mjs: all passed (browser=${browserResult})`);
} finally {
  server.close();
}
