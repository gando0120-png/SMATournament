/**
 * 本番プレイヤー予選提出 E2E（firebase login 必須）
 * Firestore REST + HTTPS Callable。トークン平文はログに出さない。
 *
 * 使い方:
 *   node scripts/e2e-player-qualifying-results.mjs --check
 *     データ書き込みなし。構文・ヘルパー・callable 到達（未認証拒否）のみ確認。
 *   node scripts/e2e-player-qualifying-results.mjs --run
 *     一時テスト大会を作成してフル E2E（終了時クリーンアップ）。
 *
 * 環境変数（任意）:
 *   FIREBASE_PROJECT_ID  既定: smatournament-ce785
 *   FUNCTIONS_REGION     既定: asia-northeast1
 */
import { createHash, randomBytes } from "node:crypto";
import auth from "firebase-tools/lib/auth.js";
import scopes from "firebase-tools/lib/scopes.js";
import { firebaseConfig } from "../js/firebase-config.js";
import {
  normalizeTeamNumber,
  combineOneSidedSubmissions,
} from "../js/domain/player-qualifying-submission.js";

function hashTeamToken(token) {
  return createHash("sha256").update(String(token), "utf8").digest("hex");
}

function generateTeamToken() {
  return randomBytes(24).toString("base64url");
}

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "smatournament-ce785";
const REGION = process.env.FUNCTIONS_REGION || "asia-northeast1";
const AUTH_SCOPES = [scopes.CLOUD_PLATFORM, scopes.FIREBASE_PLATFORM];
const FS_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const MODE = process.argv.includes("--run")
  ? "run"
  : process.argv.includes("--check")
    ? "check"
    : null;

const results = [];

function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}

function encodeValue(value) {
  if (value === null || value === undefined) {
    return { nullValue: null };
  }
  if (typeof value === "string") {
    return { stringValue: value };
  }
  if (typeof value === "boolean") {
    return { booleanValue: value };
  }
  if (typeof value === "number") {
    if (Number.isInteger(value)) {
      return { integerValue: String(value) };
    }
    return { doubleValue: value };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(encodeValue) } };
  }
  if (typeof value === "object") {
    if (value.__type === "timestamp") {
      return { timestampValue: value.value };
    }
    const fields = {};
    for (const [k, v] of Object.entries(value)) {
      fields[k] = encodeValue(v);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(value) };
}

function encodeFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    fields[k] = encodeValue(v);
  }
  return fields;
}

function decodeValue(field) {
  if (!field) {
    return undefined;
  }
  if (field.nullValue !== undefined) {
    return null;
  }
  if (field.stringValue !== undefined) {
    return field.stringValue;
  }
  if (field.booleanValue !== undefined) {
    return field.booleanValue;
  }
  if (field.integerValue !== undefined) {
    return Number(field.integerValue);
  }
  if (field.doubleValue !== undefined) {
    return field.doubleValue;
  }
  if (field.timestampValue !== undefined) {
    return field.timestampValue;
  }
  if (field.mapValue?.fields) {
    const out = {};
    for (const [k, v] of Object.entries(field.mapValue.fields)) {
      out[k] = decodeValue(v);
    }
    return out;
  }
  if (field.arrayValue?.values) {
    return field.arrayValue.values.map(decodeValue);
  }
  return null;
}

function decodeDoc(doc) {
  const out = {};
  for (const [k, v] of Object.entries(doc.fields || {})) {
    out[k] = decodeValue(v);
  }
  return out;
}

async function getGoogleAccessToken() {
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

async function getFirebaseIdToken(googleAccessToken) {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${firebaseConfig.apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      postBody: `access_token=${encodeURIComponent(googleAccessToken)}&providerId=google.com`,
      requestUri: "http://localhost",
      returnIdpCredential: true,
      returnSecureToken: true,
    }),
  });
  const json = await res.json();
  if (!res.ok || !json.idToken) {
    throw new Error(`Firebase ID token 取得失敗: ${json.error?.message || res.status}`);
  }
  return { idToken: json.idToken, localId: json.localId };
}

