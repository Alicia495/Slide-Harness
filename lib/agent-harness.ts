import { tool, type ToolSet } from "ai";
import { z } from "zod";
import {
  DeckSchema,
  OperationSchema,
  SLIDE_H,
  SLIDE_W,
  SlideBlueprintSchema,
  SlideSchema,
  slideFromBlueprint,
  slideTitle,
  type Deck,
  type Element,
  type Operation,
  type Slide,
  type SlideBlueprint,
} from "./document";
import { applyOperations, DocumentError } from "./operations";

// Working Copy: 開始版に固定した作業コピー。正本 (sourceDeck) は読み取り専用で保持する。
export type WorkingCopy = {
  baseVersion: number;
  sourceDeck: Deck;
  deck: Deck;
  operations: Operation[];
  changeKinds: Operation["type"][];
};

// 各ツールは今回の呼び出しで生成した操作だけを返し、累積は Working Copy 側に残す。
export type ToolResult = {
  deck: Deck;
  operations: Operation[];
  changeKinds: Operation["type"][];
};

export type DeckSummary = {
  title: string;
  slides: { id: string; index: number; title: string; elementCount: number }[];
};

export type ElementPatch = {
  elementId: string;
  text?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  fontSize?: number;
  color?: string;
  bold?: boolean;
  rotation?: number;
};

export type ReflowRule =
  | { type: "alignRow"; elementIds: readonly string[]; y: number }
  | { type: "alignColumn"; elementIds: readonly string[]; x: number }
  | { type: "distributeHorizontally"; elementIds: readonly string[]; x: number; width: number }
  | { type: "distributeVertically"; elementIds: readonly string[]; y: number; height: number };

export type LayoutIssueKind = "overflow" | "overlap" | "smallText" | "denseText";

export type LayoutIssue = {
  kind: LayoutIssueKind;
  slideId: string;
  elementIds: string[];
  detail: string;
};

export type PolicyDecision = "auto" | "proposal";

export type VisualInsight = {
  summary: string;
  issues: string[];
  meetsIntent: boolean;
};

export type RenderFn = (deck: Deck) => Buffer | Promise<Buffer>;
export type VisionFn = (request: {
  image: Buffer;
  slideId: string;
  intent: string;
}) => VisualInsight | Promise<VisualInsight>;

export type InspectionDeps = {
  render: RenderFn;
  vision: VisionFn;
};

export type InspectionLimits = {
  maxRenderCalls?: number;
  maxVisionCalls?: number;
  visionSupported?: boolean;
};

export type InspectionRuntime = {
  deps: InspectionDeps;
  maxRenderCalls: number;
  maxVisionCalls: number;
  visionSupported: boolean;
  renderCalls: number;
  visionCalls: number;
  renderCache: Map<string, Buffer>;
};

export type ToolName = "read" | "edit" | "write" | "reflow" | "render" | "inspect" | "commit";

export type ChangeClassification = { tool: ToolName; operations: readonly Operation[] };

// 要素レベル操作のみ auto 候補。write / reflow / 構造操作は proposal。
const ELEMENT_LEVEL_TYPES: readonly Operation["type"][] = [
  "updateText", "moveElement", "resizeElement", "updateStyle", "updateImageProps", "reorderElement",
];

const OVERLAP_TOLERANCE = 0.01;
const OVERLAP_RATIO = 0.1;
const SMALL_FONT_SIZE = 10;
const DENSE_MIN_CHARS = 200;
const DENSE_RATIO = 1.25;
const LINE_SPACING = 1.3;
const LATIN_EM = 0.55;
// 装飾 shape / icon は意図的な重なりが多いため重複検査の対象にしない。
const CONTENT_KINDS: readonly Element["kind"][] = ["text", "table", "chart", "image"];
const DEFAULT_MAX_RENDER_CALLS = 3;
const DEFAULT_MAX_VISION_CALLS = 2;

export const VisualInsightSchema = z.object({
  summary: z.string().max(600),
  issues: z.array(z.string().max(400)).max(8),
  meetsIntent: z.boolean(),
});

export function createWorkingCopy(deck: Deck, baseVersion: number): WorkingCopy {
  if (!Number.isInteger(baseVersion) || baseVersion < 0) throw new DocumentError("基準版番号が不正です。");
  return {
    baseVersion,
    sourceDeck: structuredClone(deck),
    deck: structuredClone(deck),
    operations: [],
    changeKinds: [],
  };
}

