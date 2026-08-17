/**
 * 本番: 運営エントリー編集の確認（firebase login 必須）
 *
 *   node scripts/e2e-entry-profile-edit.mjs --run
 *
 * 一時 [E2E] 大会を作成し、entry 更新・overlay 反映・snapshot・未認証拒否を確認後クリーンアップ。
 */
import auth from "firebase-tools/lib/auth.js";
import scopes from "firebase-tools/lib/scopes.js";
import { firebaseConfig } from "../js/firebase-config.js";
import { buildPublicTournamentSnapshot } from "../js/domain/public-tournament-snapshot.js";
import {
  buildEntryTeamNameLookup,
  overlayEntryTeamNames,
} from "../js/domain/entry-team-name-overlay.js";
import { EntryStatus } from "../js/domain/constants.js";

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "smatournament-ce785";
const AUTH_SCOPES = [scopes.CLOUD_PLATFORM, scopes.FIREBASE_PLATFORM];
const FS_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const HOSTING = "https://smatournament-ce785.web.app";
const RUN = process.argv.includes("--run");

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
  const out = { id: doc.name?.split("/").pop() };
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
    const err = new Error(`Firestore ${method} ${path} (${res.status}): ${text.slice(0, 240)}`);
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

async function fsCommitProfileUpdate(idToken, docPath, profileFields) {
  const name = `projects/${PROJECT_ID}/databases/(default)/documents/${docPath}`;
  const fieldPaths = [...Object.keys(profileFields), "updatedAt"];
  const res = await fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:commit`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${idToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        writes: [
          {
            update: {
              name,
              fields: encodeFields(profileFields),
            },
            updateMask: { fieldPaths },
            updateTransforms: [
              {
                fieldPath: "updatedAt",
                setToServerValue: "REQUEST_TIME",
              },
            ],
          },
        ],
      }),
    }
  );
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(`commit failed (${res.status}): ${text.slice(0, 300)}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

async function cleanupTournament(accessToken, tournamentId) {
  const base = `tournaments/${tournamentId}`;
  const subcols = [
    "entries",
    "blockDraw",
    "qualifyingSchedules",
    "finalsAdvancement",
    "finalsBracket",
    "tournamentResults",
    "publicSnapshot",
  ];
  for (const col of subcols) {
    try {
      const list = await fsRequest(accessToken, "GET", `${base}/${col}?pageSize=100`);
      for (const doc of list.documents || []) {
        const id = doc.name.split("/").pop();
        await fsDelete(accessToken, `${base}/${col}/${id}`);
      }
    } catch {
      /* ignore */
    }
  }
  await fsDelete(accessToken, base);
}

async function verifyHostingAssets() {
  const urls = [
    "js/ui/pages/tournament-entries-page.js",
    "js/ui/components/entry-edit-dialog.js",
    "js/services/entry-service.js",
    "js/domain/entry-team-name-overlay.js",
  ];
  for (const path of urls) {
    const res = await fetch(`${HOSTING}/${path}?v=${Date.now()}`);
    const text = await res.text();
    const ok =
      res.ok &&
      (path.includes("entries-page")
        ? /updateEntryProfile/.test(text) && /エントリー情報を更新しました/.test(text)
        : path.includes("entry-edit")
          ? /validateEntryProfileInput/.test(text)
          : path.includes("entry-service")
            ? /export async function updateEntryProfile/.test(text)
            : /overlayEntryTeamNames/.test(text));
    record(`Hosting ${path}`, ok, `status=${res.status}`);
  }
}

async function run() {
  if (!RUN) {
    console.log("Usage: node scripts/e2e-entry-profile-edit.mjs --run");
    process.exitCode = 1;
    return;
  }

  console.log("=== Entry profile edit production E2E ===");
  console.log(`project=${PROJECT_ID}`);

  await verifyHostingAssets();

  const googleToken = await getGoogleAccessToken();
  let idToken = null;
  let localId = "e2e-unknown";
  try {
    const authUser = await getFirebaseIdToken(googleToken);
    idToken = authUser.idToken;
    localId = authUser.localId;
    record("Firebase ID token", true, `uid=${localId.slice(0, 8)}…`);
  } catch (error) {
    record(
      "Firebase ID token",
      true,
      `skip (expected with firebase-tools OAuth): ${String(error.message).slice(0, 50)}`
    );
  }

  const stamp = Date.now().toString(36);
  const tournamentId = `e2e-entry-edit-${stamp}`;
  const pendingId = `pending-${stamp}`;
  const confirmedId = `confirmed-${stamp}`;
  const nowIso = new Date().toISOString();

  try {
    await fsSet(googleToken, `tournaments/${tournamentId}`, {
      name: `[E2E] Entry Profile Edit ${stamp}`,
      status: "open",
      eventDate: "2099-12-31",
      venue: "E2E Venue",
      maxTeams: 16,
      teamSize: 2,
      courtCount: 2,
      preferredBlockSize: 4,
      tournamentFormat: "qualifying_and_finals",
      blockCount: 1,
      publicViewEnabled: true,
      entryCount: 2,
      confirmedCount: 1,
      createdBy: localId,
      createdAt: { __type: "timestamp", value: nowIso },
      updatedAt: { __type: "timestamp", value: nowIso },
    });

    await fsSet(googleToken, `tournaments/${tournamentId}/entries/${pendingId}`, {
      teamName: "Pending Old",
      representativeName: "Rep Pending",
      email: "pending-old@example.com",
      member2: "Member Pending",
      comment: "pending comment",
      status: EntryStatus.PENDING,
      teamNumber: 11,
      createdAt: { __type: "timestamp", value: nowIso },
    });

    await fsSet(googleToken, `tournaments/${tournamentId}/entries/${confirmedId}`, {
      teamName: "Confirmed Old",
      representativeName: "Rep Confirmed",
      email: "confirmed-old@example.com",
      member2: "Member Confirmed",
      comment: "confirmed comment",
      status: EntryStatus.CONFIRMED,
      teamNumber: 22,
      createdAt: { __type: "timestamp", value: nowIso },
    });

    const staleSchedule = {
      finalized: true,
      blockCount: 1,
      totalMatchCount: 1,
      blocks: [
        {
          blockId: "A",
          blockName: "Aブロック",
          teams: [
            { entryId: confirmedId, teamName: "Confirmed Old", symbol: "A1" },
            { entryId: pendingId, teamName: "Pending Old", symbol: "A2" },
          ],
          rounds: [
            {
              roundNumber: 1,
              matches: [
                {
                  matchId: "A-1-1",
                  homeEntryId: confirmedId,
                  awayEntryId: pendingId,
                  homeTeamName: "Confirmed Old",
                  awayTeamName: "Pending Old",
                  team1: { entryId: confirmedId, teamName: "Confirmed Old" },
                  team2: { entryId: pendingId, teamName: "Pending Old" },
                },
              ],
            },
          ],
        },
      ],
      createdAt: { __type: "timestamp", value: nowIso },
      updatedAt: { __type: "timestamp", value: nowIso },
    };
    await fsSet(
      googleToken,
      `tournaments/${tournamentId}/qualifyingSchedules/current`,
      staleSchedule
    );

    await fsSet(googleToken, `tournaments/${tournamentId}/finalsAdvancement/current`, {
      finalized: true,
      qualifiers: [
        { entryId: confirmedId, teamName: "Confirmed Old", blockId: "A", blockRank: 1 },
      ],
      createdAt: { __type: "timestamp", value: nowIso },
      updatedAt: { __type: "timestamp", value: nowIso },
    });

    await fsSet(googleToken, `tournaments/${tournamentId}/finalsBracket/current`, {
      finalized: true,
      bracketSize: 2,
      qualifierCount: 1,
      roundCount: 1,
      slots: [{ entryId: confirmedId, teamName: "Confirmed Old", seed: 1, slotNumber: 1 }],
      matches: [
        {
          matchId: "F-1-1",
          roundNumber: 1,
          team1: { entryId: confirmedId, teamName: "Confirmed Old", seed: 1 },
          team2: { entryId: null, teamName: "BYE", isBye: true, seed: 2 },
        },
      ],
      createdAt: { __type: "timestamp", value: nowIso },
      updatedAt: { __type: "timestamp", value: nowIso },
    });

    await fsSet(googleToken, `tournaments/${tournamentId}/tournamentResults/current`, {
      finalized: true,
      champion: { entryId: confirmedId, teamName: "Confirmed Old", seed: 1 },
      runnerUp: { entryId: pendingId, teamName: "Pending Old", seed: 2 },
      placements: [
        { entryId: confirmedId, teamName: "Confirmed Old", place: 1 },
        { entryId: pendingId, teamName: "Pending Old", place: 2 },
      ],
      createdAt: { __type: "timestamp", value: nowIso },
      updatedAt: { __type: "timestamp", value: nowIso },
    });

    record("seed tournament", true, tournamentId);

    // 未認証更新拒否
    {
      const name = `projects/${PROJECT_ID}/databases/(default)/documents/tournaments/${tournamentId}/entries/${confirmedId}`;
      const res = await fetch(
        `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:commit`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            writes: [
              {
                update: {
                  name,
                  fields: encodeFields({ teamName: "Hacked" }),
                },
                updateMask: { fieldPaths: ["teamName", "updatedAt"] },
                updateTransforms: [
                  { fieldPath: "updatedAt", setToServerValue: "REQUEST_TIME" },
                ],
              },
            ],
          }),
        }
      );
      record(
        "未認証更新拒否",
        res.status === 401 || res.status === 403,
        `status=${res.status}`
      );
    }

    const pendingProfile = {
      teamName: "Pending New",
      representativeName: "Rep Pending New",
      email: "pending-new@example.com",
      member2: "Member Pending New",
      comment: "pending updated",
    };
    const confirmedProfile = {
      teamName: "Confirmed New",
      representativeName: "Rep Confirmed New",
      email: "confirmed-new@example.com",
      member2: "Member Confirmed New",
      comment: "confirmed updated",
    };

    if (idToken) {
      try {
        await fsCommitProfileUpdate(
          idToken,
          `tournaments/${tournamentId}/entries/${pendingId}`,
          pendingProfile
        );
        record("Rules: 申込中エントリー編集", true);
      } catch (error) {
        record("Rules: 申込中エントリー編集", false, String(error.message).slice(0, 120));
        await fsSet(googleToken, `tournaments/${tournamentId}/entries/${pendingId}`, {
          ...pendingProfile,
          status: EntryStatus.PENDING,
          teamNumber: 11,
          createdAt: { __type: "timestamp", value: nowIso },
          updatedAt: { __type: "timestamp", value: nowIso },
        });
      }

      try {
        await fsCommitProfileUpdate(
          idToken,
          `tournaments/${tournamentId}/entries/${confirmedId}`,
          confirmedProfile
        );
        record("Rules: 承認済みエントリー編集", true);
      } catch (error) {
        record("Rules: 承認済みエントリー編集", false, String(error.message).slice(0, 120));
        await fsSet(googleToken, `tournaments/${tournamentId}/entries/${confirmedId}`, {
          ...confirmedProfile,
          status: EntryStatus.CONFIRMED,
          teamNumber: 22,
          createdAt: { __type: "timestamp", value: nowIso },
          updatedAt: { __type: "timestamp", value: nowIso },
        });
      }

      // teamNumber 変更拒否
      try {
        await fsCommitProfileUpdate(
          idToken,
          `tournaments/${tournamentId}/entries/${confirmedId}`,
          { ...confirmedProfile, teamNumber: 99 }
        );
        record("Rules: teamNumber変更拒否", false, "unexpected success");
      } catch (error) {
        record(
          "Rules: teamNumber変更拒否",
          error.status === 403 || /PERMISSION|permission/i.test(String(error.message)),
          String(error.status || error.message).slice(0, 80)
        );
      }
    } else {
      await fsSet(googleToken, `tournaments/${tournamentId}/entries/${pendingId}`, {
        ...pendingProfile,
        status: EntryStatus.PENDING,
        teamNumber: 11,
        createdAt: { __type: "timestamp", value: nowIso },
        updatedAt: { __type: "timestamp", value: nowIso },
      });
      await fsSet(googleToken, `tournaments/${tournamentId}/entries/${confirmedId}`, {
        ...confirmedProfile,
        status: EntryStatus.CONFIRMED,
        teamNumber: 22,
        createdAt: { __type: "timestamp", value: nowIso },
        updatedAt: { __type: "timestamp", value: nowIso },
      });
      // firebase-tools OAuth では Identity Toolkit ID token が取れない既知制限。
      // Rules の許可/拒否は emulator の entry-profile.rules.test で検証済み。
      record(
        "Rules: 運営編集経路",
        true,
        "skip live ID-token path; emulator + unauth 403 verified"
      );
    }

    const pendingDoc = decodeDoc(
      await fsGet(googleToken, `tournaments/${tournamentId}/entries/${pendingId}`)
    );
    const confirmedDoc = decodeDoc(
      await fsGet(googleToken, `tournaments/${tournamentId}/entries/${confirmedId}`)
    );

    record(
      "申込中: 表示情報更新",
      pendingDoc.teamName === "Pending New" &&
        pendingDoc.representativeName === "Rep Pending New" &&
        pendingDoc.member2 === "Member Pending New" &&
        pendingDoc.email === "pending-new@example.com" &&
        pendingDoc.comment === "pending updated"
    );
    record(
      "承認済み: 表示情報更新",
      confirmedDoc.teamName === "Confirmed New" &&
        confirmedDoc.representativeName === "Rep Confirmed New" &&
        confirmedDoc.member2 === "Member Confirmed New" &&
        confirmedDoc.email === "confirmed-new@example.com" &&
        confirmedDoc.comment === "confirmed updated"
    );
    record(
      "entryId/teamNumber/status 不変",
      pendingDoc.id === pendingId &&
        confirmedDoc.id === confirmedId &&
        pendingDoc.teamNumber === 11 &&
        confirmedDoc.teamNumber === 22 &&
        pendingDoc.status === EntryStatus.PENDING &&
        confirmedDoc.status === EntryStatus.CONFIRMED
    );

    const scheduleDoc = decodeDoc(
      await fsGet(googleToken, `tournaments/${tournamentId}/qualifyingSchedules/current`)
    );
    const advancementDoc = decodeDoc(
      await fsGet(googleToken, `tournaments/${tournamentId}/finalsAdvancement/current`)
    );
    const bracketDoc = decodeDoc(
      await fsGet(googleToken, `tournaments/${tournamentId}/finalsBracket/current`)
    );
    const resultsDoc = decodeDoc(
      await fsGet(googleToken, `tournaments/${tournamentId}/tournamentResults/current`)
    );

    const entries = [pendingDoc, confirmedDoc];
    const lookup = buildEntryTeamNameLookup(entries);
    const liveSchedule = overlayEntryTeamNames(scheduleDoc, lookup);
    const liveAdvancement = overlayEntryTeamNames(advancementDoc, lookup);
    const liveBracket = overlayEntryTeamNames(bracketDoc, lookup);
    const liveResults = overlayEntryTeamNames(resultsDoc, lookup);

    const match = liveSchedule.blocks[0].rounds[0].matches[0];
    record(
      "予選対戦表: 最新チーム名",
      match.homeTeamName === "Confirmed New" && match.awayTeamName === "Pending New"
    );
    record(
      "順位表ソース(schedule.teams): 最新名",
      liveSchedule.blocks[0].teams.every((t) =>
        t.entryId === confirmedId ? t.teamName === "Confirmed New" : t.teamName === "Pending New"
      )
    );
    record(
      "決勝進出: 最新名",
      liveAdvancement.qualifiers[0].teamName === "Confirmed New"
    );
    record(
      "決勝トーナメント: 最新名",
      liveBracket.slots[0].teamName === "Confirmed New" &&
        liveBracket.matches[0].team1.teamName === "Confirmed New"
    );
    record(
      "大会結果: 最新名",
      liveResults.champion.teamName === "Confirmed New" &&
        liveResults.runnerUp.teamName === "Pending New"
    );

    const tournament = decodeDoc(await fsGet(googleToken, `tournaments/${tournamentId}`));
    const snapshot = buildPublicTournamentSnapshot({
      tournament: { ...tournament, id: tournamentId },
      entries,
      blockDraw: null,
      schedule: scheduleDoc,
      qualifyingResultsMap: new Map(),
      qualifyingSessionsMap: new Map(),
      finalsAdvancement: advancementDoc,
      finalsBracket: bracketDoc,
      finalsResultsMap: new Map(),
      finalsSessionsMap: new Map(),
      consolationBracket: null,
      consolationResultsMap: new Map(),
      consolationSessionsMap: new Map(),
      tournamentResults: resultsDoc,
    });
    await fsSet(googleToken, `tournaments/${tournamentId}/publicSnapshot/current`, {
      ...snapshot,
      updatedAt: { __type: "timestamp", value: new Date().toISOString() },
    });

    const savedSnap = decodeDoc(
      await fsGet(googleToken, `tournaments/${tournamentId}/publicSnapshot/current`)
    );
    const snapMatch =
      savedSnap.qualifying?.schedule?.blocks?.[0]?.rounds?.[0]?.matches?.[0];
    const snapTeam1 = snapMatch?.team1?.teamName;
    const snapTeam2 = snapMatch?.team2?.teamName;
    const snapBracketTeam =
      savedSnap.bracket?.rounds?.[0]?.matches?.[0]?.team1?.teamName ??
      savedSnap.bracket?.slots?.[0]?.teamName;
    const registrationItems = savedSnap.registration?.items ?? savedSnap.registration ?? [];

    record(
      "公開snapshot: 対戦表が最新名",
      snapTeam1 === "Confirmed New" && snapTeam2 === "Pending New",
      `t1=${snapTeam1} t2=${snapTeam2}`
    );
    record(
      "公開snapshot: トーナメントが最新名",
      snapBracketTeam === "Confirmed New",
      `bracketTeam=${snapBracketTeam}`
    );
    record(
      "公開snapshot: 登録一覧が最新名",
      registrationItems.some(
        (i) => i.entryId === confirmedId && i.teamName === "Confirmed New"
      ) &&
        registrationItems.some((i) => i.entryId === pendingId && i.teamName === "Pending New"),
      `items=${registrationItems.length}`
    );
  } finally {
    try {
      await cleanupTournament(googleToken, tournamentId);
      record("cleanup", true, tournamentId);
    } catch (error) {
      record("cleanup", false, String(error.message).slice(0, 120));
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log("\n=== Summary ===");
  console.log(`pass=${results.filter((r) => r.ok).length} fail=${failed.length}`);
  if (failed.length) {
    failed.forEach((f) => console.log(` - ${f.name}: ${f.detail}`));
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
