# Architecture

## AI 資料生成

### 現行構成

```text
Browser -> Next.js API -> AI provider
                       -> typed deck operations -> PPTX renderer -> PNG preview
```

登録済み AI モデルは PostgreSQL に保存する。Vision 対応モデルは、生成後の PNG プレビューを使って最大 2 回の視覚レビューと修正を行う。

現行の AI 経路は Deck 全体をプロンプトへ含め、1 回の応答で型付き操作列を生成する。Deck が大きい場合の部分参照、編集後の再観測、局所的な視覚確認に制約がある。

### 採用構成

ADR-0002 に従い、AI 経路を Resource-Oriented Tool Loop Harness へ移行する。

`AI_TOOL_LOOP_ENABLED=true` かつ既存スライドがある場合に Tool Loop を使用する。フラグ無効時と空 Deck の初回生成は現行の一括操作生成へフォールバックするため、保存形式を変更せず段階的にロールアウトできる。

```text
Browser
  -> Next.js Chat API
    -> Agent Harness
      -> Tool Registry
        -> Read:    get_deck_summary / get_slide
        -> Edit:    edit_elements / reflow_slide
        -> Write:   write_slide
        -> Render:  render_slide
        -> Inspect: inspect_layout / inspect_visual
        -> Commit:  commit_changes
      -> Working Copy (baseVersion 固定)
        -> typed deck operations
        -> DeckSchema validation
        -> PPTX renderer -> PNG preview
      -> Policy Gate
        -> Version commit
        -> Proposal
    -> PostgreSQL / app_data
```

## Agent Harness

Agent Harness は AI SDK のネイティブ tool calling を使い、モデルが必要な範囲を読み、編集し、結果を検査してから保存する複数ステップの実行を管理する。

- 各 Agent Run は開始時の `baseVersion` と Deck から隔離された Working Copy を作る。
- Read ツールは Deck 全体を常時返さず、概要または指定スライドだけを返す。
- Edit、Write、Reflow は Working Copy にだけ適用し、既存の型付き Operation と `DeckSchema` で検証する。
- Render と Inspect は正本を変更しない。局所編集では対象スライドだけを処理する。
- モデルは DB、ファイル、シェル、任意コードへ直接アクセスしない。
- step、token、実行時間、render、Vision の予算を Run ごとに制限する。
- `commit_changes` だけが正本を変更でき、Policy Gate が Version または Proposal を選ぶ。
- Commit 時に現在版が `baseVersion` と異なる場合は競合として保存しない。
- Tool Loop の Working Deck は検証済み Operation を正本へ再適用した結果と完全一致する場合だけ保存する。legacy Vision 経路のみ、ADR-0001 に基づくレビュー済み Deck override を継続する。

## Deck Execution Layer

型付き Deck は引き続き資料の正本とする。PPTX と PNG は同じ Working Copy または保存済み Version から生成する成果物である。

```text
High-level tool input
  -> validated typed operations
  -> applyOperations
  -> DeckSchema / bounds validation
  -> Working Copy
```

`write_slide` は対象スライド以外と Deck ID を維持する。`reflow_slide` は許可されたレイアウト規則を検証済み Operation へ変換し、モデル生成コードを実行しない。

## Inspection

見た目の確認は、決定的検査と Vision 検査を分ける。

1. `inspect_layout` が範囲外、重なり、最小文字サイズ、文字量をモデル呼び出しなしで検査する。
2. `render_slide` が変更対象だけを PNG 化する。
3. `inspect_visual` が必要な場合だけ PNG とユーザー意図を Vision モデルへ渡し、問題点を返す。
4. Agent は問題点を受けて再編集し、必要な検査を繰り返す。

ADR-0001 の Vision レビュー方針は維持するが、局所編集で毎回 Deck 全体を処理しない。新規作成、テーマ変更、複数スライド変更、明示的な最終確認では全体レビューを行う。

## Persistence And Audit

PostgreSQL の Deck、Version、Operation、Proposal、会話履歴を継続利用する。Agent Run では開始版、モデル、Tool、対象 ID、検証結果、所要時間、使用量、停止理由、Commit 結果を追跡する。API キー、資料本文、画像内容は既定で監査ログへ保存しない。
