# アーキテクチャ（現行コード）

2026-11-10 時点のソースが正。ルートの `Architecture.md` / `DataModel.md` / `README.md` は初期草案であり、フェーズ表・エントリー status・ホスティング・確定解除の記述は現行と違う。違いは `HANDOVER.md` に列挙する。

## フロントエンド

ビルド工程は無い。各 HTML が `js/ui/pages/*-page.js` を type=module で読み、ページが `js/services` と `js/domain` を import する。スタイルは `css/tokens.css`、`css/base.css`、`css/components.css`。

| 層 | 場所 | 役割 |
|----|------|------|
| 画面 | `*.html` と `js/ui/pages/` | DOM とイベント |
| サービス | `js/services/` | Firestore / Callable。ドメイン規則を再実装しない |
| ドメイン | `js/domain/` | 入出力が決まる純粋ロジック。DOM と Firebase を import しない |
| 共通 | `js/lib/` | Firebase 初期化、エラー分類、公開スナップショット更新フック |

Firebase 初期化は `js/lib/firebase-app.js`。設定値は `js/firebase-config.js`（Git 管理。Web SDK の公開設定）。任意の上書き `js/firebase-config.local.js` は `.gitignore`。Functions クライアントはリージョン `asia-northeast1`。

運営画面の大会 ID はクエリ `id`。選手画面だけ `player-results.html?tournamentId=`。

主要な画面:

| 画面 | ファイル | 認証 |
|------|----------|------|
| 運営ログイン / 大会一覧 | `index.html` | 要 |
| 大会作成 | `tournament-new.html` | 要。作成者は `isOperatorEnabled()` |
| 大会編集 | `tournament-edit.html` / `tournament-edit-v2.html` | 要 |
| 管理ハブ | `tournament-dashboard.html?id=` | 要 |
| エントリー管理 | `tournament-entries.html?id=` | 要 |
| 予選対戦表 | `tournament-schedule.html?id=` | 要 |
| 予選順位 | `tournament-standings.html?id=` | 要 |
| 予選の試合操作 | `tournament-match.html` | 要 |
| 決勝進出 | `tournament-finals-advancement.html?id=` | 要 |
| 決勝表 | `tournament-finals-bracket.html?id=` | 要 |
| 決勝試合 | `tournament-finals-match.html` | 要 |
| 敗戦帯 | `tournament-loss-band.html` | 要 |
| 進行一覧 | `tournament-schedule-overview.html?id=` | 要 |
| 組合せ表 | `combination-sheet.html?id=&type=` | 要 |
| 大会結果 | `tournament-results.html?id=` | 要 |
| 公開エントリー | `entry.html?id=` | 不要 |
| エントリー完了案内の編集 | `tournament-entry-completion-guidance.html?id=` | 要 |
| 公開閲覧 | `tournament-public.html?id=` | 不要。`publicViewEnabled` と snapshot の read 条件 |
| 選手の結果入力 | `player-results.html?tournamentId=` | 不要。Callable |
| テスト大会削除 | `test-tournament-cleanup.html` | 要。運営者のみ |
| 大会テストツール | `tournament-test-tools.html?id=` | 要 |

`tools/*.html` は静的プレビュー。本番導線ではない。`_legacy/` は localStorage 試作で、現行ページから import しない。

## Firebase

プロジェクト ID は `.firebaserc` の `default`: `smatournament-ce785`。本番 Hosting の URL はコード内の E2E が `https://smatournament-ce785.web.app` を指している。

### Hosting

`firebase.json` の `hosting.public` はリポジトリルート。`docs/`、`tests/`、`scripts/`、`tools/`、`*.md`、`firestore.rules`、ドットファイル、`node_modules` は配信しない。HTML / JS / CSS は `Cache-Control: no-cache, must-revalidate`。GitHub Pages 用の設定は現行の `firebase.json` に無い。

### Authentication

運営ログインは Email/Password。クライアントに運営者登録画面は無い。`operators/{uid}` は本人の get のみ。create / update / list は Rules で拒否。Console で `enabled: true` を付ける。

権限の二系統:

- `operators/{uid}.enabled == true` — 全大会の管理と大会作成
- 大会の `createdBy == request.auth.uid` — その大会の管理。大会作成自体は運営者のみ

### Firestore

データは大会ドキュメントのサブコレクションに置く。トップレベルは `operators` と `tournaments`。`counters/receipt` は Rules のコメントにあるだけで未使用。

ドキュメント ID が `current` のもの: `blockDraw`、`qualifyingSchedules`、`finalsAdvancement`、`finalsBracket`、`consolationBracket`、`tournamentResults`、`publicSnapshot`、`molkkyOutResolutions`、`entryCompletionGuidance`、`timeSchedule`、loss-band の state / placements。

