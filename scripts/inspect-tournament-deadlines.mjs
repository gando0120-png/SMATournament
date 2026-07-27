/**
 * 本番 tournaments の status / entryDeadline を確認（要 firebase login）
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ID = "smatournament-ce785";

async function getAccessToken() {
  const { GoogleAuth } = await import("google-auth-library");
  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/datastore"],
  });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  if (!token.token) {
    throw new Error("Could not obtain access token. Run: npx firebase login");
  }
  return token.token;
}

function describeDeadline(value) {
  if (value === undefined) {
    return { present: false, type: "missing", raw: null };
  }
  if (value === null) {
    return { present: true, type: "null", raw: null };
  }
  if (value.timestampValue) {
    return {
      present: true,
      type: "timestamp",
      raw: value.timestampValue,
    };
  }
  if (value.stringValue !== undefined) {
    return { present: true, type: "string", raw: value.stringValue };
  }
  if (value.mapValue) {
    return { present: true, type: "map", raw: value.mapValue };
  }
  return { present: true, type: "other", raw: value };
}

async function listTournaments(token) {
  const url =
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}` +
    `/databases/(default)/documents/tournaments?pageSize=100`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Firestore list failed (${res.status}): ${body}`);
  }
  return res.json();
}

async function run() {
  const token = await getAccessToken();
  const data = await listTournaments(token);
  const docs = data.documents ?? [];

  if (docs.length === 0) {
    console.log("No tournaments found.");
    return;
  }

  console.log(`Found ${docs.length} tournament(s):\n`);
  for (const doc of docs) {
    const id = doc.name.split("/").pop();
    const fields = doc.fields ?? {};
    const status = fields.status?.stringValue ?? "(no status field)";
    const deadline = describeDeadline(fields.entryDeadline);
    console.log(JSON.stringify({ id, name: fields.name?.stringValue ?? null, status, entryDeadline: deadline }, null, 2));
  }
}

run().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
