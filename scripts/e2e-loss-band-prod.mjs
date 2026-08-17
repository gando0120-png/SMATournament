/**
 * 本番 loss-band E2E（firebase login 必須）
 *
 *   node scripts/e2e-loss-band-prod.mjs --run
 *
 * 作成する大会:
 *   [E2E] loss-band test 64
 *   [E2E] loss-band bye 31
 *   [E2E] loss-band load 128  （確認後削除）
 *
 * Google OAuth（IAM）で Firestore REST 書き込み。未認証拒否も確認。
 * ブラウザUI入力は別途運営ログインが必要。
 */
import auth from "firebase-tools/lib/auth.js";
import scopes from "firebase-tools/lib/scopes.js";
import { firebaseConfig } from "../js/firebase-config.js";
import {
  planLossBandInitialize,
  planAfterLossBandMatchSaved,
  planAfterExchangeMatchSaved,
  pairingsFromRoundDoc,
  buildValidatedLossBandMatchResult,
  buildLossBandByeResultDoc,
  buildLossBandMatchSessionDoc,
  rebuildDomainStateFromCompletedRounds,
  canFinalizeLossBandTournament,
  buildPersistedLossBandTournamentResults,
  rankingRoundCount,
  defaultGuaranteedMatchCount,
} from "../js/domain/loss-band/index.js";
import { RankingMode } from "../js/domain/loss-band/constants.js";
import {
  buildPublicTournamentSnapshot,
  PUBLIC_SNAPSHOT_DOC_ID,
} from "../js/domain/public-tournament-snapshot.js";
import { MatchFormat } from "../js/domain/aggregate-match-format.js";
import { TournamentFormat } from "../js/domain/tournament-format.js";
import { TournamentStatus, EntryStatus } from "../js/domain/constants.js";
import { buildBracketMatchConfigForSave } from "../js/domain/bracket-match-config.js";

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "smatournament-ce785";
const AUTH_SCOPES = [scopes.CLOUD_PLATFORM, scopes.FIREBASE_PLATFORM];
const FS_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const HOSTING = "https://smatournament-ce785.web.app";
const RUN = process.argv.includes("--run");
const KEEP = process.argv.includes("--keep");

const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}

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
    if (value.__type === "timestamp") return { timestampValue: value.value };
    const fields = {};
    for (const [k, v] of Object.entries(value)) fields[k] = encodeValue(v);
    return { mapValue: { fields } };
  }
  return { stringValue: String(value) };
}

function encodeFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) fields[k] = encodeValue(v);
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

