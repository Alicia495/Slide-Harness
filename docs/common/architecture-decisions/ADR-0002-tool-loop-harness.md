# ADR-0002: スライド生成・編集に Tool Loop Harness を採用

- Status: Accepted
- Date: 2026-10-28
- Tags: AI, agent, tool-calling, editing, rendering
- Related: ADR-0001

## Summary

AI に Deck 全体と一括操作列を生成させる方式から、隔離された Working Copy に対して `read / edit / write / render / inspect / commit` ツールを反復実行する Tool Loop Harness へ移行する。既存の型付き Deck、検証済み操作、版管理、PPTX レンダリング、Vision レビューは実行基盤として再利用する。

## Context

現行実装は、Deck 全体を JSON としてプロンプトへ含め、モデルに最大 30 件の操作を一度に返させている。新規生成は Blueprint から決定的にレイアウトできる一方、部分編集には次の問題がある。

- モデルは必要なスライドや要素を段階的に探索できず、編集後の中間状態も確認できない。
- Deck がコンテキスト上限を超えるとテキストや後方スライドが省略され、対象 ID と内容を正しく参照できない。
- `updateText` などの低水準操作だけでは、カード追加やレイアウト変更のような意味的編集を表しにくい。
- 1 件を超える操作は大変更として Proposal になり、反復的な小編集が中断される。
- 小編集でも Deck 全体の PPTX 生成と Vision レビューが実行され、待ち時間と AI コストが大きい。
- Vision レビュー後の Deck と保存された操作列が一致しない場合があり、変更理由の説明と再実行が難しい。

一方、型付き Deck、`applyOperations`、Zod 検証、楽観ロック、Proposal、版履歴、PPTX/PNG レンダリングは安全な実行基盤として再利用できる。変更の中心は Deck の形式ではなく、AI が Deck を知覚して操作するプロトコルである。

## Decision

AI SDK のネイティブ tool calling と複数ステップ実行を用いて、Resource-Oriented Tool Loop Harness を構築する。モデルは正本や DB を直接変更せず、開始時の `baseVersion` に固定した Working Copy に対して許可されたツールだけを実行する。

### ツール境界

モデルへ公開するツールは、既存の低水準操作をそのまま列挙せず、次の少数の高水準カテゴリにまとめる。

| カテゴリ | 初期ツール | 責務 |
| --- | --- | --- |
| Read | `get_deck_summary` | タイトル、テーマ、スライド ID と概要を返す |
| Read | `get_slide` | 指定スライドの要素と構造を返す |
| Read | `get_element` / `search_elements` | ID または条件から編集対象を特定する |
| Edit | `edit_elements` | ID を維持したまま、限定された要素群へ patch を適用する |
| Write | `write_slide` | 指定スライドを全面的に再構成する |
| Write | `write_deck` | 新規作成など明示された場合だけ Deck 全体を構成する |
| Render | `render_slide` / `render_deck` | Working Copy を PNG 化する |
| Inspect | `inspect_layout` | 範囲外、重なり、文字量などを決定的に検査する |
| Inspect | `inspect_visual` | 必要な範囲だけ Vision モデルで確認する |
| Commit | `commit_changes` | Policy Gate を通して Version または Proposal を保存する |

`edit_elements`、`write_slide`、`write_deck` は内部で型付き Operation を生成し、既存の `applyOperations` と `DeckSchema` による検証を通す。モデルが任意コード、SQL、ファイルパス、シェルを実行する機能は提供しない。

### 実行モデル

1. Harness は現在の Deck と `baseVersion` からリクエスト専用の Working Copy を作る。
2. モデルは必要な範囲だけ Read ツールで取得する。
3. Edit または Write ツールは Working Copy だけを変更し、操作結果と検証エラーをモデルへ返す。
4. モデルは必要に応じて Render と Inspect を実行し、同じ Working Copy を再編集する。
5. Harness はステップ数、トークン、実行時間、レンダリング回数のいずれかが上限に達したら停止する。
6. `commit_changes` は変更対象とリスクを評価し、局所的な小変更を新 Version、大変更を Proposal として原子的に保存する。
7. Commit 時に `baseVersion` が現在版と異なる場合は保存せず、競合として終了する。