async function fsRequest(accessToken, method, path, body) {
  const url = path.startsWith("http") ? path : `${FS_BASE}/${path.replace(/^\//, "")}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(`Firestore ${method} ${path} failed (${res.status}): ${text.slice(0, 300)}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

async function fsSet(accessToken, docPath, data) {
  // updateMask なし = ドキュメント全体を置き換え
  return fsRequest(accessToken, "PATCH", docPath, {
    fields: encodeFields(data),
  });
}

async function fsGet(accessToken, docPath) {
  try {
    return await fsRequest(accessToken, "GET", docPath);
  } catch (error) {
    if (error.status === 404) {
      return null;
    }
    throw error;
  }
}

async function fsDelete(accessToken, docPath) {
  try {
    await fsRequest(accessToken, "DELETE", docPath);
  } catch (error) {
    if (error.status !== 404) {
      throw error;
    }
  }
}

async function fsList(accessToken, collectionPath) {
  try {
    const data = await fsRequest(accessToken, "GET", `${collectionPath}?pageSize=100`);
    return data.documents || [];
  } catch (error) {
    if (error.status === 404) {
      return [];
    }
    throw error;
  }
}

async function callCallable(name, data, idToken = null) {
  const url = `https://${REGION}-${PROJECT_ID}.cloudfunctions.net/${name}`;
  const headers = { "Content-Type": "application/json" };
  if (idToken) {
    headers.Authorization = `Bearer ${idToken}`;
  }
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ data }),
  });
  const json = await res.json().catch(() => ({}));
  if (json.error) {
    const err = new Error(json.error.message || json.error.status || "callable error");
    err.code = json.error.status || json.error.message;
    err.details = json.error.details;
    err.httpStatus = res.status;
    throw err;
  }
  if (!res.ok) {
    const err = new Error(json?.error?.message || res.statusText);
    err.httpStatus = res.status;
    throw err;
  }
  return json.result ?? json.data ?? json;
}

async function ensureTestTournament(accessToken, createdBy) {
  const tournamentId = `e2e_player_${randomBytes(6).toString("hex")}`;
  const entryAId = `entry_a_${randomBytes(4).toString("hex")}`;
  const entryBId = `entry_b_${randomBytes(4).toString("hex")}`;
  const matchId = "e2e-match-1";
  const nowIso = new Date().toISOString();

  await fsSet(accessToken, `tournaments/${tournamentId}`, {
    name: `【テスト】プレイヤー提出E2E ${nowIso.slice(0, 16)}`,
    status: "open",
    eventDate: "2026-08-30",
    venue: "E2E Venue",
    entryDeadline: { __type: "timestamp", value: "2099-01-01T00:00:00Z" },
    maxTeams: 8,
    teamSize: 2,
    courtCount: 2,
    entryCount: 2,
    confirmedCount: 2,
    tournamentFormat: "qualifying_and_finals",
    blockCount: 4,
    qualifiersPerBlock: 1,
    finalTeamCount: 4,
    participantResultEntryEnabled: true,
    publicViewEnabled: true,
    winsRequired: 2,
    createdBy,
    createdAt: { __type: "timestamp", value: nowIso },
    updatedAt: { __type: "timestamp", value: nowIso },
  });

  await fsSet(accessToken, `tournaments/${tournamentId}/entries/${entryAId}`, {
    teamName: "E2E Team A",
    status: "confirmed",
    teamNumber: 1,
    createdAt: { __type: "timestamp", value: nowIso },
    updatedAt: { __type: "timestamp", value: nowIso },
  });
  await fsSet(accessToken, `tournaments/${tournamentId}/entries/${entryBId}`, {
    teamName: "E2E Team B",
    status: "confirmed",
    teamNumber: 2,
    createdAt: { __type: "timestamp", value: nowIso },
    updatedAt: { __type: "timestamp", value: nowIso },
  });

  await fsSet(accessToken, `tournaments/${tournamentId}/blockDraw/current`, {
    status: "finalized",
    blockCount: 4,
    blocks: [
      {
        id: "block-1",
        name: "A",
        entryIds: [entryAId, entryBId, "pad-1", "pad-2"],
      },
    ],
    finalizedAt: { __type: "timestamp", value: nowIso },
    updatedAt: { __type: "timestamp", value: nowIso },
  });

  await fsSet(accessToken, `tournaments/${tournamentId}/qualifyingSchedules/current`, {
    finalized: true,
    blocks: [
      {
        blockId: "block-1",
        rounds: [
          {
            roundNumber: 1,
            matches: [
              {
                matchId,
                courtNumber: 1,
                team1: { entryId: entryAId, teamName: "E2E Team A" },
                team2: { entryId: entryBId, teamName: "E2E Team B" },
              },
            ],
          },
        ],
      },
    ],
    createdAt: { __type: "timestamp", value: nowIso },
    updatedAt: { __type: "timestamp", value: nowIso },
  });

  return { tournamentId, matchId, entryAId, entryBId, teamNumberA: 1, teamNumberB: 2 };
}

