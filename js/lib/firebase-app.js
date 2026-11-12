/**
 * Firebase SDK 初期化
 */
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import { connectAuthEmulator, getAuth } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { connectFirestoreEmulator, getFirestore } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { connectFunctionsEmulator, getFunctions } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-functions.js";
import { firebaseConfig } from "../firebase-config.js";

/** このポートの静的サーバだけを Emulator に繋ぐ。8766 は従来どおり本番を見る。 */
const LOCAL_EMULATOR_PAGE_PORT = "8770";

export function shouldUseLocalEmulators() {
  if (typeof location === "undefined") {
    return false;
  }
  const host = location.hostname;
  return (host === "127.0.0.1" || host === "localhost") && location.port === LOCAL_EMULATOR_PAGE_PORT;
}

function markLocalEmulatorPage() {
  if (typeof document === "undefined" || document.getElementById("local-emulator-banner")) {
    return;
  }
  const bar = document.createElement("div");
  bar.id = "local-emulator-banner";
  bar.textContent = "ローカル Emulator 接続中。この画面の読み書きは本番 Firebase に届きません。";
  bar.style.cssText = "position:sticky;top:0;z-index:10000;background:#143d66;color:#fff;padding:8px 12px;font:600 14px/1.4 sans-serif;";
  document.body.prepend(bar);
}

const PLACEHOLDER_PREFIX = "YOUR_";

export function isFirebaseConfigured() {
  if (!firebaseConfig || typeof firebaseConfig !== "object") {
    return false;
  }
  const required = ["apiKey", "authDomain", "projectId", "appId"];
  return required.every((key) => {
    const value = firebaseConfig[key];
    return typeof value === "string" && value.length > 0 && !value.startsWith(PLACEHOLDER_PREFIX);
  });
}

let app = null;
let auth = null;
let db = null;
let functions = null;

export function getFirebaseApp() {
  if (!isFirebaseConfigured()) {
    return null;
  }
  if (!app) {
    app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  }
  return app;
}

export function getFirebaseAuth() {
  if (!getFirebaseApp()) {
    return null;
  }
  if (!auth) {
    auth = getAuth(getFirebaseApp());
    if (shouldUseLocalEmulators()) {
      connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
      markLocalEmulatorPage();
    }
  }
  return auth;
}

export function getFirebaseDb() {
  if (!getFirebaseApp()) {
    return null;
  }
  if (!db) {
    db = getFirestore(getFirebaseApp());
    if (shouldUseLocalEmulators()) {
      connectFirestoreEmulator(db, "127.0.0.1", 8090);
      markLocalEmulatorPage();
    }
  }
  return db;
}

export function getFirebaseFunctions() {
  if (!getFirebaseApp()) {
    return null;
  }
  if (!functions) {
    functions = getFunctions(getFirebaseApp(), "asia-northeast1");
    if (shouldUseLocalEmulators()) {
      connectFunctionsEmulator(functions, "127.0.0.1", 5001);
      markLocalEmulatorPage();
    }
  }
  return functions;
}
