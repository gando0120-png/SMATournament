/**
 * Firebase Web 設定のテンプレート
 *
 * 1. このファイルを firebase-config.js にコピーする
 * 2. Firebase Console → プロジェクトの設定 → マイアプリ から値を貼り付ける
 * 3. Authentication で Email/Password を有効化する
 * 4. Firestore を作成し、firestore.rules をデプロイする
 *
 * GitHub Pages 公開時:
 * - firebase-config.js はリポジトリに含めて公開する（Web API キーはクライアント配置が前提）
 * - データ保護は Firestore Security Rules で行う（README 参照）
 */
export const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.firebasestorage.app",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID",
};
