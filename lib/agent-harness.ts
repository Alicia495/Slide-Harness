import {
  SLIDE_H,
  SLIDE_W,
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
