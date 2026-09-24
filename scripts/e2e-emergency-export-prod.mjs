/**
 * EmergencyExportV1 本番テスト大会確認（読み取り専用 callable + 一時 [E2E] 大会）
 * 終了時に作成した大会は削除する。既存本番大会は変更しない。
 *
 *   node scripts/e2e-emergency-export-prod.mjs
 */
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import auth from "firebase-tools/lib/auth.js";
import scopes from "firebase-tools/lib/scopes.js";
import { firebaseConfig } from "../js/firebase-config.js";
import { buildEmergencyExport, collectForbiddenKeys } from "../js/domain/emergency-export.js";
import { EMERGENCY_EXPORT_FORBIDDEN_KEYS } from "../js/domain/emergency-export-schema.js";
import { TOURNAMENT_SUBCOLLECTIONS } from "../js/domain/tournament-subcollections.js";
import { MatchReconciliationState } from "../js/domain/player-qualifying-submission.js";

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "smatournament-ce785";
const REGION = process.env.FUNCTIONS_REGION || "asia-northeast1";
const AUTH_SCOPES = [scopes.CLOUD_PLATFORM, scopes.FIREBASE_PLATFORM];
const FS_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const EXISTING_TEST_ID = "test-team-range-mu1wvmxe";

function encodeValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
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
  if (field.arrayValue?.values) {
    return field.arrayValue.values.map(decodeValue);
  }
  return null;
}

function decodeDoc(doc) {
  if (!doc) return null;
  const out = { id: doc.name?.split("/").pop() };
  for (const [k, v] of Object.entries(doc.fields || {})) {
    out[k] = decodeValue(v);
  }
  return out;
}

async function getGoogleAccessToken() {
  const account = auth.getGlobalDefaultAccount();
  if (!account?.tokens?.refresh_token) {
    throw new Error("Firebase にログインしていません。");
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
    throw new Error(json.error?.message || `status ${res.status}`);
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
    const err = new Error(`Firestore ${method} ${path} (${res.status}): ${text.slice(0, 400)}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

async function fsSet(accessToken, docPath, data) {
  return fsRequest(accessToken, "PATCH", docPath, { fields: encodeFields(data) });
}

async function fsGet(accessToken, docPath) {
  try {
    return await fsRequest(accessToken, "GET", docPath);
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

async function fsDelete(accessToken, docPath) {
  try {
    await fsRequest(accessToken, "DELETE", docPath);
  } catch (error) {
    if (error.status !== 404) throw error;
  }
}

async function fsList(accessToken, collectionPath) {
  try {
    const data = await fsRequest(accessToken, "GET", `${collectionPath}?pageSize=100`);
    return data.documents || [];
  } catch (error) {
    if (error.status === 404) return [];
    throw error;
  }
}

async function fingerprintTournament(accessToken, tournamentId) {
  const rows = [];
  const root = await fsGet(accessToken, `tournaments/${tournamentId}`);
  rows.push({
    path: `tournaments/${tournamentId}`,
    updateTime: root?.updateTime || null,
    exists: Boolean(root),
  });
  for (const col of TOURNAMENT_SUBCOLLECTIONS) {
    const docs = await fsList(accessToken, `tournaments/${tournamentId}/${col}`);
    for (const doc of docs) {
      rows.push({
        path: doc.name.replace(`projects/${PROJECT_ID}/databases/(default)/documents/`, ""),
        updateTime: doc.updateTime || null,
        exists: true,
      });
    }
  }
  rows.sort((a, b) => a.path.localeCompare(b.path));
  return rows;
}

async function loadExportInput(accessToken, tournamentId) {
  const tournamentDoc = await fsGet(accessToken, `tournaments/${tournamentId}`);
  if (!tournamentDoc) {
    throw new Error("大会が見つかりません。");
  }
  const tournament = decodeDoc(tournamentDoc);

  async function singleton(col) {
    const doc = await fsGet(accessToken, `tournaments/${tournamentId}/${col}/current`);
    return doc ? decodeDoc(doc) : null;
  }
  async function collectionMap(col) {
    const docs = await fsList(accessToken, `tournaments/${tournamentId}/${col}`);
    const map = new Map();
    for (const doc of docs) {
      const decoded = decodeDoc(doc);
      map.set(decoded.id, decoded);
    }
    return map;
  }
  async function collectionList(col) {
    const docs = await fsList(accessToken, `tournaments/${tournamentId}/${col}`);
    return docs.map(decodeDoc);
  }

  return {
    tournamentId,
    tournament,
    entries: await collectionList("entries"),
    blockDraw: await singleton("blockDraw"),
    qualifyingSchedule: await singleton("qualifyingSchedules"),
    qualifyingMatchResults: await collectionMap("qualifyingMatchResults"),
    qualifyingMatchSessions: await collectionMap("qualifyingMatchSessions"),
    molkkyOutResolutions: await singleton("molkkyOutResolutions"),
    finalsAdvancement: await singleton("finalsAdvancement"),
    finalsBracket: await singleton("finalsBracket"),
    finalsMatchResults: await collectionMap("finalsMatchResults"),
    finalsMatchSessions: await collectionMap("finalsMatchSessions"),
    consolationBracket: await singleton("consolationBracket"),
    consolationMatchResults: await collectionMap("consolationMatchResults"),
    consolationMatchSessions: await collectionMap("consolationMatchSessions"),
    lossBandState: await singleton("lossBandState"),
    lossBandRounds: await collectionList("lossBandRounds"),
    lossBandMatchResults: await collectionMap("lossBandMatchResults"),
    lossBandMatchSessions: await collectionMap("lossBandMatchSessions"),
    lossBandPlacements: await singleton("lossBandPlacements"),
    lossBandExchangeRounds: await collectionList("lossBandExchangeRounds"),
    lossBandExchangeMatchResults: await collectionMap("lossBandExchangeMatchResults"),
    lossBandExchangeMatchSessions: await collectionMap("lossBandExchangeMatchSessions"),
    tournamentResults: await singleton("tournamentResults"),
    timeSchedule: await singleton("timeSchedule"),
    qualifyingResultSubmissions: await collectionMap("qualifyingResultSubmissions"),
    qualifyingMatchReconciliations: await collectionMap("qualifyingMatchReconciliations"),
    projectId: PROJECT_ID,
    exportedAt: new Date(),
  };
}

async function callCallable(name, data, idToken = null) {
  const url = `https://${REGION}-${PROJECT_ID}.cloudfunctions.net/${name}`;
  const headers = { "Content-Type": "application/json" };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ data }),
  });
  const json = await res.json().catch(() => ({}));
  if (json.error) {
    const err = new Error(json.error.message || json.error.status || "callable error");
    err.code = json.error.status || json.error.message;
    err.httpStatus = res.status;
    err.body = json.error;
    throw err;
  }
  if (!res.ok) {
    const err = new Error(json?.error?.message || res.statusText);
    err.httpStatus = res.status;
    err.body = json;
    throw err;
  }
  return json.result ?? json.data ?? json;
}