モデルが `commit_changes` を呼ばず正常終了した場合も正本は変更しない。途中のツール失敗、タイムアウト、キャンセルでも Working Copy を破棄し、最後に保存された版を維持する。

### 自動適用ポリシー

小変更かどうかは操作件数ではなく影響範囲で判定する。同一スライド内の選択要素または明示された少数要素に限定され、スライド構成、テーマ、他スライドへ影響しない変更は自動適用できる。それ以外は Proposal とする。

`write_slide` と `write_deck` は原則 Proposal とする。新規 Deck 作成では、正本が空であるため `write_deck` の結果を初回 Proposal として扱う。

### 視覚レビュー

ADR-0001 の Vision レビュー方針は維持する。ただし、反復中は変更されたスライドだけをレンダリングし、決定的な `inspect_layout` を先に実行する。Vision レビューは Write、レイアウト変更、または最終品質確認など、Policy が必要と判断した場合に限定する。全 Deck のレビューは新規作成、テーマ変更、複数スライド変更、PPTX 出力前の明示的な全体確認で行う。

### 監査と再現性

各 Agent Run について、開始版、モデル、ツール名、検証済み入力、結果の要約、対象 ID、所要時間、トークン使用量、停止理由、Commit 結果を記録する。API キー、プロンプト内の資料本文、画像内容は既定でログへ保存しない。

最終的に保存する変更は、Working Copy のみを直接保存するのではなく、正本へ適用可能な検証済み Operation と対応付ける。Vision による修正も同じ Tool/Operation 経路へ通し、操作ログと保存 Deck の不一致を解消する。

## Alternatives Considered

- **案 A: 現行の 17 Operation をそのまま Tool 化**
  - 概要: `updateText`、`moveElement` などを個別ツールとして公開する。
  - メリット: 既存実装の変更が小さく、早期に tool calling を検証できる。
  - 不採用の理由: モデルへ低水準ツールを多数公開しても、部分読み取り、意味的編集、レイアウト再構成、Working Copy の問題は解決しない。初期移行の内部実装としては利用する。

- **案 B: Sandbox 上で Deck JSON または DSL をプログラム編集**
  - 概要: コーディングエージェントと同様にファイル編集とコマンド実行を許可する。
  - メリット: 一括変更、条件分岐、複雑な横断編集の自由度が最も高い。
  - 不採用の理由: 任意コード実行、リソース隔離、ネットワーク制限、監査、再現性の負担が大きく、現在の安全原則を弱める。必要な横断編集は検証済みの高水準ツールとして追加する。

- **案 C: 現行の一括 JSON 操作生成を継続**
  - 概要: プロンプトと修復回数を改善し、現在の単発生成方式を維持する。
  - メリット: 実装変更が最小で、tool calling 非対応モデルも利用しやすい。
  - 不採用の理由: Deck 全文注入、中間状態を観測できないこと、コンテキスト上限、部分編集の弱さという構造的問題を解決できない。

## Consequences

### Positive

- 必要なスライドと要素だけを取得し、大規模 Deck でも対象を失わず編集できる。
- 編集、描画、検査、再編集をモデルが反復でき、見た目を含む自己修正が可能になる。
- 小変更では ID と未変更要素を維持し、全面再生成による参照切れを防げる。
- 途中失敗や競合時に正本を変更せず、安全にロールバックできる。
- ツール実行単位で変更理由、失敗、コスト、品質を観測できる。
- Deck 以外の文書形式にも適用可能な Harness 境界を得られる。

### Negative

- Agent Run、Working Copy、Tool Registry、Policy Gate、実行予算の実装が必要になる。
- 複数回のモデル呼び出しにより、単発生成より API コストが増える場合がある。
- tool calling 能力が低いモデルでは、ステップ数の増加や誤ったツール選択が起きる。
- 高水準ツールと内部 Operation の責務を継続的に整合させる必要がある。

### Neutral / Follow-ups