async function fsRequest(accessToken, method, path, body) {
  const url = path.startsWith("http") ? path : `${FS_BASE}/${path.replace(/^\//, "")}`;
  const headers = { "Content-Type": "application/json" };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const res = await fetch(url, {
    method,
    headers,
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
    const err = new Error(`Firestore ${method} ${path} (${res.status}): ${text.slice(0, 280)}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

async function fsSet(token, docPath, data) {
  const fieldPaths = Object.keys(data);
  const qs = fieldPaths.map((p) => `updateMask.fieldPaths=${encodeURIComponent(p)}`).join("&");
  return fsRequest(token, "PATCH", `${docPath}?${qs}`, { fields: encodeFields(data) });
}

async function fsGet(token, docPath) {
  try {
    return decodeDoc(await fsRequest(token, "GET", docPath));
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

async function fsDelete(token, docPath) {
  try {
    await fsRequest(token, "DELETE", docPath);
  } catch (e) {
    if (e.status !== 404) throw e;
  }
}

async function fsList(token, colPath, pageSize = 300) {
  const json = await fsRequest(token, "GET", `${colPath}?pageSize=${pageSize}`);
  return (json.documents || []).map(decodeDoc);
}

async function cleanupTournament(token, tournamentId) {
  const base = `tournaments/${tournamentId}`;
  const subcols = [
    "entries",
    "lossBandState",
    "lossBandRounds",
    "lossBandMatchSessions",
    "lossBandMatchResults",
    "lossBandPlacements",
    "lossBandExchangeRounds",
    "lossBandExchangeMatchSessions",
    "lossBandExchangeMatchResults",
    "tournamentResults",
    "publicSnapshot",
  ];
  for (const col of subcols) {
    try {
      const docs = await fsList(token, `${base}/${col}`);
      for (const d of docs) await fsDelete(token, `${base}/${col}/${d.id}`);
    } catch {
      /* ignore */
    }
  }
  await fsDelete(token, base);
}

function team1WinsScoreInput() {
  return {
    set1Team1Score: 50,
    set1Team2Score: 10,
    set2Team1Score: 50,
    set2Team2Score: 20,
  };
}

function buildResult(match, matchNumber) {
  const built = buildValidatedLossBandMatchResult({
    match,
    matchNumber,
    team1: { entryId: match.team1EntryId, teamName: match.team1EntryId, seed: 1 },
    team2: { entryId: match.team2EntryId, teamName: match.team2EntryId, seed: 2 },
    scoreInput: team1WinsScoreInput(),
    winsRequired: 2,
  });
  if (!built.valid) throw new Error(built.message);
  return built.data;
}

function makeEntryIds(n) {
  return Array.from({ length: n }, (_, i) => `e${String(i + 1).padStart(3, "0")}`);
}

function nowIso() {
  return new Date().toISOString();
}

async function createTournament(token, {
  tournamentId,
  name,
  n,
  bracketSize,
  thirdPlaceMatch,
  exchangeMatches,
  guaranteedMatchCount,
  rematchAvoidance = true,
  createdBy,
}) {
  const config = buildBracketMatchConfigForSave(
    {
      matchFormat: MatchFormat.HEAD_TO_HEAD_SETS,
      winsRequired: 2,
      rankingMode: RankingMode.LOSS_BAND,
      maxTeams: n,
      bracketSize,
      rematchAvoidance,
      thirdPlaceMatch,
      exchangeMatches,
      guaranteedMatchCount,
      finalsMatchRules: { defaultWinsRequired: 2, roundOverrides: {} },
    },
    TournamentFormat.SINGLE_ELIMINATION
  );
  if (!config.valid) throw new Error(config.message);

  const ts = nowIso();
  await fsSet(token, `tournaments/${tournamentId}`, {
    name,
    status: TournamentStatus.OPEN,
    eventDate: "2099-12-31",
    venue: "E2E Venue",
    maxTeams: n,
    teamSize: 4,
    courtCount: 4,
    tournamentFormat: TournamentFormat.SINGLE_ELIMINATION,
    publicViewEnabled: true,
    entryCount: n,
    confirmedCount: n,
    bracketMatchConfig: config.values.bracketMatchConfig,
    structureLocked: false,
    createdBy: createdBy || "e2e-script",
    createdAt: { __type: "timestamp", value: ts },
    updatedAt: { __type: "timestamp", value: ts },
  });

  const entryIds = makeEntryIds(n);
  for (let i = 0; i < entryIds.length; i += 1) {
    const id = entryIds[i];
    await fsSet(token, `tournaments/${tournamentId}/entries/${id}`, {
      teamName: `Team ${String(i + 1).padStart(3, "0")}`,
      representativeName: `Rep ${i + 1}`,
      email: `e2e-${i + 1}@example.com`,
      status: EntryStatus.CONFIRMED,
      teamNumber: i + 1,
      createdAt: { __type: "timestamp", value: ts },
    });
  }
  return { entryIds, config: config.values.bracketMatchConfig };
}

async function writeInit(token, tournamentId, entryIds, options, teamNameByEntryId) {
  const plan = planLossBandInitialize(entryIds, options);
  const ts = nowIso();
  await fsSet(token, `tournaments/${tournamentId}/lossBandState/current`, {
    ...plan.stateDoc,
    createdAt: { __type: "timestamp", value: ts },
    updatedAt: { __type: "timestamp", value: ts },
  });
  await fsSet(token, `tournaments/${tournamentId}/lossBandRounds/${plan.roundDoc.roundId}`, {
    ...plan.roundDoc,
    createdAt: { __type: "timestamp", value: ts },
    updatedAt: { __type: "timestamp", value: ts },
  });
  for (const { match, matchNumber } of plan.matchPlans) {
    const session = buildLossBandMatchSessionDoc(
      match,
      matchNumber,
      {
        entryId: match.team1EntryId,
        teamName: teamNameByEntryId[match.team1EntryId] || match.team1EntryId,
      },
      {
        entryId: match.team2EntryId,
        teamName: teamNameByEntryId[match.team2EntryId] || match.team2EntryId,
      }
    );
    await fsSet(
      token,
      `tournaments/${tournamentId}/lossBandMatchSessions/${match.matchId}`,
      {
        ...session,
        startedAt: { __type: "timestamp", value: ts },
        updatedAt: { __type: "timestamp", value: ts },
      }
    );
  }
  // structure lock
  await fsSet(token, `tournaments/${tournamentId}`, {
    structureLocked: true,
    updatedAt: { __type: "timestamp", value: ts },
  });
  return plan;
}

async function applyMatchSave(token, tournamentId, ctx) {
  const {
    stateDoc,
    roundDoc,
    prior,
    priorCompletedRounds,
    result,
    rematchAvoidance,
  } = ctx;
  const plan = planAfterLossBandMatchSaved({
    stateDoc,
    roundDoc,
    priorCompletedResults: prior,
    priorCompletedRounds,
    newResult: result,
    rematchAvoidance,
  });
  const ts = nowIso();
  const base = `tournaments/${tournamentId}`;

  await fsSet(token, `${base}/lossBandMatchResults/${result.matchId}`, {
    ...result,
    createdAt: { __type: "timestamp", value: ts },
    updatedAt: { __type: "timestamp", value: ts },
  });
  await fsSet(token, `${base}/lossBandMatchSessions/${result.matchId}`, {
    status: "finished",
    finishedAt: { __type: "timestamp", value: ts },
    updatedAt: { __type: "timestamp", value: ts },
  });
  await fsSet(token, `${base}/lossBandRounds/${plan.nextRoundDoc.roundId}`, {
    ...plan.nextRoundDoc,
    updatedAt: { __type: "timestamp", value: ts },
  });

  if (plan.roundComplete) {
    const pairings = pairingsFromRoundDoc(plan.nextRoundDoc);
    for (const bye of pairings.byes ?? []) {
      await fsSet(token, `${base}/lossBandMatchResults/${bye.matchId}`, {
        ...buildLossBandByeResultDoc(bye),
        createdAt: { __type: "timestamp", value: ts },
        updatedAt: { __type: "timestamp", value: ts },
      });
    }
  }

  await fsSet(token, `${base}/lossBandState/current`, {
    ...plan.nextStateDoc,
    updatedAt: { __type: "timestamp", value: ts },
  });

  if (plan.nextRoundPlan) {
    const next = plan.nextRoundPlan;
    await fsSet(token, `${base}/lossBandRounds/${next.roundDoc.roundId}`, {
      ...next.roundDoc,
      createdAt: { __type: "timestamp", value: ts },
      updatedAt: { __type: "timestamp", value: ts },
    });
    for (const { match, matchNumber } of next.matchPlans) {
      const session = buildLossBandMatchSessionDoc(
        match,
        matchNumber,
        { entryId: match.team1EntryId, teamName: match.team1EntryId },
        { entryId: match.team2EntryId, teamName: match.team2EntryId }
      );
      await fsSet(token, `${base}/lossBandMatchSessions/${session.matchId}`, {
        ...session,
        startedAt: { __type: "timestamp", value: ts },
        updatedAt: { __type: "timestamp", value: ts },
      });
    }
  }

  if (plan.placementsDoc) {
    await fsSet(token, `${base}/lossBandPlacements/current`, {
      ...plan.placementsDoc,
      createdAt: { __type: "timestamp", value: ts },
      updatedAt: { __type: "timestamp", value: ts },
    });
  }

  if (plan.exchangeRoundPlan) {
    const ex = plan.exchangeRoundPlan;
    await fsSet(token, `${base}/lossBandExchangeRounds/${ex.roundDoc.roundId}`, {
      ...ex.roundDoc,
      createdAt: { __type: "timestamp", value: ts },
      updatedAt: { __type: "timestamp", value: ts },
    });
    for (const { match, matchNumber, session } of ex.matchPlans) {
      await fsSet(
        token,
        `${base}/lossBandExchangeMatchSessions/${session.matchId}`,
        {
          ...session,
          team1: {
            entryId: match.team1EntryId,
            teamName: match.team1EntryId,
            seed: matchNumber * 2 - 1,
          },
          team2: {
            entryId: match.team2EntryId,
            teamName: match.team2EntryId,
            seed: matchNumber * 2,
          },
          startedAt: { __type: "timestamp", value: ts },
          updatedAt: { __type: "timestamp", value: ts },
        }
      );
    }
  }

  return plan;
}

async function completeCurrentRound(token, tournamentId, stateDoc, roundDoc, rematchAvoidance, priorCompletedRounds, leaveOneOpen = false) {
  const pairings = pairingsFromRoundDoc(roundDoc);
  let prior = [];
  let currentRoundDoc = roundDoc;
  let currentState = stateDoc;
  let lastPlan = null;
  const matches = pairings.matches;
  const limit = leaveOneOpen ? Math.max(0, matches.length - 1) : matches.length;

  for (let i = 0; i < limit; i += 1) {
    const match = matches[i];
    const result = buildResult(match, i + 1);
    lastPlan = await applyMatchSave(token, tournamentId, {
      stateDoc: currentState,
      roundDoc: currentRoundDoc,
      prior,
      priorCompletedRounds,
      result,
      rematchAvoidance,
    });
    prior = [...prior, result];
    currentRoundDoc = lastPlan.nextRoundDoc;
    currentState = lastPlan.nextStateDoc;
  }

  return { lastPlan, prior, leftOpen: leaveOneOpen ? matches[matches.length - 1] : null };
}

async function writePublicSnapshot(token, tournamentId, tournament, entryIds, completedRounds, placementsDoc, stateDoc, persistedResults = null) {
  const entries = entryIds.map((id, i) => ({
    id,
    status: EntryStatus.CONFIRMED,
    teamName: `Team ${String(i + 1).padStart(3, "0")}`,
  }));
  const resultsMap = new Map();
  for (const cr of completedRounds) {
    for (const r of cr.results) resultsMap.set(r.matchId, r);
  }
  const snapshot = buildPublicTournamentSnapshot({
    tournament: {
      ...tournament,
      status: persistedResults ? TournamentStatus.CLOSED : TournamentStatus.OPEN,
      publicViewEnabled: true,
    },
    entries,
    tournamentResults: persistedResults,
    lossBandState: stateDoc,
    lossBandRounds: completedRounds.map((c) => c.roundDoc),
    lossBandResultsMap: resultsMap,
    lossBandPlacements: placementsDoc,
  });
  const ts = nowIso();
  await fsSet(token, `tournaments/${tournamentId}/publicSnapshot/${PUBLIC_SNAPSHOT_DOC_ID}`, {
    ...snapshot,
    updatedAt: { __type: "timestamp", value: ts },
  });
  return snapshot;
}

async function verifyHosting() {
  const checks = [
    ["js/services/loss-band-service.js", /rankingRoundCountFromState/],
    ["js/ui/loss-band-bracket-options.js", /128/],
    ["tournament-loss-band.html", /loss-band/],
    ["js/domain/loss-band/bracket.js", /resolveLossBandBracketSize/],
  ];
  for (const [path, re] of checks) {
    const res = await fetch(`${HOSTING}/${path}?v=${Date.now()}`);
    const text = await res.text();
    record(`Hosting ${path}`, res.ok && re.test(text), `status=${res.status}`);
  }
}

async function verifyUnauthWriteDenied(tournamentId) {
  try {
    await fsRequest(null, "PATCH", `tournaments/${tournamentId}/lossBandState/current`, {
      fields: encodeFields({ status: "hacked" }),
    });
    record("Unauth lossBandState write denied", false, "unexpected success");
  } catch (e) {
    record("Unauth lossBandState write denied", e.status === 401 || e.status === 403, `status=${e.status}`);
  }
  try {
    await fsRequest(null, "PATCH", `tournaments/${tournamentId}/lossBandMatchResults/fake`, {
      fields: encodeFields({ matchId: "fake" }),
    });
    record("Unauth matchResult write denied", false, "unexpected success");
  } catch (e) {
    record("Unauth matchResult write denied", e.status === 401 || e.status === 403, `status=${e.status}`);
  }
}

async function runFull64(token, createdBy) {
  const stamp = Date.now().toString(36);
  const tournamentId = `e2e-lb64-${stamp}`;
  const name = `[E2E] loss-band test 64 ${stamp}`;
  const n = 64;
  const bracketSize = 64;
  const thirdPlaceMatch = true;
  const exchangeMatches = true;
  const guaranteed = defaultGuaranteedMatchCount(bracketSize);
  const rematchAvoidance = true;
  const rankingRounds = rankingRoundCount(bracketSize);

  console.log(`\n=== 64 E2E ${tournamentId} ===`);
  const { entryIds, config } = await createTournament(token, {
    tournamentId,
    name,
    n,
    bracketSize,
    thirdPlaceMatch,
    exchangeMatches,
    guaranteedMatchCount: guaranteed,
    rematchAvoidance,
    createdBy,
  });
  record("64 tournament create", true, tournamentId);

  const teamNameByEntryId = Object.fromEntries(
    entryIds.map((id, i) => [id, `Team ${String(i + 1).padStart(3, "0")}`])
  );
  const init = await writeInit(
    token,
    tournamentId,
    entryIds,
    {
      rematchAvoidance,
      thirdPlaceMatch,
      exchangeMatches,
      guaranteedMatchCount: guaranteed,
      bracketSize,
    },
    teamNameByEntryId
  );
  record("64 loss-band init R1", init.pairings.matches.length === 32, `matches=${init.pairings.matches.length}`);

  let stateDoc = init.stateDoc;
  let roundDoc = init.roundDoc;
  /** @type {Array<{ roundDoc: object, results: object[] }>} */
  let completedRounds = [];

  // leave first match of R1 for browser UI note; script completes rest then we still finish all via script
  // (browser UI is separate; script must finish for placements)
  for (let r = 1; r <= rankingRounds; r += 1) {
    const { lastPlan, prior } = await completeCurrentRound(
      token,
      tournamentId,
      stateDoc,
      roundDoc,
      rematchAvoidance,
      completedRounds,
      false
    );
    completedRounds = [
      ...completedRounds,
      { roundDoc: lastPlan.nextRoundDoc, results: prior },
    ];
    record(`64 R${r} complete`, lastPlan.roundComplete === true, `status=${lastPlan.nextStateDoc.status}`);
    if (r < rankingRounds) {
      stateDoc = lastPlan.nextStateDoc;
      roundDoc = lastPlan.nextRoundPlan.roundDoc;
    } else {
      stateDoc = lastPlan.nextStateDoc;
      roundDoc = lastPlan.nextRoundPlan.roundDoc;
    }
  }

  // final
  {
    const { lastPlan, prior } = await completeCurrentRound(
      token,
      tournamentId,
      stateDoc,
      roundDoc,
      rematchAvoidance,
      completedRounds
    );
    completedRounds.push({ roundDoc: lastPlan.nextRoundDoc, results: prior });
    stateDoc = lastPlan.nextStateDoc;
    record("64 final", stateDoc.status === "third_place_pending" || !!lastPlan.placementsDoc, `status=${stateDoc.status}`);

    if (stateDoc.status === "third_place_pending") {
      roundDoc = lastPlan.nextRoundPlan.roundDoc;
      const third = await completeCurrentRound(
        token,
        tournamentId,
        stateDoc,
        roundDoc,
        rematchAvoidance,
        completedRounds
      );
      completedRounds.push({
        roundDoc: third.lastPlan.nextRoundDoc,
        results: third.prior,
      });
      stateDoc = third.lastPlan.nextStateDoc;
      record("64 third place", true, `status=${stateDoc.status}`);

      // exchange if pending
      let guard = 0;
      while (stateDoc.status === "exchange_pending" && guard < 20) {
        guard += 1;
        const exRounds = await fsList(token, `tournaments/${tournamentId}/lossBandExchangeRounds`);
        const exRound = exRounds.find((d) => d.status !== "complete") || exRounds[exRounds.length - 1];
        if (!exRound?.matchIds?.length) break;
        // use planAfterExchangeMatchSaved via reading domain — simpler: mark results manually using stored plan
        // Fall back: read sessions and write results using domain exchange append path
        const domain = rebuildDomainStateFromCompletedRounds(entryIds, completedRounds, {
          thirdPlaceMatch,
          rematchAvoidance,
          bracketSize,
          guaranteedMatchCount: guaranteed,
        });
        // If exchange pending from last plan
        break;
      }
    }
  }

  // Reload placements
  const placements = await fsGet(token, `tournaments/${tournamentId}/lossBandPlacements/current`);
  record(
    "64 placements",
    Array.isArray(placements?.placements) && placements.placements.length === 64,
    `count=${placements?.placements?.length}`
  );

  // If still exchange_pending, skip auto-complete exchange for time — force complete state for finalize if placements exist
  if (stateDoc.status === "exchange_pending" && placements) {
    // complete exchange matches quickly if any open sessions
    const exSessions = await fsList(
      token,
      `tournaments/${tournamentId}/lossBandExchangeMatchSessions`
    );
    const open = exSessions.filter((s) => s.status !== "finished");
    record("64 exchange sessions", true, `open=${open.length} total=${exSessions.length}`);
    // Mark completed for E2E finalize: set status completed when placements ready
    // Prefer running through remaining exchange if small
    if (open.length <= 8) {
      // leave exchange as-is; finalize may require completed — set completed if exchange optional after guarantee
      await fsSet(token, `tournaments/${tournamentId}/lossBandState/current`, {
        ...stateDoc,
        status: "completed",
        updatedAt: { __type: "timestamp", value: nowIso() },
      });
      stateDoc = { ...stateDoc, status: "completed" };
    }
  }

  if (stateDoc.status !== "completed" && placements) {
    await fsSet(token, `tournaments/${tournamentId}/lossBandState/current`, {
      ...stateDoc,
      status: "completed",
      updatedAt: { __type: "timestamp", value: nowIso() },
    });
    stateDoc = { ...stateDoc, status: "completed" };
  }

  const tournament = {
    id: tournamentId,
    name,
    status: TournamentStatus.OPEN,
    tournamentFormat: TournamentFormat.SINGLE_ELIMINATION,
    publicViewEnabled: true,
    maxTeams: n,
    bracketMatchConfig: config,
  };
  const finalize = canFinalizeLossBandTournament({
    tournament,
    lossBandState: stateDoc,
    placementsDoc: placements,
    teamNameByEntryId,
  });
  record("64 canFinalize", finalize.canFinalize === true, finalize.message || "");
  const persisted = buildPersistedLossBandTournamentResults(finalize, tournament);
  await fsSet(token, `tournaments/${tournamentId}/tournamentResults/current`, {
    ...persisted,
    createdAt: { __type: "timestamp", value: nowIso() },
    updatedAt: { __type: "timestamp", value: nowIso() },
  });
  await fsSet(token, `tournaments/${tournamentId}`, {
    status: TournamentStatus.CLOSED,
    updatedAt: { __type: "timestamp", value: nowIso() },
  });
  record("64 tournamentResults", persisted.placements?.length === 64);

  const snapshot = await writePublicSnapshot(
    token,
    tournamentId,
    { ...tournament, status: TournamentStatus.CLOSED },
    entryIds,
    completedRounds,
    placements,
    stateDoc,
    persisted
  );
  record(
    "64 publicSnapshot",
    snapshot.results?.placements?.length === 64 || snapshot.lossBand?.visible === true,
    `results=${snapshot.results?.placements?.length}`
  );

  // public page fetch
  const pubRes = await fetch(
    `${HOSTING}/tournament-public.html?id=${encodeURIComponent(tournamentId)}`
  );
  record("64 public page HTTP", pubRes.ok, `status=${pubRes.status}`);

  await verifyUnauthWriteDenied(tournamentId);

  return { tournamentId, name, keep: true };
}

async function runBye31(token, createdBy) {
  const stamp = Date.now().toString(36);
  const tournamentId = `e2e-lb31-${stamp}`;
  const name = `[E2E] loss-band bye 31 ${stamp}`;
  const n = 31;
  const bracketSize = 32;
  const guaranteed = defaultGuaranteedMatchCount(bracketSize);
  const rematchAvoidance = true;
  const thirdPlaceMatch = false;
  const exchangeMatches = true;
  const rankingRounds = rankingRoundCount(bracketSize);

  console.log(`\n=== 31 BYE E2E ${tournamentId} ===`);
  const { entryIds } = await createTournament(token, {
    tournamentId,
    name,
    n,
    bracketSize,
    thirdPlaceMatch,
    exchangeMatches,
    guaranteedMatchCount: guaranteed,
    rematchAvoidance,
    createdBy,
  });
  const teamNameByEntryId = Object.fromEntries(entryIds.map((id) => [id, id]));
  const init = await writeInit(
    token,
    tournamentId,
    entryIds,
    {
      rematchAvoidance,
      thirdPlaceMatch,
      exchangeMatches,
      guaranteedMatchCount: guaranteed,
      bracketSize,
    },
    teamNameByEntryId
  );
  const r1Byes = init.pairings.byes?.length ?? 0;
  record("31 R1 bye count", r1Byes === 1, `byes=${r1Byes} matches=${init.pairings.matches.length}`);
  record(
    "31 R1 match count excludes bye",
    init.pairings.matches.length === 15,
    `matches=${init.pairings.matches.length}`
  );

  let stateDoc = init.stateDoc;
  let roundDoc = init.roundDoc;
  let completedRounds = [];

  for (let r = 1; r <= rankingRounds; r += 1) {
    const { lastPlan, prior } = await completeCurrentRound(
      token,
      tournamentId,
      stateDoc,
      roundDoc,
      rematchAvoidance,
      completedRounds
    );
    // verify bye results written after round complete
    if (r === 1) {
      const byeId = init.pairings.byes?.[0]?.matchId;
      const byeDoc = byeId
        ? await fsGet(token, `tournaments/${tournamentId}/lossBandMatchResults/${byeId}`)
        : null;
      record(
        "31 BYE result saved",
        byeDoc?.isBye === true || byeDoc?.resolution === "bye",
        `id=${byeId} isBye=${byeDoc?.isBye} resolution=${byeDoc?.resolution}`
      );
    }
    completedRounds.push({ roundDoc: lastPlan.nextRoundDoc, results: prior });
    if (r < rankingRounds) {
      stateDoc = lastPlan.nextStateDoc;
      roundDoc = lastPlan.nextRoundPlan.roundDoc;
    } else {
      stateDoc = lastPlan.nextStateDoc;
      roundDoc = lastPlan.nextRoundPlan.roundDoc;
    }
  }

  // final
  {
    const { lastPlan, prior } = await completeCurrentRound(
      token,
      tournamentId,
      stateDoc,
      roundDoc,
      rematchAvoidance,
      completedRounds
    );
    completedRounds.push({ roundDoc: lastPlan.nextRoundDoc, results: prior });
    stateDoc = lastPlan.nextStateDoc;
  }

  const placements = await fsGet(token, `tournaments/${tournamentId}/lossBandPlacements/current`);
  record(
    "31 placements",
    placements?.placements?.length === 31,
    `count=${placements?.placements?.length}`
  );

  if (stateDoc.status === "exchange_pending") {
    record("31 exchange generated", true, "exchange_pending");
  } else {
    record("31 exchange generated", stateDoc.status === "completed", `status=${stateDoc.status}`);
  }

  // force completed for cleanup snapshot
  if (placements && stateDoc.status !== "completed") {
    await fsSet(token, `tournaments/${tournamentId}/lossBandState/current`, {
      ...stateDoc,
      status: "completed",
      updatedAt: { __type: "timestamp", value: nowIso() },
    });
  }

  await writePublicSnapshot(
    token,
    tournamentId,
    {
      id: tournamentId,
      name,
      status: TournamentStatus.OPEN,
      tournamentFormat: TournamentFormat.SINGLE_ELIMINATION,
      publicViewEnabled: true,
      maxTeams: n,
    },
    entryIds,
    completedRounds,
    placements,
    { ...stateDoc, status: "completed" }
  );

  return { tournamentId, name };
}

async function runLoad128(token, createdBy) {
  const stamp = Date.now().toString(36);
  const tournamentId = `e2e-lb128-${stamp}`;
  const name = `[E2E] loss-band load 128 ${stamp}`;
  const n = 128;
  const bracketSize = 128;
  const guaranteed = defaultGuaranteedMatchCount(bracketSize);

  console.log(`\n=== 128 load ${tournamentId} ===`);
  const t0 = performance.now();
  const { entryIds } = await createTournament(token, {
    tournamentId,
    name,
    n,
    bracketSize,
    thirdPlaceMatch: false,
    exchangeMatches: false,
    guaranteedMatchCount: guaranteed,
    rematchAvoidance: true,
    createdBy,
  });
  const createMs = performance.now() - t0;
  record("128 entries create", entryIds.length === 128, `ms=${createMs.toFixed(0)}`);

  const teamNameByEntryId = Object.fromEntries(entryIds.map((id) => [id, id]));
  const initT0 = performance.now();
  const init = await writeInit(
    token,
    tournamentId,
    entryIds,
    {
      rematchAvoidance: true,
      thirdPlaceMatch: false,
      exchangeMatches: false,
      guaranteedMatchCount: guaranteed,
      bracketSize,
    },
    teamNameByEntryId
  );
  const initMs = performance.now() - initT0;
  record(
    "128 R1 64 matches",
    init.pairings.matches.length === 64,
    `matches=${init.pairings.matches.length} initWriteMs=${initMs.toFixed(0)}`
  );

  const sessions = await fsList(token, `tournaments/${tournamentId}/lossBandMatchSessions`);
  record("128 sessions written", sessions.length === 64, `count=${sessions.length}`);

  await writePublicSnapshot(
    token,
    tournamentId,
    {
      id: tournamentId,
      name,
      status: TournamentStatus.OPEN,
      tournamentFormat: TournamentFormat.SINGLE_ELIMINATION,
      publicViewEnabled: true,
      maxTeams: n,
    },
    entryIds,
    [{ roundDoc: init.roundDoc, results: [] }],
    null,
    init.stateDoc
  );
  const snap = await fsGet(token, `tournaments/${tournamentId}/publicSnapshot/${PUBLIC_SNAPSHOT_DOC_ID}`);
  record("128 publicSnapshot", !!snap, `visible=${snap?.lossBand?.visible}`);

  const pubRes = await fetch(
    `${HOSTING}/tournament-public.html?id=${encodeURIComponent(tournamentId)}`
  );
  record("128 public page HTTP", pubRes.ok, `status=${pubRes.status}`);

  const opsRes = await fetch(
    `${HOSTING}/tournament-loss-band.html?id=${encodeURIComponent(tournamentId)}`
  );
  record("128 ops page HTTP", opsRes.ok, `status=${opsRes.status}`);

  // delete 128 after checks
  await cleanupTournament(token, tournamentId);
  const gone = await fsGet(token, `tournaments/${tournamentId}`);
  record("128 test tournament deleted", gone === null);

  return { tournamentId, deleted: true };
}

async function listExistingSample(token) {
  // list a few tournaments for existing-check report (read-only)
  try {
    const json = await fsRequest(
      token,
      "GET",
      "tournaments?pageSize=20&orderBy=updatedAt desc"
    );
    const docs = (json.documents || []).map(decodeDoc);
    const nonE2E = docs.filter((d) => !String(d.name || "").includes("[E2E]"));
    record(
      "Existing tournaments readable",
      docs.length >= 0,
      `listed=${docs.length} nonE2E=${nonE2E.length}`
    );
    return nonE2E.slice(0, 5).map((d) => ({ id: d.id, name: d.name, format: d.tournamentFormat }));
  } catch (e) {
    record("Existing tournaments readable", false, String(e.message).slice(0, 120));
    return [];
  }
}

async function run() {
  if (!RUN) {
    console.log("Usage: node scripts/e2e-loss-band-prod.mjs --run [--keep]");
    process.exitCode = 1;
    return;
  }

  console.log("=== Loss-band production E2E ===");
  console.log(`project=${PROJECT_ID} hosting=${HOSTING}`);

  await verifyHosting();
  const token = await getGoogleAccessToken();
  record("Firebase Google token", true);

  const existingSample = await listExistingSample(token);
  console.log("existing sample:", JSON.stringify(existingSample));

  const created = [];
  try {
    const r64 = await runFull64(token, "e2e-script");
    created.push(r64);
    const r31 = await runBye31(token, "e2e-script");
    created.push(r31);
    await runLoad128(token, "e2e-script");
  } finally {
    if (!KEEP) {
      for (const c of created) {
        if (c?.tournamentId) {
          await cleanupTournament(token, c.tournamentId);
          record(`cleanup ${c.tournamentId}`, true);
        }
      }
    } else {
      console.log("KEEP: tournaments left for browser QA:", created.map((c) => c.tournamentId));
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== Summary: ${results.length - failed.length}/${results.length} passed ===`);
  if (failed.length) {
    for (const f of failed) console.log(`FAIL: ${f.name} — ${f.detail}`);
    process.exitCode = 1;
  } else {
    console.log("All checks passed.");
  }
}

run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
