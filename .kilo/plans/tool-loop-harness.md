# Plan: Tool Loop Harness (implements ADR-0002)

- Created: 2026-10-28
- Branch: `feature/tool-loop-harness`
- ADRs: [`docs/common/architecture-decisions/ADR-0002-tool-loop-harness.md`](../../docs/common/architecture-decisions/ADR-0002-tool-loop-harness.md)
- Scope summary: Deck の正本を直接変更しない Working Copy と、高水準の read/edit/write/render/inspect/commit ツールを持つ AI SDK tool loop を導入する。既存の型付き Operation、Version、Proposal、NDJSON API を再利用する。

## Scope

- 初期ツール: `get_deck_summary`、`get_slide`、`edit_elements`、`write_slide`、`render_slide`、`inspect_layout`、`inspect_visual`、`reflow_slide`、`commit_changes`
- Run 単位の step、token、実行時間、render、Vision 予算
- `baseVersion` 固定の隔離 Working Copy
- 影響範囲ベースの Version / Proposal Policy
- Tool の開始・完了・検査・Commit を既存 NDJSON ストリームへ通知
- `AI_TOOL_LOOP_ENABLED` feature flag と現行 JSON-in-prompt 経路へのロールバック
- Tool 名、対象 ID、時間、停止理由、Commit 結果の構造化ログ

## Out Of Scope

- `write_deck`、`get_element`、`search_elements`、`render_deck`
- 任意コード、シェル、SQL、ファイル編集を許可する Sandbox
- Deck のグループ、永続的なレイアウト制約、意味的コンポーネント
- Agent Run の中断・再開と監査ログの DB 永続化
- tool calling 非対応モデル向けの新しい代替プロトコル

## Tasks

### 1. Working Copy と決定的 Deck ツール

- File(s): `lib/agent-harness.ts`、`lib/document.ts`、`lib/operations.ts`、`tests/agent-harness.test.ts`
- TDD: ✅（Working Copy、ID 維持、patch、reflow、layout 検査、Policy は入出力が決定的なドメインロジック）
- Red cases: Read が対象範囲だけを返す、編集が元 Deck を変更しない、`write_slide` が Deck ID と他スライドを維持する、不正 ID/範囲外を拒否する、reflow が許可済み規則だけを適用する、layout 検査が重なり・範囲外・小文字・過剰文字を報告する、局所編集だけを自動適用と判定する
- Commit draft: `test(agent): add working copy tool cases (red)` → `feat(agent): implement working copy deck tools (green)`
- 検証: `pnpm test -- tests/agent-harness.test.ts tests/document.test.ts`

### 2. 局所 Render と Visual Inspect

- File(s): `lib/agent-harness.ts`、`lib/ai.ts`、`lib/pptx.ts`、`lib/render.ts`、`tests/agent-harness.test.ts`、`tests/ai.test.ts`
- TDD: ✅（対象スライド抽出、render/Vision 予算、Vision が Deck を直接変更しない契約を依存注入で検証可能）
- Red cases: `render_slide` が指定スライドだけを出力する、回数上限を超えると停止する、`inspect_visual` が issue のみを返し Working Copy を変更しない、Vision 非対応モデルを拒否する
- Commit draft: `test(agent): add render and visual inspection cases (red)` → `feat(agent): implement scoped slide inspection (green)`
- 検証: `pnpm test -- tests/agent-harness.test.ts tests/ai.test.ts tests/pptx.test.ts`

### 3. AI SDK Tool Loop と実行予算

- File(s): `lib/ai.ts`、`lib/agent-harness.ts`、`tests/ai.test.ts`、`tests/agent-harness.test.ts`
- TDD: ✅（Tool registry、停止条件、commit なし終了、feature flag 分岐、Tool イベントは観測可能な契約）
- Red cases: Zod schema から9ツールを登録する、Working Copy を同一 Run 内で共有する、明示的な `commit_changes` なしでは変更を返さない、step/time/render/Vision 予算で停止する、Tool イベントと停止理由を通知する
- Commit draft: `test(agent): add tool loop orchestration cases (red)` → `feat(agent): run slide edits through AI tools (green)`
- 検証: `pnpm test -- tests/agent-harness.test.ts tests/ai.test.ts`

