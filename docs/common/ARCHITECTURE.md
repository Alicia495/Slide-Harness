# Architecture

## AI 資料生成

```text
Browser -> Next.js API -> AI provider
                       -> typed deck operations -> PPTX renderer -> PNG preview
```

登録済み AI モデルは PostgreSQL に保存する。Vision 対応モデルは、生成後の PNG プレビューを使って最大 2 回の視覚レビューと修正を行う。