export function getDeckSummary(workingCopy: WorkingCopy): DeckSummary {
  return {
    title: workingCopy.deck.title,
    slides: workingCopy.deck.slides.map((slide, index) => ({
      id: slide.id,
      index,
      title: slideTitle(slide),
      elementCount: slide.elements.length,
    })),
  };
}

export function getSlide(workingCopy: WorkingCopy, slideId: string): Slide {
  const slide = workingCopy.deck.slides.find((item) => item.id === slideId);
  if (!slide) throw new DocumentError("対象のスライドが見つかりません。");
  return structuredClone(slide);
}

export function createInspectionRuntime(
  deps: InspectionDeps,
  limits: InspectionLimits = {},
): InspectionRuntime {
  return {
    deps,
    maxRenderCalls: positiveInteger(limits.maxRenderCalls ?? DEFAULT_MAX_RENDER_CALLS, "render 上限"),
    maxVisionCalls: positiveInteger(limits.maxVisionCalls ?? DEFAULT_MAX_VISION_CALLS, "Vision 上限"),
    visionSupported: limits.visionSupported ?? true,
    renderCalls: 0,
    visionCalls: 0,
    renderCache: new Map(),
  };
}

export async function renderSlide(
  workingCopy: WorkingCopy,
  slideId: string,
  runtime: InspectionRuntime,
): Promise<Buffer> {
  const slide = getSlide(workingCopy, slideId);
  const scopedDeck: Deck = { ...structuredClone(workingCopy.deck), slides: [slide] };
  const cacheKey = JSON.stringify({ theme: scopedDeck.theme, slide });
  const cached = runtime.renderCache.get(cacheKey);
  if (cached) return Buffer.from(cached);
  if (runtime.renderCalls >= runtime.maxRenderCalls) {
    throw new DocumentError("この実行で許可されたレンダリング回数を超えました。", 429);
  }
  runtime.renderCalls += 1;
  const image = await runtime.deps.render(scopedDeck);
  if (!Buffer.isBuffer(image)) throw new DocumentError("スライドの画像を生成できませんでした。", 502);
  runtime.renderCache.set(cacheKey, Buffer.from(image));
  return Buffer.from(image);
}

export async function inspectVisual(
  workingCopy: WorkingCopy,
  slideId: string,
  intent: string,
  runtime: InspectionRuntime,
): Promise<VisualInsight> {
  if (!runtime.visionSupported) throw new DocumentError("選択したモデルは Vision 検査に対応していません。", 400);
  if (runtime.visionCalls >= runtime.maxVisionCalls) {
    throw new DocumentError("この実行で許可された Vision 検査回数を超えました。", 429);
  }
  const normalizedIntent = intent.trim();
  if (!normalizedIntent) throw new DocumentError("視覚検査の意図を指定してください。");
  const image = await renderSlide(workingCopy, slideId, runtime);
  runtime.visionCalls += 1;
  return VisualInsightSchema.parse(await runtime.deps.vision({ image, slideId, intent: normalizedIntent }));
}

export function editElements(
  workingCopy: WorkingCopy,
  slideId: string,
  patches: readonly ElementPatch[],
): ToolResult {
  const slide = findSlide(workingCopy.deck, slideId);
  const operations: Operation[] = [];
  for (const patch of patches) {
    const element = slide.elements.find((item) => item.id === patch.elementId);
    if (!element) throw new DocumentError("対象の要素が見つかりません。");
    const start = operations.length;
    const posX = patch.x;
    const posY = patch.y;
    if ((posX === undefined) !== (posY === undefined)) throw new DocumentError("移動は x と y を組で指定してください。");
    if (posX !== undefined && posY !== undefined) {
      operations.push({ type: "moveElement", slideId, elementId: element.id, x: posX, y: posY });
    }
    const sizeW = patch.w;
    const sizeH = patch.h;
    if ((sizeW === undefined) !== (sizeH === undefined)) throw new DocumentError("サイズ変更は w と h を組で指定してください。");
    if (sizeW !== undefined && sizeH !== undefined) {
      operations.push({ type: "resizeElement", slideId, elementId: element.id, w: sizeW, h: sizeH });
    }
    if (patch.text !== undefined) {
      operations.push({ type: "updateText", slideId, elementId: element.id, text: patch.text });
    }
    const style = {
      fontSize: patch.fontSize,
      color: patch.color,
      bold: patch.bold,
      rotation: patch.rotation,
    };
    if (style.fontSize !== undefined || style.color !== undefined || style.bold !== undefined || style.rotation !== undefined) {
      // 要素 kind に合わないスタイル指定は applyOperations 側の検証に委ねる。
      operations.push({ type: "updateStyle", slideId, elementId: element.id, ...style });
    }
    if (operations.length === start) throw new DocumentError("適用可能な変更がありません。");
  }
  return applyToWorkingCopy(workingCopy, operations);
}

