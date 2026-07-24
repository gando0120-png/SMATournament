# SMATournament

SMA 主催モルック大会の運営 Web アプリ（Firebase 版）

SMAScore（ライブ配信スコア表示）とは **別プロジェクト** です。

---

## 概要

大会作成・エントリー受付・参加者管理・予選ブロック抽選を行う Web アプリケーション。

| 項目 | 内容 |
|------|------|
| 技術 | HTML / CSS / Vanilla JavaScript |
| バックエンド | Firebase Firestore + Firebase Authentication |
| 認証 | Email/Password（SMA 運営用） |
| 公開 | GitHub Pages 想定 |
| UI | 日本語・モバイルファースト |

### 実装フェーズ

| Phase | 内容 | 状態 |
|-------|------|------|
| 0 | ディレクトリ構成・legacy 退避・Firebase 設定テンプレート・Security Rules 草案 | **完了** |
| 1 | 基盤 CSS / Firebase 初期化 / 運営ログイン | **完了** |
| 2 | 大会 CRUD | 未着手 |
| 3 | エントリー | 未着手 |
| 4 | ブロック抽選 | 未着手 |
| 5 | 仕上げ・デプロイ | 未着手 |

---

## ディレクトリ構成

```
SMATournament/
├── index.html                      # トップ（Phase 1 で本実装）
├── firestore.rules                 # Firestore Security Rules 草案
├── .gitignore
│
├── css/                            # Phase 1 以降
├── js/
│   ├── firebase-config.js          # Firebase Web 設定（Git 管理・Pages 公開）
│   ├── firebase-config.example.js  # 設定テンプレート
│   ├── lib/                        # Firebase 初期化・認証
│   ├── domain/                     # ビジネスロジック（DOM 非依存）
│   ├── services/                   # Firestore CRUD
│   ├── ui/                         # 画面・コンポーネント
│   └── utils/
│
├── _legacy/                        # v0.1 試作（localStorage 版・参照用）
│   ├── index.html
│   ├── css/
│   └── js/
│
├── requirements.md
├── Architecture.md
├── DataModel.md
└── decision_log.md
```

**重要:** 新 Firebase 版は `_legacy/` を **一切 import しません**。

---

## Firestore データ構造

すべて大会配下に統一します。トップレベルに `entries` / `blockDraw` は **作りません**。

```
tournaments/{tournamentId}                 # 大会ドキュメント
tournaments/{tournamentId}/entries/{entryId}   # 自動ドキュメント ID
tournaments/{tournamentId}/blockDraw/current

operators/{uid}                              # 運営者登録（トップレベル）
```

### operators（`operators/{uid}`）

| フィールド | 説明 |
|------------|------|
| `email` | 運営者メール（任意・管理用） |
| `displayName` | 表示名（任意） |
| `createdAt` | 登録日時 |

**権限:** `operators/{uid}` が存在する UID のみ、大会の作成・一覧・編集が可能。  
**登録方法:** Firebase Console から手動（下記「運営者の登録手順」参照）。クライアントからの write は不可。

### Tournament（`tournaments/{tournamentId}`）

| フィールド | 説明 |
|------------|------|
| `name` | 大会名 |
| `eventDate` | 開催日（YYYY-MM-DD） |
| `venue` | 会場 |
| `entryDeadline` | エントリー締切（Timestamp） |
| `maxTeams` | 募集チーム数 |
| `teamSize` | 1 チームの人数 |
| `courtCount` | 使用コート数 |
| `preferredBlockSize` | ブロック基本人数（**初期値 4**。コードに固定値を分散しない） |
| `status` | `draft` → `open` → `closed` / `archived` |
| `entryCount` | エントリー総数（集計） |
| `confirmedCount` | 参加確定数（集計） |
| `createdAt` / `updatedAt` / `createdBy` | メタデータ |

**大会作成直後:** `status = draft`  
**運営が「エントリー受付を開始」:** `status = open`  
**draft 中に公開 URL へアクセス:** 「現在、エントリー受付開始前です」と表示（Phase 3）

### Entry（`entries/{entryId}`）

