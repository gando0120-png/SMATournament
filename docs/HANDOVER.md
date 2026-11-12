# 引き継ぎ

調査日 2026-11-10。仕様の正はソース。このファイルは実装の地図と、本番を壊さないための注意。参加者の氏名・連絡先・トークンは書いていない。

## いま動いている機能

運営（ログイン）:

- 大会の作成・編集・受付開始・終了・ソフト削除、公開フラグ、選手入力フラグ
- 形式: 予選＋決勝、一発トーナメント。試合は H2H セット、または複数チーム合計。決勝の順位モードに敗戦帯（`loss_band`、枠 32/64/128）
- 公開エントリーの受付と、運営による `pending` → `confirmed`、プロフィール修正、参加辞退（`cancelled`。行は残す）。抽選前はクライアント更新。予選対戦表の確定後は Callable がエントリーだけを変え、辞退チームの試合は無効として導出する
- テスト大会名に限るダミーエントリー
- ブロック抽選 draft、配置の移動・入替、ブロック確定、確定時の予選対戦表生成（失敗時は「予選対戦表を生成」）
- 予選の対戦表・試合開始・結果・順位・モルックアウト
- 決勝進出の確定、決勝ブラケット、試合進行、BYE、下位トーナメント、大会結果の確定
- 敗戦帯の進行と、Callable 経由の結果修正（後続ラウンドの破棄と再生成を含む）
- 進行一覧、組合せ表、時刻表
- 公開スナップショットの更新
- 選手入力の照合一覧と、運営ロック
- 非常用 JSON と緊急運営 Excel のダウンロード（ダッシュボード。Firestore へは書かない）
- テスト大会の削除（名前条件付き、運営者のみ）

選手・一般:

- `entry.html?id=` から受付中の申込（status `pending`）
- `tournament-public.html?id=` で公開スナップショットの閲覧（`publicViewEnabled` のとき）
- `player-results.html?tournamentId=` でチーム選択、予選の自側得点、条件を満たせば決勝の勝利報告

認証の実体は Firebase Authentication の Email/Password と、Console 登録の `operators/{uid}.enabled`。大会作成者は自分の大会を管理できる。

## 設計判断

- ドメインロジックは `js/domain` に集め、画面と Functions で共有する。Functions へはデプロイ時コピー。手で二実装しない。
- 運営の進行データはクライアント SDK + Rules。選手提出・トークン・照合の書き込みと、非常用エクスポート・テスト大会削除・敗戦帯修正は Admin SDK。選手に Rules の read を開けない。
- 予選対戦表と決勝進出は一度書いたらクライアントから更新できない。進行の取り消しを後から足すときは Rules と既存大会の両方を設計する必要がある。ブロック確定を draft に戻す処理は無い。
- 公開ページは生の `entries` を読まない。スナップショットに禁止フィールドがある。
- 選手は自側得点だけ送る。相手得点からの補完はしない。両提出が一致したとき正式結果になる。
- チーム別 URL は廃止方向。`issueEntryAccessTokensCallable` と `teamToken` は残っているが、掲示は大会共通 URL。
- 利用者向けエラーは内部コードを隠す。調査は console と Cloud Logging。
- 緊急時はアプリを正にし続けず、Excel に運営を切り替える。切り替えたあとアプリと Excel の並行入力をしない（Excel 内の注意文）。

## EmergencyExport と緊急 Excel

正は `js/domain/emergency-export-schema.js`、組み立ては `js/domain/emergency-export.js`、派生表示は `emergency-export-derived.js`、整合性は `emergency-export-integrity.js`。Callable は `exportEmergencyTournamentCallable`（読み取り専用）。ダッシュボードのボタンは「非常データを保存（JSON）」。

- `schemaVersion` 1、`type` は `emergency-ops`、`source` は `firestore`
- 注記: source が大会進行の正。derived は理解用で、Firestore へ書き戻さない
- 個人情報・認証情報は載せない。禁止キーに email、代表者名、member2〜4、comment、token、tokenHash、createdBy、clientRequestId など。除外コレクションは `entryAccessTokens`、`publicSnapshot`、`entryCompletionGuidance`、`testSimulation`
- 載せるコレクションは schema の `EMERGENCY_EXPORT_ALLOWED_COLLECTIONS`（エントリーはチーム名と番号と状態まで）
- エントリーの許可キーは `entryId`、`teamName`、`status`、`teamNumber`、`isDummy`、`dummyIndex`、時刻だけ