export function writeSlide(
  workingCopy: WorkingCopy,
  slideId: string,
  blueprint: SlideBlueprint,
): ToolResult {
  const index = workingCopy.deck.slides.findIndex((item) => item.id === slideId);
  if (index < 0) throw new DocumentError("対象のスライドが見つかりません。");
  const generated = slideFromBlueprint(blueprint, workingCopy.deck.theme, index);
  const operation: Operation = { type: "replaceSlide", slideId, slide: { ...generated, id: slideId } };
  return applyToWorkingCopy(workingCopy, [operation]);
}

export function reflowSlide(
  workingCopy: WorkingCopy,
  slideId: string,
  rule: ReflowRule,
): ToolResult {
  const slide = findSlide(workingCopy.deck, slideId);
  const ids = [...rule.elementIds];
  if (ids.length < 2) throw new DocumentError("Reflow は 2 件以上の要素を指定してください。");
  if (new Set(ids).size !== ids.length) throw new DocumentError("Reflow 対象の要素 ID が重複しています。");
  // 全対象の存在を先に確認し、途中失敗で一部だけ適用される状態を避ける。
  const targets = ids.map((id) => {
    const element = slide.elements.find((item) => item.id === id);
    if (!element) throw new DocumentError("対象の要素が見つかりません。");
    return element;
  });
  const operations: Operation[] = [];
  switch (rule.type) {
    case "alignRow": {
      const y = coordinate(rule.y, "y");
      for (const element of targets) {
        operations.push({ type: "moveElement", slideId, elementId: element.id, x: element.x, y });
      }
      break;
    }
    case "alignColumn": {
      const x = coordinate(rule.x, "x");
      for (const element of targets) {
        operations.push({ type: "moveElement", slideId, elementId: element.id, x, y: element.y });
      }
      break;
    }
    case "distributeHorizontally": {
      const x = coordinate(rule.x, "x");
      const width = positive(rule.width, "width");
      const totalW = targets.reduce((sum, element) => sum + element.w, 0);
      const gap = (width - totalW) / (targets.length - 1);
      if (gap < 0) throw new DocumentError("要素を並べる幅が足りません。");
      let cursor = x;
      for (const element of targets) {
        operations.push({ type: "moveElement", slideId, elementId: element.id, x: cursor, y: element.y });
        cursor += element.w + gap;
      }
      break;
    }
    case "distributeVertically": {
      const y = coordinate(rule.y, "y");
      const height = positive(rule.height, "height");
      const totalH = targets.reduce((sum, element) => sum + element.h, 0);
      const gap = (height - totalH) / (targets.length - 1);
      if (gap < 0) throw new DocumentError("要素を並べる高さが足りません。");
      let cursor = y;
      for (const element of targets) {
        operations.push({ type: "moveElement", slideId, elementId: element.id, x: element.x, y: cursor });
        cursor += element.h + gap;
      }
      break;
    }
  }
  return applyToWorkingCopy(workingCopy, operations);
}

export function inspectLayout(deck: Deck, slideId: string): LayoutIssue[] {
  const slide = deck.slides.find((item) => item.id === slideId);
  if (!slide) throw new DocumentError("対象のスライドが見つかりません。");
  const issues: LayoutIssue[] = [];
  for (const element of slide.elements) {
    if (isOutOfBounds(element)) {
      issues.push({
        kind: "overflow",
        slideId,
        elementIds: [element.id],
        detail: `座標 (${round(element.x)}, ${round(element.y)}) サイズ (${round(element.w)} x ${round(element.h)}) がスライド範囲外です。`,
      });
    }
    if (element.kind === "text") {
      if (Number.isFinite(element.fontSize) && element.fontSize <= SMALL_FONT_SIZE) {
        issues.push({ kind: "smallText", slideId, elementIds: [element.id], detail: `文字サイズ ${element.fontSize} が小さすぎます。` });
      }
      const density = textDensity(element.text, element.w, element.h, element.fontSize);
      if (density !== null && density > DENSE_RATIO) {
        issues.push({ kind: "denseText", slideId, elementIds: [element.id], detail: `文字量 ${element.text.length} が領域に対して多すぎます。` });
      }
    }
  }
  const content = slide.elements.filter((element) => CONTENT_KINDS.includes(element.kind));
  for (let i = 0; i < content.length; i++) {
    for (let j = i + 1; j < content.length; j++) {
      const a = content[i];
      const b = content[j];
      const ratio = overlapRatio(a, b);
      if (ratio !== null && ratio >= OVERLAP_RATIO) {
        issues.push({
          kind: "overlap",
          slideId,
          elementIds: [a.id, b.id],
          detail: `実効矩形の重複が全体の ${Math.round(ratio * 100)}% です。`,
        });
      }
    }
  }
  return issues;
}