async function captureCallable(name, data, idToken = null) {
  try {
    const result = await callCallable(name, data, idToken);
    return { ok: true, result };
  } catch (error) {
    return {
      ok: false,
      httpStatus: error.httpStatus ?? null,
      code: error.code ?? null,
      message: error.message,
    };
  }
}

function makeResult(matchId, team1, team2, stats1, stats2) {
  return {
    matchId,
    blockId: "A",
    roundNumber: Number(matchId.match(/R(\d+)/)?.[1] || 1),
    courtNumber: 1,
    team1,
    team2,
    sets: [
      { setNumber: 1, team1Score: 50, team2Score: 20, result: "team1", finishReason: "normal" },
      { setNumber: 2, team1Score: 30, team2Score: 50, result: "team2", finishReason: "normal" },
    ],
    team1Stats: stats1,
    team2Stats: stats2,
    status: "finished",
  };
}

async function cleanupTournament(accessToken, tournamentId) {
  for (const col of TOURNAMENT_SUBCOLLECTIONS) {
    const docs = await fsList(accessToken, `tournaments/${tournamentId}/${col}`);
    for (const doc of docs) {
      const id = doc.name.split("/").pop();
      await fsDelete(accessToken, `tournaments/${tournamentId}/${col}/${id}`);
    }
  }
  await fsDelete(accessToken, `tournaments/${tournamentId}`);
}