| フィールド | 説明 |
|------------|------|
| `receiptNumber` | **MVP では未使用（null または省略）**。運営画面の表示番号は `appliedAt` 順に UI で付与。正式連番は将来 Cloud Functions で実装 |
| `teamName` / `representativeName` / `representativeContact` | チーム情報 |
| `members` | メンバー名配列 |
| `note` | 備考 |
| `status` | `applied` / `confirmed` / `waitlisted` / `cancelled` |
| `appliedAt` / `updatedAt` | 日時 |

**定員ルール:**

- 定員未満の新規申込 → `applied`
- 定員到達後の新規申込 → **拒否せず** `waitlisted`

### BlockDraw（`blockDraw/current`）

| フィールド | 説明 |
|------------|------|
| `status` | `draft` / `finalized` |
| `preferredBlockSize` | 抽選時のブロック基本人数（Tournament からコピーまたは参照） |
| `blocks` | ブロック配列（`entryIds` 等） |
| `finalizedAt` | 確定日時 |

**確定後:** 原則編集不可。確認ダイアログ付き **「確定解除」** で `draft` に戻す（Phase 4）。

### counters/receipt（将来機能）

MVP では **使用しません**。公開フォームからの Transaction 採番は Security Rules と両立しにくいため、  
Entry は Firestore 自動ドキュメント ID で保存します。正式な `receiptNumber` 連番採番は将来 Cloud Functions で実装予定。

---

## Firebase 設定の管理方法

### なぜ `firebase-config.js` を Git 管理するか

GitHub Pages は静的ホスティングのため、ビルド時に環境変数を注入する仕組みがありません。  
Firebase Web SDK は **クライアント側配置が前提** で、`apiKey` 等は公開情報として扱われます。

**データの保護は Firestore Security Rules で行います。** API キー非公開だけでは不十分です。

### ファイルの役割

| ファイル | Git | 用途 |
|----------|-----|------|
| `js/firebase-config.js` | **含める** | GitHub Pages / ローカル共通の Web 設定 |
| `js/firebase-config.example.js` | 含める | 新規参加者向けテンプレート |
| `js/firebase-config.local.js` | **除外**（.gitignore） | 個人開発用の上書き（任意） |

### セットアップ手順