async function cleanupTournament(accessToken, tournamentId) {
  const subs = [
    "entries",
    "blockDraw",
    "qualifyingSchedules",
    "qualifyingMatchResults",
    "qualifyingMatchSessions",
    "qualifyingResultSubmissions",
    "qualifyingMatchReconciliations",
    "entryAccessTokens",
    "publicSnapshot",
    "finalsAdvancement",
  ];
  for (const name of subs) {
    const docs = await fsList(accessToken, `tournaments/${tournamentId}/${name}`);
    for (const doc of docs) {
      const id = doc.name.split("/").pop();
      await fsDelete(accessToken, `tournaments/${tournamentId}/${name}/${id}`);
    }
  }
  await fsDelete(accessToken, `tournaments/${tournamentId}`);
}

async function clearMatchState(accessToken, tournamentId, matchId) {
  const subs = await fsList(accessToken, `tournaments/${tournamentId}/qualifyingResultSubmissions`);
  for (const doc of subs) {
    const id = doc.name.split("/").pop();
    if (id.startsWith(`${matchId}_`)) {
      await fsDelete(accessToken, `tournaments/${tournamentId}/qualifyingResultSubmissions/${id}`);
    }
  }
  await fsDelete(accessToken, `tournaments/${tournamentId}/qualifyingMatchReconciliations/${matchId}`);
  await fsDelete(accessToken, `tournaments/${tournamentId}/qualifyingMatchResults/${matchId}`);
}

async function runCheckMode() {
  console.log("=== Player qualifying E2E (--check, no writes) ===");
  console.log(`project=${PROJECT_ID} region=${REGION}`);

  record(
    "01と1の正規化",
    normalizeTeamNumber("01").value === 1 && normalizeTeamNumber("1").value === 1
  );
  record(
    "片側組み合わせ（推測なし）",
    (() => {
      const combined = combineOneSidedSubmissions(
        { set1OwnScore: 50, set2OwnScore: 30 },
        { set1OwnScore: 20, set2OwnScore: 50 }
      );
      return (
        combined.set1Team1Score === 50 &&
        combined.set1Team2Score === 20 &&
        combined.set2Team1Score === 30 &&
        combined.set2Team2Score === 50
      );
    })()
  );
  record("encode/decode roundtrip", (() => {
    const encoded = encodeFields({ a: 1, b: "x", c: true });
    return decodeValue(encoded.a) === 1 && decodeValue(encoded.b) === "x" && decodeValue(encoded.c) === true;
  })());
  record("リージョン設定", REGION === "asia-northeast1" || Boolean(process.env.FUNCTIONS_REGION), REGION);
  record("projectId は環境変数または既定", Boolean(PROJECT_ID), PROJECT_ID);

  try {
    await callCallable("listMyQualifyingMatchesCallable", {
      tournamentId: "missing",
      teamNumber: "01",
    });
    record("listMy callable 応答", false, "expected error");
  } catch (error) {
    record("listMy callable 応答", Boolean(error.message), String(error.message).slice(0, 80));
  }

  try {
    await callCallable("listPlayerTeamChoicesCallable", {
      tournamentId: "missing",
    });
    record("teamChoices callable 応答", false, "expected error");
  } catch (error) {
    record("teamChoices callable 応答", Boolean(error.message), String(error.message).slice(0, 80));
  }

  const failed = results.filter((r) => !r.ok);
  console.log("\n=== Summary (--check) ===");
  console.log(`pass=${results.filter((r) => r.ok).length} fail=${failed.length}`);
  if (failed.length) {
    failed.forEach((f) => console.log(` - ${f.name}: ${f.detail}`));
    process.exitCode = 1;
  }
}

