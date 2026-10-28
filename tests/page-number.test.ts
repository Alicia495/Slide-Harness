import { describe, expect, it } from "vitest";
import { emptyDeck, slideFromBlueprint, type Deck, type Operation } from "../lib/document";
import { applyOperations } from "../lib/operations";

function kpiDeck(): Deck {
  const deck = emptyDeck("KPI 資料");
  deck.slides = [
    slideFromBlueprint({ layout: "kpi", title: "指標A", kpis: [{ value: "42", label: "値A", note: "12" }, { value: "7", label: "値B", note: "3" }] }, deck.theme, 0),
    slideFromBlueprint({ layout: "kpi", title: "指標B", kpis: [{ value: "58", label: "値C", note: "99" }, { value: "4", label: "値D", note: "5" }] }, deck.theme, 1),
  ];
  return deck;
}

function pageNumberElements(deck: Deck) {
  return deck.slides.flatMap((slide) => slide.elements.filter((e) => e.kind === "text" && e.role === "pageNumber"));
}

describe("pageNumber role", () => {
  it("generates page numbers with the dedicated pageNumber role", () => {
    const deck = kpiDeck();
    const pages = pageNumberElements(deck);
    expect(pages.length).toBe(2);
    expect(pages.map((e) => e.kind === "text" && e.text)).toEqual(["01", "02"]);
  });

  it("refreshes page numbers on reorder without rewriting KPI caption numbers", () => {
    const deck = kpiDeck();
    const operations: Operation[] = [{ type: "reorderSlide", slideId: deck.slides[1].id, toIndex: 0 }];
    const result = applyOperations(deck, operations);
    expect(pageNumberElements(result).map((e) => e.kind === "text" && e.text)).toEqual(["01", "02"]);
    const captions = result.slides.flatMap((slide) => slide.elements.filter((e) => e.kind === "text" && e.role === "caption"));
    expect(captions.map((e) => e.kind === "text" && e.text)).toEqual(["99", "5", "12", "3"]);
  });

  it("keeps refreshing page numbers stored as legacy captions in saved documents", () => {
    const deck = kpiDeck();
    // 旧版スキーマの保存文書を模する: ページ番号が caption(role 導入前)で保持されている。
    const pages = deck.slides.map((slide) => slide.elements.find((e) => e.kind === "text" && e.role === "pageNumber" && e.x >= 11.5 && e.y >= 6.5));
    for (const page of pages) if (page && page.kind === "text") page.role = "caption";
    const operations: Operation[] = [{ type: "reorderSlide", slideId: deck.slides[1].id, toIndex: 0 }];
    const result = applyOperations(deck, operations);
    const texts = result.slides.map((slide) => {
      const legacy = slide.elements.find((e) => e.kind === "text" && e.role === "caption" && e.x >= 11.5 && e.y >= 6.5);
      return legacy && legacy.kind === "text" ? legacy.text : null;
    });
    expect(texts).toEqual(["01", "02"]);
    const kpiNotes = result.slides.flatMap((slide) => slide.elements.filter((e) => e.kind === "text" && e.role === "caption" && e.x < 11.5));
    expect(kpiNotes.map((e) => e.kind === "text" && e.text)).toEqual(["99", "5", "12", "3"]);
  });
});
