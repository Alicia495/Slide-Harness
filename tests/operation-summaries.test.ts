import { describe, expect, it } from "vitest";
import { operationSummaries, summarizeOperations } from "../lib/operations";
import type { Operation } from "../lib/document";

describe("operationSummaries", () => {
  it("各 operation の差分概要を 1 件ずつ返す", () => {
    const summaries = operationSummaries([
      { type: "addSlide", slide: { layout: "bullets", title: "タイトル", bullets: ["内容"] } },
      { type: "updateStyle", slideId: "8f0a4a9f-3b3d-4a1e-9c3e-0c0d9a5dcb1e", elementId: "8f0a4a9f-3b3d-4a1e-9c3e-0c0d9a5dcb1f", color: "#112233" },
    ]);
    expect(summaries).toEqual(["スライドを追加", "見た目を変更"]);
  });

  it("replaceDeck は全体の再構成に集約する", () => {
    // 要約は type だけを見るため、Operation 型の replaceDeck 形状外で呼び出すための意図的なキャスト。
    const replaceLike = { type: "replaceDeck", deck: { id: "8f0a4a9f-3b3d-4a1e-9c3e-0c0d9a5dcb1e", title: "t", theme: { name: "n", primary: "#111111", accent: "#222222", background: "#FFFFFF", text: "#111223", fontFace: "Aptos" }, slides: [] } } as unknown as Operation;
    expect(operationSummaries([replaceLike]))
      .toEqual(["プレゼンテーション全体を作成・再構成"]);
  });

  it("summarizeOperations は summaries の連結と一致する", () => {
    const ops = [{ type: "deleteSlide" as const, slideId: "8f0a4a9f-3b3d-4a1e-9c3e-0c0d9a5dcb1e" }];
    expect(summarizeOperations(ops)).toBe(operationSummaries(ops).join("、"));
  });
});