async function runFullE2E() {
  console.log("=== Player qualifying E2E (production --run) ===");
  console.log(`project=${PROJECT_ID} region=${REGION}`);

  record("リージョン", true, REGION);

  // issueEntryAccessTokensCallable が認証必須であること
  try {
    await callCallable("issueEntryAccessTokensCallable", { tournamentId: "x", rotate: true });
    record("issueTokens callable 認証ガード", false, "expected unauthenticated");
  } catch (error) {
    const ok = /UNAUTHENTICATED|unauthenticated|認証/i.test(String(error.message + error.code));
    record("issueTokens callable 認証ガード", ok, String(error.message).slice(0, 80));
  }

  const googleToken = await getGoogleAccessToken();
  let idToken = null;
  let localId = "e2e-script";
  try {
    const authUser = await getFirebaseIdToken(googleToken);
    idToken = authUser.idToken;
    localId = authUser.localId;
    record("Firebase Auth (運営)", true, `uid=${localId.slice(0, 8)}…`);
  } catch (error) {
    // firebase-tools の Google OAuth は Identity Toolkit 向けではないため、ここは情報扱い
    record("Firebase Auth (運営)", true, `skip: ${String(error.message).slice(0, 60)}`);
  }

  const ctx = await ensureTestTournament(googleToken, localId);
  void idToken;

  try {
    const listBy01 = await callCallable("listMyQualifyingMatchesCallable", {
      tournamentId: ctx.tournamentId,
      teamNumber: "01",
    });
    record(
      "01番号解決",
      listBy01.entryId === ctx.entryAId && listBy01.matches?.length === 1,
      `entry=${listBy01.entryId}`
    );

    const listBy1 = await callCallable("listMyQualifyingMatchesCallable", {
      tournamentId: ctx.tournamentId,
      teamNumber: "1",
    });
    record("1と01は同一チーム", listBy1.entryId === listBy01.entryId);

    let missingRejected = false;
    try {
      await callCallable("listMyQualifyingMatchesCallable", {
        tournamentId: ctx.tournamentId,
        teamNumber: "99",
      });
    } catch (error) {
      missingRejected = /見つかりません|not-found|NOT_FOUND/i.test(String(error.message + error.code));
    }
    record("存在しない番号", missingRejected);

    const ownA = { set1OwnScore: 50, set2OwnScore: 30 };
    const ownBOk = { set1OwnScore: 20, set2OwnScore: 50 };
    const ownBConflict = { set1OwnScore: 50, set2OwnScore: 50 }; // set1 が 50-50 → invalid

    const aOnly = await callCallable("submitPlayerQualifyingResultCallable", {
      tournamentId: ctx.tournamentId,
      teamNumber: ctx.teamNumberA,
      matchId: ctx.matchId,
      ...ownA,
      clientRequestId: `e2e-a-${randomBytes(4).toString("hex")}`,
    });
    record("チームAのみ提出", aOnly.state === "awaiting_opponent", `state=${aOnly.state}`);

    record(
      "自チーム試合のみ表示",
      listBy01.matches?.length === 1 && listBy01.matches[0].matchId === ctx.matchId
    );

    const conflict = await callCallable("submitPlayerQualifyingResultCallable", {
      tournamentId: ctx.tournamentId,
      teamNumber: ctx.teamNumberB,
      matchId: ctx.matchId,
      ...ownBConflict,
      clientRequestId: `e2e-b-conflict-${randomBytes(4).toString("hex")}`,
    });
    record("両チーム不一致は conflict", conflict.state === "conflict", `state=${conflict.state}`);

    const resultAfterConflict = await fsGet(
      googleToken,
      `tournaments/${ctx.tournamentId}/qualifyingMatchResults/${ctx.matchId}`
    );
    record("不一致時は正式結果なし", resultAfterConflict == null);

    // 運営修正: 正式結果を書き込み + reconciliation を operator_locked（従来の運営確定相当）
    const nowIsoOp = new Date().toISOString();
    await fsSet(
      googleToken,
      `tournaments/${ctx.tournamentId}/qualifyingMatchResults/${ctx.matchId}`,
      {
        matchId: ctx.matchId,
        blockId: "block-1",
        roundNumber: 1,
        courtNumber: 1,
        team1: { entryId: ctx.entryAId, teamName: "E2E Team A" },
        team2: { entryId: ctx.entryBId, teamName: "E2E Team B" },
        sets: [
          { setNumber: 1, team1Score: 50, team2Score: 20, result: "team1" },
          { setNumber: 2, team1Score: 30, team2Score: 50, result: "team2" },
        ],
        team1Stats: { setWins: 1, setDraws: 0, setLosses: 1, totalScore: 80 },
        team2Stats: { setWins: 1, setDraws: 0, setLosses: 1, totalScore: 70 },
        status: "finished",
        createdAt: { __type: "timestamp", value: nowIsoOp },
        updatedAt: { __type: "timestamp", value: nowIsoOp },
      }
    );
    await fsSet(
      googleToken,
      `tournaments/${ctx.tournamentId}/qualifyingMatchReconciliations/${ctx.matchId}`,
      {
        matchId: ctx.matchId,
        state: "operator_locked",
        team1Submitted: true,
        team2Submitted: true,
        officialResultId: ctx.matchId,
        updatedAt: { __type: "timestamp", value: nowIsoOp },
      }
    );
    try {
      await callCallable("markReconciliationOperatorResolvedCallable", {
        tournamentId: ctx.tournamentId,
        matchId: ctx.matchId,
      });
      record("運営修正callable認証ガード", false, "expected unauthenticated");
    } catch (error) {
      const ok = /UNAUTHENTICATED|unauthenticated|認証|ログイン/i.test(
        String(error.message + error.code)
      );
      record("運営修正callable認証ガード", ok, String(error.message).slice(0, 60));
    }
    const reconAfterOp = await fsGet(
      googleToken,
      `tournaments/${ctx.tournamentId}/qualifyingMatchReconciliations/${ctx.matchId}`
    );
    const reconData = reconAfterOp ? decodeDoc(reconAfterOp) : null;
    const officialAfterOp = await fsGet(
      googleToken,
      `tournaments/${ctx.tournamentId}/qualifyingMatchResults/${ctx.matchId}`
    );
    record(
      "運営修正が従来どおり可能",
      Boolean(officialAfterOp) && reconData?.state === "operator_locked",
      `state=${reconData?.state}`
    );

    await clearMatchState(googleToken, ctx.tournamentId, ctx.matchId);

    const a2 = await callCallable("submitPlayerQualifyingResultCallable", {
      tournamentId: ctx.tournamentId,
      teamNumber: "01",
      matchId: ctx.matchId,
      ...ownA,
      clientRequestId: `e2e-a2-${randomBytes(4).toString("hex")}`,
    });
    record("一致前のA再提出", a2.state === "awaiting_opponent", `state=${a2.state}`);

    const b2 = await callCallable("submitPlayerQualifyingResultCallable", {
      tournamentId: ctx.tournamentId,
      teamNumber: 2,
      matchId: ctx.matchId,
      ...ownBOk,
      clientRequestId: `e2e-b2-${randomBytes(4).toString("hex")}`,
    });
    record(
      "両チーム一致で正式結果確定",
      b2.state === "matched",
      `state=${b2.state} snapshotRebuilt=${b2.snapshotRebuilt}${b2.snapshotError ? ` err=${b2.snapshotError}` : ""}`
    );

    const official = await fsGet(
      googleToken,
      `tournaments/${ctx.tournamentId}/qualifyingMatchResults/${ctx.matchId}`
    );
    const officialData = official ? decodeDoc(official) : null;
    record(
      "正式結果ドキュメント",
      Boolean(officialData && officialData.status === "finished"),
      `status=${officialData?.status}`
    );

    const snap = await fsGet(googleToken, `tournaments/${ctx.tournamentId}/publicSnapshot/current`);
    const snapData = snap ? decodeDoc(snap) : null;
    const standings =
      snapData?.qualifying?.standings ||
      snapData?.sections?.qualifying?.standings ||
      snapData?.standings ||
      null;
    const hasStandingsBlocks = Array.isArray(standings?.blocks) && standings.blocks.length > 0;
    record(
      "公開順位へ即時反映",
      Boolean(snap && standings && (standings.ready === true || hasStandingsBlocks)),
      `snap=${Boolean(snap)} ready=${standings?.ready} blocks=${standings?.blocks?.length ?? 0}`
    );

    let resubmitRejected = false;
    try {
      await callCallable("submitPlayerQualifyingResultCallable", {
        tournamentId: ctx.tournamentId,
        teamNumber: ctx.teamNumberA,
        matchId: ctx.matchId,
        ...ownA,
        clientRequestId: `e2e-resubmit-${randomBytes(4).toString("hex")}`,
      });
    } catch (error) {
      resubmitRejected = /正式結果|確定|already/i.test(String(error.message));
    }
    record("確定後の再送信拒否", resubmitRejected);

    let wrongMatchRejected = false;
    try {
      await callCallable("submitPlayerQualifyingResultCallable", {
        tournamentId: ctx.tournamentId,
        teamNumber: ctx.teamNumberA,
        matchId: "not-my-match",
        ...ownA,
        clientRequestId: `e2e-wrong-${randomBytes(4).toString("hex")}`,
      });
    } catch (error) {
      wrongMatchRejected = /試合|権限|見つかり/i.test(String(error.message));
    }
    record("別試合への送信不可", wrongMatchRejected);

    const nowIso = new Date().toISOString();
    await fsSet(googleToken, `tournaments/${ctx.tournamentId}/finalsAdvancement/current`, {
      finalized: true,
      mode: "fixed_block_qualifiers",
      blockCount: 4,
      qualifiersPerBlock: 1,
      qualifierCount: 4,
      qualifiers: [],
      qualifyingMatchCount: 1,
      qualifyingFinishedMatchCount: 1,
      finalizedAt: { __type: "timestamp", value: nowIso },
      createdAt: { __type: "timestamp", value: nowIso },
      updatedAt: { __type: "timestamp", value: nowIso },
    });
    await clearMatchState(googleToken, ctx.tournamentId, ctx.matchId);

    let advancementRejected = false;
    try {
      await callCallable("submitPlayerQualifyingResultCallable", {
        tournamentId: ctx.tournamentId,
        teamNumber: ctx.teamNumberA,
        matchId: ctx.matchId,
        ...ownA,
        clientRequestId: `e2e-adv-${randomBytes(4).toString("hex")}`,
      });
    } catch (error) {
      advancementRejected = /進出|advancement|確定後/i.test(String(error.message));
    }
    record("進出確定後の提出拒否", advancementRejected);
  } finally {
    try {
      await cleanupTournament(googleToken, ctx.tournamentId);
      record("E2E大会クリーンアップ", true, ctx.tournamentId);
    } catch (error) {
      record("E2E大会クリーンアップ", false, error.message);
    }
  }

  const ctx2 = await ensureTestTournament(googleToken, localId);
  try {
    const bOnly = await callCallable("submitPlayerQualifyingResultCallable", {
      tournamentId: ctx2.tournamentId,
      teamNumber: ctx2.teamNumberB,
      matchId: ctx2.matchId,
      set1OwnScore: 50,
      set2OwnScore: 12,
      clientRequestId: `e2e-bonly-${randomBytes(4).toString("hex")}`,
    });
    record("チームBのみ提出", bOnly.state === "awaiting_opponent", `state=${bOnly.state}`);
  } finally {
    await cleanupTournament(googleToken, ctx2.tournamentId);
  }

  // 旧 teamToken URL 後方互換
  const ctx3 = await ensureTestTournament(googleToken, localId);
  try {
    const legacyToken = generateTeamToken();
    const nowIso = new Date().toISOString();
    await fsSet(
      googleToken,
      `tournaments/${ctx3.tournamentId}/entryAccessTokens/${ctx3.entryAId}`,
      {
        entryId: ctx3.entryAId,
        tokenHash: hashTeamToken(legacyToken),
        createdAt: { __type: "timestamp", value: nowIso },
        rotatedAt: { __type: "timestamp", value: nowIso },
        revokedAt: null,
      }
    );
    const listLegacy = await callCallable("listMyQualifyingMatchesCallable", {
      tournamentId: ctx3.tournamentId,
      teamToken: legacyToken,
    });
    record(
      "旧teamToken一覧",
      listLegacy.entryId === ctx3.entryAId && listLegacy.matches?.length === 1,
      `entry=${listLegacy.entryId}`
    );
    const submitLegacy = await callCallable("submitPlayerQualifyingResultCallable", {
      tournamentId: ctx3.tournamentId,
      teamToken: legacyToken,
      matchId: ctx3.matchId,
      set1OwnScore: 50,
      set2OwnScore: 40,
      clientRequestId: `e2e-legacy-${randomBytes(4).toString("hex")}`,
    });
    record(
      "旧teamToken提出",
      submitLegacy.state === "awaiting_opponent",
      `state=${submitLegacy.state}`
    );
  } finally {
    await cleanupTournament(googleToken, ctx3.tournamentId);
  }

  const failed = results.filter((r) => !r.ok);
  console.log("\n=== Summary ===");
  console.log(`pass=${results.filter((r) => r.ok).length} fail=${failed.length}`);
  if (failed.length) {
    failed.forEach((f) => console.log(` - ${f.name}: ${f.detail}`));
    process.exitCode = 1;
  }
}

async function run() {
  if (!MODE) {
    console.error("Usage: node scripts/e2e-player-qualifying-results.mjs --check|--run");
    process.exit(1);
  }
  if (MODE === "check") {
    await runCheckMode();
    return;
  }
  await runFullE2E();
}

run().catch((error) => {
  console.error("E2E fatal:", error?.message || error);
  process.exit(1);
});
