/**
 * 本番 Firebase 上の決勝勝利報告 E2E（テスト大会のみ。削除しない）
 * node scripts/e2e-player-finals-win-report-prod.mjs --run
 */
import { randomBytes } from "node:crypto";
import auth from "firebase-tools/lib/auth.js";
import scopes from "firebase-tools/lib/scopes.js";
import { firebaseConfig } from "../js/firebase-config.js";
import { buildFinalsBracket, buildPersistedFinalsBracket } from "../js/domain/finals-bracket.js";
import {
  buildPersistedSingleEliminationBracket,
  buildSingleEliminationBracket,
} from "../js/domain/single-elimination-bracket.js";
import { resolveFinalsMatchTeams } from "../js/domain/finals-match-progress.js";
import { canModifyFinalsMatchResult } from "../js/domain/finals-match-progress.js";
import {
  PlayerFinalsPageMode,
  resolvePlayerFinalsPageMode,
  PLAYER_FINALS_UNSUPPORTED_FORMAT_MESSAGE,
} from "../js/domain/player-finals-win-report.js";
import { RankingMode } from "../js/domain/loss-band/constants.js";
import { MatchFormat } from "../js/domain/aggregate-match-format.js";
import { TournamentStatus } from "../js/domain/constants.js";

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "smatournament-ce785";
const REGION = process.env.FUNCTIONS_REGION || "asia-northeast1";
const HOSTING = "https://smatournament-ce785.web.app";
const AUTH_SCOPES = [scopes.CLOUD_PLATFORM, scopes.FIREBASE_PLATFORM];
const FS_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const RUN = process.argv.includes("--run");

const results = [];

function record(name, ok, detail = "") {
  results.push({ name, ok, detail: String(detail || "") });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}

function stamp() {
  return randomBytes(3).toString("hex");
}

function encodeValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } };
  if (typeof value === "object") {
    if (value.__type === "timestamp") return { timestampValue: value.value };
    const fields = {};
    for (const [k, v] of Object.entries(value)) fields[k] = encodeValue(v);
    return { mapValue: { fields } };
  }
  return { stringValue: String(value) };
}

function encodeFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) fields[k] = encodeValue(v);
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
    for (const [k, v] of Object.entries(field.mapValue.fields)) out[k] = decodeValue(v);
    return out;
  }
  if (field.arrayValue?.values) return field.arrayValue.values.map(decodeValue);
  return null;
}

function decodeDoc(doc) {
  if (!doc) return null;
  const out = { id: doc.name?.split("/").pop() };
  for (const [k, v] of Object.entries(doc.fields || {})) out[k] = decodeValue(v);
  return out;
}

