import { describe, expect, it } from "vitest";
import {
  DEFAULT_THEME,
  DeckSchema,
  OperationSchema,
  SLIDE_H,
  SLIDE_W,
  emptyDeck,
  type Deck,
  type Operation,
  type SlideBlueprint,
} from "../lib/document";
import { applyOperations } from "../lib/operations";
import {
  classifyChanges,
  createWorkingCopy,
  editElements,
  getDeckSummary,
  getSlide,
  inspectLayout,
  reflowSlide,
  writeSlide,
  type ElementPatch,
  type PolicyDecision,
  type ReflowRule,
} from "../lib/agent-harness";

function sampleDeck(): Deck {
  return applyOperations(emptyDeck(), [{
    type: "replaceDeck",
    title: "製品提案",
    slides: [
      { layout: "title", title: "製品提案", subtitle: "2026年" },
      { layout: "bullets", title: "課題", bullets: ["現状を整理", "改善を進める"] },
      { layout: "bullets", title: "効果", bullets: ["自動化", "品質向上"] },
    ],
  }]);
}

function titleElement(slide: Deck["slides"][number]) {
  const title = slide.elements.find((element) => element.kind === "text" && element.role === "title");
  if (!title || title.kind !== "text") throw new Error("missing title element");
  return title;
}

describe("working copy read tools", () => {
  it("getDeckSummary returns only slide-level scope, not element bodies", () => {
    const workingCopy = createWorkingCopy(sampleDeck(), 3);
    const summary = getDeckSummary(workingCopy);
    expect(summary.title).toBe("製品提案");
    expect(summary.slides).toHaveLength(3);
    const [first] = summary.slides;
    expect(first.title).toBe("製品提案");
    expect(first.elementCount).toBe(sampleDeck().slides[0].elements.length);
    // 概要は要素本文を含まない。
    expect("elements" in first).toBe(false);
  });

  it("getSlide returns only the requested slide with its elements", () => {
    const deck = sampleDeck();
    const workingCopy = createWorkingCopy(deck, 1);
    const target = deck.slides[1];
    const slide = getSlide(workingCopy, target.id);
    expect(slide.id).toBe(target.id);
    expect(slide.elements.length).toBeGreaterThan(0);
  });
});

describe("working copy isolation", () => {
  it("editing the working copy leaves the source deck unchanged", () => {
    const source = sampleDeck();
    const snapshot = structuredClone(source);
    const workingCopy = createWorkingCopy(source, 5);
    const title = titleElement(workingCopy.deck.slides[0]);
    editElements(workingCopy, source.slides[0].id, [{ elementId: title.id, text: "新しい提案" }]);
    expect(source).toEqual(snapshot);
  });
});

describe("edit_elements", () => {
  it("applies multiple local patches through typed operations and preserves element IDs", () => {
    const source = sampleDeck();
    const workingCopy = createWorkingCopy(source, 0);
    const slideId = source.slides[1].id;
    const slide = source.slides[1];
    const title = titleElement(slide);
    const body = slide.elements.find((element) => element.kind === "text" && element.role === "body");
    if (!body || body.kind !== "text") throw new Error("missing body element");

    const patches: ElementPatch[] = [
      { elementId: title.id, text: "更新された課題" },
      { elementId: body.id, fontSize: 24, color: "#3156D3" },
    ];
    const result = editElements(workingCopy, slideId, patches);

    expect(result.operations.length).toBeGreaterThanOrEqual(2);
    expect(result.operations.every((op) => OperationSchema.safeParse(op).success)).toBe(true);

    const edited = result.deck.slides[1];
    const editedTitle = edited.elements.find((element) => element.id === title.id);
    const editedBody = edited.elements.find((element) => element.id === body.id);
    expect(editedTitle?.kind).toBe("text");
    if (editedTitle?.kind === "text") expect(editedTitle.text).toBe("更新された課題");
    expect(editedBody?.kind).toBe("text");
    if (editedBody?.kind === "text") {
      expect(editedBody.fontSize).toBe(24);
      expect(editedBody.color).toBe("#3156D3");
    }
    // Operation 経路が Working Copy 結果と一致する。
    expect(result.deck).toEqual(applyOperations(source, result.operations));
  });
});

describe("write_slide", () => {
  it("replaces only the target slide, preserving deck ID, slide ID, and other slides", () => {
    const source = sampleDeck();
    const workingCopy = createWorkingCopy(source, 7);
    const targetId = source.slides[1].id;
    const blueprint: SlideBlueprint = { layout: "cards", title: "書き換え後", cards: [
      { title: "A", body: "甲" },
      { title: "B", body: "乙" },
      { title: "C", body: "丙" },
    ] };

    const result = writeSlide(workingCopy, targetId, blueprint);

    expect(result.deck.id).toBe(source.id);
    expect(result.deck.slides).toHaveLength(source.slides.length);
    expect(result.deck.slides[1].id).toBe(targetId);
    expect(result.deck.slides[1]).not.toEqual(source.slides[1]);
    expect(result.deck.slides[0]).toEqual(source.slides[0]);
    expect(result.deck.slides[2]).toEqual(source.slides[2]);
    const newTitle = result.deck.slides[1].elements.find((element) => element.kind === "text" && element.role === "title");
    expect(newTitle?.kind).toBe("text");
    if (newTitle?.kind === "text") expect(newTitle.text).toBe("書き換え後");
  });
});