function summarize(exported) {
  const json = JSON.stringify(exported);
  const forbidden = [...collectForbiddenKeys(exported)];
  const leaked = EMERGENCY_EXPORT_FORBIDDEN_KEYS.filter((key) => json.includes(`"${key}"`));
  return {
    schemaVersion: exported.exportMeta.schemaVersion,
    exportType: exported.exportMeta.exportType,
    tournamentId: exported.exportMeta.tournamentId,
    tournamentName: exported.exportMeta.tournamentName,
    phase: exported.derived.situation.phase,
    phaseLabelJa: exported.derived.situation.phaseLabelJa,
    summaryJa: exported.derived.situation.summaryJa,
    nextActionsJa: exported.derived.situation.nextActionsJa,
    qualifying: exported.derived.situation.qualifying,
    remainingMatchIds: exported.derived.remainingMatches.map((m) => m.matchId),
    remainingMatches: exported.derived.remainingMatches.map((m) => ({
      matchId: m.matchId,
      status: m.status,
      courtNumber: m.courtNumber,
      team1: m.team1,
      team2: m.team2,
    })),
    standings: exported.derived.qualifyingStandings?.blocks?.map((block) => ({
      blockId: block.blockId,
      rows: block.standings.map((row) => ({
        rank: row.rank,
        teamName: row.teamName,
        displayTeamNumber: row.displayTeamNumber,
        setWins: row.setWins,
        setDraws: row.setDraws,
        totalScore: row.totalScore,
      })),
    })),
    finalsAdvancementStatus: {
      finalized: exported.derived.finalsAdvancementStatus.finalized,
      canFinalize: exported.derived.finalsAdvancementStatus.canFinalize,
      projectedCount: exported.derived.finalsAdvancementStatus.projectedQualifiers?.length ?? null,
      qualifierCount: exported.derived.finalsAdvancementStatus.qualifiers?.length ?? null,
      blockers: exported.derived.finalsAdvancementStatus.blockers,
    },
    playerPipeline: {
      submissions: Object.keys(exported.source.playerPipeline.submissions),
      reconciliations: Object.entries(exported.source.playerPipeline.reconciliations).map(
        ([id, doc]) => ({ matchId: id, state: doc.state })
      ),
    },
    matchPipelineStatuses: exported.derived.matchDisplayStates
      .filter((item) => item.playerPipelineStatus)
      .map((item) => ({
        matchId: item.matchId,
        status: item.status,
        playerPipelineStatus: item.playerPipelineStatus,
      })),
    integrityChecks: exported.derived.integrityChecks,
    pii: {
      forbiddenKeysFound: forbidden,
      leakedQuotedKeys: leaked,
      includesEmailValue: json.includes("@example.com"),
      includesSecretUid: json.includes("uid-should-not-leak"),
      includesTokenHash: json.includes("deadbeef"),
    },
  };
}

