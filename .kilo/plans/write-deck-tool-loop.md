# Plan: 新規作成の Tool Loop 対応 (implements ADR-0002)

- Created: 2026-10-28
- Branch: feature/tool-loop-harness
- ADRs: docs/common/architecture-decisions/ADR-0002-tool-loop-harness.md
- Scope summary: `write_deck` ツール追加と空 Deck の Tool Loop 有効化。新規生成は初回 Proposal として保存する。

## Tasks

### 1. write_deck ハーネス実装
- File(s): `lib/agent-harness.ts`, `tests/agent-harness.test.ts`
- TDD: ✅ (ロジック追加)
- Red: `writeDeck` が `replaceDeck` Operation を 1 件生成し Working Copy へ反映する。`write_deck` を使った commit の Policy は常に `proposal`。ツール集合に 10 個目として登録され、空 Deck の Working Copy で実行でき、`get_deck_summary` が空一覧を返す。入力検証 (title 必須、slides 1〜10、Blueprint スキーマ再利用)。
- Commit draft: `test(agent): add write deck tool cases (red)` → `feat(agent): add write deck tool to harness (green)`
- 検証: `pnpm vitest run tests/agent-harness.test.ts`

### 2. 空 Deck の Tool Loop 有効化
- File(s): `lib/agent-harness.ts` (`isToolLoopEnabled`), `lib/ai.ts` (`selectAIGenerationMode` 呼び出し側), `tests/ai.test.ts`, `tests/agent-harness.test.ts`
- TDD: ✅ (契約変更)
- Red: `selectAIGenerationMode({flag:true}, 空Deck)` → `"tool-loop"`。flag 無効時は従来どおり `"legacy"`。既存の「空 Deck は常に legacy」テストを新契約へ更新する。
- Commit draft: `test(agent): route empty decks to tool loop (red)` → `feat(agent): enable tool loop for new deck creation (green)`
- 検証: `pnpm vitest run tests/ai.test.ts tests/agent-harness.test.ts`

### 3. 新規作成のプロンプト誘導
- File(s): `lib/ai.ts`, `tests/ai.test.ts`
- TDD: ✅ (文字列契約)
- Red: `TOOL_LOOP_SYSTEM_PROMPT` が `write_deck` による Deck 作成手順を含む。空 Deck 実行時の prompt が `write_deck` 作成を指示する。
- Commit draft: `test(agent): require write deck guidance in tool prompt (red)` → `feat(agent): guide new decks through write deck (green)`
- 検証: `pnpm vitest run tests/ai.test.ts`

### 4. UI ラベルと docs 更新
- File(s): `components/Editor.tsx`, `README.md`
- TDD: ❌ (表示ラベルと文書。検証は build)
- 内容: `toolPhaseLabel` の `write_deck` 表示を「プレゼンを作成しています…」へ。README の「空資料の初回生成は従来経路」記述を新仕様に更新。
- Commit draft: `feat(ui): label write deck activity` + `docs(agent): document new deck tool loop`
- 検証: `pnpm build`

## 実装順序の根拠

write_deck ツール (1) がモード拡大 (2) とプロンプト (3) の前提。UI・docs (4) は実装確定後。

## 検証 (Phase 4) で実行する全テスト

- `pnpm vitest run`
- `pnpm typecheck`
- `pnpm build`
- `git diff --check`
- `APP_URL=http://127.0.0.1:35020 pnpm smoke` (稼働コンテナの登録モデルで plan chat まで)

## 設計メモ

- `write_deck` 入力は `{ title, slides: SlideBlueprint[1..12] }` → 内部で `replaceDeckSlides` Operation 1 件。生成時にスライド ID を確定させ、Operation ログの再適用を決定論的にする (保存時検証 `isReplayableToolLoopResult` 対応)。
- Policy: `toolsUsed` に `write_deck` があれば `commit_changes` は常に `proposal` (ADR-0002 自動適用ポリシー)。
- 保存: 既存 chat route の tool-loop 分岐が `replaceDeckSlides` を再適用検証 (`isReplayableToolLoopResult`) 経由で初回 Proposal 化する。`deckOverride` は使わない。
- 空 Deck でも `baseVersion` 楽観ロック・Proposal プレビュー画像・ライブ Activity 表示はそのまま再利用。
- レンダリング/Vision 予算 (既定 3/2 回) は変更しない。全 Deck 描写は `render_deck` 対象外のため、モデルはスライド単位の inspect を使う。

## 対象外 (follow-up)

- `get_element` / `search_elements` / `render_deck`
- Run 中断後の再開永続化
- legacy 経路 (flag 無効時) の廃止

## 検証結果 (2026-10-28)

- `pnpm vitest run`: 152 tests / 13 files passed。`pnpm typecheck` / `pnpm build` / `git diff --check` passed。
- 手動 e2e (空 Deck + Swift1.5-Flash, `http://127.0.0.1:35020`): `write_deck` → 並列 `inspect_layout` → `edit_elements` (パッチエラーの自己修復あり) → `commit_changes` が 7 step で完走し、`mode: proposal` で Proposal (11 operations / 3 slides) が作成された。保存は Proposal 承認時のみ。ライブ Activity 配信 (reasoning/tool) も全 step で確認。
- e2e での当初失敗と対応 (設計メモに反映済み):
  - 10 step 予算では新規作成に不足 → 作成 Run のみ `toolLoopMaxSteps` で 14 へ拡大 (`feat(agent): widen step budget for new deck runs`)。
  - `replaceDeck` は再適用でスライド ID が再生成され再適用検証に失敗 → `replaceDeckSlides` (明示 ID 付き SlideSchema) を追加し決定論化 (`feat(agent): carry write deck slides with explicit ids for replay`)。
  - 検査ループで予算を消費し commit 前に停止 → 作成誘導を「検査は各スライド 1 回・修復後即 commit」へ強化 (`feat(agent): bound creation inspect rounds before commit`)。
- 既知の環境制約: `pnpm smoke` は `modelId:"demo"` 固定のため登録モデルのみのコンテナでは失敗 (手動 e2e で代替検証)。
