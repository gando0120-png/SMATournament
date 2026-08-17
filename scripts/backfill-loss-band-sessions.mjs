/**
 * 本番 incomplete lossBandMatchSessions の roundNumber / lossBand backfill
 *
 *   node scripts/backfill-loss-band-sessions.mjs --tournament=e2e-lb-ui-mswvli3t
 */
import auth from "firebase-tools/lib/auth.js";
import scopes from "firebase-tools/lib/scopes.js";
import { resolveLossBandSessionBackfillFromRounds } from "../js/domain/loss-band/index.js";

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "smatournament-ce785";
const AUTH_SCOPES = [scopes.CLOUD_PLATFORM, scopes.FIREBASE_PLATFORM];
const FS_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

const tournamentArg = process.argv.find((a) => a.startsWith("--tournament="));
const TOURNAMENT_ID = tournamentArg
  ? tournamentArg.slice("--tournament=".length)
  : "e2e-lb-ui-mswvli3t";

function decodeValue(field) {
  if (!field) return undefined;
  if (field.nullValue !== undefined) return null;
  if (field.stringValue !== undefined) return field.stringValue;
  if (field.booleanValue !== undefined) return field.booleanValue;
  if (field.integerValue !== undefined) return Number(field.integerValue);
  if (field.doubleValue !== undefined) return field.doubleValue;
  if (field.timestampValue !== undefined) return field.timestampValue;
  if (field.mapValue?.fields) {
    const out = {};
    for (const [k, v] of Object.entries(field.mapValue.fields)) {
      out[k] = decodeValue(v);
    }
    return out;
  }
  if (field.arrayValue?.values) return field.arrayValue.values.map(decodeValue);
  return null;
}

function decodeDoc(doc) {
  const out = { id: doc.name?.split("/").pop() };
  for (const [k, v] of Object.entries(doc.fields || {})) out[k] = decodeValue(v);
  return out;
}

async function getGoogleAccessToken() {
  const account = auth.getGlobalDefaultAccount();
  if (!account?.tokens?.refresh_token) {
    throw new Error("Firebase にログインしていません。npx firebase login を実行してください。");
  }
  const token = await auth.getAccessToken(account.tokens.refresh_token, AUTH_SCOPES);
  if (!token?.access_token) throw new Error("アクセストークンを取得できませんでした。");
  return token.access_token;
}

async function fsList(accessToken, collectionPath) {
  const docs = [];
  let pageToken = "";
  do {
    const url = new URL(`${FS_BASE}/${collectionPath}`);
    url.searchParams.set("pageSize", "300");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const json = await res.json();
    if (!res.ok) {
      throw new Error(`list ${collectionPath} failed: ${res.status} ${JSON.stringify(json)}`);
    }
    for (const doc of json.documents || []) docs.push(decodeDoc(doc));
    pageToken = json.nextPageToken || "";
  } while (pageToken);
  return docs;
}

async function fsPatchFields(accessToken, docPath, fields) {
  const fieldPaths = Object.keys(fields);
  const url = new URL(`${FS_BASE}/${docPath}`);
  for (const path of fieldPaths) {
    url.searchParams.append("updateMask.fieldPaths", path);
  }
  const bodyFields = {};
  for (const [k, v] of Object.entries(fields)) {
    bodyFields[k] = Number.isInteger(v)
      ? { integerValue: String(v) }
      : { stringValue: String(v) };
  }
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields: bodyFields }),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`patch ${docPath} failed: ${res.status} ${JSON.stringify(json)}`);
  }
  return json;
}

async function main() {
  const token = await getGoogleAccessToken();
  const base = `tournaments/${TOURNAMENT_ID}`;
  const rounds = await fsList(token, `${base}/lossBandRounds`);
  const sessions = await fsList(token, `${base}/lossBandMatchSessions`);

  console.log(
    JSON.stringify(
      {
        tournamentId: TOURNAMENT_ID,
        rounds: rounds.length,
        sessions: sessions.length,
      },
      null,
      2
    )
  );

  let skippedComplete = 0;
  let updated = 0;
  const unresolved = [];

  for (const session of sessions) {
    const hasRound = Number.isInteger(session.roundNumber);
    const hasBand = Number.isInteger(session.lossBand);
    if (hasRound && hasBand) {
      skippedComplete += 1;
      continue;
    }

    const resolved = resolveLossBandSessionBackfillFromRounds(
      rounds,
      session.matchId || session.id
    );
    if (!resolved.ok) {
      unresolved.push({
        matchId: session.matchId || session.id,
        reason: resolved.reason,
        hasRoundNumber: hasRound,
        hasLossBand: hasBand,
      });
      continue;
    }

    const patch = {};
    if (!hasRound) patch.roundNumber = resolved.roundNumber;
    if (!hasBand) patch.lossBand = resolved.lossBand;

    if (Object.keys(patch).length === 0) {
      skippedComplete += 1;
      continue;
    }

    await fsPatchFields(
      token,
      `${base}/lossBandMatchSessions/${session.id}`,
      patch
    );
    updated += 1;
    console.log(
      `[UPDATED] ${session.id} → ${JSON.stringify(patch)}`
    );
  }

  console.log(
    JSON.stringify(
      {
        updated,
        skippedComplete,
        unresolvedCount: unresolved.length,
        unresolved,
      },
      null,
      2
    )
  );

  if (unresolved.length > 0) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
