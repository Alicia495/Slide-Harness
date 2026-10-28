import { createAzure } from "@ai-sdk/azure";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, hasToolCall, stepCountIs, streamText, type LanguageModel } from "ai";
import { z } from "zod";
import { type Deck, OperationSchema, slideTitle, type Operation } from "./document";
import { applyOperations, DocumentError } from "./operations";
import { getModel, recordVisionStatus, type ModelConfig, type ModelProfile } from "./model-settings";
import { prepareConversationContext } from "./context-memory";
import { assetPathsForProject } from "./assets";
import { buildPptx } from "./pptx";
import { renderPptxPreview } from "./render";
import {
  createAgentRunBudget,
  createAgentToolRegistry,
  createInspectionRuntime,
  createWorkingCopy,
  finalizeAgentRunState,
  getAgentToolSet,
  isToolLoopEnabled,
  isAgentBudgetExhausted,
  VisualInsightSchema,
  type InspectionDeps,
  type PolicyDecision,
  type ToolEventRecord,
  type VisualInsight,
} from "./agent-harness";

export type { ModelConfig, ModelProfile } from "./model-settings";
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

function samplingFor(profile: ModelConfig, thinking = false) {
  if (profile.provider === "vllm") return {
    temperature: 1.0, topP: 0.95, presencePenalty: 0.0,
    providerOptions: { vllm: {
      top_k: 20, min_p: 0.0, repetition_penalty: 1.0,
      chat_template_kwargs: { enable_thinking: thinking },
    } },
  };
  return { temperature: profile.temperature, topP: profile.topP };
}

// ツールループは思考内容をリアルタイムで返すため、reasoning を生成する設定で呼ぶ。
export function toolLoopSampling(profile: ModelConfig) {
  return samplingFor(profile, true);
}

// "tool" は Phase 3B のツール実行フェーズ。detail の追加項目は後方互換 (既存呼び出しは attempt のみ)。
export type AIPhase = "context" | "generating" | "repair" | "vision" | "rendering" | "tool";
export type PhaseReporter = (phase: AIPhase, detail?: { attempt?: number; tool?: string; status?: ToolEventRecord["status"] }) => void;

export type AIGenerationMode = "tool-loop" | "legacy";

// ツールループはフラグ有効かつ既存資料があるときのみ。空 Deck の初回作成は legacy のまま。
export function selectAIGenerationMode(env: Record<string, string | undefined>, deck: Deck): AIGenerationMode {
  return isToolLoopEnabled(env, deck) ? "tool-loop" : "legacy";
}

export const REPLY_MAX = 2400;
export const GENERATE_TIMEOUT_MS = 600000;
export const VISION_TIMEOUT_MS = 300000;
export const REPAIR_ATTEMPTS = 5;

const OutputSchema = z.object({
  reply: z.string().max(REPLY_MAX).default("変更案を作成しました。"),
  operations: z.array(OperationSchema).min(0).max(30),
  questions: z.array(z.string().trim().min(3).max(200)).max(3).default([]),
});
export type AIResult = z.infer<typeof OutputSchema>;

export function clampReply(reply: string): string {
  return reply.length > REPLY_MAX ? `${reply.slice(0, REPLY_MAX - 1)}…` : reply;
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

function timeoutDocumentError(): DocumentError {
  return new DocumentError("AI 応答の生成が時間内に完了しませんでした。依頼を短くするか、AI 設定で最大出力トークンを下げて再試行してください。", 504);
}

// 検証失敗の zod 詳細を、ユーザーが対処できる日本語の案内に変換する（詳細はサーバーログへ残す）。
export function validationFailureMessage(issue: string, phase: "operations" | "plan"): string {
  const label = phase === "plan" ? "構成案" : "変更案";
  const code = /"code"\s*:\s*"([a-z_]+)"/.exec(issue)?.[1] ?? "";
  if (code === "invalid_union" || issue.includes("Invalid discriminator")) {
    return phase === "plan"
      ? "AI が構成案として許可されていない形式を返しました。操作やレイアウト指定を含まない依頼にして再試行してください。"
      : "AI が許可されていない操作形式を返しました。依頼を短くし、対象スライドを絞って再試行してください。";
  }
  if (code === "too_big") return `AI の${label}が大きすぎました。依頼を分割して再試行してください。`;
  if (code === "too_small") return `AI の${label}が短すぎました。目的・対象読者・伝えたい内容を具体的に書いて再試行してください。`;
  if (code === "invalid_type") return `AI の${label}が形式違反でした。依頼を短くして再試行してください。`;
  if (code === "invalid_format" || issue.includes("Invalid UUID")) {
    return "AI が存在しないスライド・要素 ID を指定しました。対象スライドを選択してから依頼し直してください。";
  }
  if (issue.includes("応答が空です")) return "AI の応答が空でした。依頼を具体化して再試行してください。";
  return `AI の${label}を検証できませんでした。時間をおいて再試行するか、依頼を短くしてください。`;
}

function validationFailureError(issue: string, phase: "operations" | "plan", modelId: string): DocumentError {
  console.error(`[ai] ${phase} 検証失敗 modelId=${modelId} issue=${issue}`);
  return new DocumentError(validationFailureMessage(issue, phase), 502);
}

function validationLines(error: unknown): string[] {
  if (error instanceof z.ZodError) return error.issues.slice(0, 8).map((issue) => `- ${issue.path.join(".")}: ${issue.message}`);
  return [`- ${error instanceof Error ? error.message : "unknown validation error"}`];
}

// 検証失敗をモデル自身へ返して直させる修復指示（ツール結果に相当）。実 ID 一覧を同じ応答内に添えて UUID 発明を防ぐ。
export function repairFeedback(error: unknown, deck: Deck): string {
  return [
    "Your previous reply failed validation. Repair it and return the complete corrected JSON object only.",
    ...validationLines(error),
    "Rules: use only the slideId and elementId values listed in the document below, never invent ids, keep already valid operations unchanged, and do not add operations.",
    `Document with valid ids: ${deckContext(deck)}`,
  ].join("\n");
}

export function planRepairFeedback(error: unknown): string {
  return [
    "Your previous reply failed validation. Repair it and return the complete corrected JSON object only.",
    ...validationLines(error),
    'Rules: return ONLY {"reply":"...","plan":"..."} with the four required headings, no operations, no coordinates, no ids, OR ONLY {"reply":"...","questions":["short question",...]} with 1-3 questions when you need to ask the user. Never return both plan and questions.',
  ].join("\n");
}

export function normalizeReply(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function generationOutputTokens(profile: ModelConfig): number {
  const contextBound = profile.contextWindow ? Math.floor(profile.contextWindow * 0.8) : Number.POSITIVE_INFINITY;
  return Math.min(profile.maxOutputTokens, contextBound);
}

const VisionProbeSchema = z.object({ dominantColor: z.string().trim().min(1).max(40) });
const VisionReviewSchema = z.object({
  summary: z.string().max(600).default("視覚レビューを完了しました。"),
  meetsIntent: z.preprocess((value) => (typeof value === "string" ? value.trim().toLowerCase() !== "false" : value), z.boolean().default(true)),
  issues: z.array(z.string().trim().max(400)).max(8).default([]),
  operations: z.array(OperationSchema).max(30).default([]),
});
const VISION_PROBE_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9J4OsAAAAASUVORK5CYII=", "base64");
const VISION_REVIEW_LIMIT = 3;
const VISION_MAX_OUTPUT_TOKENS = 65536;

export type DeckReviewReport = { summary: string; issues: string[]; rounds: number; fixed: number; meetsIntent: boolean };

export function parseVisionProbe(raw: string): boolean {
  try {
    const result = VisionProbeSchema.parse(extractJSON(raw));
    return ["white", "#fff", "#ffffff", "rgb(255,255,255)"].includes(result.dominantColor.toLowerCase());
  } catch {
    return false;
  }
}

function extractJSON(raw: string): unknown {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(cleaned); } catch { /* Try the first object below. */ }
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first < 0 || last <= first) throw new Error("AI 応答から JSON を読み取れませんでした。");
  return JSON.parse(cleaned.slice(first, last + 1));
}

