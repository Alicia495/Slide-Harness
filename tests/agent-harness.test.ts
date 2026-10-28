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
import { applyOperations, DocumentError } from "../lib/operations";
import {
  assertAgentTime,
  classifyChanges,
  consumeAgentStep,
  createAgentRunBudget,
  createAgentToolRegistry,
  createInspectionRuntime,
  createWorkingCopy,
  editElements,
  executeAgentTool,
  getAgentRunState,
  getDeckSummary,
  getSlide,
  inspectLayout,
  inspectVisual,
  isToolLoopEnabled,
  renderSlide,
  reflowSlide,
  writeSlide,
  type ElementPatch,
  type InspectionDeps,
  type InspectionLimits,
  type InspectionRuntime,
  type PolicyDecision,
  type ReflowRule,
  type RenderFn,
  type VisualInsight,
  type VisionFn,
  type WorkingCopy,
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

// --- Phase 3A: render / visual inspection runtime (Red: 未実装 API の契約固定) ---

type RenderSpy = {
  fn: RenderFn;
  calls: number;
  received: Deck[];
};

type VisionSpy = {
  fn: VisionFn;
  calls: number;
  received: { image: Buffer; slideId: string; intent: string }[];
};

function makeRenderSpy(failWith?: Error): RenderSpy {
  const spy: RenderSpy = { fn: () => Buffer.from(""), calls: 0, received: [] };
  spy.fn = (deck: Deck): Buffer => {
    spy.calls += 1;
    spy.received.push(structuredClone(deck));
    if (failWith) throw failWith;
    return Buffer.from("rendered-image");
  };
  return spy;
}

function makeVisionSpy(failWith?: Error): VisionSpy {
  const insight: VisualInsight = { summary: "要約", issues: ["指摘"], meetsIntent: true };
  const spy: VisionSpy = {
    fn: () => insight,
    calls: 0,
    received: [],
  };
  spy.fn = (request: { image: Buffer; slideId: string; intent: string }): VisualInsight => {
    spy.calls += 1;
    spy.received.push({ image: request.image, slideId: request.slideId, intent: request.intent });
    if (failWith) throw failWith;
    return insight;
  };
  return spy;
}

function inspectionFixture(): { workingCopy: WorkingCopy; slideId: string; snapshot: Deck } {
  const source = sampleDeck();
  const workingCopy = createWorkingCopy(source, 4);
  const snapshot = structuredClone(workingCopy.deck);
  return { workingCopy, slideId: source.slides[1].id, snapshot };
}

function editWorkingCopySlide(workingCopy: WorkingCopy, slideId: string): void {
  const slide = workingCopy.deck.slides.find((item) => item.id === slideId);
  if (!slide) throw new Error("missing slide");
  const title = titleElement(slide);
  editElements(workingCopy, slideId, [{ elementId: title.id, text: "レンダリング後に編集" }]);
}

describe("render_slide", () => {
  it("passes a single-slide deck with preserved deck and slide IDs and returns a Buffer", async () => {
    const { workingCopy, slideId } = inspectionFixture();
    const render = makeRenderSpy();
    const vision = makeVisionSpy();
    const deps: InspectionDeps = { render: render.fn, vision: vision.fn };
    const runtime: InspectionRuntime = createInspectionRuntime(deps);
    const image = await renderSlide(workingCopy, slideId, runtime);
    expect(render.calls).toBe(1);
    const passed = render.received[0];
    expect(passed.id).toBe(workingCopy.deck.id);
    expect(passed.slides).toHaveLength(1);
    expect(passed.slides[0].id).toBe(slideId);
    expect(Buffer.isBuffer(image)).toBe(true);
  });

  it("caches identical slide renders within a run and invalidates the cache after an edit", async () => {
    const { workingCopy, slideId } = inspectionFixture();
    const render = makeRenderSpy();
    const vision = makeVisionSpy();
    const runtime = createInspectionRuntime({ render: render.fn, vision: vision.fn });
    const first = await renderSlide(workingCopy, slideId, runtime);
    const second = await renderSlide(workingCopy, slideId, runtime);
    expect(render.calls).toBe(1);
    expect(second.equals(first)).toBe(true);
    editWorkingCopySlide(workingCopy, slideId);
    await renderSlide(workingCopy, slideId, runtime);
    expect(render.calls).toBe(2);
  });

  it("rejects renders beyond maxRenderCalls with DocumentError and adds no dependency calls", async () => {
    const { workingCopy, slideId } = inspectionFixture();
    const render = makeRenderSpy();
    const vision = makeVisionSpy();
    const limits: InspectionLimits = { maxRenderCalls: 1 };
    const runtime = createInspectionRuntime({ render: render.fn, vision: vision.fn }, limits);
    await renderSlide(workingCopy, slideId, runtime);
    editWorkingCopySlide(workingCopy, slideId);
    await expect(renderSlide(workingCopy, slideId, runtime)).rejects.toThrow(DocumentError);
    expect(render.calls).toBe(1);
  });

  it("keeps counters and working copy consistent when the render dependency throws", async () => {
    const { workingCopy, slideId, snapshot } = inspectionFixture();
    const render = makeRenderSpy(new Error("render 依存の失敗"));
    const vision = makeVisionSpy();
    const limits: InspectionLimits = { maxRenderCalls: 1 };
    const runtime = createInspectionRuntime({ render: render.fn, vision: vision.fn }, limits);
    await expect(renderSlide(workingCopy, slideId, runtime)).rejects.toThrow("render 依存の失敗");
    expect(render.calls).toBe(1);
    expect(workingCopy.deck).toEqual(snapshot);
    expect(workingCopy.operations).toHaveLength(0);
    // 失敗呼び出しも上限に算入される: 次は上限拒否となり依存は追加呼び出しされない。
    await expect(renderSlide(workingCopy, slideId, runtime)).rejects.toThrow(DocumentError);
    expect(render.calls).toBe(1);
  });
});

describe("inspect_visual", () => {
  it("passes image, slideId, and intent to the vision dependency and leaves the working copy unchanged", async () => {
    const { workingCopy, slideId, snapshot } = inspectionFixture();
    const operationsSnapshot = [...workingCopy.operations];
    const render = makeRenderSpy();
    const vision = makeVisionSpy();
    const runtime = createInspectionRuntime({ render: render.fn, vision: vision.fn });
    const intent = "タイトルを強調したい";
    const result = await inspectVisual(workingCopy, slideId, intent, runtime);
    expect(vision.calls).toBe(1);
    const request = vision.received[0];
    expect(Buffer.isBuffer(request.image)).toBe(true);
    expect(request.slideId).toBe(slideId);
    expect(request.intent).toBe(intent);
    expect(result.summary).toBeTypeOf("string");
    expect(Array.isArray(result.issues)).toBe(true);
    expect(result.meetsIntent).toBeTypeOf("boolean");
    expect(workingCopy.deck).toEqual(snapshot);
    expect(workingCopy.operations).toEqual(operationsSnapshot);
  });

  it("rejects inspections beyond maxVisionCalls with DocumentError and adds no dependency calls", async () => {
    const { workingCopy, slideId } = inspectionFixture();
    const render = makeRenderSpy();
    const vision = makeVisionSpy();
    const limits: InspectionLimits = { maxVisionCalls: 1 };
    const runtime = createInspectionRuntime({ render: render.fn, vision: vision.fn }, limits);
    await inspectVisual(workingCopy, slideId, "意図A", runtime);
    await expect(inspectVisual(workingCopy, slideId, "意図B", runtime)).rejects.toThrow(DocumentError);
    expect(vision.calls).toBe(1);
  });

  it("rejects inspectVisual on a vision-unsupported runtime while renderSlide still works", async () => {
    const { workingCopy, slideId } = inspectionFixture();
    const render = makeRenderSpy();
    const vision = makeVisionSpy();
    const limits: InspectionLimits = { visionSupported: false };
    const runtime = createInspectionRuntime({ render: render.fn, vision: vision.fn }, limits);
    await expect(inspectVisual(workingCopy, slideId, "意図A", runtime)).rejects.toThrow(DocumentError);
    expect(vision.calls).toBe(0);
    const image = await renderSlide(workingCopy, slideId, runtime);
    expect(Buffer.isBuffer(image)).toBe(true);
  });

  it("keeps counters and working copy consistent when the vision dependency throws", async () => {
    const { workingCopy, slideId, snapshot } = inspectionFixture();
    const operationsSnapshot = [...workingCopy.operations];
    const render = makeRenderSpy();
    const vision = makeVisionSpy(new Error("vision 依存の失敗"));
    const runtime = createInspectionRuntime({ render: render.fn, vision: vision.fn });
    await expect(inspectVisual(workingCopy, slideId, "意図A", runtime)).rejects.toThrow("vision 依存の失敗");
    expect(vision.calls).toBe(1);
    expect(workingCopy.deck).toEqual(snapshot);
    expect(workingCopy.operations).toEqual(operationsSnapshot);
  });
});

// --- Phase 3A Task 3: AI SDK tool loop と実行予算 (Red: 未実装 API の契約固定) ---

const TOOL_LOOP_TOOL_NAMES = [
  "get_deck_summary",
  "get_slide",
  "edit_elements",
  "write_slide",
  "render_slide",
  "inspect_layout",
  "inspect_visual",
  "reflow_slide",
  "commit_changes",
] as const;

type ToolEventRecord = { status: "start" | "complete" | "error"; tool: string };

function makeToolEventRecorder(): { events: ToolEventRecord[]; onToolEvent: (event: ToolEventRecord) => void } {
  const events: ToolEventRecord[] = [];
  return { events, onToolEvent: (event: ToolEventRecord) => { events.push(event); } };
}

// context は同一 Working Copy / InspectionRuntime を共有する。実装側が run 状態を this へ付与する。
function makeToolLoopContext(
  workingCopy: WorkingCopy,
  runtime: InspectionRuntime,
  onToolEvent: (event: ToolEventRecord) => void,
  budget?: unknown,
): { [key: string]: unknown } {
  return budget === undefined ? { workingCopy, runtime, onToolEvent } : { workingCopy, runtime, onToolEvent, budget };
}

function toolLoopFixture(): {
  source: Deck;
  workingCopy: WorkingCopy;
  render: RenderSpy;
  vision: VisionSpy;
  runtime: InspectionRuntime;
  events: ToolEventRecord[];
  context: { [key: string]: unknown };
  registry: Record<string, { inputSchema: unknown; execute: unknown }>;
  slideId: string;
} {
  const source = sampleDeck();
  const workingCopy = createWorkingCopy(source, 0);
  const render = makeRenderSpy();
  const vision = makeVisionSpy();
  const runtime = createInspectionRuntime({ render: render.fn, vision: vision.fn });
  const { events, onToolEvent } = makeToolEventRecorder();
  const context = makeToolLoopContext(workingCopy, runtime, onToolEvent);
  const registry = createAgentToolRegistry(context) as Record<string, { inputSchema: unknown; execute: unknown }>;
  return { source, workingCopy, render, vision, runtime, events, context, registry, slideId: source.slides[1].id };
}

describe("tool registry", () => {
  it("registers exactly the nine planned tools with inputSchema and execute", () => {
    const { registry } = toolLoopFixture();
    expect(Object.keys(registry).sort()).toEqual([...TOOL_LOOP_TOOL_NAMES].sort());
    for (const name of TOOL_LOOP_TOOL_NAMES) {
      expect(registry[name].inputSchema).toBeDefined();
      expect(typeof registry[name].execute).toBe("function");
    }
  });
});

describe("shared run state through tools", () => {
  it("edits made through edit_elements are visible to a later get_slide in the same run", async () => {
    const f = toolLoopFixture();
    const before = await executeAgentTool(f.registry, "get_slide", { slideId: f.slideId }) as Deck["slides"][number];
    const title = titleElement(before);
    await executeAgentTool(f.registry, "edit_elements", {
      slideId: f.slideId,
      patches: [{ elementId: title.id, text: "ツール経由の編集" }],
    });
    const after = await executeAgentTool(f.registry, "get_slide", { slideId: f.slideId }) as Deck["slides"][number];
    const edited = after.elements.find((element) => element.id === title.id);
    expect(edited?.kind === "text" ? edited.text : null).toBe("ツール経由の編集");
  });

  it("shares one inspection runtime across render_slide and inspect_visual", async () => {
    const f = toolLoopFixture();
    const image = await executeAgentTool(f.registry, "render_slide", { slideId: f.slideId });
    expect(Buffer.isBuffer(image)).toBe(true);
    const insight = await executeAgentTool(f.registry, "inspect_visual", { slideId: f.slideId, intent: "タイトルを強調したい" }) as VisualInsight;
    expect(typeof insight.summary).toBe("string");
    expect(f.render.calls).toBe(1);
    expect(f.vision.calls).toBe(1);
    const issues = await executeAgentTool(f.registry, "inspect_layout", { slideId: f.slideId });
    expect(Array.isArray(issues)).toBe(true);
  });
});

describe("commit_changes", () => {
  it("flips commitRequested and exposes operations, working deck, policy, and reply", async () => {
    const f = toolLoopFixture();
    expect(getAgentRunState(f.context).commitRequested).toBe(false);
    const slide = getSlide(f.workingCopy, f.slideId);
    const title = titleElement(slide);
    await executeAgentTool(f.registry, "edit_elements", {
      slideId: f.slideId,
      patches: [{ elementId: title.id, text: "コミット対象" }],
    });
    await executeAgentTool(f.registry, "commit_changes", { reply: "更新をコミットします" });
    const state = getAgentRunState(f.context);
    expect(state.commitRequested).toBe(true);
    expect(state.operations.length).toBeGreaterThan(0);
    expect(state.operations.every((operation: Operation) => OperationSchema.safeParse(operation).success)).toBe(true);
    expect(state.workingDeck).toEqual(f.workingCopy.deck);
    expect(state.policy).toBe<PolicyDecision>("auto");
    expect(state.reply).toBe("更新をコミットします");
  });

  it("rejects a commit with no changes", async () => {
    const f = toolLoopFixture();
    await expect(executeAgentTool(f.registry, "commit_changes", { reply: "変更なし" })).rejects.toThrow();
    expect(getAgentRunState(f.context).commitRequested).toBe(false);
  });

  it("classifies a commit after write_slide as proposal", async () => {
    const f = toolLoopFixture();
    await executeAgentTool(f.registry, "write_slide", {
      slideId: f.slideId,
      blueprint: { layout: "title", title: "書き換え" },
    });
    await executeAgentTool(f.registry, "commit_changes", { reply: "書き換えました" });
    expect(getAgentRunState(f.context).policy).toBe<PolicyDecision>("proposal");
  });

  it("classifies a commit after reflow_slide as proposal", async () => {
    const f = toolLoopFixture();
    const slideId = f.source.slides[2].id;
    const slide = getSlide(f.workingCopy, slideId);
    await executeAgentTool(f.registry, "reflow_slide", {
      slideId,
      rule: { type: "alignRow", elementIds: slide.elements.map((element) => element.id), y: 2 },
    });
    await executeAgentTool(f.registry, "commit_changes", { reply: "整えました" });
    expect(getAgentRunState(f.context).policy).toBe<PolicyDecision>("proposal");
  });
});

describe("tool events", () => {
  it("emits start and complete events around each tool execute", async () => {
    const f = toolLoopFixture();
    await executeAgentTool(f.registry, "get_deck_summary", {});
    expect(f.events.map((event) => event.status)).toEqual(["start", "complete"]);
    expect(f.events.every((event) => event.tool === "get_deck_summary")).toBe(true);
  });

  it("emits an error event when a tool execution fails", async () => {
    const source = sampleDeck();
    const workingCopy = createWorkingCopy(source, 0);
    const render = makeRenderSpy(new Error("render 失敗"));
    const vision = makeVisionSpy();
    const runtime = createInspectionRuntime({ render: render.fn, vision: vision.fn });
    const { events, onToolEvent } = makeToolEventRecorder();
    const context = makeToolLoopContext(workingCopy, runtime, onToolEvent);
    const registry = createAgentToolRegistry(context);
    await expect(executeAgentTool(registry, "render_slide", { slideId: source.slides[1].id })).rejects.toThrow("render 失敗");
    expect(events.some((event) => event.status === "start" && event.tool === "render_slide")).toBe(true);
    expect(events.some((event) => event.status === "error" && event.tool === "render_slide")).toBe(true);
    expect(events.some((event) => event.status === "complete" && event.tool === "render_slide")).toBe(false);
  });
});

describe("agent run budget", () => {
  it("stops after the step budget is consumed", () => {
    const budget = createAgentRunBudget({ maxSteps: 2, maxDurationMs: 10000, now: () => 0 });
    expect(() => consumeAgentStep(budget)).not.toThrow();
    expect(() => consumeAgentStep(budget)).not.toThrow();
    expect(() => consumeAgentStep(budget)).toThrow(/step|ステップ|予算/i);
  });

  it("stops when the injected clock exceeds the time budget", () => {
    let clock = 0;
    const budget = createAgentRunBudget({ maxSteps: 10, maxDurationMs: 1000, now: () => clock });
    expect(() => assertAgentTime(budget)).not.toThrow();
    clock = 1500;
    expect(() => assertAgentTime(budget)).toThrow(/time|時間|予算/i);
  });

  it("stops tool execution once the registry run budget is exceeded", async () => {
    const source = sampleDeck();
    const workingCopy = createWorkingCopy(source, 0);
    const render = makeRenderSpy();
    const vision = makeVisionSpy();
    const runtime = createInspectionRuntime({ render: render.fn, vision: vision.fn });
    const { events, onToolEvent } = makeToolEventRecorder();
    const budget = createAgentRunBudget({ maxSteps: 1, maxDurationMs: 10000, now: () => 0 });
    const context = makeToolLoopContext(workingCopy, runtime, onToolEvent, budget);
    const registry = createAgentToolRegistry(context);
    await executeAgentTool(registry, "get_deck_summary", {});
    await expect(executeAgentTool(registry, "get_slide", { slideId: source.slides[1].id })).rejects.toThrow(/step|ステップ|予算/i);
  });
});

describe("tool loop feature flag", () => {
  it("enables the tool loop only with the flag and an existing slide", () => {
    const deck = sampleDeck();
    expect(isToolLoopEnabled({ AI_TOOL_LOOP_ENABLED: "true" }, deck)).toBe(true);
    expect(isToolLoopEnabled({ AI_TOOL_LOOP_ENABLED: "false" }, deck)).toBe(false);
    expect(isToolLoopEnabled({}, deck)).toBe(false);
    expect(isToolLoopEnabled({ AI_TOOL_LOOP_ENABLED: "true" }, emptyDeck("空の資料"))).toBe(false);
  });
});
