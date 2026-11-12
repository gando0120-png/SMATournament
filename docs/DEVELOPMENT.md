# 開発・テスト・デプロイ

現行のツール設定は `package.json`、`functions/package.json`、`firebase.json`、`.firebaserc`。GitHub Actions のワークフローはリポジトリに無い。

## 必要なもの

- Git
- Node.js 20（`functions/package.json` の `engines.node`）
- npm
- Firebase CLI（リポジトリの devDependency `firebase-tools`。グローバルインストールでもよい）
- Firestore Rules テストと Emulator を動かすときだけ Java（Firebase CLI が Emulator を起動する前提）
- 本番を触る人だけ Firebase / Google Cloud の権限（この文書の末尾）

秘密鍵ファイルはリポジトリに置かない。認証は各自の `firebase login` / `gcloud auth login`。

## 初回準備

```powershell
cd C:\path\to\SMATournament
npm install
npm --prefix functions install
```

`js/firebase-config.js` は Git に含まれる Web SDK 設定で、ローカルも本番プロジェクトを指す。個人用の上書きが必要なら `js/firebase-config.example.js` を参考に `js/firebase-config.local.js` を作る。このファイルは Git 対象外。初期化コードが local ファイルを自動では読み込まない。切り替えるなら `js/lib/firebase-app.js` の import を確認してから使う。

運営者としてログインするには、Authentication の Email/Password ユーザーと、Firestore の `operators/{そのUID}` に `enabled: true` が要る。登録 UI は無い。Console 作業。フィールドにメールを入れる場合、その値をチケットやチャットに貼らない。

別の Firebase プロジェクトを既定にする手順はリポジトリに無い。`.firebaserc` の `default` が本番 ID。実験用プロジェクトを使うなら、自分の環境だけで alias を切り替え、本番 ID へデプロイしない。

## ローカル表示

静的サーバで開く。README の例:

```powershell
npx --yes serve -p 8766
```

`http://localhost:8766/` が運営トップ。この状態の Firestore 読み書きは、設定が本番プロジェクトのままなら本番データに届く。ローカル表示は本番の閲覧になる。大会の作成・確定・結果入力を試す場所ではない。

## Emulator

`firebase.json` の emulator は Firestore `8090`、Auth `9099`、Functions `5001`。UI は無効。

`http://127.0.0.1:8770/` だけが Emulator に接続する（`js/lib/firebase-app.js`）。`8766` は本番の閲覧のまま。8770 の起動は静的サーバと、Auth / Firestore / Functions の Emulator、`node scripts/local-emulator-seed.mjs`。本番プロジェクトへは書かない。テスト用ログインは seed スクリプト先頭の定数。

Rules テストが Emulator を起動する。

```powershell
npm run test:rules
```

中身は `firebase emulators:exec --only firestore`。単体で起動するなら:

```powershell
npx firebase emulators:start --only firestore
```

ブラウザ確認用は次で、Auth / Firestore / Functions を同時に起動する。

```powershell
npx firebase emulators:start --only auth,firestore,functions
npx --yes serve -p 8770
node scripts/local-emulator-seed.mjs
```

## テストコマンド

リポジトリルート。`npm test` は無い。

| コマンド | 内容 |
|----------|------|
| `npm run test:domain` | `tests/domain/*.test.mjs` を node で直列実行 |
| `npm run test:smoke` | HTML / JS の配線を文字列と import で検査 |
| `npm run test:service` | `tests/service/` |
| `npm run test:functions` | `functions/test/`。実行前に domain を vendor へ同期 |
| `npm run test:rules` | Firestore Emulator |
| `npm run test:smoke:production` | 本番 Hosting の JS が期待する export を持つか。データは書かない。本番確認の依頼時だけ |

Functions 単体は `functions/` で `npm test`（中で `sync-domain`）。

変更したドメインに対応するテストファイルを先に足し、少なくとも `test:domain` と、Rules を変えたなら `test:rules`、Callable を変えたなら `test:functions` を実行する。

`scripts/e2e-*-prod.mjs` は本番に大会を作る、または本番を操作するものがある。引き継ぎ確認の一環で実行しない。

## ドメイン同期

Functions は `js/domain` を直接 import しない。`functions/scripts/sync-domain.mjs` が `functions/vendor/domain` へコピーする。`functions/vendor/` は `.gitignore`。

```powershell
npm --prefix functions run sync-domain
```

`firebase deploy --only functions` の `predeploy` でも同じコマンドが走る。vendor を手で直しても次のデプロイで消える。

## GitHub

リモートは `origin` = `https://github.com/gando0120-png/SMATournament.git`。開発ブランチの固定名は無い。確認した時点の追跡ブランチは `main`。

- `main` へ直接押し込むか PR にするかは、移管後の担当者間で決める。リポジトリに PR テンプレートと保護ルールの定義ファイルは無い。
- コミットメッセージは既存の `feat:` / `fix:` の1行が近い。
- コミットに含めないもの: `node_modules/`、`functions/vendor/`、`js/firebase-config.local.js`、`.firebase/`、認証情報、本番データのエクスポート、参加者名簿。
- `js/firebase-config.js` は Web SDK 用として意図的に Git 管理（`.gitignore` のコメント）。秘密鍵ではないが、再掲しない。

Codex から作業する場合も、本番 Firebase へ書き込む操作と `firebase deploy` は人間の確認後にする。

## 本番デプロイ

対象確認:

