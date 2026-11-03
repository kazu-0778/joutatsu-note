# 上達ノート

イラストの上達を補助するWebアプリです。作品の記録・自己評価・次の課題・練習アドバイス・制作スケジュール・成長の記録を1か所で管理します。

- 公開URL（GitHub Pages）: https://kazu-0778.github.io/joutatsu-note/
- 標準はスマホだけで完結（データは端末の中に保存）
- 設定でGoogleドライブと連携すると、PCとも同じ作品・記録を使えます（作品データは運営側のサーバーを通りません）

## ファイル構成

| ファイル | 内容 |
| --- | --- |
| `index.html` | アプリ本体（画面・計算ロジック・端末内保存） |
| `drive.js` | Googleドライブ連携（ログイン、フォルダ作成、双方向同期） |
| `config.js` | GoogleのOAuthクライアントID |
| `sw.js` / `manifest.webmanifest` / `icons/` | ホーム画面への追加とオフライン表示（PWA） |

ビルドは不要です。ファイルをそのまま GitHub Pages で配信します。

## 公開の手順（最初の1回）

1. GitHubのリポジトリ画面で **Settings → Pages** を開く
2. **Source** を「Deploy from a branch」、**Branch** を `main` / `/ (root)` にして **Save**
3. 数分後に https://kazu-0778.github.io/joutatsu-note/ で開けるようになる

## Googleドライブ連携の設定

1. Google Cloud で OAuth クライアントID（種類：ウェブアプリケーション）を作成する
   - 承認済みのJavaScript生成元: `https://kazu-0778.github.io`
   - スコープ: `https://www.googleapis.com/auth/drive.file`（このアプリが作ったファイルだけを扱う）
   - 同意画面が「テスト中」の間は、登録したテストユーザーだけが連携できる
2. `config.js` の `googleClientId` にクライアントIDを書く（クライアントシークレットは書かない）

## ドライブ内のフォルダ構成

```
上達ノート/
  作品/        <作品id>.jpg など（画像）
  記録/        <作品id>.json（自己評価・課題・スケジュールなど）
  設定.json
```

バックアップ（ZIP）も同じ構成です。

## 同期のしくみ

- 端末内（IndexedDB）を正として、保存のたび・アプリを開いたとき・2分ごとにドライブと同期します
- 作品1点ごとに `updatedAt`（最終更新日時）を比べ、新しい方を採用します
- 削除は「削除済み」の記録を残して他の端末に伝えます
- Googleのログインは1時間で切れますが、切れた後（または切れる5分前）に画面をタップすると自動で取り直します（許可済みなので確認画面は一瞬開いて閉じます）。ログインはアプリを閉じても1時間以内なら引き継ぎます

## ローカルで動かす

```bash
python3 -m http.server 8000
```

http://localhost:8000/ を開きます。ローカルでGoogle連携を試す場合は、OAuthクライアントの「承認済みのJavaScript生成元」に `http://localhost:8000` も追加してください。