type ElementLevelOperation = Extract<Operation, {
  type: "updateText" | "moveElement" | "resizeElement" | "updateStyle" | "updateImageProps" | "reorderElement"
}>;

function isElementLevelOperation(operation: Operation): operation is ElementLevelOperation {
  return ELEMENT_LEVEL_TYPES.includes(operation.type);
}

export function classifyChanges({ tool, operations }: ChangeClassification): PolicyDecision {
  if (tool !== "edit" || operations.length === 0) return "proposal";
  const slideIds = new Set<string>();
  for (const operation of operations) {
    if (!isElementLevelOperation(operation)) return "proposal";
    slideIds.add(operation.slideId);
  }
  return slideIds.size === 1 ? "auto" : "proposal";
}

function applyToWorkingCopy(workingCopy: WorkingCopy, operations: Operation[]): ToolResult {
  if (operations.length === 0) throw new DocumentError("適用する変更がありません。");
  if (workingCopy.operations.length + operations.length > MAX_WORKING_COPY_OPERATIONS) {
    throw new DocumentError("1 回の実行で扱える変更操作は 30 件までです。依頼を分割してください。", 429);
  }
  const deck = applyOperations(workingCopy.deck, operations);
  workingCopy.deck = deck;
  workingCopy.operations.push(...operations);
  for (const operation of operations) {
    if (!workingCopy.changeKinds.includes(operation.type)) workingCopy.changeKinds.push(operation.type);
  }
  return { deck, operations: [...operations], changeKinds: operations.map((operation) => operation.type) };
}

function findSlide(deck: Deck, slideId: string): Slide {
  const slide = deck.slides.find((item) => item.id === slideId);
  if (!slide) throw new DocumentError("対象のスライドが見つかりません。");
  return slide;
}

function coordinate(value: number, axis: "x" | "y"): number {
  const max = axis === "y" ? SLIDE_H : SLIDE_W;
  if (!Number.isFinite(value) || value < 0 || value > max) {
    throw new DocumentError(`移動先の ${axis} が範囲外です。`);
  }
  return value;
}

function positive(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new DocumentError(`${label} が不正です。`);
  return value;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new DocumentError(`${label}が不正です。`);
  return value;
}

function isOutOfBounds(element: Element): boolean {
  const { x, y, w, h } = element;
  if (![x, y, w, h].every((value) => Number.isFinite(value))) return true;
  return x < 0 || y < 0 || x + w > SLIDE_W + OVERLAP_TOLERANCE || y + h > SLIDE_H + OVERLAP_TOLERANCE;
}

// 実効矩形の重複面積を 2 つのうち小さい側の面積で割った比率。接触のみの除外。
function overlapRatio(a: Element, b: Element): number | null {
  if (![a.x, a.y, a.w, a.h, b.x, b.y, b.w, b.h].every((value) => Number.isFinite(value))) return null;
  const width = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (width <= OVERLAP_TOLERANCE || height <= OVERLAP_TOLERANCE) return null;
  const minArea = Math.min(a.w * a.h, b.w * b.h);
  if (minArea <= 0) return null;
  return (width * height) / minArea;
}

// em 基準の概算容量に対する使用量比率。CJK は 1 em、それ以外を 0.55 em として決定的に評価する。
function textDensity(text: string, w: number, h: number, fontSize: number): number | null {
  if (text.length < DENSE_MIN_CHARS) return null;
  if (!Number.isFinite(w) || !Number.isFinite(h) || !Number.isFinite(fontSize) || w <= 0 || h <= 0 || fontSize <= 0) return null;
  const emPerLine = (w * 72) / fontSize;
  const lines = Math.max(1, Math.floor((h * 72) / (fontSize * LINE_SPACING)));
  const capacity = emPerLine * lines;
  if (capacity <= 0) return null;
  let units = 0;
  for (const char of text) {
    units += isWideChar(char) ? 1 : LATIN_EM;
  }
  return units / capacity;
}