`functions/src/tournament-subcollections.js` の削除対象一覧が、大会配下コレクションの実在リストに一番近い。EmergencyExport が読む集合はそれより狭く、`js/domain/emergency-export-schema.js` の `EMERGENCY_EXPORT_ALLOWED_COLLECTIONS`。

クライアント直書きできないもの（Rules が write 拒否、Functions の Admin SDK だけが書く）:

- `entryAccessTokens`
- `qualifyingResultSubmissions`
- `qualifyingMatchReconciliations`

create のみ（update / delete 不可）の例:

- `qualifyingSchedules`
- `finalsAdvancement`
- `consolationBracket`
- `tournamentResults`
- `lossBandPlacements`

`blockDraw` の update は draft 中の配置変更か、draft から `finalized` への遷移だけ。確定を draft に戻す更新は Rules に無い。draft の delete は受付中の大会だけ。

`finalsMatchResults` の delete は `resolution == 'bye'` のみ。

### Functions

`functions/index.js`。すべて `onCall`、リージョン `asia-northeast1`、Node.js 22。デプロイ前に `functions/scripts/sync-domain.mjs` が `js/domain` を `functions/vendor/domain` へコピーする。

| Callable | 呼び出し元 | 認可 |
|----------|------------|------|
| `listPlayerTeamChoicesCallable` | 選手画面 | 未認証可。大会 ID のみ |
| `listMyQualifyingMatchesCallable` | 選手画面 | 未認証可。チーム番号または旧トークン |
| `submitPlayerQualifyingResultCallable` | 選手画面 | 未認証可。自側得点 |
| `listMyCurrentFinalsMatchCallable` | 選手画面 | 未認証可 |
| `reportMyFinalsWinCallable` | 選手画面 | 未認証可。勝者は本人チーム |
| `issueEntryAccessTokensCallable` | 運営 | ログイン + 大会管理。チーム別 URL は非推奨 |
| `listMatchReconciliationsCallable` | 運営 | ログイン + 大会管理 |
| `markReconciliationOperatorResolvedCallable` | 運営 | ログイン + 大会管理 |
| `rebuildPublicSnapshotCallable` | 運営 | ログイン + 大会管理 |
| `correctLossBandRankingResultCallable` | 運営 | ログイン + 大会管理 |
| `exportEmergencyTournamentCallable` | 運営 | ログイン。中で運営者または作成者を確認。読み取り専用 |
| `dryRunTestTournamentCleanupCallable` | 運営 | ログイン + `operators.enabled` |
| `deleteTestTournamentCallable` | 運営 | ログイン + `operators.enabled` + テスト大会名 |

未認証 Callable に App Check の記述は無い。保護は「返す項目を絞る」と「提出は対戦表上の自チームだけ」で、Firestore Rules ではない。

Functions の実行基盤は Cloud Run。デプロイ時のビルドは Cloud Build（default pool、タグ `p-gcf`）。リポジトリに本番用 `cloudbuild.yaml` は無い。

## 主要データ

大会 `tournaments/{id}` の状態は `draft` / `open` / `closed` / `archived`（`js/domain/constants.js`）。削除は物理 delete ではなくソフト削除（`allow delete: if false`）。

形式 `tournamentFormat`:

- `qualifying_and_finals` — ブロック予選のあと決勝
- `single_elimination` — 予選ブロックを使わない一発トーナメント
- フィールドが無い古い大会は公開形式 `legacy`（`js/domain/tournament-format.js` の `resolvePublicTournamentFormat`）

順位の取り方 `bracketMatchConfig` 側の ranking mode（`js/domain/loss-band/constants.js`）:

- `single_elimination`
- `loss_band` — 敗戦帯。枠はコード上 32 / 64 / 128

試合形式は head-to-head のセットと、複数チーム合計（`matchFormat`）がある。下位トーナメント `consolationBracket` は上位ブラケット確定後に作る。

エントリー `entries/{entryId}`:

- 公開フォーム作成時の status は `pending`（`firestore.rules` の `validPublicEntryCreate`）。必須はチーム名、代表者名、メール、`createdAt`
- 運営が `pending` → `confirmed`
- 抽選ドキュメントも予選対戦表も無いときだけ `confirmed` → `cancelled`（`cancelledAt` を付ける。ドキュメントは残す）
- ダミーエントリーはテスト大会名のときだけ作成・削除できる

ブロック `blockDraw/current`: `status` は `draft` または `finalized`。`blocks[].entryIds` が配置。

予選 `qualifyingSchedules/current`: `finalized` と `blocks[].rounds[].matches[]`。`matchId`、`courtNumber`、`team1` / `team2`。

