/**
 * 大会管理ダッシュボード — Firestore 読込診断（本番切り分け用）
 */
import {
  collection,
  doc,
  getDocFromServer,
  getDocsFromServer,
  query,
  orderBy,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { getFirebaseDb } from "./firebase-app.js";
import { getCurrentUser } from "./auth.js";
import {
  BLOCK_DRAW_DOC_ID,
  FINALS_ADVANCEMENT_DOC_ID,
  FINALS_BRACKET_DOC_ID,
  QUALIFYING_SCHEDULE_DOC_ID,
  TOURNAMENT_RESULTS_DOC_ID,
} from "../domain/constants.js";
import { getOperatorRecord } from "./firestore.js";

const LOG = "[dashboard]";

/**
 * @param {string} label
 * @param {() => Promise<unknown>} operation
 * @param {object} meta
 */
async function traceFirestoreOperation(label, operation, meta = {}) {
  console.info(`${LOG} ${label} start`, meta);
  try {
    const result = await operation();
    console.info(`${LOG} ${label} ok`, meta);
    return { ok: true, result, meta };
  } catch (error) {
    console.error(`${LOG} ${label} failed`, {
      ...meta,
      code: error?.code ?? "(no code)",
      message: error?.message ?? String(error),
    });
    return {
      ok: false,
      error,
      meta,
      code: error?.code ?? "(no code)",
      message: error?.message ?? String(error),
    };
  }
}

/**
 * @param {string} tournamentId
 * @param {{ loadStage?: string }} [options]
 */
export async function runDashboardFirestoreProbe(tournamentId, options = {}) {
  const authUser = getCurrentUser();
  const uid = authUser?.uid ?? null;
  const loadStage = (options.loadStage || "G").toUpperCase();

  console.info(`${LOG} auth uid:`, uid ?? "(none)");
  console.info(`${LOG} probe loadStage:`, loadStage);
  console.info(`${LOG} probe tournamentId:`, tournamentId);
  console.info(`${LOG} probe location:`, window.location.href);

  const summary = {
    loadStage,
    tournamentId,
    uid,
    operatorExists: false,
    operatorEnabled: null,
    operatorEnabledType: null,
    tournamentCreatedBy: null,
    steps: [],
    firstFailure: null,
  };

  const operatorPath = uid ? `operators/${uid}` : null;

  if (!uid) {
    summary.firstFailure = {
      step: "auth",
      path: "(auth)",
      operation: "getCurrentUser",
      code: "auth/no-user",
    };
    return summary;
  }

  if (loadStage === "A") {
    console.info(`${LOG} probe stop at stage A (auth only)`);
    return summary;
  }

  const operatorStep = await traceFirestoreOperation(
    "operator get",
    async () => {
      const record = await getOperatorRecord(uid, { source: "server" });
      summary.operatorExists = record != null;
      summary.operatorEnabled = record?.enabled ?? null;
      summary.operatorEnabledType = record == null ? null : typeof record.enabled;
      return record;
    },
    { path: operatorPath, operation: "getDocFromServer" }
  );
  summary.steps.push({ step: "operator", ...operatorStep });
  if (!operatorStep.ok && !summary.firstFailure) {
    summary.firstFailure = {
      step: "operator",
      path: operatorPath,
      operation: "getDocFromServer",
      code: operatorStep.code,
      message: operatorStep.message,
    };
  }

  const db = getFirebaseDb();
  const tournamentPath = `tournaments/${tournamentId}`;
  const tournamentStep = await traceFirestoreOperation(
    "tournament get",
    async () => {
      const snap = await getDocFromServer(doc(db, "tournaments", tournamentId));
      if (!snap.exists()) {
        const error = new Error("Tournament not found");
        error.code = "tournament/not-found";
        throw error;
      }
      summary.tournamentCreatedBy = snap.data()?.createdBy ?? null;
      summary.tournamentEventDate = snap.data()?.eventDate ?? null;
      summary.tournamentStatus = snap.data()?.status ?? null;
      // id はドキュメントフィールドで上書きされないよう最後に付与する
      return { ...snap.data(), id: snap.id };
    },
    { path: tournamentPath, operation: "getDocFromServer" }
  );
  summary.steps.push({ step: "tournament", ...tournamentStep });
  if (!tournamentStep.ok && !summary.firstFailure) {
    summary.firstFailure = {
      step: "tournament",
      path: tournamentPath,
      operation: "getDocFromServer",
      code: tournamentStep.code,
      message: tournamentStep.message,
    };
  }

  if (loadStage === "A" || loadStage === "B") {
    console.info(`${LOG} probe stop at stage ${loadStage}`);
    return summary;
  }

  const subcollectionSteps = [
    {
      step: "entries",
      path: `${tournamentPath}/entries`,
      operation: "getDocsFromServer",
      run: () =>
        getDocsFromServer(
          query(
            collection(db, "tournaments", tournamentId, "entries"),
            orderBy("createdAt", "desc")
          )
        ),
      minStage: "C",
    },
    {
      step: "blockDraw",
      path: `${tournamentPath}/blockDraw/${BLOCK_DRAW_DOC_ID}`,
      operation: "getDocFromServer",
      run: () =>
        getDocFromServer(
          doc(db, "tournaments", tournamentId, "blockDraw", BLOCK_DRAW_DOC_ID)
        ),
      minStage: "D",
    },
    {
      step: "qualifyingSchedules",
      path: `${tournamentPath}/qualifyingSchedules/${QUALIFYING_SCHEDULE_DOC_ID}`,
      operation: "getDocFromServer",
      run: () =>
        getDocFromServer(
          doc(
            db,
            "tournaments",
            tournamentId,
            "qualifyingSchedules",
            QUALIFYING_SCHEDULE_DOC_ID
          )
        ),
      minStage: "E",
    },
    {
      step: "finalsAdvancement",
      path: `${tournamentPath}/finalsAdvancement/${FINALS_ADVANCEMENT_DOC_ID}`,
      operation: "getDocFromServer",
      run: () =>
        getDocFromServer(
          doc(
            db,
            "tournaments",
            tournamentId,
            "finalsAdvancement",
            FINALS_ADVANCEMENT_DOC_ID
          )
        ),
      minStage: "F",
    },
    {
      step: "finalsBracket",
      path: `${tournamentPath}/finalsBracket/${FINALS_BRACKET_DOC_ID}`,
      operation: "getDocFromServer",
      run: () =>
        getDocFromServer(
          doc(db, "tournaments", tournamentId, "finalsBracket", FINALS_BRACKET_DOC_ID)
        ),
      minStage: "G",
    },
    {
      step: "tournamentResults",
      path: `${tournamentPath}/tournamentResults/${TOURNAMENT_RESULTS_DOC_ID}`,
      operation: "getDocFromServer",
      run: () =>
        getDocFromServer(
          doc(
            db,
            "tournaments",
            tournamentId,
            "tournamentResults",
            TOURNAMENT_RESULTS_DOC_ID
          )
        ),
      minStage: "G",
    },
    {
      step: "finalsMatchResults",
      path: `${tournamentPath}/finalsMatchResults`,
      operation: "getDocsFromServer",
      run: () =>
        getDocsFromServer(
          collection(db, "tournaments", tournamentId, "finalsMatchResults")
        ),
      minStage: "G",
    },
  ];

  const stageOrder = ["A", "B", "C", "D", "E", "F", "G"];
  const stageIndex = stageOrder.indexOf(loadStage);

  for (const item of subcollectionSteps) {
    if (stageIndex < stageOrder.indexOf(item.minStage)) {
      continue;
    }

    const result = await traceFirestoreOperation(item.step, item.run, {
      path: item.path,
      operation: item.operation,
    });
    summary.steps.push({ step: item.step, ...result });
    if (!result.ok && !summary.firstFailure) {
      summary.firstFailure = {
        step: item.step,
        path: item.path,
        operation: item.operation,
        code: result.code,
        message: result.message,
      };
    }
  }

  console.info(`${LOG} probe summary`, {
    uid,
    tournamentId,
    operatorExists: summary.operatorExists,
    operatorEnabled: summary.operatorEnabled,
    operatorEnabledType: summary.operatorEnabledType,
    tournamentCreatedBy: summary.tournamentCreatedBy,
    tournamentEventDate: summary.tournamentEventDate,
    tournamentStatus: summary.tournamentStatus,
    ownerMatchesAuth: summary.tournamentCreatedBy != null && summary.tournamentCreatedBy === uid,
    firstFailure: summary.firstFailure,
    loadStage,
  });

  return summary;
}

/**
 * @param {object} summary
 * @param {unknown} error
 */
export function logDashboardFailureContext(summary, error) {
  console.error(`${LOG} failure context`, {
    firestorePath: summary?.firstFailure?.path ?? "(unknown)",
    operation: summary?.firstFailure?.operation ?? "(unknown)",
    errorCode: error?.code ?? summary?.firstFailure?.code ?? "(no code)",
    errorMessage: error?.message ?? summary?.firstFailure?.message ?? "(no message)",
    tournamentId: summary?.tournamentId ?? null,
    authUid: summary?.uid ?? null,
    tournamentCreatedBy: summary?.tournamentCreatedBy ?? null,
    operatorExists: summary?.operatorExists ?? null,
    operatorEnabled: summary?.operatorEnabled ?? null,
    operatorEnabledType: summary?.operatorEnabledType ?? null,
  });
}