function isWideChar(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return (
    (code >= 0x1100 && code <= 0x115f)
    || (code >= 0x2e80 && code <= 0xa4cf)
    || (code >= 0xac00 && code <= 0xd7a3)
    || (code >= 0xf900 && code <= 0xfaff)
    || (code >= 0xfe30 && code <= 0xfe6f)
    || (code >= 0xff00 && code <= 0xff60)
    || (code >= 0xffe0 && code <= 0xffe6)
  );
}

function round(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : "NaN";
}

// --- Phase 3B: AI SDK ツールループの登録と実行予算 (ADR-0002) ---

export const AGENT_TOOL_NAMES = [
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

export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number];

export type ToolEventRecord = { status: "start" | "complete" | "error"; tool: string };
export type ToolEventReporter = (event: ToolEventRecord) => void;

// 1 実行あたりの予算。now は注入式時計で、時間判定を決定的にする。
export type AgentRunBudget = {
  maxSteps: number;
  maxDurationMs: number;
  startedAt: number;
  stepsUsed: number;
  now: () => number;
};

export type AgentRunContext = {
  workingCopy: WorkingCopy;
  runtime: InspectionRuntime;
  onToolEvent?: ToolEventReporter;
  budget?: AgentRunBudget;
};

export type AgentRunState = {
  commitRequested: boolean;
  budgetExhausted: boolean;
  operations: Operation[];
  workingDeck: Deck | null;
  policy: PolicyDecision | null;
  reply: string | null;
  toolsUsed: AgentToolName[];
};

type RunRecord = { context: AgentRunContext; state: AgentRunState };
type RawToolHandler = (input: Record<string, unknown>, record: RunRecord) => Promise<unknown>;

// AI SDK の Tool を、実行基盤の参照から引ける最小の参照型へ寄せる。
export type AgentToolHandle = { inputSchema: unknown; execute?: unknown };
export type AgentToolRegistry = Record<string, AgentToolHandle>;

const COMMIT_REPLY_MAX = 1200;
const TOOL_PATCH_MAX = 20;
const TOOL_ELEMENT_IDS_MAX = 24;
const MAX_WORKING_COPY_OPERATIONS = 30;

const ElementPatchSchema = z.object({
  elementId: z.uuid(),
  text: z.string().max(8000).optional(),
  x: z.number().finite().min(0).max(SLIDE_W).optional(),
  y: z.number().finite().min(0).max(SLIDE_H).optional(),
  w: z.number().finite().positive().max(SLIDE_W).optional(),
  h: z.number().finite().positive().max(SLIDE_H).optional(),
  fontSize: z.number().min(8).max(96).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  bold: z.boolean().optional(),
  rotation: z.number().min(0).max(360).optional(),
});

const ReflowRuleSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("alignRow"), elementIds: z.array(z.uuid()).min(2).max(TOOL_ELEMENT_IDS_MAX), y: z.number().finite().min(0).max(SLIDE_H) }),
  z.object({ type: z.literal("alignColumn"), elementIds: z.array(z.uuid()).min(2).max(TOOL_ELEMENT_IDS_MAX), x: z.number().finite().min(0).max(SLIDE_W) }),
  z.object({ type: z.literal("distributeHorizontally"), elementIds: z.array(z.uuid()).min(2).max(TOOL_ELEMENT_IDS_MAX), x: z.number().finite().min(0).max(SLIDE_W), width: z.number().finite().positive().max(SLIDE_W) }),
  z.object({ type: z.literal("distributeVertically"), elementIds: z.array(z.uuid()).min(2).max(TOOL_ELEMENT_IDS_MAX), y: z.number().finite().min(0).max(SLIDE_H), height: z.number().finite().positive().max(SLIDE_H) }),
]);

export const DeckSummarySchema = z.object({
  title: z.string(),
  slides: z.array(z.object({ id: z.string(), index: z.number(), title: z.string(), elementCount: z.number() })),
});

export const ToolResultSchema = z.object({
  deck: DeckSchema,
  operations: z.array(OperationSchema),
  changeKinds: z.array(z.string()),
});

export const LayoutIssueSchema = z.object({
  kind: z.enum(["overflow", "overlap", "smallText", "denseText"]),
  slideId: z.string(),
  elementIds: z.array(z.string()),
  detail: z.string(),
});

const CommitResultSchema = z.object({
  committed: z.literal(true),
  policy: z.enum(["auto", "proposal"]),
  operationCount: z.number().int().nonnegative(),
});