1. [Firebase Console](https://console.firebase.google.com/) でプロジェクトを作成
2. **Authentication** → Sign-in method → **Email/Password** を有効化
3. SMA 運営用アカウントを「ユーザー」タブから追加
4. **運営者ドキュメント** `operators/{uid}` を Firestore に手動登録（下記）
5. **Firestore Database** を作成（本番モード推奨）
6. **プロジェクトの設定** → マイアプリ → Web アプリを追加
7. 表示された設定値を `js/firebase-config.js` に貼り付け
8. `firestore.rules` を Firebase にデプロイ（下記）

### 複数環境（開発 / 本番）を分ける場合

- Firebase プロジェクトを dev / prod で分ける
- ブランチごとに `firebase-config.js` の `projectId` を切り替える
- または `firebase-config.local.js` で上書き（Phase 1 の初期化コードで対応予定）

### セキュリティ上の注意

- `firebase-config.js` を `.gitignore` に入れない（Pages で読み込めなくなる）
- API キー制限: Google Cloud Console で HTTP リferrer 制限を設定することを推奨
- 運営操作は Authentication 必須 + Security Rules で保護
- 大会一覧は **認証済み運営者のみ**（一般参加者は `entry.html?id={tournamentId}` のみ）

---

## Firebase 側で人間が行う設定

### 1. プロジェクト作成

- プロジェクト名例: `smatournament-prod`
- Firestore: 有効化（リージョンは `asia-northeast1` 推奨）

### 2. Authentication

- プロバイダ: **Email/Password** のみ（初期版）
- 運営用ユーザーを 1 件以上手動作成

### 3. 運営者の登録手順（operators）

1. **Authentication** → **ユーザー** → 運営用 Email/Password ユーザーを追加（または既存ユーザーを使用）
2. 追加したユーザーの **ユーザー UID** をコピー（例: `xY3AbC...`）
3. **Firestore** → **データ** → **コレクションを開始**
   - コレクション ID: `operators`
   - ドキュメント ID: **手順 2 の UID**
   - フィールド例:
     - `email` (string): 運営者のメールアドレス
     - `displayName` (string): 表示名（任意）
     - `createdAt` (timestamp): 登録日時
4. 同じ手順で、必要な運営者全員分の `operators/{uid}` を作成

**確認:** ログイン後、`operators/{自分のuid}` が存在する場合のみ大会一覧が表示されます。

### 4. Firestore Rules デプロイ

Firebase CLI を使う場合:

```powershell
npm install -g firebase-tools
firebase login
cd C:\Users\user2\Projects\SMATournament
firebase init firestore
# 既存の firestore.rules を使用
firebase deploy --only firestore:rules
```

Console から貼り付ける場合: **Firestore → ルール** に `firestore.rules` の内容をコピー → 公開

### 5. GitHub Pages

- リポジトリ Settings → Pages → Source: `main` ブランチ `/ (root)`
- 公開 URL 例: `https://{user}.github.io/SMATournament/`

### 6. API キー制限（推奨）

Google Cloud Console → 認証情報 → ブラウザキー → アプリケーション制限:

- `https://{user}.github.io/*`
- `http://localhost:*`（ローカル開発用）

---

## Security Rules 草案（概要）

`firestore.rules` を参照。要点:

| パス | 読取 | 書込 |
|------|------|------|
| `operators/{uid}` | 本人のみ（get） | 不可（Console 手動登録） |
| `tournaments` 一覧 | 運営者のみ（operators 登録済み） | 運営者のみ |
| `tournaments/{id}` 単体 | **公開**（エントリーフォームが status 確認） | 運営者のみ |
| `.../entries` | 運営者のみ | 公開作成（`open` かつ締切前のみ）/ 運営者更新 |
| `.../blockDraw` | 運営者のみ | 運営者のみ |

公開エントリー作成時:

- `status` は `applied` または `waitlisted` のみ
- `source == 'public'`
- 大会 `status == open` かつ `request.time < entryDeadline`

---

## ローカル確認方法

```powershell
cd C:\Users\user2\Projects\SMATournament
npx --yes serve -p 8766
```

| URL | 期待結果 |
|-----|----------|
| http://localhost:8766/ | 運営ログイン画面 / 大会一覧（空状態） |
| http://localhost:8766/_legacy/ | v0.1 試作（独立動作） |

**Phase 1 確認チェックリスト**

- [ ] `js/firebase-config.js` が実値に置換済み
- [ ] Firestore Rules がデプロイ済み（operators ルール含む）
- [ ] 運営用 Authentication ユーザーが作成済み
- [ ] `operators/{uid}` ドキュメントが登録済み
- [ ] 未設定時に「Firebase 設定が未入力」が表示される
- [ ] ログイン成功 + operators 未登録 → 運営者未登録メッセージ
- [ ] ログイン成功 + operators 登録済み → 大会一覧（空状態）
- [ ] ログアウトが動作する

**Phase 0 確認チェックリスト**

- [ ] `_legacy/index.html` が動作する（旧版）
- [ ] `js/firebase-config.js` が存在し `YOUR_*` を実値に置換済み
- [ ] Firestore Rules が Firebase にデプロイ済み
- [ ] 運営用 Email/Password アカウントが作成済み

---

## 画面 URL（Phase 1 以降）

| 画面 | URL | 認証 |
|------|-----|------|
| トップ（大会一覧） | `/index.html` | 要 |
| 大会作成 | `/tournament-new.html` | 要 |
| 管理ハブ | `/tournament-dashboard.html?id={tournamentId}` | 要 |
| エントリー管理 | `/entries.html?id={tournamentId}` | 要 |
| ブロック抽選 | `/lottery.html?id={tournamentId}` | 要 |
| 公開エントリー | `/entry.html?id={tournamentId}` | 不要 |

---

## 関連ドキュメント

- [requirements.md](requirements.md)
- [Architecture.md](Architecture.md)
- [DataModel.md](DataModel.md)
- [decision_log.md](decision_log.md)

---

## 更新履歴

| 日付 | 内容 |
|------|------|
| 2026-07-17 | v0.1 試作（localStorage） |
| 2026-07-22 | Phase 0: Firebase 版基盤・legacy 退避・Security Rules 草案 |
| 2026-07-22 | Phase 1: CSS 基盤・Firebase 認証・operators 権限・index 本実装 |
