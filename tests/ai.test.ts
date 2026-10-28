import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DECK_CONTEXT_LIMIT, PLAN_SYSTEM_PROMPT, REPLY_MAX, SYSTEM_PROMPT, TOOL_LOOP_SYSTEM_PROMPT, buildDemoPlan, clampReply, createToolLoopActivityFeed, deckContext, generationOutputTokens, normalizeReply, parseVisionProbe, planRepairFeedback, repairFeedback, selectAIGenerationMode, toolLoopSampling, toolLoopTokenBudget, toolLoopWorkflowInstruction, tokenUsageExceedsBudget, validationFailureMessage, type ModelConfig, type ToolLoopActivityEvent } from "../lib/ai";
import { emptyDeck, type Deck } from "../lib/document";
import { DocumentError, isSmallAIEdit } from "../lib/operations";

describe("AI slide generation guidance", () => {
  it("prioritizes visual layouts without fabricating chart data", () => {
    expect(SYSTEM_PROMPT).toContain("Design visual-first");
    expect(SYSTEM_PROMPT).toContain("at least two thirds of non-cover slides");
    expect(SYSTEM_PROMPT).toContain("Never invent numbers merely to add a chart");
  });

  it("binds generated content to the document theme", () => {
    expect(SYSTEM_PROMPT).toContain("theme in the Current document is binding");
    expect(SYSTEM_PROMPT).toContain("do not use setTheme unless the user explicitly asks");
  });
});

