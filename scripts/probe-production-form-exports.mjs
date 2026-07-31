import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

async function getRemote(url) {
  const res = await fetch(url, {
    cache: "no-store",
    headers: { pragma: "no-cache", "cache-control": "no-cache" },
  });
  const buf = Buffer.from(await res.arrayBuffer());
  return {
    status: res.status,
    cc: res.headers.get("cache-control"),
    etag: res.headers.get("etag"),
    len: buf.length,
    sha: crypto.createHash("sha256").update(buf).digest("hex"),
    text: buf.toString("utf8"),
  };
}

function getLocal(rel) {
  const buf = fs.readFileSync(path.join(root, rel));
  return {
    len: buf.length,
    sha: crypto.createHash("sha256").update(buf).digest("hex"),
    text: buf.toString("utf8"),
  };
}

const targets = [
  {
    key: "form",
    url: "https://smatournament-ce785.web.app/js/ui/tournament-form.js",
    local: "js/ui/tournament-form.js",
  },
  {
    key: "edit",
    url: "https://smatournament-ce785.web.app/js/ui/pages/tournament-edit-page.js",
    local: "js/ui/pages/tournament-edit-page.js",
  },
  {
    key: "html",
    url: "https://smatournament-ce785.web.app/tournament-edit.html",
    local: "tournament-edit.html",
  },
];

for (const t of targets) {
  const remote = await getRemote(t.url);
  const local = getLocal(t.local);
  const exports = [...remote.text.matchAll(/^export function (\w+)/gm)].map((m) => m[1]);
  const formImports = [...remote.text.matchAll(/from\s*["']([^"']*tournament-form[^"']*)["']/g)].map(
    (m) => m[1]
  );
  const scriptSrc = remote.text.match(/tournament-edit-page\.js[^"']*/)?.[0] ?? null;

  console.log(`=== ${t.key} ===`);
  console.log("url", t.url);
  console.log("status", remote.status, "cc", remote.cc, "etag", remote.etag);
  console.log("remote sha", remote.sha, "len", remote.len);
  console.log("local  sha", local.sha, "len", local.len);
  console.log("sha match", remote.sha === local.sha);
  console.log(
    "remote has export setFinalsWinsRequiredFieldsLocked",
    /export\s+function\s+setFinalsWinsRequiredFieldsLocked/.test(remote.text)
  );
  console.log(
    "remote mentions setFinalsWinsRequiredFieldsLocked",
    remote.text.includes("setFinalsWinsRequiredFieldsLocked")
  );
  if (t.key === "form") console.log("remote exports:", exports.join(", "));
  if (t.key === "edit") console.log("form imports:", formImports.join(", ") || "(none)");
  if (t.key === "html") console.log("entry script:", scriptSrc);
  console.log("");
}
