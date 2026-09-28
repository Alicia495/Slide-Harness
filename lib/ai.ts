import { createAzure } from "@ai-sdk/azure";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, type LanguageModel } from "ai";
import { z } from "zod";
import { type Deck, OperationSchema, slideTitle, type Operation } from "./document";
import { applyOperations, DocumentError } from "./operations";
import { getModel, type ModelConfig, type ModelProfile } from "./model-settings";
import { prepareConversationContext } from "./context-memory";

export type { ModelProfile } from "./model-settings";
function modelFor(profile: ModelConfig): LanguageModel {
  if (profile.provider === "azure") {
    const azure = createAzure({
      resourceName: profile.resourceName || undefined,
      baseURL: profile.baseUrl || undefined,
      apiKey: profile.apiKey,
      apiVersion: profile.apiVersion || undefined,
      useDeploymentBasedUrls: profile.legacyUrls,
    });
    return azure.chat(profile.modelName);
  }
  if (profile.provider === "vllm") {
    const vllm = createOpenAICompatible({
      name: "vllm", baseURL: profile.baseUrl,
      apiKey: profile.apiKey || undefined,
    });
    return vllm.chatModel(profile.modelName);
  }
  throw new Error("選択した AI モデルが設定されていません。");
}

function samplingFor(profile: ModelConfig) {
  if (profile.provider === "vllm") return {
    temperature: 1.0, topP: 0.95, presencePenalty: 0.0,
    providerOptions: { vllm: {
      top_k: 20, min_p: 0.0, repetition_penalty: 1.0,
      chat_template_kwargs: { enable_thinking: false },
    } },
  };
  return { temperature: profile.temperature, topP: profile.topP };
}

const OutputSchema = z.object({
  reply: z.string().max(1200).default("変更案を作成しました。"),
  operations: z.array(OperationSchema).min(1).max(30),
});
export type AIResult = z.infer<typeof OutputSchema>;

function extractJSON(raw: string): unknown {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(cleaned); } catch { /* Try the first object below. */ }
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first < 0 || last <= first) throw new Error("AI 応答から JSON を読み取れませんでした。");
  return JSON.parse(cleaned.slice(first, last + 1));
}

function deckContext(deck: Deck): string {
  return JSON.stringify({
    title: deck.title,
    theme: deck.theme,
    slides: deck.slides.map((slide, index) => ({
      index: index + 1, id: slide.id, title: slideTitle(slide),
      elements: slide.elements.map((element) => ({
        ...element,
        ...(element.kind === "image" ? { assetId: element.assetId } : {}),
      })),
    })),
  }).slice(0, 48000);
}

const SYSTEM = `You edit a PowerPoint presentation through a typed document model. Return ONLY one JSON object: {"reply":"short Japanese explanation","operations":[...]}.
Never return JavaScript or Markdown. Use exact UUIDs supplied in the document context. Do not invent existing slide or element IDs.
The canvas is 13.333 x 7.5 inches. Coordinates and dimensions must remain within it. Colors use #RRGGBB.
Allowed operations:
- {"type":"replaceDeck","title":"...","slides":[{"layout":"title|bullets|twoColumn|chart|table|section","title":"...","subtitle":"...","bullets":["..."],"rightBullets":["..."],"chart":{"type":"bar|line|pie","series":[{"name":"...","labels":["..."],"values":[1]}]},"table":[["..."]]}]}
- {"type":"addSlide","slide":{same slide fields},"index":0}
- {"type":"deleteSlide","slideId":"uuid"}
- {"type":"reorderSlide","slideId":"uuid","toIndex":0}
- {"type":"updateText","slideId":"uuid","elementId":"uuid","text":"..."}
- {"type":"moveElement","slideId":"uuid","elementId":"uuid","x":1,"y":1}
- {"type":"resizeElement","slideId":"uuid","elementId":"uuid","w":5,"h":1}
- {"type":"updateStyle","slideId":"uuid","elementId":"uuid","fontSize":24,"color":"#182230","bold":true,"fill":"#3156D3"}
- {"type":"updateTable","slideId":"uuid","elementId":"uuid","rows":[["..."]]}
- {"type":"updateChart","slideId":"uuid","elementId":"uuid","series":[{"name":"...","labels":["..."],"values":[1]}]}
- {"type":"setTheme","primary":"#3156D3","accent":"#65A9F0","background":"#FFFFFF","text":"#182230","fontFace":"Aptos"}
Use replaceDeck only when creating a new presentation or when explicitly asked to remake the entire deck. For a new deck, create useful, specific slide content with 3-7 slides unless the user asks otherwise. Prefer concise Japanese suitable for slides. For edits, preserve unrelated content. If the selected element is relevant, target it. Reply and operations must agree.`;

