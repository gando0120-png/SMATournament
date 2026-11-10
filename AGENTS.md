# SMATournament — Codex / 開発エージェント向け

SMA 主催モルック大会の運営 Web アプリ。静的 HTML / CSS / Vanilla JavaScript と Firebase（Hosting / Auth / Firestore / Functions Gen2）で動く。SMAScore（配信スコア）とは別プロジェクト。

このファイルが現行の開発制約。ルートの `README.md`、`Architecture.md`、`DataModel.md`、`requirements.md`、`decision_log.md` は 2026-07 の初期草案で、実装と矛盾する。現行仕様はコードと `docs/ARCHITECTURE.md` を正とする。矛盾の一覧は `docs/HANDOVER.md`。

## 最初に読むファイル

1. `docs/ARCHITECTURE.md` — 構成、データ、予選・決勝・選手入力・公開ページ
2. `docs/DEVELOPMENT.md` — 環境、テスト、GitHub、デプロイ、復旧
3. `docs/HANDOVER.md` — 実装範囲、設計判断、緊急運営、本番注意
4. `firebase.json` / `.firebaserc` — Hosting・Functions・Emulator・既定プロジェクト ID
5. `firestore.rules` — クライアント権限の正
6. `functions/index.js` — Callable の認証境界
7. `js/domain/constants.js` — ステータスとドキュメント ID
8. `js/domain/emergency-export-schema.js` と `js/domain/emergency-ops-excel.js` — 非常時 JSON / Excel。設計を崩さない

変更対象の画面は、対応する `*.html`、`js/ui/pages/*-page.js`、`js/services/*.js`、`js/domain/*.js` をセットで見る。Functions が同じ判定を使う場合は `functions/src/` と `npm --prefix functions run sync-domain` の同期対象（`js/domain` → `functions/vendor/domain`）も見る。`functions/vendor/` は生成物で Git 管理外。編集しない。

## 構成の要点

- ブラウザは Firebase Web SDK を CDN ESM で直接 import する。バンドラは無い。
- 運営の大会進行は、ログイン済みクライアントが Firestore を Rules の範囲で直接読み書きする。
- 選手の結果入力、公開スナップショットの一部再構築、テスト大会削除、敗戦帯の結果修正、非常用 JSON は Callable（`asia-northeast1`）経由。選手向け Callable は `invoker: "public"` で未認証可。中身は Admin SDK なので Rules を通らない。
- 公開閲覧は `tournaments/{id}/publicSnapshot/current` を読む。個人情報と内部セッションはスナップショットに載せない（`js/domain/public-tournament-snapshot.js` の `FORBIDDEN_SNAPSHOT_FIELDS`）。
- 大会 URL のクエリは運営画面が `id`、選手画面 `player-results.html` だけ `tournamentId`。

## 禁止事項

- 本番プロジェクト `smatournament-ce785` の大会データ（抽選、対戦表、結果、エントリー、公開スナップショット）を、依頼がない限り読み書きしない。調査は読み取り専用。
- `scripts/e2e-*-prod.mjs` と `scripts/probe-production-*.mjs` は本番 Hosting / 本番データに触れる。確認なしに実行しない。
- Firestore Rules を「動かないから」と緩めない。選手が読めないコレクションは Callable 側で必要項目だけ返す設計。
- API キー、秘密鍵、refresh token、`operators` のメール、参加者の氏名・メール・連絡先・チームトークンを、コミット・ログ・資料・チャットに出さない。`js/firebase-config.js` の Web 設定はクライアント公開前提だが、資料へ転記しない。
- `functions/vendor/` を手編集しない。ドメイン変更は `js/domain` を直し、デプロイ前の `sync-domain` に任せる。
- `_legacy/` を新コードから import しない。
- EmergencyExportV1 を Firestore へ書き戻さない。緊急 Excel を開いたあとにアプリへ結果を逆輸入しない。Excel は抽選を再実行しない。正式ブラケットが export にあればそれを使い、無いときだけ運営者の手動配置を使う。
- 予選対戦表（`qualifyingSchedules`）と決勝進出（`finalsAdvancement`）は Rules 上 create のみ。update / delete は不可。確定解除 UI は無い。
- テスト大会削除 Callable は名前条件を満たす大会だけ。本番大会名では動かさない。

## 仕様を変えるとき

- 判定は `js/domain` に置く。画面と Functions に同じ条件を複製しない。Functions は `functions/vendor/domain` 経由で同じファイルを読む。
- クライアントが書くフィールドを増やすときは、`firestore.rules` の `hasOnly` / 型チェックと `tests/rules/` を同時に更新する。Rules の式が長いと評価上限に当たる（時刻表の override は 1 マップ 16 件までの理由）。
- 公開 JSON に項目を足すときは `FORBIDDEN_SNAPSHOT_FIELDS` と EmergencyExport の `EMERGENCY_EXPORT_FORBIDDEN_KEYS` を確認する。メール、代表者名、メンバー名、トークン、`createdBy` は出さない。
- エントリーの公開作成ステータスは `pending`。`applied` は定数に残っているが、公開作成 Rules は `pending` のみ。`confirmed` から `cancelled` は、ブロック抽選ドキュメントも予選対戦表も無いときだけ。
- ブロック確定は `blockDraw/current` を `finalized` にし、続けて `qualifyingSchedules/current` を生成する（`js/services/block-draw-service.js` の `finalizeBlockDraw`）。失敗時はダッシュボードの「予選対戦表を生成」。確定後に draft へ戻す更新は Rules が拒否する。
- 選手入力の成否メッセージは `js/lib/user-facing-error.js` で利用者向け文言に潰れる。Callable の `internal` は画面上「試合データを読み込めませんでした」になる。原因調査はブラウザの console と Cloud Logging。

## テスト

依存は Node.js 20（Functions の `engines`）。リポジトリルートで次を実行する。

- `npm run test:domain` — ドメイン単体
- `npm run test:smoke` — 画面と配線の静的検査
- `npm run test:service` — サービス層
- `npm run test:functions` — Callable ロジック（先頭で domain を vendor へ同期）
- `npm run test:rules` — Firestore Emulator（`127.0.0.1:8090`）。Java が必要

`npm test` は定義されていない。本番スモーク `npm run test:smoke:production` は本番 Hosting の配信 JS を読む。データは書かないが、本番確認の依頼があるときだけ使う。

UI を変えたときは、可能ならブラウザで該当画面の操作を確認する。本番大会では操作しない。

## デプロイ

手順の詳細、バックアップ、検証、復旧は `docs/DEVELOPMENT.md`。要点だけ。

- 対象は `.firebaserc` の `default`（`smatournament-ce785`）。別プロジェクトへ向けない。
- Hosting の公開ルートはリポジトリ直下。`firebase.json` の `ignore` で `docs/`、`tests/`、`scripts/`、`tools/`、Markdown、Rules は配信しない。
- Functions デプロイは `predeploy` で `sync-domain` が走る。Node 20。リージョンはコード上 `asia-northeast1`。
- デプロイ前に、変更範囲のテスト、対象コミットの記録、Firestore エクスポート（データに影響する変更のとき）を行う。
- 2026-11-10 15時台（JST）は Cloud Billing が無効で Callable が 500 になっていた。17時台の再確認では有効。無効に戻ると選手の結果入力画面は汎用エラーになる。Functions を使う前に課金状態を確認する。事実の出典は `docs/HANDOVER.md`。
- Cloud Build の worker 既定は 2027-03-28 まで legacy。その後 regular。Functions デプロイが使う。アプリに `cloudbuild.yaml` は無い。
