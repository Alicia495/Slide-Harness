import { describe, expect, it } from "vitest";
import { emptyDeck, ShapeTypeSchema, slideTitle, type Operation } from "../lib/document";
import { applyOperations, isSmallAIEdit } from "../lib/operations";

function deckWithSlide() {
  return applyOperations(emptyDeck(), [{ type: "replaceDeck", title: "製品提案", slides: [
    { layout: "title", title: "製品提案", subtitle: "2026年", bullets: [] },
    { layout: "bullets", title: "課題", bullets: ["現状を整理", "改善を進める"] },
  ] }]);
}

describe("document operations", () => {
  it("creates and edits a deck without changing the previous version", () => {
    const original = deckWithSlide();
    const slide = original.slides[0];
    const title = slide.elements.find((element) => element.kind === "text" && element.role === "title");
    expect(title?.kind).toBe("text");
    if (!title) throw new Error("missing title");
    const changed = applyOperations(original, [{ type: "updateText", slideId: slide.id, elementId: title.id, text: "新しい提案" }]);
    expect(slideTitle(changed.slides[0])).toBe("新しい提案");
    expect(slideTitle(original.slides[0])).toBe("製品提案");
  });

  it("rejects edits that would overflow the slide", () => {
    const deck = deckWithSlide();
    const slide = deck.slides[0];
    const title = slide.elements.find((element) => element.kind === "text" && element.role === "title");
    if (!title) throw new Error("missing title");
    expect(() => applyOperations(deck, [{ type: "moveElement", slideId: slide.id, elementId: title.id, x: 12.5, y: 7 }])).toThrow(/外/);
  });

  it("treats one element edit as small and slide changes as major", () => {
    const deck = deckWithSlide();
    const slideId = deck.slides[0].id;
    const elementId = deck.slides[0].elements[0].id;
    const small: Operation[] = [{ type: "moveElement", slideId, elementId, x: 1, y: 1 }];
    const major: Operation[] = [{ type: "deleteSlide", slideId }];
    expect(isSmallAIEdit(small)).toBe(true);
    expect(isSmallAIEdit(major)).toBe(false);
  });

  it("adds and styles shapes and icons, and reorders elements", () => {
    const deck = deckWithSlide();
    const slideId = deck.slides[0].id;
    const afterShape = applyOperations(deck, [{
      type: "addShape", slideId, shape: "rightArrow", x: 2, y: 3, w: 1.5, h: 0.8, fill: "#3156D3", rotation: 45,
    }]);
    const addedShape = afterShape.slides[0].elements.find((e) => e.kind === "shape" && e.shape === "rightArrow");
    expect(addedShape).toBeDefined();
    expect(addedShape?.kind).toBe("shape");
    if (addedShape?.kind === "shape") {
      expect(addedShape.rotation).toBe(45);
    }

    const afterIcon = applyOperations(afterShape, [{
      type: "addIcon", slideId, name: "Rocket", x: 4, y: 3, w: 0.8, h: 0.8, color: "#65A9F0",
    }]);
    const addedIcon = afterIcon.slides[0].elements.find((e) => e.kind === "icon");
    expect(addedIcon).toBeDefined();
    expect(addedIcon?.kind).toBe("icon");
    if (addedIcon?.kind === "icon") {
      expect(addedIcon.name).toBe("Rocket");
      expect(addedIcon.color).toBe("#65A9F0");
    }

    const afterReorder = applyOperations(afterIcon, [{
      type: "reorderElement", slideId, elementId: addedIcon!.id, action: "sendToBack",
    }]);
    expect(afterReorder.slides[0].elements[0].id).toBe(addedIcon!.id);

    const afterDelete = applyOperations(afterReorder, [{
      type: "deleteElement", slideId, elementId: addedIcon!.id,
    }]);
    expect(afterDelete.slides[0].elements.some((e) => e.id === addedIcon!.id)).toBe(false);
  });

  it("accepts every supported shape and rejects invalid rotation", () => {
    const deck = deckWithSlide();
    const slideId = deck.slides[0].id;
    const operations: Operation[] = ShapeTypeSchema.options.map((shape, index) => ({
      type: "addShape",
      slideId,
      shape,
      x: index * 0.5,
      y: 3,
      w: 0.4,
      h: 0.4,
      fill: "#3156D3",
      arrowHead: shape === "line" ? "both" : undefined,
    }));
    const updated = applyOperations(deck, operations);
    expect(updated.slides[0].elements.filter((element) => element.kind === "shape").length).toBeGreaterThanOrEqual(ShapeTypeSchema.options.length);
    expect(() => applyOperations(deck, [{
      type: "addShape",
      slideId,
      shape: "triangle",
      x: 1,
      y: 1,
      w: 1,
      h: 1,
      fill: "#3156D3",
      rotation: 361,
    }])).toThrow();
  });

  it("generates rich layouts: steps, cards, kpi, comparison", () => {
    const deck = applyOperations(emptyDeck(), [{
      type: "replaceDeck", title: "リッチプレゼン", slides: [
        {
          layout: "steps", title: "導入プロセス", subtitle: "簡単3ステップ",
          steps: [
            { stepNumber: 1, title: "ヒアリング", body: "課題の把握" },
            { stepNumber: 2, title: "設計・構築", body: "要件に合わせた導入" },
            { stepNumber: 3, title: "運用開始", body: "定着支援" },
          ],
        },
        {
          layout: "cards", title: "主要機能", subtitle: "3つの強み",
          cards: [
            { title: "高速処理", body: "待ち時間を削減", icon: "Zap" },
            { title: "安全設計", body: "強固なセキュリティ", icon: "Shield" },
            { title: "拡張性", body: "API連携に対応", icon: "Boxes" },
          ],
        },
        {
          layout: "kpi", title: "導入成果", subtitle: "前年比の伸び",
          kpis: [
            { value: "200%", label: "売上伸長", note: "昨対比" },
            { value: "50", unit: "時間", label: "削減時間", note: "月間平均" },
          ],
        },
        {
          layout: "comparison", title: "従来比", subtitle: "メリット比較",
          comparison: {
            left: { title: "従来方式", bullets: ["手作業でミスが多い", "時間がかかる"], tag: "Before" },
            right: { title: "本システム", bullets: ["自動化で正確", "即時完了"], tag: "After" },
          },
        },
      ],
    }]);

    expect(deck.slides.length).toBe(4);

    const stepsArrows = deck.slides[0].elements.filter((e) => e.kind === "shape" && e.shape === "rightArrow");
    expect(stepsArrows.length).toBe(2);

    const cardsIcons = deck.slides[1].elements.filter((e) => e.kind === "icon");
    expect(cardsIcons.length).toBe(3);

    const kpiTexts = deck.slides[2].elements.filter((e) => e.kind === "text" && e.text.includes("200%"));
    expect(kpiTexts.length).toBe(1);

    const compArrow = deck.slides[3].elements.find((e) => e.kind === "shape" && e.shape === "rightArrow");
    expect(compArrow).toBeDefined();
    expect(deck.slides[3].elements.some((e) => e.kind === "text" && e.text === "Before")).toBe(true);
  });

  it("updates image decoration and supports every layer movement", () => {
    const deck = deckWithSlide();
    const slideId = deck.slides[0].id;
    const withImage = applyOperations(deck, [{
      type: "addImage",
      slideId,
      assetId: crypto.randomUUID(),
      x: 2,
      y: 2,
      w: 4,
      h: 2,
      alt: "テスト画像",
    }]);
    const image = withImage.slides[0].elements.at(-1);
    if (!image || image.kind !== "image") throw new Error("missing image");

    const decorated = applyOperations(withImage, [{
      type: "updateImageProps",
      slideId,
      elementId: image.id,
      objectFit: "fill",
      borderRadius: 0.2,
      stroke: "#D24646",
    }]);
    const updated = decorated.slides[0].elements.find((element) => element.id === image.id);
    expect(updated).toMatchObject({ objectFit: "fill", borderRadius: 0.2, stroke: "#D24646" });

    const backward = applyOperations(decorated, [{ type: "reorderElement", slideId, elementId: image.id, action: "sendBackward" }]);
    expect(backward.slides[0].elements.at(-2)?.id).toBe(image.id);
    const forward = applyOperations(backward, [{ type: "reorderElement", slideId, elementId: image.id, action: "bringForward" }]);
    expect(forward.slides[0].elements.at(-1)?.id).toBe(image.id);

    const cleared = applyOperations(forward, [{ type: "updateImageProps", slideId, elementId: image.id, stroke: null, borderRadius: 0 }]);
    const clearedImage = cleared.slides[0].elements.find((element) => element.id === image.id);
    expect(clearedImage).toMatchObject({ borderRadius: 0 });
    expect(clearedImage && "stroke" in clearedImage ? clearedImage.stroke : undefined).toBeUndefined();
  });
});