// 入力契約は Zod スキーマのみ。実行前に必ずここで検証する。
const toolInputSchemas = {
  get_deck_summary: z.object({}),
  get_slide: z.object({ slideId: z.uuid() }),
  edit_elements: z.object({ slideId: z.uuid(), patches: z.array(ElementPatchSchema).min(1).max(TOOL_PATCH_MAX) }),
  write_slide: z.object({ slideId: z.uuid(), blueprint: SlideBlueprintSchema }),
  render_slide: z.object({ slideId: z.uuid() }),
  inspect_layout: z.object({ slideId: z.uuid() }),
  inspect_visual: z.object({ slideId: z.uuid(), intent: z.string().trim().min(1).max(500) }),
  reflow_slide: z.object({ slideId: z.uuid(), rule: ReflowRuleSchema }),
  commit_changes: z.object({ reply: z.string().trim().min(1).max(COMMIT_REPLY_MAX) }),
};

function isWorkingCopyLike(value: unknown): boolean {
  if (!(value instanceof Object)) return false;
  return Array.isArray(Reflect.get(value, "operations"))
    && Array.isArray(Reflect.get(value, "changeKinds"))
    && typeof Reflect.get(value, "baseVersion") === "number"
    && DeckSchema.safeParse(Reflect.get(value, "deck")).success
    && DeckSchema.safeParse(Reflect.get(value, "sourceDeck")).success;
}

function isInspectionRuntimeLike(value: unknown): boolean {
  if (!(value instanceof Object)) return false;
  const deps = Reflect.get(value, "deps");
  return deps instanceof Object
    && typeof Reflect.get(deps, "render") === "function"
    && typeof Reflect.get(deps, "vision") === "function"
    && Reflect.get(value, "renderCache") instanceof Map
    && typeof Reflect.get(value, "renderCalls") === "number"
    && typeof Reflect.get(value, "visionCalls") === "number"
    && typeof Reflect.get(value, "visionSupported") === "boolean";
}

function isAgentRunBudgetLike(value: unknown): boolean {
  if (!(value instanceof Object)) return false;
  return typeof Reflect.get(value, "maxSteps") === "number"
    && typeof Reflect.get(value, "maxDurationMs") === "number"
    && typeof Reflect.get(value, "startedAt") === "number"
    && typeof Reflect.get(value, "stepsUsed") === "number"
    && typeof Reflect.get(value, "now") === "function";
}

const AgentRunContextSchema = z.looseObject({
  workingCopy: z.custom<WorkingCopy>(isWorkingCopyLike),
  runtime: z.custom<InspectionRuntime>(isInspectionRuntimeLike),
  onToolEvent: z.custom<ToolEventReporter>((value) => typeof value === "function").optional(),
  budget: z.custom<AgentRunBudget>(isAgentRunBudgetLike).optional(),
});

// 実行状態は context オブジェクトそのものをキーに共有する (Working Copy / Runtime を含む)。
const runRecords = new WeakMap<object, RunRecord>();
const registryRecords = new WeakMap<object, RunRecord>();
const registryToolSets = new WeakMap<object, ToolSet>();

function runRecordOf(context: unknown): RunRecord {
  if (!(context instanceof Object)) throw new DocumentError("実行コンテキストが不正です。");
  const record = runRecords.get(context);
  if (!record) throw new DocumentError("この実行の登録情報が見つかりません。");
  return record;
}

export function getAgentRunState(context: unknown): AgentRunState {
  return runRecordOf(context).state;
}

export function isAgentBudgetExhausted(context: unknown): boolean {
  return runRecordOf(context).state.budgetExhausted;
}

export function finalizeAgentRunState(context: unknown): AgentRunState {
  const record = runRecordOf(context);
  if (!record.state.commitRequested) return record.state;
  const { workingCopy } = record.context;
  record.state.operations = [...workingCopy.operations];
  record.state.workingDeck = structuredClone(workingCopy.deck);
  record.state.policy = commitPolicy(record);
  return record.state;
}

export function createAgentRunBudget(options: { maxSteps: number; maxDurationMs: number; now: () => number }): AgentRunBudget {
  return {
    maxSteps: positiveInteger(options.maxSteps, "step 上限"),
    maxDurationMs: positiveInteger(options.maxDurationMs, "時間上限"),
    startedAt: options.now(),
    stepsUsed: 0,
    now: options.now,
  };
}

export function assertAgentTime(budget: AgentRunBudget): void {
  if (budget.now() - budget.startedAt >= budget.maxDurationMs) {
    throw new DocumentError("実行時間の予算を超えました。", 504);
  }
}

