/**
 * 本番 tournaments 一覧・フィールド比較（firebase login 必須）
 * 認証情報は出力しない。
 */
import auth from "firebase-tools/lib/auth.js";
import scopes from "firebase-tools/lib/scopes.js";

const PROJECT_ID = "smatournament-ce785";
const AUTH_SCOPES = [scopes.CLOUD_PLATFORM, scopes.FIREBASE_PLATFORM];

const SUBCOLLECTIONS = [
  "entries",
  "blockDraw",
  "qualifyingSchedules",
  "qualifyingMatchResults",
  "qualifyingMatchSessions",
  "finalsAdvancement",
  "finalsBracket",
  "finalsMatchSessions",
  "finalsMatchResults",
  "tournamentResults",
  "publicSnapshot",
];

async function getToken() {
  const account = auth.getGlobalDefaultAccount();
  if (!account?.tokens?.refresh_token) {
    throw new Error("Firebase にログインしていません。npx firebase login を実行してください。");
  }
  const token = await auth.getAccessToken(account.tokens.refresh_token, AUTH_SCOPES);
  if (!token?.access_token) {
    throw new Error("アクセストークンを取得できませんでした。");
  }
  return token.access_token;
}

function decodeField(field) {
  if (field == null) {
    return { present: false, type: "missing", value: null };
  }
  if (field.nullValue !== undefined) {
    return { present: true, type: "null", value: null };
  }
  if (field.stringValue !== undefined) {
    return { present: true, type: "string", value: field.stringValue };
  }
  if (field.booleanValue !== undefined) {
    return { present: true, type: "boolean", value: field.booleanValue };
  }
  if (field.integerValue !== undefined) {
    return { present: true, type: "integer", value: field.integerValue };
  }
  if (field.doubleValue !== undefined) {
    return { present: true, type: "double", value: field.doubleValue };
  }
  if (field.timestampValue !== undefined) {
    return { present: true, type: "timestamp", value: field.timestampValue };
  }
  if (field.mapValue !== undefined) {
    return { present: true, type: "map", value: field.mapValue };
  }
  if (field.arrayValue !== undefined) {
    return { present: true, type: "array", value: field.arrayValue };
  }
  return { present: true, type: "other", value: field };
}

function summarizeTournament(doc) {
  const id = doc.name.split("/").pop();
  const f = doc.fields ?? {};
  return {
    id,
    name: decodeField(f.name),
    eventDate: decodeField(f.eventDate),
    status: decodeField(f.status),
    createdBy: decodeField(f.createdBy),
    entryDeadline: decodeField(f.entryDeadline),
    isDeleted: decodeField(f.isDeleted),
    createdAt: decodeField(f.createdAt),
    updatedAt: decodeField(f.updatedAt),
  };
}

async function listTournaments(token) {
  const docs = [];
  let pageToken = "";
  do {
    const url =
      `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}` +
      `/databases/(default)/documents/tournaments?pageSize=100` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "");
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      throw new Error(`Firestore list failed (${res.status}): ${await res.text()}`);
    }
    const data = await res.json();
    docs.push(...(data.documents ?? []));
    pageToken = data.nextPageToken ?? "";
  } while (pageToken);
  return docs;
}

async function listSubcollectionDocIds(token, tournamentId, subcollection) {
  const url =
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}` +
    `/databases/(default)/documents/tournaments/${tournamentId}/${subcollection}?pageSize=100`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) {
    return [];
  }
  if (!res.ok) {
    const body = await res.text();
    if (body.includes("NOT_FOUND") || res.status === 403) {
      return [];
    }
    throw new Error(`List ${subcollection} failed (${res.status}): ${body}`);
  }
  const data = await res.json();
  return (data.documents ?? []).map((d) => d.name.split("/").pop());
}

async function run() {
  const token = await getToken();
  const docs = await listTournaments(token);
  const summaries = docs.map(summarizeTournament).sort((a, b) => {
    const da = a.eventDate.value ?? "";
    const db = b.eventDate.value ?? "";
    return String(da).localeCompare(String(db));
  });

  console.log(JSON.stringify({ projectId: PROJECT_ID, count: summaries.length, tournaments: summaries }, null, 2));

  for (const t of summaries) {
    const subs = {};
    for (const col of SUBCOLLECTIONS) {
      const ids = await listSubcollectionDocIds(token, t.id, col);
      if (ids.length > 0) {
        subs[col] = ids;
      }
    }
    if (Object.keys(subs).length > 0) {
      console.log(JSON.stringify({ id: t.id, name: t.name.value, subcollections: subs }));
    }
  }
}

run().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