async function createInProgressTournament(accessToken, createdBy) {
  const suffix = randomBytes(4).toString("hex");
  const tournamentId = `e2e-emergency-export-${suffix}`;
  const e1 = `e1-${suffix}`;
  const e2 = `e2-${suffix}`;
  const e3 = `e3-${suffix}`;
  const nowIso = new Date().toISOString();
  const name = `[E2E] EmergencyExport ${suffix}`;

  const t1 = { entryId: e1, teamName: "Alpha" };
  const t2 = { entryId: e2, teamName: "Bravo" };
  const t3 = { entryId: e3, teamName: "Charlie" };
  const statsWin = { setWins: 1, setDraws: 1, setLosses: 0, totalScore: 80 };
  const statsLose = { setWins: 0, setDraws: 1, setLosses: 1, totalScore: 70 };

  await fsSet(accessToken, `tournaments/${tournamentId}`, {
    name,
    status: "open",
    eventDate: "2099-12-31",
    venue: "E2E EmergencyExport",
    entryDeadline: { __type: "timestamp", value: "2099-01-01T00:00:00Z" },
    maxTeams: 8,
    teamSize: 2,
    courtCount: 2,
    confirmedCount: 3,
    tournamentFormat: "qualifying_and_finals",
    blockCount: 1,
    preferredBlockSize: 3,
    qualifiersPerBlock: 1,
    finalTeamCount: 4,
    participantResultEntryEnabled: true,
    publicViewEnabled: false,
    createdBy,
    createdAt: { __type: "timestamp", value: nowIso },
    updatedAt: { __type: "timestamp", value: nowIso },
  });

  await fsSet(accessToken, `tournaments/${tournamentId}/entries/${e1}`, {
    teamName: "Alpha",
    status: "confirmed",
    teamNumber: 1,
    email: "alpha@example.com",
    representativeName: "代表A",
    comment: "秘密のメモ",
    member2: "メンバーA2",
    createdBy: "uid-should-not-leak",
    clientRequestId: "req-secret",
    tokenHash: "deadbeef",
  });
  await fsSet(accessToken, `tournaments/${tournamentId}/entries/${e2}`, {
    teamName: "Bravo",
    status: "confirmed",
    teamNumber: 2,
  });
  await fsSet(accessToken, `tournaments/${tournamentId}/entries/${e3}`, {
    teamName: "Charlie",
    status: "confirmed",
  });

  await fsSet(accessToken, `tournaments/${tournamentId}/blockDraw/current`, {
    status: "finalized",
    blockCount: 1,
    blocks: [{ id: "A", name: "Aブロック", entryIds: [e1, e2, e3] }],
    finalizedAt: { __type: "timestamp", value: nowIso },
  });

  await fsSet(accessToken, `tournaments/${tournamentId}/qualifyingSchedules/current`, {
    finalized: true,
    blockCount: 1,
    totalMatchCount: 3,
    blocks: [
      {
        blockId: "A",
        blockName: "Aブロック",
        teamCount: 3,
        teams: [
          { symbol: "A1", entryId: e1, teamName: "Alpha" },
          { symbol: "A2", entryId: e2, teamName: "Bravo" },
          { symbol: "A3", entryId: e3, teamName: "Charlie" },
        ],
        rounds: [
          {
            roundNumber: 1,
            matches: [
              {
                matchId: "qualifying-A-R1-M1",
                roundNumber: 1,
                matchNumber: 1,
                courtNumber: 1,
                team1: t1,
                team2: t2,
                status: "waiting",
              },
            ],
          },
          {
            roundNumber: 2,
            matches: [
              {
                matchId: "qualifying-A-R2-M1",
                roundNumber: 2,
                matchNumber: 1,
                courtNumber: 1,
                team1: t1,
                team2: t3,
                status: "waiting",
              },
            ],
          },
          {
            roundNumber: 3,
            matches: [
              {
                matchId: "qualifying-A-R3-M1",
                roundNumber: 3,
                matchNumber: 1,
                courtNumber: 2,
                team1: t2,
                team2: t3,
                status: "waiting",
              },
            ],
          },
        ],
      },
    ],
  });

  await fsSet(
    accessToken,
    `tournaments/${tournamentId}/qualifyingMatchResults/qualifying-A-R1-M1`,
    makeResult("qualifying-A-R1-M1", t1, t2, statsWin, statsLose)
  );
  await fsSet(
    accessToken,
    `tournaments/${tournamentId}/qualifyingMatchResults/qualifying-A-R2-M1`,
    makeResult("qualifying-A-R2-M1", t1, t3, statsWin, statsLose)
  );
  await fsSet(accessToken, `tournaments/${tournamentId}/qualifyingMatchSessions/qualifying-A-R1-M1`, {
    matchId: "qualifying-A-R1-M1",
    status: "finished",
    startedAt: { __type: "timestamp", value: nowIso },
    finishedAt: { __type: "timestamp", value: nowIso },
  });

  await fsSet(
    accessToken,
    `tournaments/${tournamentId}/qualifyingResultSubmissions/qualifying-A-R3-M1_${e2}`,
    {
      matchId: "qualifying-A-R3-M1",
      entryId: e2,
      side: "team1",
      set1OwnScore: 50,
      set2OwnScore: 30,
      status: "pending",
      tokenHashPrefix: "abcdef12",
      authMethod: "teamNumber",
      clientRequestId: "req-1",
    }
  );
  await fsSet(
    accessToken,
    `tournaments/${tournamentId}/qualifyingMatchReconciliations/qualifying-A-R3-M1`,
    {
      matchId: "qualifying-A-R3-M1",
      state: MatchReconciliationState.AWAITING_OPPONENT,
      submissions: {
        team1EntryId: e2,
        team2EntryId: e3,
        team1Submitted: true,
        team2Submitted: false,
      },
      tokenHashPrefix: "abcdef12",
      clientRequestId: "req-1",
    }
  );

  return { tournamentId, name, e1, e2, e3 };
}

function assertReadOnly(before, after) {
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw new Error("Firestore fingerprint changed after export");
  }
}