describe("invalid targets and bounds", () => {
  it("rejects unknown slide IDs", () => {
    const workingCopy = createWorkingCopy(sampleDeck(), 0);
    expect(() => getSlide(workingCopy, "00000000-0000-4000-8000-000000000000")).toThrow();
    expect(() => writeSlide(workingCopy, "00000000-0000-4000-8000-000000000000", { layout: "title", title: "x" })).toThrow();
  });

  it("rejects unknown element IDs and out-of-bounds moves", () => {
    const source = sampleDeck();
    const workingCopy = createWorkingCopy(source, 0);
    const slideId = source.slides[0].id;
    expect(() => editElements(workingCopy, slideId, [{ elementId: "00000000-0000-4000-8000-000000000000", text: "x" }])).toThrow();
    const title = titleElement(source.slides[0]);
    expect(() => editElements(workingCopy, slideId, [{ elementId: title.id, x: SLIDE_W, y: SLIDE_H }])).toThrow(/外|範囲|bounds/i);
  });
});

describe("reflow_slide", () => {
  it("aligns multiple elements under an allowed rule", () => {
    const source = sampleDeck();
    const workingCopy = createWorkingCopy(source, 2);
    const slide = source.slides[2];
    const texts = slide.elements.filter((element) => element.kind === "text");
    const rule: ReflowRule = { type: "alignRow", elementIds: texts.map((element) => element.id), y: 2 };
    const result = reflowSlide(workingCopy, slide.id, rule);
    const reflowed = result.deck.slides[2];
    for (const element of reflowed.elements) {
      if (texts.some((text) => text.id === element.id)) {
        expect(element.y).toBe(2);
      }
    }
    expect(result.operations.every((op) => OperationSchema.safeParse(op).success)).toBe(true);
  });

  it("rejects a rule that is not on the allowed list", () => {
    const source = sampleDeck();
    const workingCopy = createWorkingCopy(source, 0);
    const slide = source.slides[2];
    const elementIds = slide.elements.map((element) => element.id);
    const rule = { type: "freeform", elementIds, y: 2 } as unknown as ReflowRule;
    expect(() => reflowSlide(workingCopy, slide.id, rule)).toThrow();
  });
});

describe("inspect_layout", () => {
  function layoutDeck(): Deck {
    return DeckSchema.parse({
      id: crypto.randomUUID(),
      title: "検査",
      theme: DEFAULT_THEME,
      slides: [{
        id: crypto.randomUUID(),
        background: "#FFFFFF",
        elements: [
          { kind: "text", id: crypto.randomUUID(), role: "title", text: "範囲外", x: 12, y: 1, w: 3, h: 1, rotation: 0, fontSize: 20, color: "#182230", bold: true, align: "left", valign: "top" },
          { kind: "text", id: crypto.randomUUID(), role: "body", text: "重複A", x: 1, y: 1, w: 4, h: 3, rotation: 0, fontSize: 16, color: "#182230", bold: false, align: "left", valign: "top" },
          { kind: "text", id: crypto.randomUUID(), role: "body", text: "重複B", x: 2, y: 2, w: 4, h: 3, rotation: 0, fontSize: 16, color: "#182230", bold: false, align: "left", valign: "top" },
          { kind: "text", id: crypto.randomUUID(), role: "body", text: "小文字", x: 8, y: 5, w: 3, h: 1, rotation: 0, fontSize: 8, color: "#182230", bold: false, align: "left", valign: "top" },
          { kind: "text", id: crypto.randomUUID(), role: "body", text: "あ".repeat(1200), x: 0.5, y: 5, w: 3, h: 1, rotation: 0, fontSize: 20, color: "#182230", bold: false, align: "left", valign: "top" },
        ],
      }],
    });
  }

  it("reports overlap, out-of-bounds, small font, and dense text", () => {
    const deck = layoutDeck();
    const issues = inspectLayout(deck, deck.slides[0].id);
    const kinds = new Set(issues.map((issue) => issue.kind));
    expect(kinds.has("overflow")).toBe(true);
    expect(kinds.has("overlap")).toBe(true);
    expect(kinds.has("smallText")).toBe(true);
    expect(kinds.has("denseText")).toBe(true);
  });

  it("reports no issues for a clean slide", () => {
    const deck = sampleDeck();
    expect(inspectLayout(deck, deck.slides[0].id)).toHaveLength(0);
  });
});

describe("commit policy", () => {
  it("classifies same-slide element patches as auto-apply", () => {
    const source = sampleDeck();
    const workingCopy = createWorkingCopy(source, 1);
    const slideId = source.slides[1].id;
    const slide = source.slides[1];
    const title = titleElement(slide);
    const body = slide.elements.find((element) => element.kind === "text" && element.role === "body");
    if (!body || body.kind !== "text") throw new Error("missing body element");
    const result = editElements(workingCopy, slideId, [
      { elementId: title.id, text: "課題A" },
      { elementId: body.id, fontSize: 22 },
    ]);
    expect(classifyChanges({ tool: "edit", operations: result.operations })).toBe<PolicyDecision>("auto");
  });

  it("classifies write, reflow, and structural edits as proposal", () => {
    const source = sampleDeck();
    const workingCopy = createWorkingCopy(source, 0);
    const slideId = source.slides[1].id;

    const write = writeSlide(workingCopy, slideId, { layout: "title", title: "全面書き換え" });
    expect(classifyChanges({ tool: "write", operations: write.operations })).toBe<PolicyDecision>("proposal");

    const slide = source.slides[2];
    const reflow = reflowSlide(workingCopy, slide.id, {
      type: "alignRow",
      elementIds: slide.elements.map((element) => element.id),
      y: 2,
    });
    expect(classifyChanges({ tool: "reflow", operations: reflow.operations })).toBe<PolicyDecision>("proposal");

    const structural: Operation[] = [{ type: "deleteSlide", slideId }];
    expect(classifyChanges({ tool: "edit", operations: structural })).toBe<PolicyDecision>("proposal");
  });
});