export function consumeAgentStep(budget: AgentRunBudget): void {
  assertAgentTime(budget);
  if (budget.stepsUsed >= budget.maxSteps) {
    throw new DocumentError("実行ステップの予算を超えました。", 429);
  }
  budget.stepsUsed += 1;
}

export function isToolLoopEnabled(env: Record<string, string | undefined>, deck: Deck): boolean {
  return env.AI_TOOL_LOOP_ENABLED === "true" && deck.slides.length > 0;
}

// write / reflow は常に proposal。同一 slide の要素編集のみ auto を許す。
function commitPolicy(record: RunRecord): PolicyDecision {
  const { toolsUsed } = record.state;
  if (toolsUsed.includes("write_slide") || toolsUsed.includes("reflow_slide")) return "proposal";
  return classifyChanges({ tool: "edit", operations: record.context.workingCopy.operations });
}

const rawToolHandlersByTool: Record<AgentToolName, RawToolHandler> = {
  get_deck_summary: async (_input, record) => getDeckSummary(record.context.workingCopy),
  get_slide: async (input, record) => {
    const { slideId } = toolInputSchemas.get_slide.parse(input);
    return getSlide(record.context.workingCopy, slideId);
  },
  edit_elements: async (input, record) => {
    const { slideId, patches } = toolInputSchemas.edit_elements.parse(input);
    return editElements(record.context.workingCopy, slideId, patches);
  },
  write_slide: async (input, record) => {
    const { slideId, blueprint } = toolInputSchemas.write_slide.parse(input);
    return writeSlide(record.context.workingCopy, slideId, blueprint);
  },
  render_slide: async (input, record) => {
    const { slideId } = toolInputSchemas.render_slide.parse(input);
    return renderSlide(record.context.workingCopy, slideId, record.context.runtime);
  },
  inspect_layout: async (input, record) => {
    const { slideId } = toolInputSchemas.inspect_layout.parse(input);
    return inspectLayout(record.context.workingCopy.deck, slideId);
  },
  inspect_visual: async (input, record) => {
    const { slideId, intent } = toolInputSchemas.inspect_visual.parse(input);
    return inspectVisual(record.context.workingCopy, slideId, intent, record.context.runtime);
  },
  reflow_slide: async (input, record) => {
    const { slideId, rule } = toolInputSchemas.reflow_slide.parse(input);
    return reflowSlide(record.context.workingCopy, slideId, rule);
  },
  commit_changes: async (input, record) => {
    const { reply } = toolInputSchemas.commit_changes.parse(input);
    const { workingCopy } = record.context;
    const state = record.state;
    state.commitRequested = true;
    state.reply = reply;
    state.operations = [...workingCopy.operations];
    state.workingDeck = structuredClone(workingCopy.deck);
    state.policy = commitPolicy(record);
    return { committed: true, policy: state.policy, operationCount: state.operations.length };
  },
};

// 生結果をそのままモデルへ返さない。画像は要約、deck 本文は返さない。
function summarizeToolResult(toolName: AgentToolName, result: unknown): Record<string, unknown> {
  switch (toolName) {
    case "get_deck_summary": {
      const summary = DeckSummarySchema.parse(result);
      return { title: summary.title, slides: summary.slides };
    }
    case "get_slide":
      return { slide: SlideSchema.parse(result) };
    case "edit_elements":
    case "write_slide":
    case "reflow_slide": {
      const applied = ToolResultSchema.parse(result);
      return { operations: applied.operations, changeKinds: applied.changeKinds };
    }
    case "render_slide":
      return { rendered: true, byteLength: Buffer.isBuffer(result) ? result.byteLength : 0 };
    case "inspect_layout":
      return { issues: LayoutIssueSchema.array().parse(result).slice(0, 20) };
    case "inspect_visual":
      return { insight: VisualInsightSchema.parse(result) };
    case "commit_changes":
      return CommitResultSchema.parse(result);
  }
}

async function invokeAgentTool(record: RunRecord, toolName: AgentToolName, input: Record<string, unknown>): Promise<unknown> {
  const { context, state } = record;
  context.onToolEvent?.({ status: "start", tool: toolName });
  try {
    if (context.budget) consumeAgentStep(context.budget);
    const result = await rawToolHandlersByTool[toolName](input, record);
    if (!state.toolsUsed.includes(toolName)) state.toolsUsed.push(toolName);
    context.onToolEvent?.({ status: "complete", tool: toolName });
    return result;
  } catch (error) {
    if (error instanceof DocumentError && (error.status === 429 || error.status === 504)) {
      state.budgetExhausted = true;
    }
    context.onToolEvent?.({ status: "error", tool: toolName });
    throw error;
  }
}

