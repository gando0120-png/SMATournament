/**
 * Firebase Authentication ラッパ
 */
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { getFirebaseAuth, isFirebaseConfigured } from "./firebase-app.js";
import { ConfigUnconfiguredError } from "./errors.js";

function requireAuth() {
  if (!isFirebaseConfigured()) {
    throw new ConfigUnconfiguredError();
  }
  const auth = getFirebaseAuth();
  if (!auth) {
    throw new ConfigUnconfiguredError();
  }
  return auth;
}

export async function loginWithEmail(email, password) {
  const auth = requireAuth();
  const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
  return credential.user;
}

export async function logout() {
  const auth = requireAuth();
  await signOut(auth);
}

export function watchAuthState(callback) {
  if (!isFirebaseConfigured()) {
    callback(null);
    return () => {};
  }
  const auth = getFirebaseAuth();
  if (!auth) {
    callback(null);
    return () => {};
  }
  return onAuthStateChanged(auth, callback);
}

export function getCurrentUser() {
  const auth = getFirebaseAuth();
  return auth?.currentUser ?? null;
}
