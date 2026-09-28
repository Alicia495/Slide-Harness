import { describe, expect, it } from "vitest";
import { emptyDeck, slideTitle, type Operation } from "../lib/document";
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
});