export function createAgentToolRegistry(context: unknown): AgentToolRegistry {
  if (!(context instanceof Object)) throw new DocumentError("実行コンテキストが不正です。");
  const validated = AgentRunContextSchema.parse(context);
  const record: RunRecord = {
    context: validated,
    state: { commitRequested: false, budgetExhausted: false, operations: [], workingDeck: null, policy: null, reply: null, toolsUsed: [] },
  };
  runRecords.set(context, record);
  const toolSet: ToolSet = {
    get_deck_summary: tool({
      description: "Summarize every slide of the current working deck: slide id, index, title, and element count.",
      inputSchema: toolInputSchemas.get_deck_summary,
      execute: async (input) => summarizeToolResult("get_deck_summary", await invokeAgentTool(record, "get_deck_summary", input)),
    }),
    get_slide: tool({
      description: "Read one slide with its exact element ids before editing it.",
      inputSchema: toolInputSchemas.get_slide,
      execute: async (input) => summarizeToolResult("get_slide", await invokeAgentTool(record, "get_slide", input)),
    }),
    edit_elements: tool({
      description: "Apply element-level patches (text, position, size, style) to existing element ids of one slide.",
      inputSchema: toolInputSchemas.edit_elements,
      execute: async (input) => summarizeToolResult("edit_elements", await invokeAgentTool(record, "edit_elements", input)),
    }),
    write_slide: tool({
      description: "Replace the whole target slide with a slide blueprint. Requires an approved layout choice.",
      inputSchema: toolInputSchemas.write_slide,
      execute: async (input) => summarizeToolResult("write_slide", await invokeAgentTool(record, "write_slide", input)),
    }),
    render_slide: tool({
      description: "Render the target slide to an image. Returns only a rendered flag and byte length.",
      inputSchema: toolInputSchemas.render_slide,
      execute: async (input) => summarizeToolResult("render_slide", await invokeAgentTool(record, "render_slide", input)),
    }),
    inspect_layout: tool({
      description: "Check the target slide for overflow, overlap, small text, and dense text.",
      inputSchema: toolInputSchemas.inspect_layout,
      execute: async (input) => summarizeToolResult("inspect_layout", await invokeAgentTool(record, "inspect_layout", input)),
    }),
    inspect_visual: tool({
      description: "Inspect the rendered target slide image against the stated intent.",
      inputSchema: toolInputSchemas.inspect_visual,
      execute: async (input) => summarizeToolResult("inspect_visual", await invokeAgentTool(record, "inspect_visual", input)),
    }),
    reflow_slide: tool({
      description: "Align or distribute existing elements of one slide with an allowed reflow rule.",
      inputSchema: toolInputSchemas.reflow_slide,
      execute: async (input) => summarizeToolResult("reflow_slide", await invokeAgentTool(record, "reflow_slide", input)),
    }),
    commit_changes: tool({
      description: "Commit the accumulated changes of this run. Required before any change is applied.",
      inputSchema: toolInputSchemas.commit_changes,
      execute: async (input) => summarizeToolResult("commit_changes", await invokeAgentTool(record, "commit_changes", input)),
    }),
  };
  const registry: AgentToolRegistry = toolSet;
  registryToolSets.set(registry, toolSet);
  for (const toolName of AGENT_TOOL_NAMES) {
    const entry = toolSet[toolName];
    if (!entry) throw new DocumentError("ツールの登録に失敗しました。");
    registryRecords.set(entry, record);
  }
  return registry;
}

// generateText へ渡すツール集合 (AI SDK の Tool 型)。実行ごとに 1 組だけ対応する。
export function getAgentToolSet(registry: AgentToolRegistry): ToolSet {
  const toolSet = registryToolSets.get(registry);
  if (!toolSet) throw new DocumentError("この実行のツール登録が見つかりません。");
  return toolSet;
}

export async function executeAgentTool(
  registry: AgentToolRegistry,
  toolName: AgentToolName,
  input: Record<string, unknown>,
): Promise<unknown> {
  const entry = registry[toolName];
  if (!entry) throw new DocumentError("指定されたツールは登録されていません。");
  const record = registryRecords.get(entry);
  if (!record) throw new DocumentError("この実行の登録情報が見つかりません。");
  const parsedInput = toolInputSchemas[toolName].parse(input);
  return invokeAgentTool(record, toolName, parsedInput);
}
