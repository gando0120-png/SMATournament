/**
 * Firebase SDK 初期化
 */
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-functions.js";
import { firebaseConfig } from "../firebase-config.js";

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
  }
  return auth;
}

export function getFirebaseDb() {
  if (!getFirebaseApp()) {
    return null;
  }
  if (!db) {
    db = getFirestore(getFirebaseApp());
  }
  return db;
}

export function getFirebaseFunctions() {
  if (!getFirebaseApp()) {
    return null;
  }
  if (!functions) {
    functions = getFunctions(getFirebaseApp(), "asia-northeast1");
  }
  return functions;
}