async function run() {
  const report = {
    projectId: PROJECT_ID,
    region: REGION,
    hostingUsed: false,
    unauthenticated: {},
    operatorAuth: { obtained: false },
    created: null,
  };

  report.unauthenticated.noToken = await captureCallable("exportEmergencyTournamentCallable", {
    tournamentId: "e2e-emergency-export-missing",
  });
  report.unauthenticated.invalidBearer = await captureCallable(
    "exportEmergencyTournamentCallable",
    { tournamentId: "e2e-emergency-export-missing" },
    "not-a-real-token"
  );
  report.unauthenticated.missingTournamentId = await captureCallable(
    "exportEmergencyTournamentCallable",
    {}
  );

  const googleToken = await getGoogleAccessToken();
  try {
    const authInfo = await getFirebaseIdToken(googleToken);
    report.operatorAuth = { obtained: true, uidPresent: Boolean(authInfo.localId) };

    report.authenticated = {
      missingTournamentId: await captureCallable(
        "exportEmergencyTournamentCallable",
        {},
        authInfo.idToken
      ),
      missingTournament: await captureCallable(
        "exportEmergencyTournamentCallable",
        { tournamentId: "e2e-emergency-export-does-not-exist" },
        authInfo.idToken
      ),
    };

    const created = await createInProgressTournament(googleToken, authInfo.localId);
    report.created = { tournamentId: created.tournamentId, name: created.name };
    try {
      const before = await fingerprintTournament(googleToken, created.tournamentId);
      const result = await callCallable(
        "exportEmergencyTournamentCallable",
        { tournamentId: created.tournamentId },
        authInfo.idToken
      );
      const after = await fingerprintTournament(googleToken, created.tournamentId);
      assertReadOnly(before, after);

      const exported = result.export;
      const outPath = join(tmpdir(), result.fileName || `${created.tournamentId}.json`);
      writeFileSync(outPath, JSON.stringify(exported, null, 2), "utf8");
      const reloaded = JSON.parse(readFileSync(outPath, "utf8"));

      report.created.via = "callable";
      report.created.fileName = result.fileName;
      report.created.contentType = result.contentType;
      report.created.schemaVersion = result.schemaVersion;
      report.created.reloadOk =
        reloaded?.exportMeta?.schemaVersion === 1 &&
        reloaded?.exportMeta?.tournamentId === created.tournamentId;
      report.created.jsonPath = outPath;
      report.created.fingerprintUnchanged = true;
      report.created.summary = summarize(exported);
    } finally {
      await cleanupTournament(googleToken, created.tournamentId);
      const gone = await fsGet(googleToken, `tournaments/${created.tournamentId}`);
      report.created.cleanedUp = gone == null;
    }
  } catch (error) {
    report.operatorAuth = {
      obtained: false,
      message: error.message,
    };
  }

  console.log(JSON.stringify(report, null, 2));
}

async function runSetup() {
  const googleToken = await getGoogleAccessToken();
  const created = await createInProgressTournament(googleToken, "test-operator");
  const before = await fingerprintTournament(googleToken, created.tournamentId);
  console.log(
    JSON.stringify(
      {
        mode: "setup",
        tournamentId: created.tournamentId,
        name: created.name,
        fingerprintCount: before.length,
      },
      null,
      2
    )
  );
}

async function runFingerprint(tournamentId) {
  const googleToken = await getGoogleAccessToken();
  const rows = await fingerprintTournament(googleToken, tournamentId);
  console.log(JSON.stringify({ mode: "fingerprint", tournamentId, rows }, null, 2));
}

async function runCleanup(tournamentId) {
  const googleToken = await getGoogleAccessToken();
  await cleanupTournament(googleToken, tournamentId);
  const gone = await fsGet(googleToken, `tournaments/${tournamentId}`);
  console.log(JSON.stringify({ mode: "cleanup", tournamentId, cleanedUp: gone == null }, null, 2));
}

const modeArg = process.argv[2] || "";
if (modeArg === "--setup") {
  runSetup().catch((error) => {
    console.error(error);
    process.exit(1);
  });
} else if (modeArg === "--fingerprint") {
  const id = process.argv[3];
  if (!id) {
    console.error("tournamentId required");
    process.exit(1);
  }
  runFingerprint(id).catch((error) => {
    console.error(error);
    process.exit(1);
  });
} else if (modeArg === "--cleanup") {
  const id = process.argv[3];
  if (!id) {
    console.error("tournamentId required");
    process.exit(1);
  }
  runCleanup(id).catch((error) => {
    console.error(error);
    process.exit(1);
  });
} else {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