緊急 Excel は `js/domain/emergency-ops-excel.js` と `emergency-ops-finals*.js`、実体は `js/domain/minimal-xlsx.js`（マクロなし）。ボタンは「緊急運営用Excelを保存（XLSX）」。Firestore へは書かない。JSON をブラウザ内で表にしたもの。

予選シート: 「大会状況」「予選対戦表」「現在順位」「未消化試合」「_集計」。脱出時点の公式結果は静的。未消化は Excel 数式。順位規則の表示文はセット勝、セット分、総得点（`sma-qualifying-standings-v1`）。同点は人手で最終順位を入れる。

決勝シート: 「決勝進出」「決勝トーナメント」「_決勝集計」。export に正式ブラケットの試合があればそれを使う（コード上の mode は `official`、表示「脱出前確定」）。試合が無いときは Excel が抽選を再計算しない。運営が現場の配置を slot に入れ、アプリと同じ配線で進める（`emergency-ops-finals-manual.js`、mode `emergency_manual`）。配置の指紋で、確定後の改変を検出する。

この JSON と Excel の形を変えるときは `tests/domain/emergency-export.test.mjs`、`emergency-ops-excel.test.mjs`、`emergency-ops-finals.test.mjs` と `functions/test/emergency-export.functions.test.mjs` を同時に更新する。書き戻し機能は足さない。

## 既知の制約と、コードに無いもの

- README が未着手と書いている Phase 2 以降は実装済み。README のフェーズ表は使わない。
- 受付番号 `receiptNumber` と `counters/receipt` は未実装。Rules のコメントどおり。
- `RankingRule` という差し替え口は `js/` に無い。予選順位は `qualifying-standings`、敗戦帯は `js/domain/loss-band/`。
- ブロック「確定解除」は README の Phase 4 記述のみ。Rules の update は draft 編集か draft→finalized だけ。
- 公開エントリーの status は `pending`。README の `applied` は定数には残るが、公開作成 Rules は `pending`。
- ホスティングの現行設定は Firebase Hosting。README の GitHub Pages 手順は現行の `firebase.json` と一致しない。
- GitHub Actions は無い。`npm test` は無い。
- Auth / Functions の Emulator 定義は無い。ブラウザを Firestore Emulator に繋ぐコードも無い。
- `firestore.indexes.json` はリポジトリに無い。
- 選手向け Callable に App Check は無い。
- チーム番号は、選手画面のチーム一覧 Callable が欠番を埋めるときに初めて保存される。確定エントリーの `teamNumber` が空でも、抽選自体は entryId で組む。
- 利用者向けエラーは Callable の内部例外を「試合データを読み込めませんでした」にまとめる。課金停止もこの文言になる。
- `scripts/e2e-*-prod.mjs` は本番を使う。テストランナーには入っていない。
- Cloud Build の worker 既定変更日は 2027-03-28。それまで未指定ビルドは legacy。regular の非本番スモークは 2026-10-01 に SUCCESS（解決版 `2026.09`）。Functions の本番デプロイ経路自体は変えていない。

## 本番運用の注意

- プロジェクト ID `smatournament-ce785`。Hosting は `https://smatournament-ce785.web.app`。
- Cloud Billing は、2026-11-10 15時台（JST）の読み取りでは `billingEnabled: false` だった。同じ時間帯の Callable ログは、課金無効を理由とする HTTP 500 だった。この状態だと選手の結果入力、照合、非常用 JSON、敗戦帯修正、テスト大会削除は起動できない。Hosting と、Rules の範囲で運営画面が直接読み書きする経路は別である。
- 2026-11-10 17時台（JST）に同じ Billing API を読み取り専用で再確認したところ、`billingEnabled: true` だった。課金アカウントの識別子はここに書かない。有効になったあとに Callable が成功するかは、この確認では呼んでいない。再度無効になると、選手画面はまた汎用の読み込みエラーになる。
- 同日の読み取りでは、受付中の本番大会で `blockDraw/current` が `draft`、`qualifyingSchedules/current` が無いものがあった。画面上にブロックが見えても、確定と対戦表生成が終わるまで選手の試合一覧は空になる。確定のやり直しはしていない。
- 選手 URL を本番大会で開くと、チーム番号の補完書き込みが起き得る。調査で開かない。
- 非常用 JSON / Excel を保存したあとは、そのファイルを会場の正にする。アプリへ結果を戻す機能は無い。
- デプロイとデータ復旧は `DEVELOPMENT.md` のバックアップ、検証、復旧の順。エクスポートには個人情報が含まれる。