function demoResult(deck: Deck, request: string, target?: { slideId?: string; elementId?: string }): AIResult {
  if (!deck.slides.length) {
    const topic = request.replace(/\s+/g, " ").slice(0, 60) || "新しい提案";
    return { reply: "構成案を作成しました。内容を確認して適用してください。", operations: [{ type: "replaceDeck", title: topic, slides: [
      { layout: "title", title: topic, subtitle: "概要と提案", bullets: [] },
      { layout: "bullets", title: "背景と課題", bullets: ["現状を整理する", "優先すべき課題を明確にする", "解決に向けた方針を共有する"] },
      { layout: "twoColumn", title: "提案内容", bullets: ["導入しやすい構成", "運用しながら改善"], rightBullets: ["成果を確認する指標", "次のアクションを明確化"] },
      { layout: "bullets", title: "次のステップ", bullets: ["範囲と担当を決める", "試行して結果を確認する", "改善して展開する"] },
    ] }] };
  }
  const slide = deck.slides.find((s) => s.id === target?.slideId) ?? deck.slides[0];
  const element = slide.elements.find((e) => e.id === target?.elementId && e.kind === "text") ?? slide.elements.find((e) => e.kind === "text" && e.role === "title");
  if (element?.kind === "text") {
    return { reply: "選択中の文章にデモの変更を加えました。", operations: [{ type: "updateText", slideId: slide.id, elementId: element.id, text: `${element.text}（更新）` }] };
  }
  return { reply: "デモのスライドを追加します。", operations: [{ type: "addSlide", slide: { layout: "bullets", title: "追加スライド", bullets: [request.slice(0, 120)] } }] };
}

export async function generateOperations(projectId: string, deck: Deck, request: string, modelId: string, target?: { slideId?: string; elementId?: string }): Promise<AIResult & { compacted?: boolean }> {
  const profile = await getModel(modelId);
  if (!profile) throw new DocumentError("AI モデルを選択してください。");
  if (profile.provider === "demo") return demoResult(deck, request, target);
  const model = modelFor(profile);
  const fixedPrompt = `${SYSTEM}\nSelected target: ${JSON.stringify(target ?? {})}\nCurrent document: ${deckContext(deck)}`;
  const pending = { id: crypto.randomUUID(), role: "user" as const, content: request,
    metadata: { modelId, target }, createdAt: new Date().toISOString() };
  const context = await prepareConversationContext(projectId, profile, fixedPrompt, async (instruction, maxOutputTokens) => {
    const result = await generateText({ model, prompt: instruction, maxOutputTokens, ...samplingFor(profile), abortSignal: AbortSignal.timeout(120000) });
    return result.text;
  }, pending);
  const prompt = `Selected target: ${JSON.stringify(target ?? {})}\nCurrent document (source of truth): ${deckContext(deck)}\n\n${context.text}\n\n${deck.slides.length ? "Edit the existing document. The latest user message is the request to answer." : "The document is empty. Create it with replaceDeck."}`;
  let issue = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await generateText({
      model, system: SYSTEM,
      prompt: issue ? `${prompt}\nPrevious response was invalid: ${issue}. Return valid JSON matching the contract.` : prompt,
      maxOutputTokens: profile.maxOutputTokens,
      ...samplingFor(profile),
      abortSignal: AbortSignal.timeout(120000),
    });
    try {
      const parsed = OutputSchema.parse(extractJSON(result.text));
      applyOperations(deck, parsed.operations);
      return { ...parsed, compacted: context.compacted };
    } catch (error) {
      issue = error instanceof Error ? error.message.slice(0, 600) : "unknown validation error";
    }
  }
  throw new Error(`AI の変更案を検証できませんでした: ${issue}`);
}

export async function testModelConnection(modelId: string): Promise<string> {
  const profile = await getModel(modelId);
  if (!profile) throw new DocumentError("AI モデルが設定されていません。");
  if (profile.provider === "demo") return "デモモードは利用できます。";
  const result = await generateText({
    model: modelFor(profile), prompt: "Reply with exactly OK.", maxOutputTokens: Math.min(256, profile.maxOutputTokens),
    ...samplingFor(profile),
    abortSignal: AbortSignal.timeout(20000),
  });
  return result.text.trim() || "接続できました。";
}
