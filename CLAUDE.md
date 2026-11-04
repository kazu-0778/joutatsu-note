# 上達ノート：作業メモ

イラストの上達を補助するWebアプリ（PWA）。仕様の正本は `docs/requirements.md`（Word版：`docs/上達ノート_要件定義書.docx`、共同編集用：https://claude.ai/artifact/JhSezKgNwvAjd2nEZWYosg ）。作業の前に `docs/requirements.md` を読むこと。

## 現状（2026-11-03 時点、APP_VERSION 2026.11.04-2）

- 公開版：https://kazu-0778.github.io/joutatsu-note/ （main への push で GitHub Pages に数分で反映）
- 構成：`index.html`（本体）／`drive.js`（Googleドライブ双方向同期、drive.file）／`config.js`（OAuthクライアントID設定済み）／`sw.js`・`manifest.webmanifest`・`icons/`（PWA）
- 保存：端末内 IndexedDB が正。設定でGoogleドライブと同期（作品ごとに updatedAt で新しい方、削除は tombstone）
- 主な機能：作品記録・自己評価（項目カスタム）・課題と反省（スキップ可）・練習メニュー・スケジュール（作業時間×配分%で期日計算、工程完了ボタン）・実績からの配分提案・お題ガチャ＋Claude相談（claude.ai を相談文入りで開く、結果のまとめを取り込んで記録）・成長の記録・正方形タイルのギャラリー・ZIPバックアップ・ライト／ダーク
- claude.ai 上の試作版（https://claude.ai/artifact/5emCiCaXmy7kT7GEjbGVFE ）は仕様確認用。今後は公開版を正とし、試作版の更新は不要（ユーザーから頼まれたときだけ）

## 作業のルール

- ユーザーは日本語。非エンジニア向けに、手順は画面の言葉で具体的に説明する
- 変更したら `index.html` の `APP_VERSION` と `sw.js` の `CACHE` 名を上げる（更新が届くように）
- 動作確認：`python3 -m http.server` ＋ Playwright。ドライブ同期は偽のドライブAPIを route で立てて2台分を確認する
- テスト用ファイルをリポジトリ内に作らない（スクラッチパッドを使う）
- 出力する Excel・Word のフォントは游ゴシック
- 仕様を変えたら `docs/requirements.md` も更新する

## 次の候補（ユーザーと相談して決める）

- 公開版を使った感想の反映、未決事項（requirements.md 8章）の決定
- 段階B：MCPコネクタ（Claudeが記録を読み、計画を登録）
- Capacitor でのスマホアプリ化、OneDrive / Dropbox 対応

## 一般公開前に必ずユーザーへ指示すること

一般公開（Google の同意画面を「本番環境」にする、ストア公開、URL を広く共有するなど）の準備に入るときは、作業を始める前にユーザーへ次を指示する。

- [ ] Google Cloud の「Google Auth Platform → ブランディング」で、**ユーザーサポートメール**を個人の Gmail からアプリ用の問い合わせアドレスに変更する
  - 理由：ユーザーサポートメールはログイン時の確認画面から利用者に見える。現在は個人の Gmail が設定されている
  - 選べるのは、ログイン中の Google アカウントのアドレスか、そのアカウントが管理する Google グループのアドレス
  - 「連絡先情報（デベロッパーの連絡先）」は利用者に見えないため変更は任意
