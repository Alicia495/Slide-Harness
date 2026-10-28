import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DECK_CONTEXT_LIMIT, PLAN_SYSTEM_PROMPT, REPLY_MAX, SYSTEM_PROMPT, TOOL_LOOP_SYSTEM_PROMPT, buildDemoPlan, clampReply, deckContext, generationOutputTokens, normalizeReply, parseVisionProbe, planRepairFeedback, repairFeedback, selectAIGenerationMode, toolLoopTokenBudget, tokenUsageExceedsBudget, validationFailureMessage, type ModelConfig } from "../lib/ai";
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

  it("does not reuse the JSON-in-prompt operations contract", () => {
    expect(TOOL_LOOP_SYSTEM_PROMPT).not.toContain('"operations":[');
    expect(TOOL_LOOP_SYSTEM_PROMPT).not.toBe(SYSTEM_PROMPT);
  });
});

describe("AI generation mode selection", () => {
  it("selects tool-loop for a non-empty deck with the flag enabled", () => {
    expect(selectAIGenerationMode({ AI_TOOL_LOOP_ENABLED: "true" }, deckWithSlide("表紙"))).toBe("tool-loop");
  });

  it("selects legacy for an empty deck even with the flag enabled", () => {
    expect(selectAIGenerationMode({ AI_TOOL_LOOP_ENABLED: "true" }, emptyDeck("空の資料"))).toBe("legacy");
  });

  it("selects legacy when the flag is not exactly true", () => {
    const deck = deckWithSlide("表紙");
    expect(selectAIGenerationMode({ AI_TOOL_LOOP_ENABLED: "false" }, deck)).toBe("legacy");
    expect(selectAIGenerationMode({}, deck)).toBe("legacy");
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