function visionOutputTokens(profile: ModelConfig): number {
  const contextBound = profile.contextWindow ? Math.floor(profile.contextWindow * 0.5) : VISION_MAX_OUTPUT_TOKENS;
  return Math.min(VISION_MAX_OUTPUT_TOKENS, contextBound);
}

async function requestVision(model: LanguageModel, profile: ModelConfig, text: string, images: Buffer[]): Promise<string> {
  try {
    const result = await generateText({
      model,
      messages: [{ role: "user", content: [{ type: "text", text }, ...images.map((image) => ({ type: "file" as const, data: image, mediaType: "image/png" }))] }],
      maxOutputTokens: visionOutputTokens(profile),
      ...samplingFor(profile),
      abortSignal: AbortSignal.timeout(VISION_TIMEOUT_MS),
    });
    return result.text;
  } catch (error) {
    if (isTimeoutError(error)) throw timeoutDocumentError();
    throw error;
  }
}

async function requestText(model: LanguageModel, profile: ModelConfig, text: string): Promise<string> {
  try {
    const result = await generateText({
      model, prompt: text, maxOutputTokens: visionOutputTokens(profile),
      ...samplingFor(profile), abortSignal: AbortSignal.timeout(VISION_TIMEOUT_MS),
    });
    return result.text;
  } catch (error) {
    if (isTimeoutError(error)) throw timeoutDocumentError();
    throw error;
  }
}

async function parseVisionReview(text: string, deck: Deck, model: LanguageModel, profile: ModelConfig, instruction: string): Promise<z.infer<typeof VisionReviewSchema>> {
  let issue = "";
  let repair = "";
  let current = text;
  let previous = "";
  for (let attempt = 0; attempt < REPAIR_ATTEMPTS; attempt++) {
    try {
      // Vision レビューは改善提案層のため、個別の不正操作は件単位で破棄し有効な修正だけ採用する。
      const raw = extractJSON(current) as Record<string, unknown>;
      const supplied = Array.isArray(raw.operations) ? raw.operations : [];
      const valid = supplied.filter((operation) => OperationSchema.safeParse(operation).success);
      if (valid.length < supplied.length) console.warn(`[ai] Vision レビューの不正操作を破棄 discarded=${supplied.length - valid.length} modelId=${profile.id}`);
      const parsed = VisionReviewSchema.parse({ ...raw, operations: valid });
      if (!parsed.meetsIntent && !parsed.operations.length) throw new Error('meetsIntent false requires at least one fixing operation. Set meetsIntent true with issues only, OR return operations that fix the listed issues.');
      return parsed;
    } catch (error) {
      issue = error instanceof Error ? error.message.slice(0, 600) : "unknown validation error";
      const stalled = normalizeReply(current) === normalizeReply(previous);
      previous = current;
      repair = repairFeedback(error, deck);
      console.warn(`[ai] Vision レビュー検証失敗をモデルへ返して修復 attempt=${attempt + 1}/${REPAIR_ATTEMPTS} modelId=${profile.id} issue=${issue}`);
      if (stalled) break;
      // 修復は画像を再送せず、前応答と ID 一覧のみのテキストで行う。
      current = await requestText(model, profile, `${instruction}\n\nYour previous reply:\n${current.slice(0, REPLY_MAX)}\n\n${repair}`);
    }
  }
  console.error(`[ai] vision 検証失敗 modelId=${profile.id} issue=${issue}`);
  throw new DocumentError("AI の視覚レビューを検証できませんでした。時間をおいて再試行するか、依頼を短くしてください。", 502);
}