## 初期ドキュメントとの矛盾

| 文書 | 現行と違う点 |
|------|----------------|
| `README.md` フェーズ表 | Phase 2〜5 が未着手のまま。実装は大会 CRUD、エントリー、抽選、Hosting デプロイまで進んでいる |
| `README.md` 公開 | GitHub Pages。現行は Firebase Hosting（`firebase.json`） |
| `README.md` 画面 URL | `entries.html`、`lottery.html` は無い。`tournament-entries.html` とダッシュボード内の抽選 |
| `README.md` エントリー status | 公開作成は `applied` ではなく `pending`。定員後の `waitlisted` 自動付与は公開作成 Rules に無い |
| `README.md` ブロック | 「確定解除」で draft に戻す、とある。Rules も UI もそれがない |
| `README.md` の `preferredBlockSize` だけが抽選単位 | フィールドは残る。大会設定には `blockCount` もある |
| `Architecture.md` | RankingRule 抽象、Match コレクション分離など初期方針。現行のコレクション名は `docs/ARCHITECTURE.md` |
| `DataModel.md` / `requirements.md` / `decision_log.md` | 初期決定の記録。現行 Rules と定数が優先 |

これらの古いファイルは削除していない。新担当者は `AGENTS.md` と `docs/` を優先する。

## 新担当者が最初に確認すること

1. GitHub `gando0120-png/SMATournament` の `main` を push できること。
2. Firebase / Google Cloud でプロジェクト `smatournament-ce785` にログインできること。課金が有効か。無効なら Callable は本番で使えない。
3. 自分の Authentication ユーザーを作り、`operators/{uid}.enabled = true` を既存の管理者が付けること。メールアドレスはチャットに貼らない。
4. `npm install` と `npm --prefix functions install` のあと、`npm run test:domain` と `npm run test:functions` がローカルで通ること。Rules まで見るなら Java を入れて `npm run test:rules`。
5. `AGENTS.md` の禁止事項。とくに本番大会を開いて試さないこと、`scripts/e2e-*-prod.mjs` を流さないこと。
6. 大会当日の避難手順: ダッシュボードの JSON と XLSX。中身の仕様は上記 Emergency 節。
7. デプロイする日は `DEVELOPMENT.md` のバックアップから。初回のデプロイは、課金と権限が揃ってから、変更のない確認デプロイであっても人間が立ち会う。

## 権限と設定（移管で渡すもの）

コード変更では付与できない。前任者が次を移す。

| 対象 | 必要なもの |
|------|------------|
| GitHub | `gando0120-png/SMATournament` の write。`main` の保護があるなら、そのバイパスまたは PR 権限 |
| Firebase プロジェクト `smatournament-ce785` | 少なくとも Firebase Hosting のリリース、Firestore Rules のデプロイ、Cloud Functions のデプロイとログ閲覧。データ復旧まで含むなら Firestore のエクスポート権限 |
| 課金 | このプロジェクトの Cloud Billing を有効にできる人。2026-11-10 時点では無効 |
| Authentication | 運営ユーザーの追加 |
| Firestore Console | `operators/{uid}` の作成（クライアントからは不可） |
| Google Cloud Build | Functions デプロイ失敗時のログ。2027-03-28 の worker 既定変更の通知先 |
| ローカル | Node.js 22、npm、Firebase CLI、Rules テスト用の Java。サービスアカウント鍵は渡さない |
| 渡さないもの | 本番エクスポートの中の参加者個人情報、チームトークン、`js/firebase-config.js` の再送（リポジトリにある）、このチャットに出た課金アカウント資源名の転記 |