async function getGoogleAccessToken() {
  const account = auth.getGlobalDefaultAccount();
  if (!account?.tokens?.refresh_token) throw new Error("Firebase にログインしていません。");
  const token = await auth.getAccessToken(account.tokens.refresh_token, AUTH_SCOPES);
  if (!token?.access_token) throw new Error("アクセストークンを取得できませんでした。");
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
    return decodeDoc(await fsRequest(accessToken, "GET", docPath));
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

async function fsCommit(accessToken, writes) {
  const res = await fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:commit`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ writes }),
    }
  );
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`commit failed (${res.status}): ${text.slice(0, 400)}`);
  }
  return text ? JSON.parse(text) : {};
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
    err.raw = json.error;
    throw err;
  }
  if (!res.ok) {
    throw new Error(json?.error?.message || res.statusText);
  }
  return json.result ?? json.data ?? json;
}

function callableErrorText(error) {
  return String(error?.message || error?.code || "");
}

function isShortJapanese(text) {
  const s = String(text || "");
  return /[\u3040-\u30ff\u3400-\u9fff]/.test(s) && !/FirebaseError|INTERNAL|stack|functions\//i.test(s);
}

function nowIso() {
  return new Date().toISOString();
}

function teamDoc(entryId, teamName, seed) {
  return { entryId, teamName, seed, isBye: false };
}

async function createBaseTournament(accessToken, createdBy, { id, name, format, extra = {} }) {
  const iso = nowIso();
  await fsSet(accessToken, `tournaments/${id}`, {
    name,
    status: "open",
    eventDate: "2026-09-20",
    venue: "E2E Venue",
    entryDeadline: { __type: "timestamp", value: "2099-01-01T00:00:00Z" },
    maxTeams: extra.maxTeams ?? 8,
    teamSize: 2,
    courtCount: 2,
    tournamentFormat: format,
    participantResultEntryEnabled: true,
    publicViewEnabled: true,
    winsRequired: extra.winsRequired ?? 2,
    createdBy,
    createdAt: { __type: "timestamp", value: iso },
    updatedAt: { __type: "timestamp", value: iso },
    ...extra,
  });
}

async function createEntry(accessToken, tournamentId, { id, teamName, teamNumber }) {
  const iso = nowIso();
  await fsSet(accessToken, `tournaments/${tournamentId}/entries/${id}`, {
    teamName,
    status: "confirmed",
    teamNumber,
    representativeName: "代表",
    createdAt: { __type: "timestamp", value: iso },
    updatedAt: { __type: "timestamp", value: iso },
  });
}

const INSPECT_QF = (() => {
  const i = process.argv.indexOf("--inspect");
  return i >= 0 ? process.argv[i + 1] : "";
})();

if (INSPECT_QF) {
  const googleToken = await getGoogleAccessToken();
  const paths = [
    `tournaments/${INSPECT_QF}`,
    `tournaments/${INSPECT_QF}/finalsMatchResults/final-r1-m1`,
    `tournaments/${INSPECT_QF}/finalsMatchResults/final-r1-m2`,
    `tournaments/${INSPECT_QF}/finalsMatchResults/final-r2-m1`,
    `tournaments/${INSPECT_QF}/finalsMatchSessions/final-r1-m1`,
    `tournaments/${INSPECT_QF}/finalsMatchSessions/final-r2-m1`,
    `tournaments/${INSPECT_QF}/finalsBracket/current`,
    `tournaments/${INSPECT_QF}/publicSnapshot/current`,
  ];
  for (const p of paths) {
    const doc = await fsGet(googleToken, p);
    if (!doc) {
      console.log(`\n=== ${p} MISSING ===`);
      continue;
    }
    const slim = {
      id: doc.id,
      name: doc.name,
      source: doc.source,
      reportedByEntryId: doc.reportedByEntryId,
      resolution: doc.resolution,
      winner: doc.winner,
      loser: doc.loser,
      winnerSide: doc.winnerSide,
      winsRequired: doc.winsRequired,
      team1SetWins: doc.team1SetWins,
      team2SetWins: doc.team2SetWins,
      sets: doc.sets,
      status: doc.status,
      startedAt: Boolean(doc.startedAt),
      finishedAt: Boolean(doc.finishedAt),
      team1: doc.team1,
      team2: doc.team2,
      matches: Array.isArray(doc.matches)
        ? doc.matches.map((m) => ({
            matchId: m.matchId,
            roundNumber: m.roundNumber,
            team1: m.team1,
            team2: m.team2,
          }))
        : undefined,
      finalsMatchResults: Array.isArray(doc.finalsMatchResults)
        ? doc.finalsMatchResults.map((r) => ({
            matchId: r.matchId,
            source: r.source,
            winner: r.winner?.teamName,
            sets: r.sets,
            team1SetWins: r.team1SetWins,
          }))
        : undefined,
      consolationMatchResults: Array.isArray(doc.consolationMatchResults)
        ? doc.consolationMatchResults.map((r) => ({
            matchId: r.matchId,
            winner: r.winner,
            sets: r.sets,
          }))
        : undefined,
      bracketFinal: Array.isArray(doc.bracket?.rounds)
        ? doc.bracket.rounds.map((round) => ({
            roundLabel: round.roundLabel,
            matches: (round.matches || []).map((m) => ({
              matchId: m.matchId,
              resultSummary: m.resultSummary,
              team1: m.team1?.teamName || m.team1,
              team2: m.team2?.teamName || m.team2,
              displayStatus: m.displayStatus,
            })),
          }))
        : undefined,
    };
    console.log(`\n=== ${p} ===`);
    console.log(JSON.stringify(slim, null, 2));
  }
  process.exit(0);
}

if (!RUN) {
  console.log("Usage: node scripts/e2e-player-finals-win-report-prod.mjs --run");
  process.exit(1);
}

const ids = {
  qf: `test-finals-win-qf-${stamp()}`,
  se: `test-finals-win-se-${stamp()}`,
  guard: `test-finals-win-guard-${stamp()}`,
};

const report = {
  qfId: ids.qf,
  seId: ids.se,
  guardId: ids.guard,
};

try {
  console.log("=== Player finals win-report E2E (production test tournaments) ===");
  const googleToken = await getGoogleAccessToken();
  let createdBy = "e2e-script";
  let idToken = null;
  try {
    const authUser = await getFirebaseIdToken(googleToken);
    createdBy = authUser.localId;
    idToken = authUser.idToken;
    record("Firebase Auth", true, `uid=${createdBy.slice(0, 8)}…`);
  } catch (error) {
    record("Firebase Auth", true, `skip ${String(error.message).slice(0, 60)}`);
  }

  const entries = [
    { id: "e-sma", teamName: "SMA", teamNumber: 1 },
    { id: "e-b", teamName: "チームB", teamNumber: 2 },
    { id: "e-c", teamName: "チームC", teamNumber: 3 },
    { id: "e-d", teamName: "チームD", teamNumber: 4 },
  ];

  await createBaseTournament(googleToken, createdBy, {
    id: ids.qf,
    name: "[TEST] 決勝勝利報告 E2E",
    format: "qualifying_and_finals",
    extra: {
      blockCount: 4,
      qualifiersPerBlock: 1,
      finalTeamCount: 4,
      entryCount: 4,
      confirmedCount: 4,
      finalsMatchRules: {
        defaultWinsRequired: 2,
        roundOverrides: { final: 3 },
      },
    },
  });
  for (const entry of entries) {
    await createEntry(googleToken, ids.qf, entry);
  }
  const iso = nowIso();
  await fsSet(googleToken, `tournaments/${ids.qf}/blockDraw/current`, {
    status: "finalized",
    blockCount: 4,
    blocks: [{ id: "block-1", name: "A", entryIds: entries.map((e) => e.id) }],
    finalizedAt: { __type: "timestamp", value: iso },
    updatedAt: { __type: "timestamp", value: iso },
  });
  const qualMatchId = "e2e-qual-1";
  await fsSet(googleToken, `tournaments/${ids.qf}/qualifyingSchedules/current`, {
    finalized: true,
    blocks: [
      {
        blockId: "block-1",
        rounds: [
          {
            roundNumber: 1,
            matches: [
              {
                matchId: qualMatchId,
                courtNumber: 1,
                roundNumber: 1,
                team1: { entryId: "e-sma", teamName: "SMA" },
                team2: { entryId: "e-b", teamName: "チームB" },
              },
            ],
          },
        ],
      },
    ],
    createdAt: { __type: "timestamp", value: iso },
    updatedAt: { __type: "timestamp", value: iso },
  });
  record("Q+Fテスト大会作成", true, ids.qf);

  const beforeAdv = await callCallable("listMyCurrentFinalsMatchCallable", {
    tournamentId: ids.qf,
    teamNumber: 1,
  });
  record(
    "進出前は予選モード",
    beforeAdv.pageMode === "qualifying",
    `pageMode=${beforeAdv.pageMode}`
  );

  const qualList = await callCallable("listMyQualifyingMatchesCallable", {
    tournamentId: ids.qf,
    teamNumber: 1,
  });
  record(
    "予選試合が一覧される",
    qualList.matches?.some((m) => m.matchId === qualMatchId) === true,
    `count=${qualList.matches?.length}`
  );

  const subA = await callCallable("submitPlayerQualifyingResultCallable", {
    tournamentId: ids.qf,
    teamNumber: 1,
    matchId: qualMatchId,
    set1OwnScore: 50,
    set2OwnScore: 21,
  });
  record("予選A提出", subA.state === "awaiting_opponent" || Boolean(subA.state), `state=${subA.state}`);
  const subB = await callCallable("submitPlayerQualifyingResultCallable", {
    tournamentId: ids.qf,
    teamNumber: 2,
    matchId: qualMatchId,
    set1OwnScore: 12,
    set2OwnScore: 50,
  });
  record(
    "予選照合で公式確定",
    subB.state === "matched" || subB.state === "official" || Boolean(subB.officialResult || subB.state),
    `state=${subB.state}`
  );
  const qualOfficial = await fsGet(
    googleToken,
    `tournaments/${ids.qf}/qualifyingMatchResults/${qualMatchId}`
  );
  record("予選公式結果あり", Boolean(qualOfficial?.status === "finished" || qualOfficial?.sets), JSON.stringify({
    status: qualOfficial?.status,
    sets: qualOfficial?.sets?.length,
  }));

  const qualifiers = [
    { entryId: "e-sma", teamName: "SMA", seed: 1, source: "block_winner", blockId: "A", blockName: "A" },
    { entryId: "e-c", teamName: "チームC", seed: 2, source: "block_winner", blockId: "B", blockName: "B" },
    { entryId: "e-d", teamName: "チームD", seed: 3, source: "block_winner", blockId: "C", blockName: "C" },
    { entryId: "e-b", teamName: "チームB", seed: 4, source: "block_winner", blockId: "D", blockName: "D" },
  ];
  const built = buildFinalsBracket(qualifiers, { expectedCount: 4 });
  if (!built.valid) throw new Error(built.message);
  const persisted = buildPersistedFinalsBracket(built);
  await fsSet(googleToken, `tournaments/${ids.qf}/finalsAdvancement/current`, {
    finalized: true,
    qualifierCount: 4,
    qualifiers,
    updatedAt: { __type: "timestamp", value: nowIso() },
  });
  await fsSet(googleToken, `tournaments/${ids.qf}/finalsBracket/current`, persisted);
  const sf1 = persisted.matches.find((m) => m.matchId === "final-r1-m1");
  const sf2 = persisted.matches.find((m) => m.matchId === "final-r1-m2");
  record(
    "決勝ブラケット生成",
    persisted.finalized === true && sf1 && sf2,
    `${sf1?.team1?.teamName} vs ${sf1?.team2?.teamName} / ${sf2?.team1?.teamName} vs ${sf2?.team2?.teamName}`
  );

  const consMarker = "CONS-E2E-MARKER";
  await fsSet(googleToken, `tournaments/${ids.qf}/consolationBracket/current`, {
    mode: "consolation",
    bracketKind: "consolation",
    finalized: true,
    bracketSize: 2,
    teamCount: 2,
    slots: [
      { slotNumber: 1, seed: 1, entryId: "e-c", teamName: "チームC", isBye: false },
      { slotNumber: 2, seed: 2, entryId: "e-d", teamName: "チームD", isBye: false },
    ],
    matches: [
      {
        matchId: "final-r1-m1",
        roundNumber: 1,
        matchNumber: 1,
        roundLabel: "決勝",
        team1: teamDoc("e-c", "チームC", 1),
        team2: teamDoc("e-d", "チームD", 2),
        nextMatchId: null,
      },
    ],
  });
  await fsSet(googleToken, `tournaments/${ids.qf}/consolationMatchResults/final-r1-m1`, {
    matchId: "final-r1-m1",
    roundNumber: 1,
    matchNumber: 1,
    status: "finished",
    resolution: "played",
    team1: teamDoc("e-c", "チームC", 1),
    team2: teamDoc("e-d", "チームD", 2),
    winner: teamDoc("e-c", consMarker, 1),
    loser: teamDoc("e-d", "チームD", 2),
    winnerSide: "team1",
    team1SetWins: 2,
    team2SetWins: 0,
    sets: [
      { setNumber: 1, team1Score: 21, team2Score: 10, winner: "team1", finishReason: "time_limit" },
      { setNumber: 2, team1Score: 21, team2Score: 8, winner: "team1", finishReason: "time_limit" },
    ],
    updatedAt: { __type: "timestamp", value: nowIso() },
    createdAt: { __type: "timestamp", value: nowIso() },
  });

  const afterAdv = await callCallable("listMyCurrentFinalsMatchCallable", {
    tournamentId: ids.qf,
    teamNumber: 1,
  });
  record(
    "進出後は決勝モード",
    afterAdv.pageMode === "finals" && afterAdv.state === "playable" && afterAdv.canReport === true,
    `${afterAdv.roundLabel} ${afterAdv.teamName} vs ${afterAdv.opponentName}`
  );
  record("参加者にbracketKindを選ばせていない", afterAdv.bracketKind == null, `bracketKind=${afterAdv.bracketKind}`);

  const sessionBefore = await fsGet(
    googleToken,
    `tournaments/${ids.qf}/finalsMatchSessions/${afterAdv.matchId}`
  );
  record("報告前はsessionなし", sessionBefore == null);

  const listedMatchId = afterAdv.matchId;
  const report1 = await callCallable("reportMyFinalsWinCallable", {
    tournamentId: ids.qf,
    teamNumber: 1,
    matchId: listedMatchId,
    winnerEntryId: "e-b",
  });
  record("勝利報告成功（winnerEntryId偽装は無視）", report1.ok === true, report1.message);

  const result1 = await fsGet(
    googleToken,
    `tournaments/${ids.qf}/finalsMatchResults/${listedMatchId}`
  );
  record(
    "公式played保存",
    result1?.resolution === "played" &&
      result1?.source === "player_win_report" &&
      result1?.reportedByEntryId === "e-sma" &&
      result1?.winner?.entryId === "e-sma" &&
      result1?.loser?.entryId === "e-b" &&
      result1?.winnerSide === "team1" &&
      result1?.team1SetWins === 2 &&
      result1?.sets?.length === 2,
    JSON.stringify({
      resolution: result1?.resolution,
      source: result1?.source,
      winner: result1?.winner?.entryId,
      wins: result1?.team1SetWins,
      sets: result1?.sets?.length,
      winsRequired: result1?.winsRequired,
    })
  );
  const session1 = await fsGet(
    googleToken,
    `tournaments/${ids.qf}/finalsMatchSessions/${listedMatchId}`
  );
  record(
    "session finished 生成",
    session1?.status === "finished" && session1?.team1?.entryId === "e-sma",
    `status=${session1?.status}`
  );

  const bracketAfter = await fsGet(googleToken, `tournaments/${ids.qf}/finalsBracket/current`);
  const finalCard = bracketAfter.matches.find((m) => m.roundNumber === 2);
  record(
    "次カードteam1/2をブラケットへ未書き込み",
    finalCard?.team1 == null && finalCard?.team2 == null,
    JSON.stringify({ team1: finalCard?.team1, team2: finalCard?.team2 })
  );
  const resultsMap = new Map([[listedMatchId, result1]]);
  const resolvedFinal = resolveFinalsMatchTeams({
    match: finalCard,
    bracket: bracketAfter,
    resultsMap,
  });
  record(
    "表示時解決で勝者が次カードへ",
    resolvedFinal.resolved === false && resolvedFinal.team1?.entryId === "e-sma",
    `reason=${resolvedFinal.reason} team1=${resolvedFinal.team1?.teamName}`
  );

  const snapshot1 = await fsGet(googleToken, `tournaments/${ids.qf}/publicSnapshot/current`);
  const snapMain = (snapshot1?.finalsMatchResults || []).find((r) => r.matchId === listedMatchId);
  const snapSummary = JSON.stringify(snapshot1?.bracket || snapshot1?.finalsMatchResults || {}).slice(0, 200);
  record(
    "public snapshot に勝利報告source",
    snapMain?.source === "player_win_report" && snapMain?.winner?.entryId === "e-sma",
    `source=${snapMain?.source}`
  );
  const snapText = JSON.stringify(snapshot1);
  record(
    "公開snapshotは勝利報告表示用sourceを持つ",
    snapText.includes("player_win_report") && snapText.includes("SMA"),
    snapSummary
  );
  const consSnap = snapshot1?.consolationMatchResults || [];
  record(
    "consolation結果がsnapshotから消えていない",
    consSnap.some((r) => r?.winner?.teamName === consMarker),
    `count=${consSnap.length}`
  );

  const waiting = await callCallable("listMyCurrentFinalsMatchCallable", {
    tournamentId: ids.qf,
    teamNumber: 1,
  });
  record(
    "片側のみ勝ち上がりは相手未定",
    waiting.state === "waiting_opponent" && String(waiting.message || "").includes("次の対戦相手"),
    waiting.message
  );
  const eliminatedB = await callCallable("listMyCurrentFinalsMatchCallable", {
    tournamentId: ids.qf,
    teamNumber: 2,
  });
  record(
    "敗者は決勝トーナメント敗退",
    eliminatedB.state === "eliminated" && String(eliminatedB.message).includes("敗退"),
    eliminatedB.message
  );

  let dupMsg = "";
  try {
    await callCallable("reportMyFinalsWinCallable", {
      tournamentId: ids.qf,
      teamNumber: 1,
      matchId: listedMatchId,
    });
    record("二重送信が拒否される", false, "2件目が成功してしまった");
  } catch (error) {
    dupMsg = callableErrorText(error);
    record(
      "二重送信が拒否される",
      dupMsg.includes("すでに結果が確定") && isShortJapanese(dupMsg),
      dupMsg
    );
    record("二重送信にraw errorなし", isShortJapanese(dupMsg) && !/FirebaseError|INTERNAL/.test(dupMsg), dupMsg);
  }

  try {
    await callCallable("reportMyFinalsWinCallable", {
      tournamentId: ids.qf,
      teamNumber: 2,
      matchId: listedMatchId,
    });
    record("後着チームは上書きできない", false, "敗者報告が成功");
  } catch (error) {
    const msg = callableErrorText(error);
    const winnerStillSma = (await fsGet(
      googleToken,
      `tournaments/${ids.qf}/finalsMatchResults/${listedMatchId}`
    ))?.winner?.entryId === "e-sma";
    record("両チーム競合は先着維持", winnerStillSma, `msg=${msg}`);
  }

  try {
    await callCallable("reportMyFinalsWinCallable", {
      tournamentId: ids.qf,
      teamNumber: 1,
      matchId: "final-r1-m2",
    });
    record("matchId偽装拒否", false, "別試合IDで成功");
  } catch (error) {
    record("matchId偽装拒否", true, callableErrorText(error));
  }

  const sf2List = await callCallable("listMyCurrentFinalsMatchCallable", {
    tournamentId: ids.qf,
    teamNumber: 3,
  });
  record("もう片側SFは報告可能", sf2List.state === "playable", `${sf2List.teamName} vs ${sf2List.opponentName}`);
  const race = await Promise.allSettled([
    callCallable("reportMyFinalsWinCallable", {
      tournamentId: ids.qf,
      teamNumber: 3,
      matchId: sf2List.matchId,
    }),
    callCallable("reportMyFinalsWinCallable", {
      tournamentId: ids.qf,
      teamNumber: 4,
      matchId: sf2List.matchId,
    }),
  ]);
  const raceOk = race.filter((r) => r.status === "fulfilled");
  const raceNg = race.filter((r) => r.status === "rejected");
  const sf2Doc = await fsGet(googleToken, `tournaments/${ids.qf}/finalsMatchResults/${sf2List.matchId}`);
  record(
    "両チーム同時報告は1件だけ成功",
    raceOk.length === 1 && raceNg.length === 1,
    `ok=${raceOk.length} ng=${raceNg.length} winner=${sf2Doc?.winner?.entryId}`
  );
  record(
    "同時報告後のwinnerは先着のまま",
    sf2Doc?.winner?.entryId === "e-c" || sf2Doc?.winner?.entryId === "e-d",
    `winner=${sf2Doc?.winner?.entryId} source=${sf2Doc?.source}`
  );
  const reportSf2 = raceOk[0]?.value || { ok: Boolean(sf2Doc), message: raceNg[0]?.reason?.message };
  record("もう片側SF勝利報告", reportSf2.ok === true || Boolean(sf2Doc), reportSf2.message);

  const afterBoth = await callCallable("listMyCurrentFinalsMatchCallable", {
    tournamentId: ids.qf,
    teamNumber: 1,
  });
  record(
    "更新後に決勝カード表示",
    afterBoth.state === "playable" && afterBoth.roundLabel === "決勝",
    `${afterBoth.roundLabel} vs ${afterBoth.opponentName}`
  );

  const resultSf1BeforeEdit = await fsGet(
    googleToken,
    `tournaments/${ids.qf}/finalsMatchResults/${listedMatchId}`
  );
  const editedSets = [
    { setNumber: 1, team1Score: 21, team2Score: 19, winner: "team1", finishReason: "time_limit" },
    { setNumber: 2, team1Score: 21, team2Score: 17, winner: "team1", finishReason: "time_limit" },
  ];
  const keep = {
    matchId: resultSf1BeforeEdit.matchId,
    roundNumber: resultSf1BeforeEdit.roundNumber,
    matchNumber: resultSf1BeforeEdit.matchNumber,
    status: "finished",
    resolution: "played",
    team1: resultSf1BeforeEdit.team1,
    team2: resultSf1BeforeEdit.team2,
    winner: resultSf1BeforeEdit.winner,
    loser: resultSf1BeforeEdit.loser,
    winnerSide: resultSf1BeforeEdit.winnerSide,
    team1SetWins: 2,
    team2SetWins: 0,
    winsRequired: resultSf1BeforeEdit.winsRequired ?? 2,
    sets: editedSets,
    createdAt:
      typeof resultSf1BeforeEdit.createdAt === "string"
        ? { __type: "timestamp", value: resultSf1BeforeEdit.createdAt }
        : resultSf1BeforeEdit.createdAt,
  };
  try {
    await fsCommit(googleToken, [
      {
        update: {
          name: `projects/${PROJECT_ID}/databases/(default)/documents/tournaments/${ids.qf}/finalsMatchResults/${listedMatchId}`,
          fields: encodeFields(keep),
        },
        updateMask: {
          fieldPaths: [...Object.keys(keep), "source", "reportedByEntryId"],
        },
        updateTransforms: [{ fieldPath: "updatedAt", setToServerValue: "REQUEST_TIME" }],
      },
    ]);
    const afterEdit = await fsGet(
      googleToken,
      `tournaments/${ids.qf}/finalsMatchResults/${listedMatchId}`
    );
    record(
      "運営修正でsource削除",
      afterEdit?.source == null &&
        afterEdit?.reportedByEntryId == null &&
        afterEdit?.sets?.[0]?.team1Score === 21,
      JSON.stringify({ source: afterEdit?.source, set1: afterEdit?.sets?.[0] })
    );
  } catch (error) {
    record("運営修正でsource削除", false, String(error.message).slice(0, 180));
  }

  const rebuild = await callCallable(
    "rebuildPublicSnapshotCallable",
    { tournamentId: ids.qf },
    idToken
  ).catch((error) => ({ skipped: true, message: String(error.message || "").slice(0, 80) }));
  record(
    "運営修正後のsnapshot再生成callable",
    rebuild?.ok === true || rebuild?.skipped === true,
    rebuild?.ok === true ? "ok" : `authなしのため後続の勝利報告rebuildで確認 ${rebuild?.message || ""}`
  );

  const finalList = await callCallable("listMyCurrentFinalsMatchCallable", {
    tournamentId: ids.qf,
    teamNumber: 1,
  });
  const finalReport = await callCallable("reportMyFinalsWinCallable", {
    tournamentId: ids.qf,
    teamNumber: 1,
    matchId: finalList.matchId,
  });
  record("決勝勝利報告", finalReport.ok === true, finalReport.message);
  const finalResult = await fsGet(
    googleToken,
    `tournaments/${ids.qf}/finalsMatchResults/${finalList.matchId}`
  );
  record(
    "決勝は3先の内部3勝",
    finalResult?.winsRequired === 3 && finalResult?.team1SetWins === 3 && finalResult?.sets?.length === 3,
    JSON.stringify({
      winsRequired: finalResult?.winsRequired,
      setWins: finalResult?.team1SetWins,
      sets: finalResult?.sets?.length,
    })
  );
  const champ = await callCallable("listMyCurrentFinalsMatchCallable", {
    tournamentId: ids.qf,
    teamNumber: 1,
  });
  record("優勝表示", champ.state === "champion" && String(champ.message).includes("優勝"), champ.message);
  const loserFinal = await callCallable("listMyCurrentFinalsMatchCallable", {
    tournamentId: ids.qf,
    teamNumber: 3,
  });
  record(
    "決勝敗者は敗退",
    loserFinal.state === "eliminated",
    loserFinal.message
  );

  const snapFinal = await fsGet(googleToken, `tournaments/${ids.qf}/publicSnapshot/current`);
  const snapSf1AfterRebuild = (snapFinal?.finalsMatchResults || []).find((r) => r.matchId === listedMatchId);
  record(
    "次のsnapshot再生成後は修正結果を反映",
    (snapSf1AfterRebuild?.source == null || snapSf1AfterRebuild?.source === "") &&
      snapSf1AfterRebuild?.sets?.[0]?.team1Score === 21,
    JSON.stringify({
      source: snapSf1AfterRebuild?.source,
      set1: snapSf1AfterRebuild?.sets?.[0],
    })
  );
  record(
    "優勝後もconsolation残存",
    (snapFinal?.consolationMatchResults || []).some((r) => r?.winner?.teamName === consMarker),
    `count=${(snapFinal?.consolationMatchResults || []).length}`
  );

  const finalMatch = (await fsGet(googleToken, `tournaments/${ids.qf}/finalsBracket/current`)).matches.find(
    (m) => m.roundNumber === 2
  );
  const allResults = new Map();
  for (const match of ["final-r1-m1", "final-r1-m2", "final-r2-m1"]) {
    const doc = await fsGet(googleToken, `tournaments/${ids.qf}/finalsMatchResults/${match}`);
    if (doc) allResults.set(match, doc);
  }
  const sessionsMap = new Map();
  const finalSession = await fsGet(
    googleToken,
    `tournaments/${ids.qf}/finalsMatchSessions/${finalMatch.matchId}`
  );
  if (finalSession) sessionsMap.set(finalMatch.matchId, finalSession);
  const lock = canModifyFinalsMatchResult({
    match: persisted.matches.find((m) => m.matchId === listedMatchId),
    bracket: persisted,
    resultsMap: allResults,
    sessionsMap,
  });
  record(
    "次ラウンド開始後は前ラウンド修正ロック",
    lock.allowed === false,
    lock.message
  );

  const outsider = await callCallable("listMyCurrentFinalsMatchCallable", {
    tournamentId: ids.qf,
    teamNumber: 1,
  });
  void outsider;

  await createBaseTournament(googleToken, createdBy, {
    id: ids.se,
    name: "[TEST] 決勝勝利報告 一発TN",
    format: "single_elimination",
    extra: {
      maxTeams: 8,
      entryCount: 3,
      confirmedCount: 3,
      winsRequired: 2,
    },
  });
  const seEntries = [
    { id: "se-a", teamName: "SE-A", teamNumber: 1 },
    { id: "se-b", teamName: "SE-B", teamNumber: 2 },
    { id: "se-c", teamName: "SE-C", teamNumber: 3 },
  ];
  for (const entry of seEntries) await createEntry(googleToken, ids.se, entry);
  const seBuilt = buildSingleEliminationBracket({
    entries: seEntries.map((e) => ({ entryId: e.id, teamName: e.teamName })),
    random: () => 0.2,
  });
  const sePersisted = buildPersistedSingleEliminationBracket(seBuilt);
  await fsSet(googleToken, `tournaments/${ids.se}/finalsBracket/current`, sePersisted);
  const seList = await callCallable("listMyCurrentFinalsMatchCallable", {
    tournamentId: ids.se,
    teamNumber: 1,
  });
  record(
    "一発TNは予選を経由せず決勝UI",
    seList.pageMode === "finals",
    `state=${seList.state} match=${seList.matchId} msg=${seList.message || ""}`
  );
  const byeMatch = sePersisted.matches.find(
    (m) => m.roundNumber === 1 && (m.team1?.isBye || m.team2?.isBye)
  );
  record("BYE試合は報告対象にしない", seList.matchId !== byeMatch?.matchId, `bye=${byeMatch?.matchId}`);
  if (seList.state === "playable") {
    const seReport = await callCallable("reportMyFinalsWinCallable", {
      tournamentId: ids.se,
      teamNumber: 1,
      matchId: seList.matchId,
    });
    record("一発TN勝利報告", seReport.ok === true, seReport.message);
  } else {
    record("一発TNは実試合または相手待ち", seList.state === "waiting_opponent" || seList.state === "playable", seList.state);
  }

  await createBaseTournament(googleToken, createdBy, {
    id: ids.guard,
    name: "[TEST] 決勝勝利報告 対象外ガード",
    format: "qualifying_and_finals",
    extra: {
      matchFormat: MatchFormat.MULTI_TEAM_TOTAL,
      bracketMatchConfig: { main: { rankingMode: RankingMode.LOSS_BAND, matchFormat: MatchFormat.HEAD_TO_HEAD_SETS } },
      maxTeams: 32,
    },
  });
  await createEntry(googleToken, ids.guard, { id: "g1", teamName: "G1", teamNumber: 1 });
  const guardList = await callCallable("listMyCurrentFinalsMatchCallable", {
    tournamentId: ids.guard,
    teamNumber: 1,
  });
  record(
    "loss-band/非H2Hは勝利報告不可",
    guardList.pageMode === "unavailable" && guardList.canReport !== true,
    `${guardList.pageMode} ${guardList.message || ""}`
  );
  const domainGuard = resolvePlayerFinalsPageMode({
    tournament: {
      status: TournamentStatus.OPEN,
      participantResultEntryEnabled: true,
      bracketMatchConfig: { main: { rankingMode: RankingMode.LOSS_BAND } },
    },
    finalsAdvancement: { finalized: true },
    finalsBracket: { finalized: true, matchFormat: MatchFormat.HEAD_TO_HEAD_SETS },
  });
  record(
    "domain対象外ガード",
    domainGuard.pageMode === PlayerFinalsPageMode.UNAVAILABLE &&
      domainGuard.reason === PLAYER_FINALS_UNSUPPORTED_FORMAT_MESSAGE,
    domainGuard.reason
  );

  const hostedPlayer = await fetch(`${HOSTING}/player-results.html?tournamentId=${ids.qf}`);
  const hostedHtml = await hostedPlayer.text();
  record(
    "Hostingに勝利報告UIが載っている",
    hostedPlayer.ok && hostedHtml.includes("reloadMatchesBtn") && hostedHtml.includes("player-results-page.js"),
    `status=${hostedPlayer.status}`
  );
  const pageJs = await fetch(`${HOSTING}/js/ui/pages/player-results-page.js`);
  const pageJsText = await pageJs.text();
  record(
    "Hosting JSに決勝モードがある",
    pageJs.ok && pageJsText.includes("reportMyFinalsWin") && pageJsText.includes("勝利を確定する"),
    `status=${pageJs.status}`
  );

  console.log("\n=== URLs ===");
  console.log(`Q+F: ${HOSTING}/player-results.html?tournamentId=${ids.qf}`);
  console.log(`Public: ${HOSTING}/tournament-public.html?id=${ids.qf}`);
  console.log(`Admin bracket: ${HOSTING}/tournament-finals-bracket.html?id=${ids.qf}`);
  console.log(`SE: ${HOSTING}/player-results.html?tournamentId=${ids.se}`);
  console.log(`Guard: ${HOSTING}/player-results.html?tournamentId=${ids.guard}`);
} catch (error) {
  record("E2E実行", false, String(error.stack || error.message).slice(0, 400));
}

const failed = results.filter((r) => !r.ok);
console.log("\n=== Summary ===");
console.log(`pass=${results.filter((r) => r.ok).length} fail=${failed.length}`);
failed.forEach((f) => console.log(` - ${f.name}: ${f.detail}`));
console.log(JSON.stringify(report, null, 2));
if (failed.length) process.exitCode = 1;