async function reviewDeck(projectId: string, deck: Deck, model: LanguageModel, profile: ModelConfig, request: string, plan: string | null, onPhase?: PhaseReporter): Promise<{ deck: Deck; report: DeckReviewReport }> {
  let reviewed = deck;
  let fixed = 0;
  let lastSummary = "";
  let lastIssues: string[] = [];
  let lastMeets = true;
  let rounds = 0;
  for (let attempt = 0; attempt < VISION_REVIEW_LIMIT; attempt++) {
    onPhase?.("rendering", { attempt: attempt + 1 });
    const pptx = await buildPptx(reviewed, await assetPathsForProject(projectId));
    const images = await renderPptxPreview(pptx);
    onPhase?.("vision", { attempt: attempt + 1 });
    const instruction = [
      "You review rendered PowerPoint slides against the user's request, as the author of the deck. First verify the rendering fulfills the requested intent: topic, requested slide count, required content, structure, and language. Then inspect every supplied slide image for text overflow, overlap, clipping, weak contrast, inconsistent alignment, excessive text, insufficient visual structure, and chart/table readability.",
      'Return ONLY one JSON object: {"summary":"short Japanese report of what you saw in the images","meetsIntent":true|false,"issues":["short Japanese issues, empty when none"],"operations":[...]}.',
      "Set meetsIntent false ONLY together with at least one fixing operation: if you list issues, you must return the operations that fix them. If the issues cannot be fixed with the allowed operations, set meetsIntent true and explain in issues. Use empty operations ONLY when meetsIntent is true and the deck renders cleanly. Every operation must use an exact UUID from this document context.",
      `User request: ${request.slice(0, REPLY_MAX)}`,
      plan ? `Approved concept plan (the intent to verify against): ${plan.slice(0, 3000)}` : "No approved plan; verify against the request directly.",
      `Current document: ${deckContext(reviewed)}`,
    ].join("\n");
    const result = await parseVisionReview(await requestVision(model, profile, instruction, images), reviewed, model, profile, instruction);
    rounds = attempt + 1;
    lastSummary = result.summary;
    lastMeets = result.meetsIntent;
    lastIssues = result.meetsIntent && !result.operations.length ? [] : result.issues;
    if (!result.operations.length) break;
    reviewed = applyOperations(reviewed, result.operations);
    fixed += result.operations.length;
  }
  return { deck: reviewed, report: { summary: lastSummary, issues: lastIssues, rounds, fixed, meetsIntent: lastMeets } };
}

export const DECK_CONTEXT_LIMIT = 48000;

// 上限を超える場合は文字列切り詰め→スライド後方削除の順で決定的に縮約し、常に妥当な JSON を返す。
export function deckContext(deck: Deck): string {
  const render = (textLimit: number, slideLimit: number): string => JSON.stringify({
    title: deck.title.slice(0, textLimit),
    theme: deck.theme,
    slides: deck.slides.slice(0, slideLimit).map((slide, index) => ({
      index: index + 1, id: slide.id, title: slideTitle(slide).slice(0, textLimit),
      elements: slide.elements.map((element) => ({
        ...element,
        ...(element.kind === "image" ? { assetId: element.assetId } : {}),
        ...(element.kind === "text" ? { text: element.text.slice(0, textLimit) } : {}),
      })),
    })),
  });
  for (const textLimit of [Number.POSITIVE_INFINITY, 2000, 800, 240, 60]) {
    const rendered = render(textLimit, deck.slides.length);
    if (rendered.length <= DECK_CONTEXT_LIMIT) return rendered;
  }
  for (let slideLimit = deck.slides.length - 1; slideLimit >= 1; slideLimit--) {
    const rendered = render(60, slideLimit);
    if (rendered.length <= DECK_CONTEXT_LIMIT) return rendered;
  }
  return render(24, 1);
}

