/**
 * トップページ（運営ログイン・大会一覧プレースホルダー）
 */
import { isFirebaseConfigured } from "../../lib/firebase-app.js";
import { loginWithEmail, logout, watchAuthState } from "../../lib/auth.js";
import { isOperatorEnabled } from "../../lib/firestore.js";
import { listTournaments } from "../../services/tournament-service.js";
import { getTournamentStatusLabel } from "../../domain/constants.js";
import { isValidTournamentId } from "../../domain/validators.js";
import { classifyError } from "../../lib/errors.js";
import { showErrorToast, showToast } from "../components/toast.js";
import { confirmDialog } from "../components/confirm-dialog.js";
import {
  clearFormAlert,
  clearFormErrors,
  setFieldError,
  showFormAlert,
} from "../components/form-errors.js";

/** Cloud Functions 本番デプロイ後に true に戻す（test-tournament-cleanup.html 導線） */
const TEST_TOURNAMENT_CLEANUP_UI_ENABLED = false;

const views = {
  loading: document.getElementById("viewLoading"),
  config: document.getElementById("viewConfig"),
  login: document.getElementById("viewLogin"),
  operatorDenied: document.getElementById("viewOperatorDenied"),
  dashboard: document.getElementById("viewDashboard"),
};

const loginForm = document.getElementById("loginForm");
const loginAlert = document.getElementById("loginAlert");
const operatorDeniedAlert = document.getElementById("operatorDeniedAlert");
const logoutBtn = document.getElementById("logoutBtn");
const logoutDeniedBtn = document.getElementById("logoutDeniedBtn");
const userEmailEl = document.getElementById("userEmail");
const tournamentListEl = document.getElementById("tournamentList");
const tournamentEmptyEl = document.getElementById("tournamentEmpty");
const headerActions = document.getElementById("headerActions");

let authUnsubscribe = null;

function showView(name) {
  Object.entries(views).forEach(([key, el]) => {
    if (el) {
      el.classList.toggle("hidden", key !== name);
    }
  });
  if (headerActions) {
    headerActions.classList.toggle("hidden", name !== "dashboard");
  }
}

function validateLoginForm(email, password) {
  clearFormErrors(loginForm);
  clearFormAlert(loginAlert);
  let valid = true;

  if (!email) {
    setFieldError(document.getElementById("loginEmail"), "メールアドレスを入力してください。");
    valid = false;
  }
  if (!password) {
    setFieldError(document.getElementById("loginPassword"), "パスワードを入力してください。");
    valid = false;
  }
  return valid;
}

async function handleLoginSubmit(event) {
  event.preventDefault();
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;

  if (!validateLoginForm(email, password)) {
    return;
  }

  const submitBtn = loginForm.querySelector('button[type="submit"]');
  submitBtn.disabled = true;

  try {
    await loginWithEmail(email, password);
    // onAuthStateChanged が後続処理を行う
  } catch (error) {
    const { message } = classifyError(error);
    showFormAlert(loginAlert, message, "error");
  } finally {
    submitBtn.disabled = false;
  }
}

async function handleLogout() {
  const confirmed = await confirmDialog({
    title: "ログアウト",
    message: "ログアウトしますか？",
    confirmLabel: "ログアウト",
    cancelLabel: "キャンセル",
  });
  if (!confirmed) {
    return;
  }
  try {
    await logout();
    showToast("ログアウトしました。");
  } catch (error) {
    const { message } = classifyError(error);
    showErrorToast(message);
  }
}

function buildTournamentDashboardHref(tournamentId) {
  return `tournament-dashboard.html?id=${encodeURIComponent(tournamentId)}`;
}

async function renderTournamentList() {
  try {
    const tournaments = await listTournaments();
    tournamentListEl.innerHTML = "";

    if (tournaments.length === 0) {
      tournamentEmptyEl.classList.remove("hidden");
      return;
    }

    tournamentEmptyEl.classList.add("hidden");
    tournaments.forEach((tournament) => {
      const statusLabel = getTournamentStatusLabel(tournament.status);
      const cardContent = `
        <h3 class="panel__title">${escapeHtml(tournament.name || "（名称未設定）")}</h3>
        <p class="panel__desc">開催日: ${escapeHtml(tournament.eventDate || "—")} / 状態: ${escapeHtml(statusLabel)}</p>
      `;

      if (!isValidTournamentId(tournament.id)) {
        const item = document.createElement("article");
        item.className = "panel tournament-card tournament-card--disabled";
        item.innerHTML = cardContent;
        tournamentListEl.appendChild(item);
        return;
      }

      const link = document.createElement("a");
      link.className = "panel tournament-card";
      link.href = buildTournamentDashboardHref(tournament.id);
      link.innerHTML = cardContent;
      tournamentListEl.appendChild(link);
    });
  } catch (error) {
    const { message } = classifyError(error);
    showErrorToast(message);
    tournamentEmptyEl.classList.remove("hidden");
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function handleAuthUser(user) {
  if (!user) {
    showView("login");
    return;
  }

  showView("loading");
  userEmailEl.textContent = user.email || user.uid;

  const createBtn = document.getElementById("createTournamentBtn");
  const cleanupBtn = document.getElementById("cleanupTestTournamentsBtn");
  if (createBtn || cleanupBtn) {
    const canCreate = await isOperatorEnabled(user.uid);
    createBtn?.classList.toggle("hidden", !canCreate);
    cleanupBtn?.classList.toggle(
      "hidden",
      !canCreate || !TEST_TOURNAMENT_CLEANUP_UI_ENABLED
    );
  }

  showView("dashboard");
  await renderTournamentList();
}

function initConfigView() {
  showFormAlert(
    document.getElementById("configAlert"),
    "Firebase 設定が未入力です。js/firebase-config.js を設定してください。",
    "error"
  );
  showView("config");
}

export function initIndexPage() {
  if (!isFirebaseConfigured()) {
    initConfigView();
    return;
  }

  loginForm.addEventListener("submit", handleLoginSubmit);
  logoutBtn.addEventListener("click", handleLogout);
  logoutDeniedBtn.addEventListener("click", handleLogout);

  const createBtn = document.getElementById("createTournamentBtn");
  if (createBtn) {
    createBtn.addEventListener("click", () => {
      window.location.href = "tournament-new.html";
    });
  }

  authUnsubscribe = watchAuthState((user) => {
    handleAuthUser(user);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initIndexPage);
} else {
  initIndexPage();
}