```powershell
npx firebase projects:list
npx firebase use
```

表示が `smatournament-ce785` であることを確認してから続ける。違うプロジェクトなら中止する。

### 1. バックアップ

リポジトリに自動バックアップは無い。デプロイする人が次を残す。

- デプロイする Git のコミットハッシュ（`git rev-parse HEAD`）と、本番が今どのコミットか分からなければ Hosting の現行リリース時刻
- Firestore を変える、または Rules / Functions が既存ドキュメントの形に依存する変更では、デプロイ前に Firestore エクスポートを取る。例: Google Cloud Console の Firestore エクスポート、または権限があるアカウントで `gcloud firestore export`。出力先バケットは本番プロジェクトの既存手順に従う。バケット名はリポジトリに書かれていない。エクスポートファイルは Git に入れない
- エクスポートに参加者のメールと氏名が含まれる。置き場所は運営者だけが読める場所にする
- Hosting だけの変更でも、リリース前のバージョンを Console の Hosting リリース履歴で特定できるようにする

課金が無効だと Functions のデプロイと実行が失敗する。2026-11-10 15時台（JST）は無効で、17時台の再確認では有効だった。詳細は `HANDOVER.md`。デプロイ直前に Console で有効であることを確認する。課金を切り替える操作は、この資料の手順ではない。

### 2. 検証

デプロイ前:

- 変更範囲の `npm run test:*` が成功している
- Rules 変更なら `npm run test:rules`
- Functions 変更なら `npm run test:functions`（同期後の vendor でテストされる）
- 本番大会のドキュメントをテスト用に更新しない

デプロイコマンドは変更した面だけ。

```powershell
npx firebase deploy --only firestore:rules
npx firebase deploy --only functions
npx firebase deploy --only hosting
```

`firebase deploy` を引数なしで全展開しない。Indexes ファイルは `firebase.json` の ignore に名前があるが、リポジトリに `firestore.indexes.json` は無い。indexes デプロイは手順に含めない。

Hosting の公開ルートはリポジトリ直下なので、`firebase.json` の `hosting.ignore` で配信しないものを外す。対象は `tmp/`、ログ、Excel、`functions/`、`_legacy/`、`.git/`、`.env`、サービスアカウント JSON。`functions` のデプロイは `functions.source` を使うので、この ignore では止まらない。`js/firebase-config.js` はクライアント用の Web 設定として配信する。秘密鍵ではない。

Functions は Gen2 で、デプロイ時に Cloud Build が default pool を使う。2027-03-28 以降、未指定の worker は legacy から regular になる。2026-10-01 に、このプロジェクトの default pool で `workerRelease: regular`（解決版 `2026.09`）のスモークビルドは SUCCESS だった。そのビルドは Functions の本番デプロイではない。アプリ側に worker 指定は無い。

### 3. デプロイ後の確認

本番大会の抽選や結果は触らない。確認は次に限る。

- `https://smatournament-ce785.web.app/` が開き、運営ログイン画面が出る
- 変更した静的ファイルの URL が新しい内容を返す（HTML / JS / CSS は no-cache）
- Functions を出した場合、Cloud Console で対象関数の更新時刻とエラーログを見る。選手向けなら、テスト大会で `listPlayerTeamChoicesCallable` が 500 でないこと。本番大会の選手 URL を開くと `teamNumber` の補完書き込みが起きるので、本番大会では開かない
- Rules を出した場合、テスト大会で運営の読み書きと、未認証のエントリー作成条件を見る

失敗したら次の復旧へ。成功したコミットハッシュを手元の作業記録に残す。

### 4. 復旧

| 失敗 | 戻し方 |
|------|--------|
| Hosting | Firebase Console の Hosting リリース履歴で直前のリリースにロールバックする。または記録した前コミットを checkout して `npx firebase deploy --only hosting`。前コミットが不明ならロールバックを優先する |
| Functions | 記録した前コミットを checkout し `npx firebase deploy --only functions`。`predeploy` が当時の `js/domain` を vendor に同期する。課金無効が原因なら再デプロイでは直らない |
| Rules | 前コミットの `firestore.rules` で `npx firebase deploy --only firestore:rules`。緩和したまま放置しない |
| Firestore データ | デプロイ前エクスポートから、壊れた範囲だけを復旧する。全件上書きインポートは、エクスポート以降の本番進行を消す。当日の大会があるときはインポートしないで、運営者に影響範囲を確認する |
| 緊急運営が必要 | アプリを直す前に、ダッシュボードの「非常データを保存（JSON）」と「緊急運営用Excelを保存（XLSX）」で会場運営をアプリの外へ出す。手順は `HANDOVER.md`。JSON を Firestore へ戻す機能は無い |

ロールバック用に `git push --force` を `main` へ行わない。

## 障害時に先に見ること

1. 画面が「結果入力を開けません」なら、ブラウザ console の `[player-results]` または `[result-load]` と、Cloud Logging の Callable ログ。2026-11-10 の実例は課金無効の 500。
2. 運営画面の権限エラーは、`operators/{uid}.enabled` と大会の `createdBy`。
3. ブロック確定後に選手の試合が空なら、`qualifyingSchedules/current` の有無。エラー画面とは別。
4. 公開ページが空なら `publicViewEnabled` と `publicSnapshot/current`。
5. Functions デプロイ失敗は Cloud Build（`asia-northeast1`、タグ `p-gcf`）のビルドログ。