export const SYSTEM_PROMPT = `You edit a PowerPoint presentation through a typed document model. Return ONLY one JSON object: {"reply":"short Japanese explanation","operations":[...]}.
Never return JavaScript or Markdown. Use exact UUIDs supplied in the document context. Do not invent existing slide or element IDs.
The canvas is 13.333 x 7.5 inches. Coordinates and dimensions must remain within it. Colors use #RRGGBB.

Layout options for slide blueprints:
- "title": Presentation cover.
- "bullets": Standard title + bullet points.
- "twoColumn": Side-by-side comparison or 2 columns with divider.
- "cards": 3-4 feature cards, each with icon, title, and body text. Recommended for key features, strengths, benefits, or offerings.
- "steps": 2-5 sequential process steps connected by arrows. Recommended for workflows, timelines, roadmaps, and step-by-step guides.
- "kpi": 2-4 large numeric metric highlights with labels and notes. Recommended for achievements, statistics, performance, and targets.
- "comparison": 2 structured cards (e.g. Current vs Proposed, Before/After, Pros/Cons).
- "chart": Bar, line, or pie chart.
- "table": Structured data table.
- "section": Full-color section break slide.

Allowed operations:
- {"type":"replaceDeck","title":"...","slides":[{"layout":"title|bullets|twoColumn|chart|table|section|steps|cards|kpi|comparison","title":"...","subtitle":"...","bullets":["..."],"rightBullets":["..."],"cards":[{"title":"...","body":"...","icon":"Rocket|Shield|Zap|Target|Users|Check|..."}],"steps":[{"stepNumber":1,"title":"...","body":"..."}],"kpis":[{"value":"150%","unit":"社","label":"...","note":"..."}],"comparison":{"left":{"title":"...","bullets":["..."],"tag":"Before"},"right":{"title":"...","bullets":["..."],"tag":"After"}},"chart":{"type":"bar|line|pie","series":[{"name":"...","labels":["..."],"values":[1]}]},"table":[["..."]]}]}
- {"type":"addSlide","slide":{same slide fields},"index":0}
- {"type":"deleteSlide","slideId":"uuid"}
- {"type":"reorderSlide","slideId":"uuid","toIndex":0}
- {"type":"addShape","slideId":"uuid","shape":"<shape>","x":1,"y":1,"w":2,"h":1,"fill":"#3156D3","stroke":"#182230","arrowHead":"none|start|end|both","rotation":0}
  <shape> choices by category:
  - Basic: rect, roundRect, ellipse, line, triangle, diamond, hexagon, pentagon, octagon, parallelogram, trapezoid, star4, star5, star6, plus, donut, heart, sun, frame, plaque, corner
  - Arrows: rightArrow, leftArrow, upArrow, downArrow, leftRightArrow, upDownArrow, chevron, bentArrow, bentUpArrow, curvedRightArrow, curvedLeftArrow, quadArrow, circularArrow (arrowHead applies only to "line")
  - Callouts: callout, wedgeRectCallout, cloudCallout, leftArrowCallout, rightArrowCallout
  - Flowchart: flowChartTerminator (start/end), flowChartProcess (process box), flowChartDecision (branch), flowChartInputOutput (I/O), flowChartPredefinedProcess, flowChartDocument, flowChartMultidocument, flowChartInternalStorage, flowChartConnector (circle), flowChartOffpageConnector, flowChartManualInput, flowChartPreparation, flowChartDelay, flowChartMerge, flowChartCollate, flowChartSort, flowChartSummingJunction (merge point), flowChartOr, flowChartExtract
- {"type":"addIcon","slideId":"uuid","name":"LucideIconName (e.g. Rocket, Shield, Target, Zap, Users, Clock, Lightbulb, Award)","x":1,"y":1,"w":1,"h":1,"color":"#3156D3","rotation":0}
- {"type":"deleteElement","slideId":"uuid","elementId":"uuid"}
- {"type":"reorderElement","slideId":"uuid","elementId":"uuid","action":"bringToFront|sendToBack|bringForward|sendBackward"}
- {"type":"updateText","slideId":"uuid","elementId":"uuid","text":"..."}
- {"type":"moveElement","slideId":"uuid","elementId":"uuid","x":1,"y":1}
- {"type":"resizeElement","slideId":"uuid","elementId":"uuid","w":5,"h":1}
- {"type":"updateStyle","slideId":"uuid","elementId":"uuid","fontSize":24,"color":"#182230","bold":true,"fill":"#3156D3","stroke":"#DDE3EA","rotation":0}
- {"type":"updateTable","slideId":"uuid","elementId":"uuid","rows":[["..."]]}
- {"type":"updateChart","slideId":"uuid","elementId":"uuid","series":[{"name":"...","labels":["..."],"values":[1]}]}
- {"type":"updateImageProps","slideId":"uuid","elementId":"uuid","objectFit":"contain|cover|fill","borderRadius":0.1,"stroke":"#3156D3|null"}
- {"type":"setTheme","primary":"#3156D3","accent":"#65A9F0","background":"#FFFFFF","text":"#182230","fontFace":"Aptos"}

Design guidelines:
- The theme in the Current document is binding. Color every new slide and element only with the theme's primary, accent, text, and background colors, and use theme.fontFace for all text. Never introduce off-theme colors, and do not use setTheme unless the user explicitly asks for a theme change.
- Design visual-first. Before creating each content slide, identify the information structure and choose the matching visual layout: 'cards' for categories, features, or benefits; 'steps' for processes, timelines, or roadmaps; 'kpi' for headline metrics; 'comparison' for before/after, alternatives, pros/cons; 'chart' for meaningful numeric trends or distributions; 'table' for exact multi-item comparisons.
- Prefer a visual layout over 'bullets' or 'twoColumn'. Use 'bullets' only when the user explicitly requests a text-centric slide or no supported visual structure fits the content.
- For a new deck, at least two thirds of non-cover slides must use 'cards', 'steps', 'kpi', 'comparison', 'chart', or 'table'. Mix appropriate layouts instead of repeatedly using one layout.
- Use charts only with concrete numeric data from the user or document context. Never invent numbers merely to add a chart; use cards, steps, comparison, or icons instead.
- When using 'cards', select relevant Lucide icon names (e.g. Shield for security, Zap for speed, Target for goals, Users for teams, Rocket for launch/growth, Clock for time saving).
- Build custom diagrams with addShape when the content has structure. For process and decision flows, compose flowchart shapes (flowChartTerminator for start/end, flowChartProcess for steps, flowChartDecision for branches, flowChartDocument for data, flowChartConnector for junctions) and connect them with line shapes using arrowHead:"end". Place a short text element on top of each shape as its label. Use callout shapes to highlight key points, star/plus to emphasize highlights, and quadArrow or leftRightArrow to show relationships.
 - For a new deck, create 3-6 varied, visually engaging slides with specific, concise Japanese content.
 - Reply and operations must agree.

Proactive proposal rule:
 - Do not silently invent unspecified user requirements. When the request leaves meaningful choices open (target audience, tone, length, visual style, content emphasis, naming, data), return {"reply":"short Japanese comment","questions":["1-3 concrete Japanese proposals or questions, each offering 2-3 options","..."],"operations":[]} and change nothing.
 - Propose options in the questions instead of deciding alone, e.g. "色はテーマ基調の青と緑のどちらがよいですか?".
 - Ask only for choices that materially change the deck; never ask when the request is already clear.
 - When the user answers, confirms, says "おまかせ", "作成して", "その場で", or clearly authorizes proceeding, generate the deck immediately with sensible defaults and state those assumptions in the reply. Do not ask again.`;

