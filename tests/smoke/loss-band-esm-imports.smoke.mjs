/**
 * ブラウザ ESM 相当の named import / export 整合性チェック。
 *
 * Node では firebase CDN URL 付きサービスを評価できないため、
 * ローカル相対パスの import graph を静的解析し、
 * 「存在しない named export を import している」問題を deploy 前に検出する。
 *
 * 起点:
 * - tournament-loss-band.html → tournament-loss-band-page.js
 * - loss-band-service.js → loss-band domain
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** @param {string} body */
function splitImportedNames(body) {
  const names = [];
  for (const part of body.split(",")) {
    const token = part.trim();
    if (!token || token === "default" || token === "type") continue;
    // import { RankingMode as RM } → need RankingMode from module
    if (/\bas\b/i.test(token)) {
      names.push(token.split(/\s+as\s+/i)[0].trim());
      continue;
    }
    names.push(token);
  }
  return names;
}

/** @param {string} source */
function extractNamedImports(source) {
  const text = stripComments(source);
  const out = [];
  const re = /\bimport\s*(?:type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g;
  for (const match of text.matchAll(re)) {
    const specifier = match[2];
    if (
      specifier.startsWith("http://") ||
      specifier.startsWith("https://") ||
      specifier.startsWith("node:")
    ) {
      continue;
    }
    out.push({ names: splitImportedNames(match[1]), specifier });
  }
  return out;
}

/** @param {string} source */
function extractNamedExports(source) {
  const text = stripComments(source);
  const names = new Set();

  for (const match of text.matchAll(
    /\bexport\s+(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/g
  )) {
    names.add(match[1]);
  }
  for (const match of text.matchAll(/\bexport\s+class\s+([A-Za-z_$][\w$]*)/g)) {
    names.add(match[1]);
  }
  for (const match of text.matchAll(
    /\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g
  )) {
    names.add(match[1]);
  }

  // export { a as b } from "mod" → export name is b
  for (const match of text.matchAll(
    /\bexport\s*\{([^}]*)\}\s*from\s*["'][^"']+["']/g
  )) {
    for (const part of match[1].split(",")) {
      const token = part.trim();
      if (!token) continue;
      if (/\bas\b/i.test(token)) {
        names.add(token.split(/\s+as\s+/i)[1].trim());
      } else {
        names.add(token);
      }
    }
  }

  // export { a as b }; (local)
  for (const match of text.matchAll(/\bexport\s*\{([^}]*)\}(?!\s*from)/g)) {
    for (const part of match[1].split(",")) {
      const token = part.trim();
      if (!token) continue;
      if (/\bas\b/i.test(token)) {
        names.add(token.split(/\s+as\s+/i)[1].trim());
      } else {
        names.add(token);
      }
    }
  }

  return names;
}

function resolveSpecifier(fromFile, specifier) {
  const baseDir = dirname(fromFile);
  let resolved = normalize(join(baseDir, specifier));
  if (!resolved.endsWith(".js") && !resolved.endsWith(".mjs")) {
    if (existsSync(`${resolved}.js`)) resolved = `${resolved}.js`;
  }
  return resolved;
}

function rel(absPath) {
  return absPath.replace(/\\/g, "/").replace(/^.*\/SMATournament\//, "");
}

/** @param {string[]} entryRelativePaths */
function assertImportGraph(entryRelativePaths) {
  /** @type {Map<string, Set<string>>} */
  const exportCache = new Map();
  const queue = entryRelativePaths.map((p) => join(root, p));
  const seen = new Set();
  /** @type {string[]} */
  const failures = [];

  while (queue.length > 0) {
    const filePath = queue.shift();
    if (!filePath || seen.has(filePath)) continue;
    seen.add(filePath);
    if (!existsSync(filePath)) {
      failures.push(`missing file: ${filePath}`);
      continue;
    }
    const source = readFileSync(filePath, "utf8");
    if (!exportCache.has(filePath)) {
      exportCache.set(filePath, extractNamedExports(source));
    }

    for (const { names, specifier } of extractNamedImports(source)) {
      const target = resolveSpecifier(filePath, specifier);
      if (!existsSync(target)) {
        failures.push(`${rel(filePath)} imports missing module ${specifier}`);
        continue;
      }
      if (!exportCache.has(target)) {
        exportCache.set(
          target,
          extractNamedExports(readFileSync(target, "utf8"))
        );
      }
      const exports = exportCache.get(target);
      for (const name of names) {
        if (!exports.has(name)) {
          failures.push(
            `${rel(filePath)} imports '{ ${name} }' from '${specifier}' but ${rel(target)} does not export '${name}'`
          );
        }
      }
      if (!seen.has(target)) queue.push(target);
    }
  }

  return { seen, failures };
}

// ── 回帰: 今回のバグ再現ガード ──
{
  const configExports = extractNamedExports(
    readFileSync(join(root, "js/domain/loss-band/config.js"), "utf8")
  );
  assert.equal(
    configExports.has("RankingMode"),
    false,
    "config.js must not export RankingMode (definition stays in constants.js)"
  );
  const constantsExports = extractNamedExports(
    readFileSync(join(root, "js/domain/loss-band/constants.js"), "utf8")
  );
  assert.equal(
    constantsExports.has("RankingMode"),
    true,
    "constants.js must export RankingMode"
  );
}

const opsGraph = assertImportGraph([
  "js/ui/pages/tournament-loss-band-page.js",
  "js/services/loss-band-service.js",
]);
assert.equal(
  opsGraph.failures.length,
  0,
  `loss-band ops ESM graph failures:\n${opsGraph.failures.join("\n")}`
);
assert.ok(
  [...opsGraph.seen].some((p) =>
    p.replace(/\\/g, "/").endsWith("loss-band-service.js")
  )
);
assert.ok(
  [...opsGraph.seen].some((p) =>
    p.replace(/\\/g, "/").endsWith("domain/loss-band/constants.js")
  )
);

const relatedGraph = assertImportGraph([
  "js/services/public-tournament-snapshot-service.js",
  "js/ui/pages/tournament-results-page.js",
  "js/ui/loss-band-ranking-form.js",
  "js/ui/bracket-match-config-form.js",
]);
assert.equal(
  relatedGraph.failures.length,
  0,
  `related loss-band ESM graph failures:\n${relatedGraph.failures.join("\n")}`
);

const html = readFileSync(join(root, "tournament-loss-band.html"), "utf8");
assert.match(
  html,
  /type=["']module["'][^>]*src=["'][^"']*tournament-loss-band-page\.js/
);

const barrel = await import(
  pathToFileURL(join(root, "js/domain/loss-band/index.js")).href
);
assert.equal(typeof barrel.RankingMode?.LOSS_BAND, "string");
assert.equal(typeof barrel.resolveMainRankingMode, "function");

console.log("loss-band-esm-imports.smoke.mjs: all passed");
console.log(
  `ops graph modules: ${opsGraph.seen.size}; related: ${relatedGraph.seen.size}`
);