- 初期実装に `get_deck_summary`、`get_slide`、`edit_elements`、`write_slide`、`render_slide`、`inspect_layout`、`inspect_visual`、`reflow_slide`、`commit_changes` を含める。
- `write_deck`、`get_element`、`search_elements`、`render_deck` は既存経路との役割を整理した後に追加する。
- Deck のグループ、レイアウト制約、意味的コンポーネントは別 ADR で検討する。
- 現行 JSON-in-prompt 経路の廃止時期と tool calling 非対応モデルの扱いは実装計画で決める。

## NFR Considerations

| 項目 | 採用 | 内容 / 理由 |
| --- | --- | --- |
| 認証/認可 | ❌ | 現行の単一ローカル利用者と社内 LAN 境界を変更しない。将来の認証導入時は Tool 実行にもプロジェクト単位の認可を適用する。 |
| キャッシュ | ⏸ | 初期実装では導入しない。同一 Working Copy・同一スライドのレンダリング結果だけ Run 内キャッシュを検討する。 |
| 観測性 | ✅ | Agent Run、各 Tool、モデル呼び出し、レンダリング、停止理由、Commit 結果の構造化ログとメトリクスを追加する。 |
| 永続化/バックアップ | ✅ | 既存 PostgreSQL の Version、Operation、Proposal を継続利用する。Agent Run の監査情報は本文や秘密情報を避けて保存する。 |
| リトライ/サーキットブレーカー | ✅ | Tool 入力の修復は有界回数とし、モデル、PPTX、Vision のタイムアウトを分離する。非冪等な Commit は自動リトライしない。 |
| シークレット管理 | ✅ | 既存の暗号化済み AI 設定を利用し、Tool 結果やログへ API キーを含めない。 |
| ネットワーク境界 | ❌ | 新しい外部サービスや公開ポートは追加しない。モデル接続先の既存 SSRF 制約を維持する。 |
| コスト/ライセンス | ✅ | step、token、Vision、render の予算を Run ごとに制限する。既存 AI SDK と OSS の範囲で実装し、新規依存は別途評価する。 |
| スケーラビリティ | ✅ | Run ごとの同時実行数とレンダリング並列数を制限する。Working Copy は Run 内に閉じ、正本への Commit だけを短い DB トランザクションで行う。 |
| デプロイ/CI | ⏸ | 新サービスは追加せず現行コンテナ内で段階導入する。tool calling、競合、予算停止、失敗時非更新を自動テストへ追加し、CI 導入は別途判断する。 |

## Implementation Notes

- 影響範囲: `lib/ai.ts`、`lib/operations.ts`、`lib/projects.ts`、`app/api/projects/[id]/chat/route.ts`、`tests/`、`docs/common/ARCHITECTURE.md`
- AI SDK 7 の `ToolLoopAgent` または同等の `generateText` tool loop を使用し、停止条件を明示する。
- Tool の Zod input schema を唯一の契約とし、プロンプトへ Operation 仕様を手書きで複製しない。
- `write_slide` は対象スライド以外と既存の Deck ID を維持し、結果を Proposal として扱う。
- `inspect_layout` はモデルを呼ばない決定的検査として、範囲外、重なり、最小文字サイズ、文字量を報告する。
- `inspect_visual` は対象スライドだけをレンダリングして Vision モデルへ渡し、直接変更せず問題点を返す。
- `reflow_slide` は許可されたレイアウト規則と要素 ID を入力に取り、検証済み Operation へ変換する。自由形式のコードや座標計算は実行しない。
- Working Copy と実行状態は最初はリクエスト内で保持し、長時間 Run の再開が必要になった場合だけ永続化を別 ADR で検討する。
- 既存 API のチャット入力と NDJSON フェーズ通知は維持し、Tool 開始、完了、検査、Commit 待ちのイベントを追加する。
- 移行中は現行経路を feature flag で残し、モデル単位またはリクエスト単位で新 Harness を有効化する。
- ロールバック時は feature flag を無効化して現行経路へ戻す。Deck、Version、Operation の既存形式は変更しないため、データ移行の巻き戻しは不要とする。