export async function generateOperations(projectId: string, deck: Deck, request: string, modelId: string, target?: { slideId?: string; elementId?: string }, plan?: string | null, onPhase?: PhaseReporter): Promise<AIResult & { compacted?: boolean; reviewedDeck?: Deck; review?: DeckReviewReport; policy?: undefined }> {
  const profile = await getModel(modelId);
  if (!profile) throw new DocumentError("AI モデルを選択してください。");
  if (profile.provider === "demo") throw new DocumentError("Vision 対応を確認したモデルを選択してください。");
  if (!profile.visionSupported) throw new DocumentError("選択したモデルは Vision 疎通テストに合格していません。AI 設定で接続を確認してください。");
  const model = modelFor(profile);
  const fixedPrompt = `${SYSTEM_PROMPT}\nSelected target: ${JSON.stringify(target ?? {})}\nCurrent document: ${deckContext(deck)}`;
  const pending = { id: crypto.randomUUID(), role: "user" as const, content: request,
    metadata: { modelId, target }, createdAt: new Date().toISOString() };
  onPhase?.("context");
  const context = await prepareConversationContext(projectId, profile, fixedPrompt, async (instruction, maxOutputTokens) => {
    try {
      const result = await generateText({ model, prompt: instruction, maxOutputTokens, ...samplingFor(profile), abortSignal: AbortSignal.timeout(GENERATE_TIMEOUT_MS) });
      return result.text;
    } catch (error) {
      if (isTimeoutError(error)) throw timeoutDocumentError();
      throw error;
    }
  }, pending);
  const planPrompt = plan ? `Approved concept plan (strictly follow its structure, slide titles, and messaging when generating slides):\n${plan}\n\n` : "";
  const prompt = `${planPrompt}Selected target: ${JSON.stringify(target ?? {})}\nCurrent document (source of truth): ${deckContext(deck)}\n\n${context.text}\n\n${deck.slides.length ? "Edit the existing document. The latest user message is the request to answer." : "The document is empty. Create it with replaceDeck."}`;
  let issue = "";
  let repair = "";
  let previous = "";
  for (let attempt = 0; attempt < REPAIR_ATTEMPTS; attempt++) {
    onPhase?.(attempt === 0 ? "generating" : "repair", { attempt: attempt + 1 });
    let text: string;
    try {
      const result = await generateText({
        model, system: SYSTEM_PROMPT,
        prompt: repair ? `${prompt}\n\nYour previous reply:\n${previous.slice(0, REPLY_MAX)}\n\n${repair}` : prompt,
        maxOutputTokens: generationOutputTokens(profile),
        ...samplingFor(profile),
        abortSignal: AbortSignal.timeout(GENERATE_TIMEOUT_MS),
      });
      text = result.text;
    } catch (error) {
      if (isTimeoutError(error)) throw timeoutDocumentError();
      throw error;
    }
    try {
      const raw = extractJSON(text) as { reply?: unknown; operations?: unknown; questions?: unknown };
      const parsed = OutputSchema.parse({
        reply: clampReply(typeof raw.reply === "string" ? raw.reply : ""),
        operations: Array.isArray(raw.operations) ? raw.operations : [],
        questions: Array.isArray(raw.questions) ? raw.questions : [],
      });
      if (!parsed.operations.length && !parsed.reply.trim()) throw new DocumentError("応答が空です。依頼を具体化してください。");
      const generatedDeck = parsed.operations.length ? applyOperations(deck, parsed.operations) : deck;
      if (!parsed.operations.length) return { ...parsed, compacted: context.compacted };
      // ADR-0001: 小修正も含め操作のある生成は必ず Vision レビューを通す。即適用可否は chat route が isSmallAIEdit で判断する。
      const reviewedResult = await reviewDeck(projectId, generatedDeck, model, profile, request, plan ?? null, onPhase);
      return { ...parsed, compacted: context.compacted, reviewedDeck: reviewedResult.deck, review: reviewedResult.report };
    } catch (error) {
      if (error instanceof DocumentError && error.status !== 400) throw error;
      issue = error instanceof Error ? error.message.slice(0, 600) : "unknown validation error";
      const stalled = normalizeReply(text) === normalizeReply(previous);
      previous = text;
      repair = repairFeedback(error, deck);
      console.warn(`[ai] 検証失敗をモデルへ返して修復 attempt=${attempt + 1}/${REPAIR_ATTEMPTS} modelId=${modelId} issue=${issue}`);
      if (stalled) break;
    }
  }
  throw validationFailureError(issue, "operations", modelId);
}

export const TOOL_LOOP_MAX_STEPS = 10;
export const TOOL_LOOP_MAX_DURATION_MS = 900000;
export const TOOL_LOOP_MAX_TOTAL_TOKENS = 120000;
const TOOL_LOOP_DEFAULT_CONTEXT_TOKENS = 32768;

type TokenUsageStep = { usage: { totalTokens: number | undefined } };

export function toolLoopTokenBudget(profile: ModelConfig): number {
  const contextWindow = profile.contextWindow ?? TOOL_LOOP_DEFAULT_CONTEXT_TOKENS;
  return Math.min(TOOL_LOOP_MAX_TOTAL_TOKENS, contextWindow * 2);
}

export function tokenUsageExceedsBudget(steps: readonly TokenUsageStep[], maxTokens: number): boolean {
  const used = steps.reduce((total, step) => total + (step.usage.totalTokens ?? 0), 0);
  return used >= maxTokens;
}

export const TOOL_LOOP_SYSTEM_PROMPT = `Read first, then edit. You change a PowerPoint presentation only by calling the supplied tools.
You never write JavaScript, Markdown, shell commands, SQL, file paths, or any other executable code, and you never ask a runtime to execute code for you.
Work in this order: read, edit, inspect, commit.
- Read with get_deck_summary, then get_slide for the slide you intend to change. Use only the slideId and elementId values that the read tools returned. Never invent an id.
- Edit with the typed tools only: edit_elements for text, position, size, and style changes on existing elements; write_slide to replace one whole slide; reflow_slide for an allowed alignment or distribution rule. Element edits on a single slide are applied automatically, and write or reflow changes are presented as a proposal.
- Inspect with inspect_layout after each edit, and with inspect_visual after render_slide whenever the request concerns visual quality such as emphasis, spacing, alignment, imagery, or readability. Use render_slide when you need to see the rendered slide. inspect_visual never changes the deck.
- Finish with an explicit commit_changes call carrying a short Japanese reply. Nothing is applied until commit_changes succeeds. When you have made no change, do not call commit_changes.
The canvas is 13.333 x 7.5 inches, coordinates stay inside it, and colors use #RRGGBB. The document theme is binding; do not change the theme unless the user explicitly asks.
Do not paste the deck, the rendered image, or an editing protocol into your text. Use the tools to read the deck and use commit_changes to finish.`;

// ツールループでは deck 全文を prompt へ入れない。概要は read ツールで取得させる。
function toolLoopDeckBrief(deck: Deck, target?: { slideId?: string; elementId?: string }): string {
  return JSON.stringify({
    title: deck.title,
    slideCount: deck.slides.length,
    slides: deck.slides.map((slide, index) => ({ index: index + 1, id: slide.id, title: slideTitle(slide).slice(0, 80) })),
    selectedTarget: { slideId: target?.slideId ?? null, elementId: target?.elementId ?? null },
  });
}