describe("Long AI response tolerance", () => {
  it("clamps over-long replies instead of failing validation", () => {
    const short = clampReply("こんにちは");
    expect(short).toBe("こんにちは");
    const long = clampReply("あ".repeat(REPLY_MAX + 500));
    expect(long.length).toBe(REPLY_MAX);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("Vision model verification", () => {
  it("accepts only the expected image-recognition response", () => {
    expect(parseVisionProbe('{"dominantColor":"white"}')).toBe(true);
    expect(parseVisionProbe('{"dominantColor":"#FFFFFF"}')).toBe(true);
    expect(parseVisionProbe('{"dominantColor":"blue"}')).toBe(false);
    expect(parseVisionProbe("red")).toBe(false);
  });
});

describe("Plan phase", () => {
  it("requires the fixed concept plan headings", () => {
    for (const heading of ["## 目的と読者", "## コンセプト", "## スライド構成", "## テーマとデザイン方針"]) {
      expect(PLAN_SYSTEM_PROMPT).toContain(heading);
    }
    expect(PLAN_SYSTEM_PROMPT).toContain("Never return JavaScript");
  });

  it("builds a demo plan with the required headings and slide list", () => {
    const result = buildDemoPlan(emptyDeck("テスト資料"), "新サービスの提案資料を作って");
    for (const heading of ["## 目的と読者", "## コンセプト", "## スライド構成", "## テーマとデザイン方針"]) {
      expect(result.plan).toContain(heading);
    }
    expect(result.plan).toContain("新サービスの提案資料を作って");
    expect(result.reply.length).toBeLessThanOrEqual(600);
  });
});

function profileWith(maxOutputTokens: number, contextWindow: number | null): ModelConfig {
  return {
    id: "env-vllm", label: "L", provider: "vllm", modelName: "m", baseUrl: "http://127.0.0.1:8000/v1",
    resourceName: "", apiVersion: "", legacyUrls: false, hasApiKey: false,
    contextWindow, contextSource: contextWindow ? "manual" : "unknown",
    temperature: 1, topP: 0.95, maxOutputTokens, managedBy: "environment", visionSupported: true, visionCheckedAt: null,
  };
}

describe("Generation output budget", () => {
  it("respects the configured maxOutputTokens without an 8192 floor", () => {
    expect(generationOutputTokens(profileWith(2048, 32768))).toBe(2048);
    expect(generationOutputTokens(profileWith(64, 32768))).toBe(64);
  });

  it("keeps the 80% context window ceiling", () => {
    expect(generationOutputTokens(profileWith(100000, 8192))).toBe(6553);
    expect(generationOutputTokens(profileWith(5000, null))).toBe(5000);
  });
});

function oversizedDeck(slideCount: number, elementCount: number): Deck {
  const deck = emptyDeck("大きい資料");
  for (let i = 0; i < slideCount; i++) {
    deck.slides.push({
      id: crypto.randomUUID(), background: "#FFFFFF",
      elements: Array.from({ length: elementCount }, (_unused, index) => ({
        kind: "text" as const, id: crypto.randomUUID(), x: 0.5, y: (index % 12) * 0.6, w: 10, h: 0.5,
        rotation: 0, text: "あ".repeat(8000), fontSize: 24, color: "#182230", bold: false,
        align: "left" as const, valign: "top" as const, role: "body" as const,
      })),
    });
  }
  return deck;
}

describe("Deck context compaction", () => {
  it("returns the full document context when it fits", () => {
    const deck = emptyDeck("小さい資料");
    deck.slides.push({
      id: crypto.randomUUID(), background: "#FFFFFF",
      elements: [{ kind: "text", id: crypto.randomUUID(), x: 1, y: 1, w: 5, h: 1, rotation: 0, text: "そのままの文章", fontSize: 24, color: "#182230", bold: false, align: "left", valign: "top", role: "body" }],
    });
    const parsed = JSON.parse(deckContext(deck)) as { slides: { elements: { text: string }[] }[] };
    expect(parsed.slides[0].elements[0].text).toBe("そのままの文章");
  });

  it("compacts oversized decks to valid JSON within the limit, deterministically", () => {
    const deck = oversizedDeck(50, 2);
    const first = deckContext(deck);
    const second = deckContext(deck);
    expect(first.length).toBeLessThanOrEqual(DECK_CONTEXT_LIMIT);
    expect(first).toBe(second);
    const parsed = JSON.parse(first) as { title: string; theme: { name: string }; slides: { id: string; elements: { text?: string }[] }[] };
    expect(parsed.title).toBe("大きい資料");
    expect(parsed.theme.name).toBe("クリーン");
    expect(parsed.slides.length).toBeGreaterThan(0);
    expect(parsed.slides.every((slide) => typeof slide.id === "string" && slide.id.length > 0)).toBe(true);
    expect(parsed.slides.every((slide) => slide.elements.every((element) => (element.text ?? "").length <= 240))).toBe(true);
  });

  it("drops trailing slides only after text truncation still exceeds the limit", () => {
    const deck = oversizedDeck(50, 20);
    const context = deckContext(deck);
    expect(context.length).toBeLessThanOrEqual(DECK_CONTEXT_LIMIT);
    const parsed = JSON.parse(context) as { slides: { index: number }[] };
    expect(parsed.slides.length).toBeGreaterThan(0);
    expect(parsed.slides.length).toBeLessThan(deck.slides.length);
    expect(parsed.slides.map((slide) => slide.index)).toEqual(parsed.slides.map((_slide, index) => index + 1));
  });
});

describe("Small AI edit classification", () => {
  it("treats a single element-level edit as immediately applicable", () => {
    const updateText = { type: "updateText", slideId: crypto.randomUUID(), elementId: crypto.randomUUID(), text: "更新" } as const;
    expect(isSmallAIEdit([updateText])).toBe(true);
  });

  it("keeps deck-wide and multi-operation changes as proposals", () => {
    const replaceDeck = { type: "replaceDeck", title: "T", slides: [] } as const;
    expect(isSmallAIEdit([replaceDeck as never])).toBe(false);
    const move = { type: "moveElement", slideId: crypto.randomUUID(), elementId: crypto.randomUUID(), x: 1, y: 1 } as const;
    expect(isSmallAIEdit([move, move])).toBe(false);
  });
});

describe("Validation failure guidance", () => {
  const unionIssue = JSON.stringify([{ code: "invalid_union", discriminator: "type", message: "Invalid discriminator value" }]);

  it("explains unsupported operation formats as an AI response problem", () => {
    expect(validationFailureMessage(unionIssue, "operations")).toContain("許可されていない操作形式");
    expect(validationFailureMessage(unionIssue, "plan")).toContain("構成案として許可されていない形式");
  });

  it("maps size and empty-response issues to actionable guidance", () => {
    expect(validationFailureMessage('{"code":"too_big"}', "operations")).toContain("分割");
    expect(validationFailureMessage('{"code":"too_small"}', "plan")).toContain("具体的に");
    expect(validationFailureMessage("応答が空です。", "operations")).toContain("応答が空");
    expect(validationFailureMessage("unknown validation error", "plan")).toContain("構成案");
  });

  it("names invented ids as the failure cause", () => {
    const uuidIssue = JSON.stringify([{ code: "invalid_format", format: "uuid", path: ["operations", 1, "slideId"], message: "Invalid UUID" }]);
    expect(validationFailureMessage(uuidIssue, "operations")).toContain("存在しないスライド・要素 ID");
  });
});

function deckWithSlide(title: string): Deck {
  const deck = emptyDeck("資料");
  deck.slides.push({
    id: "11111111-1111-4111-8111-111111111111", background: "#FFFFFF",
    elements: [{ kind: "text", id: "22222222-2222-4222-8222-222222222222", x: 1, y: 1, w: 5, h: 1, rotation: 0, text: title, fontSize: 24, color: "#182230", bold: false, align: "left", valign: "top", role: "title" }],
  });
  return deck;
}

describe("Agentic repair feedback", () => {
  it("returns validation details and the real ids to the model", () => {
    const error = z.string().uuid().safeParse("slide-1").error!;
    const feedback = repairFeedback(error, deckWithSlide("表紙"));
    expect(feedback).toContain("Invalid UUID");
    expect(feedback).toContain("11111111-1111-4111-8111-111111111111");
    expect(feedback).toContain("22222222-2222-4222-8222-222222222222");
    expect(feedback).toContain("never invent ids");
  });

  it("feeds document-level failures back to the model as repair input", () => {
    const feedback = repairFeedback(new DocumentError("対象のスライドが見つかりません。"), deckWithSlide("表紙"));
    expect(feedback).toContain("対象のスライドが見つかりません。");
    expect(feedback).toContain("keep already valid operations unchanged");
  });

  it("keeps plan repair free of ids and operations", () => {
    const feedback = planRepairFeedback(new DocumentError("応答が空です。"));
    expect(feedback).toContain("no operations, no coordinates, no ids");
    expect(feedback).not.toContain("slideId");
  });

  it("detects a stalled model reply that repeats itself", () => {
    expect(normalizeReply('{"reply": "a",\n "operations":[]}')).toBe(normalizeReply('{"reply": "a", "operations":[]}'));
    expect(normalizeReply("a") === normalizeReply("b")).toBe(false);
  });
});

describe("Tool loop system prompt", () => {
  it("requires reading the slide before editing it", () => {
    const lower = TOOL_LOOP_SYSTEM_PROMPT.toLowerCase();
    expect(lower).toContain("read");
    expect(lower.indexOf("read")).toBeLessThan(lower.indexOf("edit"));
  });

  it("requires an explicit commit tool call before changes apply", () => {
    expect(TOOL_LOOP_SYSTEM_PROMPT).toContain("commit_changes");
    const lower = TOOL_LOOP_SYSTEM_PROMPT.toLowerCase();
    expect(lower).toContain("commit");
  });

  it("directs the model to use layout and visual inspection tools", () => {
    const lower = TOOL_LOOP_SYSTEM_PROMPT.toLowerCase();
    expect(lower).toContain("inspect");
    expect(TOOL_LOOP_SYSTEM_PROMPT).toContain("inspect_layout");
    expect(TOOL_LOOP_SYSTEM_PROMPT).toContain("inspect_visual");
  });

  it("forbids arbitrary code execution", () => {
    const lower = TOOL_LOOP_SYSTEM_PROMPT.toLowerCase();
    expect(lower).toContain("never");
    expect(lower).toContain("javascript");
  });

  it("directs deck creation through the write_deck tool", () => {
    expect(TOOL_LOOP_SYSTEM_PROMPT).toContain("write_deck");
  });

  it("instructs an empty deck run to create the deck with write_deck", () => {
    const instruction = toolLoopWorkflowInstruction(emptyDeck("空の資料"));
    expect(instruction).toContain("write_deck");
    expect(toolLoopWorkflowInstruction(deckWithSlide("表紙"))).not.toContain("write_deck");
  });

  it("does not reuse the JSON-in-prompt operations contract", () => {
    expect(TOOL_LOOP_SYSTEM_PROMPT).not.toContain('"operations":[');
    expect(TOOL_LOOP_SYSTEM_PROMPT).not.toBe(SYSTEM_PROMPT);
  });
});

describe("AI generation mode selection", () => {
  it("selects tool-loop for a non-empty deck with the flag enabled", () => {
    expect(selectAIGenerationMode({ AI_TOOL_LOOP_ENABLED: "true" }, deckWithSlide("表紙"))).toBe("tool-loop");
  });

  it("selects tool-loop for an empty deck so new creation runs through tools", () => {
    expect(selectAIGenerationMode({ AI_TOOL_LOOP_ENABLED: "true" }, emptyDeck("空の資料"))).toBe("tool-loop");
  });

  it("selects legacy when the flag is not exactly true", () => {
    const deck = deckWithSlide("表紙");
    expect(selectAIGenerationMode({ AI_TOOL_LOOP_ENABLED: "false" }, deck)).toBe("legacy");
    expect(selectAIGenerationMode({}, deck)).toBe("legacy");
    expect(selectAIGenerationMode({ AI_TOOL_LOOP_ENABLED: "false" }, emptyDeck("空の資料"))).toBe("legacy");
  });
});

describe("Tool loop token budget", () => {
  it("bounds a run from the model context window and a global ceiling", () => {
    expect(toolLoopTokenBudget(profileWith(2048, 8192))).toBe(16384);
    expect(toolLoopTokenBudget(profileWith(2048, null))).toBeGreaterThan(0);
    expect(toolLoopTokenBudget(profileWith(2048, 1000000))).toBeLessThanOrEqual(120000);
  });

  it("stops when aggregate step usage reaches the run budget", () => {
    const steps = [
      { usage: { totalTokens: 4000 } },
      { usage: { totalTokens: 5000 } },
    ];
    expect(tokenUsageExceedsBudget(steps, 9000)).toBe(true);
    expect(tokenUsageExceedsBudget(steps, 9001)).toBe(false);
  });

  it("treats missing provider usage as zero without failing", () => {
    expect(tokenUsageExceedsBudget([{ usage: { totalTokens: undefined } }], 1)).toBe(false);
  });
});

function collectFeed(): { events: ToolLoopActivityEvent[]; push: (part: Parameters<ReturnType<typeof createToolLoopActivityFeed>["onPart"]>[0]) => void; flush: () => void } {
  const events: ToolLoopActivityEvent[] = [];
  const feed = createToolLoopActivityFeed((event) => events.push(event));
  return { events, push: (part) => feed.onPart(part), flush: () => feed.flush() };
}

describe("Tool loop activity feed", () => {
  it("emits numbered step events for each model step", () => {
    const { events, push } = collectFeed();
    push({ type: "start-step" });
    push({ type: "start-step" });
    expect(events).toEqual([{ kind: "step", step: 1 }, { kind: "step", step: 2 }]);
  });

  it("emits tool start with truncated args and result with summary for the same call id", () => {
    const { events, push } = collectFeed();
    push({ type: "tool-call", toolCallId: "call-1", toolName: "edit_elements", input: { slideId: "s-1", edits: [{ elementId: "e-1", text: "あ".repeat(500) }] } });
    push({ type: "tool-result", toolCallId: "call-1", toolName: "edit_elements", output: { applied: 1 } });
    expect(events).toHaveLength(2);
    const [start, result] = events;
    expect(start.kind === "tool" && start.status).toBe("start");
    expect(start.kind === "tool" && start.args).toContain("slideId");
    expect(start.kind === "tool" && (start.args ?? "").length).toBeLessThanOrEqual(400);
    expect(result.kind === "tool" && result.status).toBe("result");
    expect(result.kind === "tool" && result.summary).toBe('{"applied":1}');
  });

  it("emits tool errors with the failure summary", () => {
    const { events, push } = collectFeed();
    push({ type: "tool-error", toolCallId: "call-9", toolName: "render_slide", error: new Error("描画に失敗しました") });
    expect(events).toHaveLength(1);
    expect(events[0].kind === "tool" && events[0].status).toBe("error");
    expect(events[0].kind === "tool" && events[0].summary).toContain("描画に失敗しました");
  });

  it("buffers reasoning deltas and flushes them at reasoning end", () => {
    const { events, push } = collectFeed();
    push({ type: "reasoning-delta", text: "まず" });
    push({ type: "reasoning-delta", text: "対象を見る" });
    expect(events).toHaveLength(0);
    push({ type: "reasoning-end" });
    expect(events).toEqual([{ kind: "reasoning", text: "まず対象を見る" }]);
  });

  it("flushes long reasoning buffers without waiting for the end boundary", () => {
    const { events, push } = collectFeed();
    push({ type: "reasoning-delta", text: "あ".repeat(160) });
    expect(events).toEqual([{ kind: "reasoning", text: "あ".repeat(160) }]);
    push({ type: "reasoning-delta", text: "い".repeat(30) });
    expect(events).toHaveLength(1);
  });

  it("keeps reasoning and reply text in separate ordered events", () => {
    const { events, push, flush } = collectFeed();
    push({ type: "reasoning-delta", text: "考える" });
    push({ type: "text-delta", text: "返答" });
    flush();
    expect(events).toEqual([{ kind: "reasoning", text: "考える" }, { kind: "text", text: "返答" }]);
  });

  it("flushes buffered content before tool events so the feed keeps stream order", () => {
    const { events, push } = collectFeed();
    push({ type: "reasoning-delta", text: "次を対象編集" });
    push({ type: "tool-call", toolCallId: "call-2", toolName: "write_slide", input: { slideId: "s-1" } });
    expect(events).toEqual([
      { kind: "reasoning", text: "次を対象編集" },
      { kind: "tool", status: "start", tool: "write_slide", callId: "call-2", args: '{"slideId":"s-1"}' },
    ]);
  });

  it("ignores parts that carry no display activity", () => {
    const { events, push } = collectFeed();
    push({ type: "start" });
    push({ type: "finish-step" });
    push({ type: "finish" });
    expect(events).toHaveLength(0);
  });
});

describe("Tool loop sampling", () => {
  it("enables thinking output on vllm so reasoning can be streamed live", () => {
    expect(toolLoopSampling(profileWith(2048, 32768))).toHaveProperty("providerOptions.vllm.chat_template_kwargs.enable_thinking", true);
  });

  it("keeps azure sampling free of vllm-specific options", () => {
    const azure: ModelConfig = {
      id: "env-azure", label: "A", provider: "azure", modelName: "gpt", baseUrl: "https://x.openai.azure.com/openai/v1",
      resourceName: "x", apiVersion: "v1", legacyUrls: false, hasApiKey: true,
      contextWindow: 128000, contextSource: "manual",
      temperature: 0.2, topP: 1, maxOutputTokens: 4096, managedBy: "environment", visionSupported: true, visionCheckedAt: null,
    };
    const sampling = toolLoopSampling(azure);
    expect(sampling.temperature).toBe(0.2);
    expect(sampling).not.toHaveProperty("providerOptions.vllm");
  });
});