予選結果 `qualifyingMatchResults/{matchId}`、進行 `qualifyingMatchSessions/{matchId}`。

決勝進出 `finalsAdvancement/current` ができると、予選結果の作成・更新は Rules で止まる。選手提出も Functions 側で拒否する。

## 予選・決勝の流れ

予選あり形式の運営操作順（ダッシュボードとサービスが実装している順）:

1. 大会を `open` にし、エントリーを `confirmed` にする。
2. ブロック抽選で `blockDraw/current` を draft 作成する。draft 中だけ移動・入替ができる。
3. 「ブロック確定」。`finalizeBlockDraw` が status を `finalized` にし、同じ操作で `saveQualifyingSchedule` を呼ぶ。対戦表ドキュメントが既にある場合は `qualifying-schedule/already-finalized` として続行する。生成に失敗すると、確定済みかつ `schedule.finalized` でないときダッシュボードに「予選対戦表を生成」が出る。
4. 運営が予選結果を入力する。または選手入力が ON なら選手が自側得点を送る。
5. 順位は `js/domain/qualifying-standings.js`。同点のモルックアウトは `molkkyOutResolutions/current`。
6. 「決勝進出を確定」で `finalsAdvancement/current` を create する。以後このドキュメントは更新できない。
7. 決勝ブラケット `finalsBracket/current` を作り、試合セッションと結果を進める。必要なら下位トーナメント。
8. `tournamentResults/current` を create して大会を閉じる。

一発トーナメントはブロック抽選を使わず、`finalsBracket` を直接作る。敗戦帯は `lossBand*` コレクションと `tournament-loss-band.html`。結果修正で次ラウンドを捨てて作り直す処理は `correctLossBandRankingResultCallable`。

ブロック確定の「やり直し」は Rules 上できない。配置を変えるには、確定前の draft 編集か、別の運用判断が必要。コードに確定解除は無い。

## 選手結果入力と照合

画面は `player-results.html` → `js/ui/pages/player-results-page.js`。

1. `listPlayerTeamChoicesCallable` が `confirmed` エントリーの番号とチーム名だけを返す。欠番は Functions が `teamNumber` を書き込む（`planTeamNumberAssignments`）。この Callable は画面を開いた時点で走る。
2. チーム選択後、`listMyCurrentFinalsMatchCallable` がページモードを決める。決勝進出前は `qualifying`。そのとき `listMyQualifyingMatchesCallable` が自チームの試合だけ返す。
3. 予選送信は自側のセット得点だけ（`submitPlayerQualifyingResultCallable`）。相手得点の `100 - x` 補完はしない。両チームの提出が揃い妥当なら正式結果になる。不一致は `qualifyingMatchReconciliations` の conflict。運営は照合一覧を見て、結果修正後に `markReconciliationOperatorResolvedCallable` を使える。
4. ゲートは `assertPlayerSubmissionAllowed`。プレイヤー入力 OFF、大会が `open` でない、決勝進出ドキュメントがある、対戦表が未確定、のいずれかで送信不可。対戦表が無いとき一覧は空で、エラー画面にはしない。
5. 決勝進出後かつ H2H ブラケット確定後は、同じ URL が決勝の「現在の試合」と勝利報告になる。敗戦帯と複数チーム合計は選手画面では使えない（`resolvePlayerFinalsPageMode`）。

旧 `teamToken` クエリは後方互換。現行の掲示 URL は大会共通で、トークンを付けない（`buildTournamentPlayerResultsUrl`）。

選手画面のエラー「結果入力を開けません / 試合データを読み込めませんでした」は、`getUserFacingError(..., RESULT_LOAD)` の汎用文。Callable の `internal` がここに入る。2026-11-10 の本番ログでは、原因は課金無効による Callable 500 だった。データ欠落や Rules 拒否とは別。

## 公開ページ

`tournament-public.html` は運営用の生コレクションを読まない。`publicSnapshot/current` を読む。read 条件はドキュメント ID が `current` かつ大会の `publicViewEnabled`（`isPublicViewEnabled`）。

中身は `buildPublicTournamentSnapshot`（schemaVersion 2）。順位・対戦・進出・結果の表示用で、メール、代表者、メンバー、トークン、`createdBy`、ダミーフラグ、セッション map、`participantResultEntryEnabled` は禁止フィールド。

運営操作のあと `js/lib/public-snapshot-hook.js` の `withPublicSnapshotRebuild` がクライアントからスナップショットを書き直す経路がある。Callable `rebuildPublicSnapshotCallable` は Admin SDK で同じ再構築を行う。

公開エントリー `entry.html` は受付中（`open` かつ締切前）だけ `entries` を create できる。一覧取得はできない。完了案内文は `entryCompletionGuidance/current` を、受付中なら未認証でも読める。