export type ToolLoopActivityEvent =
  | { kind: "step"; step: number }
  | { kind: "reasoning"; text: string }
  | { kind: "text"; text: string }
  | { kind: "tool"; status: "start" | "result" | "error"; tool: string; callId: string; args?: string; summary?: string };

export type ActivityReporter = (event: ToolLoopActivityEvent) => void;

// AI SDK fullStream の part を UI 配信用の最小構造へ緩く構造化する。
export type ToolLoopStreamPart = {
  type: string;
  text?: string;
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
  error?: unknown;
};

const ACTIVITY_FLUSH_CHARS = 160;
const ACTIVITY_PAYLOAD_MAX = 400;

function summarizeActivityPayload(value: unknown): string {
  let raw: string;
  if (typeof value === "string") raw = value;
  else if (value instanceof Error) raw = value.message;
  else {
    try { raw = JSON.stringify(value) ?? String(value); } catch { raw = "unserializable payload"; }
  }
  return raw.length > ACTIVITY_PAYLOAD_MAX ? `${raw.slice(0, ACTIVITY_PAYLOAD_MAX - 1)}…` : raw;
}

// 実行中の思考・返答・ツール実行を、境界で束ねた最小イベントとして UI へ配信する。
export function createToolLoopActivityFeed(emit: ActivityReporter) {
  let step = 0;
  let reasoning = "";
  let text = "";
  const flushReasoning = () => {
    if (!reasoning) return;
    emit({ kind: "reasoning", text: reasoning });
    reasoning = "";
  };
  const flushText = () => {
    if (!text) return;
    emit({ kind: "text", text });
    text = "";
  };
  return {
    onPart(part: ToolLoopStreamPart): void {
      switch (part.type) {
        case "start-step":
          flushReasoning();
          flushText();
          step += 1;
          emit({ kind: "step", step });
          break;
        case "reasoning-delta":
          flushText();
          reasoning += part.text ?? "";
          if (reasoning.length >= ACTIVITY_FLUSH_CHARS) flushReasoning();
          break;
        case "reasoning-end":
          flushReasoning();
          break;
        case "text-delta":
          flushReasoning();
          text += part.text ?? "";
          if (text.length >= ACTIVITY_FLUSH_CHARS) flushText();
          break;
        case "text-end":
          flushText();
          break;
        case "tool-call":
          flushReasoning();
          flushText();
          emit({ kind: "tool", status: "start", tool: part.toolName ?? "", callId: part.toolCallId ?? "", args: summarizeActivityPayload(part.input) });
          break;
        case "tool-result":
          emit({ kind: "tool", status: "result", tool: part.toolName ?? "", callId: part.toolCallId ?? "", summary: summarizeActivityPayload(part.output) });
          break;
        case "tool-error":
          emit({ kind: "tool", status: "error", tool: part.toolName ?? "", callId: part.toolCallId ?? "", summary: summarizeActivityPayload(part.error) });
          break;
      }
    },
    flush(): void {
      flushReasoning();
      flushText();
    },
  };
}

function reportToolEvent(onPhase: PhaseReporter | undefined, event: ToolEventRecord, startedAt: Map<string, number>): void {
  if (event.status === "start") startedAt.set(event.tool, Date.now());
  const started = startedAt.get(event.tool);
  const durationMs = started === undefined ? 0 : Date.now() - started;
  // 秘密や文面をログへ出さず、対象 ID と件数だけを構造化して残す。
  console.log(`[ai] tool=${event.tool} status=${event.status} durationMs=${durationMs} slideId=${event.slideId ?? "-"} operationCount=${event.operationCount ?? 0} policy=${event.policy ?? "-"}`);
  onPhase?.("tool", { tool: event.tool, status: event.status });
  if (event.status !== "start") startedAt.delete(event.tool);
}

async function requestVisualInsight(
  model: LanguageModel, profile: ModelConfig, image: Buffer, slideId: string, intent: string,
): Promise<VisualInsight> {
  const instruction = [
    "You inspect one rendered PowerPoint slide image against the user's intent, as the author of the deck.",
    "Judge text overflow, overlap, clipping, weak contrast, inconsistent alignment, excessive text, missing visual structure, and image readability.",
    'Return ONLY one JSON object: {"summary":"short Japanese report of what you saw","issues":["short Japanese issues, empty when none"],"meetsIntent":true|false}.',
    `Rendered slide id: ${slideId}`,
    `User intent: ${intent.slice(0, 500)}`,
  ].join("\n");
  const text = await requestVision(model, profile, instruction, [image]);
  return VisualInsightSchema.parse(extractJSON(text));
}

export type ToolLoopResult = AIResult & { compacted: boolean; reviewedDeck?: Deck; review?: DeckReviewReport; policy?: PolicyDecision };

