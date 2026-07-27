/**
 * 指定大会の finalsAdvancement / finalsBracket を本番 Firestore から読み取り（firebase login 必須）
 */
import auth from "firebase-tools/lib/auth.js";
import scopes from "firebase-tools/lib/scopes.js";

const PROJECT_ID = "smatournament-ce785";
const TOURNAMENT_ID = process.argv[2] || "ACMYFRu24Tr6B5kIZrNv";
const AUTH_SCOPES = [scopes.CLOUD_PLATFORM, scopes.FIREBASE_PLATFORM];

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

function decodeValue(field) {
  if (field == null) return null;
  if (field.nullValue !== undefined) return null;
  if (field.stringValue !== undefined) return field.stringValue;
  if (field.booleanValue !== undefined) return field.booleanValue;
  if (field.integerValue !== undefined) return Number(field.integerValue);
  if (field.doubleValue !== undefined) return field.doubleValue;
  if (field.timestampValue !== undefined) return field.timestampValue;
  if (field.mapValue !== undefined) {
    const out = {};
    for (const [key, value] of Object.entries(field.mapValue.fields ?? {})) {
      out[key] = decodeValue(value);
    }
    return out;
  }
  if (field.arrayValue !== undefined) {
    return (field.arrayValue.values ?? []).map(decodeValue);
  }
  return field;
}

async function getDoc(accessToken, path) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${path}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    throw new Error(`Firestore GET ${path}: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  const fields = data.fields ?? {};
  const decoded = {};
  for (const [key, value] of Object.entries(fields)) {
    decoded[key] = decodeValue(value);
  }
  return decoded;
}

async function listCollection(accessToken, path) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${path}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 404) {
    return [];
  }
  if (!res.ok) {
    throw new Error(`Firestore LIST ${path}: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return (data.documents ?? []).map((doc) => doc.name.split("/").pop());
}

const accessToken = await getToken();
const base = `tournaments/${TOURNAMENT_ID}`;

const advancement = await getDoc(accessToken, `${base}/finalsAdvancement/current`);
const bracket = await getDoc(accessToken, `${base}/finalsBracket/current`);
const finalsMatchResults = await listCollection(accessToken, `${base}/finalsMatchResults`);
const finalsMatchSessions = await listCollection(accessToken, `${base}/finalsMatchSessions`);
const tournamentResults = await getDoc(accessToken, `${base}/tournamentResults/current`);
const publicSnapshot = await getDoc(accessToken, `${base}/publicSnapshot/current`);

console.log(JSON.stringify({
  tournamentId: TOURNAMENT_ID,
  dependencies: {
    finalsMatchResultsCount: finalsMatchResults.length,
    finalsMatchSessionsCount: finalsMatchSessions.length,
    tournamentResultsExists: Boolean(tournamentResults),
    publicSnapshotExists: Boolean(publicSnapshot),
  },
  advancement: advancement
    ? {
        mode: advancement.mode,
        qualifierCount: advancement.qualifierCount,
        qualifiersSample: (advancement.qualifiers ?? []).slice(0, 2),
        qualifierFields: advancement.qualifiers?.[0] ? Object.keys(advancement.qualifiers[0]) : [],
      }
    : null,
  bracket: bracket
    ? {
        finalized: bracket.finalized,
        bracketSize: bracket.bracketSize,
        slotsSample: (bracket.slots ?? []).slice(0, 2),
        slotFields: bracket.slots?.[0] ? Object.keys(bracket.slots[0]) : [],
        round1Matches: (bracket.matches ?? [])
          .filter((m) => m.roundNumber === 1)
          .map((m) => ({
            matchId: m.matchId,
            team1: m.team1,
            team2: m.team2,
          })),
      }
    : null,
}, null, 2));
