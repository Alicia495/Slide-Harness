# Slide Harness

日本語のチャットでスライドを作成・編集し、編集可能な PowerPoint ファイルを出力する Web アプリです。文書モデルを正本として保持するため、画面や AI の修正を版履歴に残せます。

## 起動

1. `.env.example` を `.env` にコピーします。
2. `.env` に Azure OpenAI または vLLM の接続情報を記入するか、起動後の「AI 設定」画面でモデルを登録します。API キーを画面から保存する場合は `AI_SETTINGS_ENCRYPTION_KEY` も設定します。
3. `DB_PASSWORD` を変更し、`BIND_HOST` に社内 LAN のホスト IP を設定します。
4. `docker compose up --build -d` を実行します。
5. `http://<ホストIP>:3000` を開きます。`docker compose ps` で `app` と `db` の状態を確認できます。

デモで画面を試す場合は `DEMO_AI=true` にできます。デモの応答は固定で、外部 AI へは接続しません。実際の生成には Azure OpenAI または vLLM の設定が必要です。

### AI 設定画面

一覧右上の「AI 設定」から複数のモデルを登録できます。接続先のモデル一覧と最大コンテキスト長を取得し、表示名と最大出力トークン数をモデルごとに保存します。取得できない接続先では最大コンテキスト長を手動入力します。チャット欄で登録モデルを切り替えられます。環境変数で指定したモデルは読み取り専用で表示され、必要なら複製して設定画面から管理できます。

OpenAI 互換モデルへの生成リクエストは `temperature=1.0`、`top_p=0.95`、`top_k=20`、`min_p=0.0`、`presence_penalty=0.0`、`repetition_penalty=1.0` に固定します。会話の圧縮と文書操作では、推論だけで出力枠を使い切るモデルに備えて `enable_thinking=false` も送ります。Azure OpenAI は対応しないパラメータがあるため、設定画面で Temperature と Top P を指定します。

画面で入力する API キーは AES-256-GCM で暗号化して PostgreSQL に保存します。暗号化キーは `.env` の `AI_SETTINGS_ENCRYPTION_KEY` に32バイトの乱数を Base64 で設定してください。例: `node -p "require('node:crypto').randomBytes(32).toString('base64')"`。この値はバックアップし、変更すると保存済み API キーを復号できなくなります。認証不要のローカル AI なら設定は不要です。

会話では、推定入力トークン数と出力上限の合計が最大コンテキスト長の80%に達した時、古い会話を日付付きの観測記録へ変換します。直近の会話は原文のまま残し、観測記録が増えたら決定事項・制約・未解決事項を再整理します。元のメッセージはDBに残ります。トークン数はモデル共通の概算であり、接続先の実際のトークナイザーとは差があります。

### Azure OpenAI

`AZURE_OPENAI_RESOURCE`、`AZURE_OPENAI_DEPLOYMENT`、`AZURE_OPENAI_API_KEY` を設定します。プロキシや専用 URL を使う場合は `AZURE_OPENAI_ENDPOINT` を設定します。既存のデプロイメント URL 形式が必要な環境では `AZURE_OPENAI_LEGACY_URLS=true` と API バージョンも設定してください。

### vLLM

vLLM などの OpenAI 互換 API を別途起動し、`VLLM_BASE_URL` を `/v1` まで含めて指定します。ローカル開発では `http://127.0.0.1:8888/v1`、Docker Desktop からホスト上のサーバーへ接続する場合は `http://host.docker.internal:8888/v1` のように指定します。コンテナ内の `127.0.0.1` はホストではなくコンテナ自身です。`VLLM_MODEL` は `/v1/models` が返す文章生成モデルの ID です。認証不要なら `VLLM_API_KEY` は空欄にします。ホスト上のAIサーバーがコンテナからの接続に認証を要求する場合は、そのサーバーのAPIキーを設定してください。モデルに JSON 形式の応答と指示追従の能力が必要です。画面のモデル選択後、接続テストを実行できます。

## 使い方

- 一覧から新しい資料を作り、チャットで目的・対象読者・枚数を指定します。最初の構成は変更案として表示されます。
- 要素をクリックするとチャットの対象に入ります。ドラッグで移動、右下のハンドルでサイズ変更、ダブルクリックで文字を編集できます。
- AI の単一要素の修正は即適用されます。スライド全体など大きい変更は、現在と変更後を比較してから適用します。
- 上部の履歴から過去の版を復元できます。画面内の取り消し・やり直しはキーボード操作にも対応します。
- 「出力プレビュー」は LibreOffice で PPTX を描画します。「PPTX 出力」でファイルを保存します。

## 開発

Node.js 24、pnpm 11、PostgreSQL 17 を使います。

```powershell
pnpm install
$env:DATABASE_URL = "postgres://slide_harness:password@localhost:5432/slide_harness"
pnpm db:migrate
$env:DEMO_AI = "true"
pnpm dev
```

`pnpm typecheck`、`pnpm test`、`pnpm build` で検証できます。OpenAI 互換サーバーを起動した状態で `pnpm exec tsx scripts/compaction-smoke.ts` を実行すると、自然なテスト会話で80%圧縮と文書操作を確認できます。このスクリプトは `.env.local` の `DATABASE_URL`、`VLLM_BASE_URL`、`VLLM_MODEL` を使い、検証用のモデルと資料を終了時に削除します。ローカルで出力プレビューを使う場合は LibreOffice と Poppler が必要です。Docker イメージには両方を含めています。

PostgreSQL をローカルで起動できない場合、開発用の PGlite サーバーを使えます。別のターミナルで `pnpm db:dev` を実行し、アプリ側では `DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54321/postgres` と `DB_POOL_MAX=1` を設定してください。`pnpm db:migrate` の後に `pnpm dev` を起動します。これは開発専用で、Docker 配備では PostgreSQL を使います。

## データと配備

- 文書、会話、操作履歴は PostgreSQL に保存します。画像、出力ファイル、出力プレビューは `app_data` volume に保存します。
- 初期版は認証を行いません。接続できる人は全資料を閲覧・編集でき、操作した人物を区別できません。社内 LAN のファイアウォールで公開範囲を制限してください。
- 既存 PPTX の読み込み、PowerPoint 側の編集内容の再取り込み、表・グラフの画面上でのデータ編集は初期版の対象外です。
- AI は任意コードを実行せず、決められた文書操作だけを返します。サーバーで検証してから適用します。

詳細な要件は [REQUIREMENTS.md](./REQUIREMENTS.md) を参照してください。