// Phase 3B: AI SDK のツールループで読み取り -> 編集 -> 検査 -> commit_changes を実行する。
export async function generateToolLoopOperations(
  projectId: string,
  deck: Deck,
  baseVersion: number,
  request: string,
  modelId: string,
  target?: { slideId?: string; elementId?: string },
  plan?: string | null,
  onPhase?: PhaseReporter,
  onActivity?: ActivityReporter,
): Promise<ToolLoopResult> {
  const profile = await getModel(modelId);
  if (!profile) throw new DocumentError("AI モデルを選択してください。");
  if (profile.provider === "demo") throw new DocumentError("ツールループはデモモードで実行できません。Vision 対応を確認したモデルを選択してください。");
  if (!profile.visionSupported) throw new DocumentError("選択したモデルは Vision 疎通テストに合格していません。AI 設定で接続を確認してください。");
  if (!isToolLoopEnabled(process.env, deck)) throw new DocumentError("ツールループは有効ではありません。");
  const model = modelFor(profile);
  const workingCopy = createWorkingCopy(deck, baseVersion);
  const inspectionDeps: InspectionDeps = {
    // render は対象スライド 1 件に絞った deck を PPTX 化し、先頭画像を返す。
    render: async (scopedDeck) => {
      const pptx = await buildPptx(scopedDeck, await assetPathsForProject(projectId));
      const images = await renderPptxPreview(pptx);
      const image = images[0];
      if (!image) throw new DocumentError("スライドの画像を生成できませんでした。", 502);
      return image;
    },
    vision: ({ image, slideId, intent }) => requestVisualInsight(model, profile, image, slideId, intent),
  };
  const runtime = createInspectionRuntime(inspectionDeps, { visionSupported: profile.visionSupported });
  const budget = createAgentRunBudget({ maxSteps: TOOL_LOOP_MAX_STEPS, maxDurationMs: TOOL_LOOP_MAX_DURATION_MS, now: () => Date.now() });
  const toolStarts = new Map<string, number>();
  const runContext = {
    workingCopy,
    runtime,
    budget,
    onToolEvent: (event: ToolEventRecord) => reportToolEvent(onPhase, event, toolStarts),
  };
  const registry = createAgentToolRegistry(runContext);
  const tools = getAgentToolSet(registry);
  const tokenBudget = toolLoopTokenBudget(profile);
  const brief = toolLoopDeckBrief(deck, target);
  const fixedPrompt = `${TOOL_LOOP_SYSTEM_PROMPT}\nDeck overview (use the read tools for details): ${brief}`;
  const pending = { id: crypto.randomUUID(), role: "user" as const, content: request,
    metadata: { modelId, mode: "tool-loop", target }, createdAt: new Date().toISOString() };
  onPhase?.("context");
  const context = await prepareConversationContext(projectId, profile, fixedPrompt, async (instruction, maxOutputTokens) => {
    try {
      const result = await generateText({ model, prompt: instruction, maxOutputTokens, ...samplingFor(profile), abortSignal: AbortSignal.timeout(GENERATE_TIMEOUT_MS) });
      return result.text;
    } catch (error) {
      if (isTimeoutError(error)) throw timeoutDocumentError();
      throw error;
    }
  }, pending);
  const planPrompt = plan ? `Approved concept plan (strictly follow its structure, slide titles, and messaging when editing):\n${plan}\n\n` : "";
  const prompt = `${planPrompt}Deck overview (source of truth; read ids with the tools): ${brief}\nSelected target: ${JSON.stringify(target ?? {})}\n\n${context.text}\n\nLatest user request: ${request}\nRead the deck with the tools, make the edits, inspect them, and end with commit_changes.`;
  onPhase?.("generating", { attempt: 1 });
  const activity = createToolLoopActivityFeed((event) => onActivity?.(event));
  let runText = "";
  let runTotalTokens = 0;
  let runSteps: readonly TokenUsageStep[] = [];
  let runFinishReason = "";
  try {
    const result = streamText({
      model,
      system: fixedPrompt,
      prompt,
      tools,
      stopWhen: [
        hasToolCall("commit_changes"),
        stepCountIs(TOOL_LOOP_MAX_STEPS),
        ({ steps }) => tokenUsageExceedsBudget(steps, tokenBudget),
        () => isAgentBudgetExhausted(runContext),
      ],
      maxOutputTokens: generationOutputTokens(profile),
      ...toolLoopSampling(profile),
      abortSignal: AbortSignal.timeout(TOOL_LOOP_MAX_DURATION_MS),
      timeout: { totalMs: TOOL_LOOP_MAX_DURATION_MS },
    });
    for await (const part of result.fullStream) activity.onPart(part);
    activity.flush();
    const [text, usage, steps, finishReason] = await Promise.all([result.text, result.usage, result.steps, result.finishReason]);
    runText = text;
    runTotalTokens = usage.totalTokens ?? 0;
    runSteps = steps;
    runFinishReason = finishReason;
  } catch (error) {
    activity.flush();
    if (isTimeoutError(error)) throw timeoutDocumentError();
    throw error;
  }
  const state = finalizeAgentRunState(runContext);
  console.log(`[ai] toolLoop finishReason=${runFinishReason} committed=${state.commitRequested} steps=${runSteps.length} totalTokens=${runTotalTokens} tokenBudget=${tokenBudget}`);
  const textReply = clampReply(runText.trim());
  if (!state.commitRequested) {
    // commit されていない実行の operations は採用しない。
    const exhausted = tokenUsageExceedsBudget(runSteps, tokenBudget);
    return {
      reply: textReply || (exhausted
        ? "AI の実行が token 予算に達したため、変更を適用しませんでした。対象を絞って再試行してください。"
        : "変更を適用できませんでした。依頼を具体的にしてください。"),
      operations: [],
      questions: [],
      compacted: context.compacted,
    };
  }
  const reply = clampReply(state.reply ?? textReply);
  return {
    reply,
    operations: state.operations,
    questions: [],
    compacted: context.compacted,
    reviewedDeck: state.workingDeck ?? undefined,
    policy: state.policy ?? undefined,
  };
}

export async function testModelConnection(modelId: string): Promise<{ reply: string; visionSupported: boolean }> {
  const profile = await getModel(modelId);
  if (!profile) throw new DocumentError("AI モデルが設定されていません。");
  if (profile.provider === "demo") throw new DocumentError("デモモードは Vision レビューに対応していません。");
  try {
    const response = await requestVision(modelFor(profile), profile, "Inspect the supplied image. Return ONLY a JSON object with its dominantColor value. Do not guess; use the image content.", [VISION_PROBE_PNG]);
    if (!parseVisionProbe(response)) throw new Error("Vision probe response did not match the image.");
    await recordVisionStatus(modelId, true);
    return { reply: "画像入力と内容認識を確認しました。", visionSupported: true };
  } catch (error) {
    await recordVisionStatus(modelId, false);
    if (error instanceof DocumentError) throw error;
    throw new DocumentError("画像を送信して内容を確認できませんでした。Vision 対応モデルまたは接続設定を確認してください。", 400);
  }
}

const PlanOutputSchema = z.object({
  reply: z.string().max(600).default(""),
  plan: z.string().min(10).max(3000).optional(),
  questions: z.array(z.string().trim().min(3).max(200)).max(3).default([]),
});
export type PlanResult = { reply: string; plan: string | null; questions: string[] };