### 4. Version / Proposal Policy と Chat API 統合

- File(s): `lib/projects.ts`、`lib/operations.ts`、`app/api/projects/[id]/chat/route.ts`、`tests/agent-harness.test.ts`、`tests/commit-override.test.ts`、`tests/ai.test.ts`
- TDD: ✅（Commit の競合防止、局所変更の自動適用、`write_slide` の Proposal 化、既存 response mode は外部契約）
- Red cases: 同一スライドの明示要素 patch は複数件でも Version にできる、構造変更/reflow/write は Proposal、競合時は保存しない、保存 Deck と Operation が一致する、現行 `applied` / `proposal` response を維持する
- Commit draft: `test(agent): add commit policy integration cases (red)` → `feat(agent): integrate tool commits with chat API (green)`
- 検証: `pnpm test -- tests/agent-harness.test.ts tests/commit-override.test.ts tests/ai.test.ts`

### 5. Feature Flag、運用設定、ドキュメント整合

- File(s): `.env.example`、`README.md`、`docs/common/ARCHITECTURE.md`、`docs/common/architecture-decisions/ADR-0002-tool-loop-harness.md`
- TDD: ❌（設定と文書。`AI_TOOL_LOOP_ENABLED` の分岐自体は Task 3 のテストで固定する）
- Commit draft: `docs(agent): document tool loop rollout`
- 検証: `git diff --check`、`pnpm typecheck`

## 実装順序の根拠

まず AI や DB に依存しない Working Copy と決定的ツールを確立する。次に副作用のある Render/Vision を依存注入境界へ接続し、その上で AI SDK の Tool Loop を組み立てる。最後に既存の Version/Proposal と Chat API を接続することで、途中段階でも正本の保存経路を壊さない。

## Compatibility And Rollback

- 既存の Deck、Operation、Version、Proposal、API result mode は維持する。
- DB migration と新しい runtime dependency は追加しない。
- `AI_TOOL_LOOP_ENABLED=false` では現行 `generateOperations` 経路を使用する。
- Tool Loop の Commit は既存 `baseVersion` 楽観ロックを必ず通す。
- ロールバックは feature flag を無効化する。保存形式を変えないためデータ巻き戻しは不要。

## Verification In Phase 4

- `pnpm test`
- `pnpm typecheck`
- `pnpm build`
- `pnpm smoke`（アプリと DB を起動できる環境で実行）
- `git diff --check`
- `git diff main...HEAD -- '*test*'`
- `git diff main...HEAD --stat`

## Commit Policy

各 Red / Green / Docs commit の前に対象差分と commit message draft を提示し、ユーザーの明示承認後に指定ファイルだけを stage する。push は行わない。

## Completion Record

- Completed: 2026-10-28
- Result: ADR-0002 の初期9ツール、Working Copy、Version/Proposal Policy、feature flag、NDJSON通知、step/time/token/render/Vision予算、構造化監査イベントを実装した。
- Tests: `pnpm test` — 13 files / 135 tests passed
- Types: `pnpm typecheck` — passed
- Build: `pnpm build` — passed (Next.js 16.4.3 production build)
- Diff: `git diff --check` — passed
- Smoke: 稼働中の既存 Docker コンテナで実行したが、`demo` モデル未登録のため plan chat が `AI モデルを選択してください` で停止した。失敗時に作成された一時プロジェクトは削除済み。コンテナの再ビルド・再起動はデプロイ操作になるため実施していない。
- Review fixes: AI SDK の tool例外継続、同一step並列Commit、累積30操作超過、検査結果肥大、監査項目不足を独立レビューで検出し、回帰テスト後に修正した。
- Follow-up ADR: 不要。Deck の意味的グループ/永続レイアウト制約、`write_deck`、中断Run再開は ADR-0002 の明示的な対象外として維持する。
