# .potx テンプレート導入計画

## User Prompt

> スライド作成のテンプレートとして potx を入れれるようにしてほしい
> （テンプレートの拡張子である potx であること。pptx と混同しないこと）

## 方針（ユーザー承認済み）

- .potx 内のテーマ定義（`ppt/theme/themeN.xml`）から配色とフォントを抽出し、新規資料作成時に適用する。スライドマスターやレイアウト内容の取り込みは行わない。
- zip パースには既存ライブラリ jszip を使用し、devDependencies から dependencies へ昇格する（承認済み）。

## 実装内容

- `migrations/003_templates.sql`: workspace スコープの `templates` テーブル（テーマは jsonb に正規化して保存）
- `lib/templates.ts`: .potx 検証（zip マジックバイト + `[Content_Types].xml` の template main part 必須。pptx は明示的に拒否）、テーマ抽出、保存/一覧/削除
- `lib/document.ts`: `emptyDeck(title, theme?)` にテーマ引数を追加（既定値は従来どおり DEFAULT_THEME）
- `lib/projects.ts` / `app/api/projects/route.ts`: `templateId` 受理。存在しないテンプレートは 404
- `app/api/templates/route.ts`, `app/api/templates/[id]/route.ts`: 登録（multipart・50MB 上限）・一覧・削除。保存レスポンスに内部パスを返さない
- `components/TemplateModal.tsx` + `app/page.tsx`: 「新しい資料」でテンプレート選択モーダル（白紙 / 登録済み .potx / .potx アップロード / 削除）
- `scripts/smoke.ts`: テンプレート登録 → 拒否系 → 資料作成 → 削除 の検証を追加
- `tests/templates.test.ts`: パース正否・フォールバック・deck 生成のユニットテスト

## テーママッピング

| Theme | 抽出元 |
| --- | --- |
| primary | accent1 |
| accent | accent2 |
| background | lt1 |
| text | dk1（無ければ dk2） |
| fontFace | minorFont latin（無ければ majorFont、既定は Aptos） |

## 互換性・移行

- `POST /api/projects` は `templateId` 省略時従来どおり（白紙 + DEFAULT_THEME）。
- マイグレーション 003 は新規テーブル追加のみで既存データに影響なし。ロールバックはテーブル削除で可。
- 保存ファイルは `DATA_DIR/templates/<uuid>.potx`。DB 行削除時にファイルも削除。

## 既知の制限

- .potx のテーマのみ適用し、マスター／レイアウト／サンプルスライドは引き継がない。
- .potm（マクロ付き）や旧 .pot は content type 不一致で拒否。