export const PLAN_SYSTEM_PROMPT = `You plan a PowerPoint presentation before any slides are created. Return ONLY one JSON object: {"reply":"short Japanese comment on the concept (max 300 chars)","plan":"Japanese concept plan"}.
Never return JavaScript, Markdown fences, presentation operations, slide element coordinates, colors, or UUIDs.
The plan must be plain Japanese text with exactly these section headings on their own lines:
## 目的と読者
## コンセプト
## スライド構成
## テーマとデザイン方針
Under ## スライド構成, list numbered slides (3-10), each as "N. 見出し — 一行の要点 — 推奨レイアウト" choosing from title|bullets|twoColumn|cards|steps|kpi|comparison|chart|table|section.
Under ## テーマとデザイン方針, base the color and font guidance on the theme in the Current document; never invent a new palette.
When a previous plan exists in the conversation, revise it with the user's feedback instead of starting over, and keep the same headings.
Do not force a one-shot plan. When the request leaves key choices open (target audience details, tone, style, slide count, color scheme, available data, occasion), first ask 1-3 short Japanese questions instead of writing a plan: return ONLY {"reply":"short Japanese comment (max 300 chars)","questions":["specific Japanese question with concrete options",...]} and NO plan field. Ask only about choices that materially change the deck, and prefer answering from context when the request is already clear.
When the conversation contains the user's answers to your questions, incorporate them and return the plan with the required headings.
Keep the whole plan under 1500 Japanese characters.`;

export function buildDemoPlan(deck: Deck, request: string): PlanResult {
  const topic = request.replace(/\s+/g, " ").slice(0, 60) || "新サービスのご提案";
    const plan = [
      "## 目的と読者",
    `${topic}を意思決定者に伝え、次ステップへの合意を得る。`,
    "## コンセプト",
    "課題提示から価値・プロセス・成果の順で、定量表現を交えて納得逐步形成する。",
    "## スライド構成",
    `1. 表紙：${topic} — 提案の一言メッセージ — title`,
    "2. 課題と背景 — 現状のペインと機会 — bullets",
    "3. 提案の柱 — 3 つの中核価値 — cards",
    "4. 導入プロセス — 3 ステップの進め方 — steps",
    "5. 期待される成果 — 主要指標と効果 — kpi",
    "6. 次のステップ — 決定事項と予定 — bullets",
    "## テーマとデザイン方針",
    `現テーマ「${deck.theme.name}」の基調色 ${deck.theme.primary} と強調色 ${deck.theme.accent} を使用し、${deck.theme.fontFace} で統一する。`,
  ].join("\n");
  return { reply: "デモ構成案を作成しました。内容を確認し、「この構成を計画として採用」を押してから作成に進めます。", plan, questions: [] };
}

export async function generatePlan(projectId: string, deck: Deck, request: string, modelId: string, onPhase?: PhaseReporter): Promise<PlanResult & { compacted?: boolean }> {
  const profile = await getModel(modelId);
  if (!profile) throw new DocumentError("AI モデルを選択してください。");
  if (profile.provider === "demo") return buildDemoPlan(deck, request);
  const model = modelFor(profile);
  const fixedPrompt = `${PLAN_SYSTEM_PROMPT}\nCurrent document: ${deckContext(deck)}`;
  const pending = { id: crypto.randomUUID(), role: "user" as const, content: request,
    metadata: { modelId, mode: "plan" }, createdAt: new Date().toISOString() };
  onPhase?.("context");
  const context = await prepareConversationContext(projectId, profile, fixedPrompt, async (instruction, maxOutputTokens) => {
    try {
      const result = await generateText({ model, prompt: instruction, maxOutputTokens, ...samplingFor(profile), abortSignal: AbortSignal.timeout(GENERATE_TIMEOUT_MS) });
      return result.text;
    } catch (error) {
      if (isTimeoutError(error)) throw timeoutDocumentError();
      throw error;
    }
  }, pending);
  const prompt = `Current document: ${deckContext(deck)}\n\n${context.text}\n\nUser request: ${request}\nCreate or revise the concept plan following the required headings.`;
  let issue = "";
  let repair = "";
  let previous = "";
  for (let attempt = 0; attempt < REPAIR_ATTEMPTS; attempt++) {
    onPhase?.(attempt === 0 ? "generating" : "repair", { attempt: attempt + 1 });
    let text: string;
    try {
      const result = await generateText({
        model, system: PLAN_SYSTEM_PROMPT,
        prompt: repair ? `${prompt}\n\nYour previous reply:\n${previous.slice(0, REPLY_MAX)}\n\n${repair}` : prompt,
        maxOutputTokens: generationOutputTokens(profile),
        ...samplingFor(profile),
        abortSignal: AbortSignal.timeout(GENERATE_TIMEOUT_MS),
      });
      text = result.text;
    } catch (error) {
      if (isTimeoutError(error)) throw timeoutDocumentError();
      throw error;
    }
    try {
      const raw = extractJSON(text) as { reply?: unknown; plan?: unknown; questions?: unknown };
      const parsed = PlanOutputSchema.parse({
        reply: clampReply(typeof raw.reply === "string" ? raw.reply : ""),
        ...(typeof raw.plan === "string" && raw.plan.trim() ? { plan: raw.plan.trim() } : {}),
        questions: Array.isArray(raw.questions) ? raw.questions : [],
      });
      if (!parsed.plan && !parsed.questions.length) throw new DocumentError("応答が空です。依頼を具体化してください。");
      return { reply: parsed.reply || (parsed.plan ? "構成案を作成しました。" : "いくつか確認させてください。"), plan: parsed.plan ?? null, questions: parsed.questions, compacted: context.compacted };
    } catch (error) {
      issue = error instanceof Error ? error.message.slice(0, 600) : "unknown validation error";
      const stalled = normalizeReply(text) === normalizeReply(previous);
      previous = text;
      repair = planRepairFeedback(error);
      console.warn(`[ai] 構成案検証失敗をモデルへ返して修復 attempt=${attempt + 1}/${REPAIR_ATTEMPTS} modelId=${modelId} issue=${issue}`);
      if (stalled) break;
    }
  }
  throw validationFailureError(issue, "plan", modelId);
}
