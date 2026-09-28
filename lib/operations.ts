import { DeckSchema, OperationSchema, SLIDE_H, SLIDE_W, slideFromBlueprint, type Deck, type Element, type Operation, type Slide } from "./document";

export class DocumentError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

function getSlide(deck: Deck, id: string): Slide {
  const slide = deck.slides.find((item) => item.id === id);
  if (!slide) throw new DocumentError("対象のスライドが見つかりません。");
  return slide;
}

function getElement(deck: Deck, slideId: string, elementId: string): Element {
  const element = getSlide(deck, slideId).elements.find((item) => item.id === elementId);
  if (!element) throw new DocumentError("対象の要素が見つかりません。");
  return element;
}

function validateBounds(deck: Deck): void {
  const ids = new Set<string>();
  for (const slide of deck.slides) {
    if (ids.has(slide.id)) throw new DocumentError("スライド ID が重複しています。");
    ids.add(slide.id);
    for (const element of slide.elements) {
      if (ids.has(element.id)) throw new DocumentError("要素 ID が重複しています。");
      ids.add(element.id);
      if (element.x + element.w > SLIDE_W + 0.001 || element.y + element.h > SLIDE_H + 0.001) {
        throw new DocumentError("要素がスライドの外にはみ出します。");
      }
      if (element.kind === "chart") {
        for (const series of element.series) {
          if (series.labels.length !== series.values.length) throw new DocumentError("グラフの項目数と値の数が一致しません。");
        }
      }
      if (element.kind === "table") {
        const cols = element.rows[0]?.length;
        if (element.rows.some((row) => row.length !== cols)) throw new DocumentError("表の列数が揃っていません。");
      }
    }
  }
}

function refreshPageNumbers(deck: Deck): void {
  deck.slides.forEach((slide, index) => {
    for (const element of slide.elements) {
      if (element.kind === "text" && element.role === "caption" && /^\d{2}$/.test(element.text)) {
        element.text = String(index + 1).padStart(2, "0");
      }
    }
  });
}

export function applyOperations(current: Deck, rawOperations: unknown): Deck {
  const operations = Array.isArray(rawOperations) ? rawOperations.map((op) => OperationSchema.parse(op)) : [];
  if (!operations.length || operations.length > 30) throw new DocumentError("変更操作は 1～30 件にしてください。");
  const deck = structuredClone(current);
  for (const op of operations) {
    switch (op.type) {
      case "replaceDeck":
        deck.title = op.title;
        deck.slides = op.slides.map((bp, i) => slideFromBlueprint(bp, deck.theme, i));
        break;
      case "addSlide": {
        const index = Math.min(op.index ?? deck.slides.length, deck.slides.length);
        deck.slides.splice(index, 0, slideFromBlueprint(op.slide, deck.theme, index));
        break;
      }
      case "deleteSlide": {
        const index = deck.slides.findIndex((s) => s.id === op.slideId);
        if (index < 0) throw new DocumentError("削除するスライドが見つかりません。");
        deck.slides.splice(index, 1);
        break;
      }
      case "reorderSlide": {
        const index = deck.slides.findIndex((s) => s.id === op.slideId);
        if (index < 0) throw new DocumentError("移動するスライドが見つかりません。");
        const [slide] = deck.slides.splice(index, 1);
        deck.slides.splice(Math.min(op.toIndex, deck.slides.length), 0, slide);
        break;
      }
      case "updateText": {
        const element = getElement(deck, op.slideId, op.elementId);
        if (element.kind !== "text") throw new DocumentError("テキスト要素を選択してください。");
        element.text = op.text;
        break;
      }
      case "moveElement": {
        const element = getElement(deck, op.slideId, op.elementId);
        element.x = op.x;
        element.y = op.y;
        break;
      }
      case "resizeElement": {
        const element = getElement(deck, op.slideId, op.elementId);
        element.w = op.w;
        element.h = op.h;
        break;
      }
      case "updateStyle": {
        const element = getElement(deck, op.slideId, op.elementId);
        if (element.kind === "text") {
          if (op.fontSize !== undefined) element.fontSize = op.fontSize;
          if (op.color !== undefined) element.color = op.color;
          if (op.bold !== undefined) element.bold = op.bold;
        } else if (element.kind === "shape") {
          if (op.fill !== undefined) element.fill = op.fill;
        } else {
          throw new DocumentError("この要素のスタイルは変更できません。");
        }
        break;
      }
      case "updateTable": {
        const element = getElement(deck, op.slideId, op.elementId);
        if (element.kind !== "table") throw new DocumentError("表を選択してください。");
        element.rows = op.rows;
        break;
      }
      case "updateChart": {
        const element = getElement(deck, op.slideId, op.elementId);
        if (element.kind !== "chart") throw new DocumentError("グラフを選択してください。");
        element.series = op.series;
        break;
      }
      case "setTheme": {
        const previous = { ...deck.theme };
        Object.assign(deck.theme, Object.fromEntries(Object.entries(op).filter(([key, value]) => key !== "type" && value !== undefined)));
        for (const slide of deck.slides) {
          if (slide.background === previous.background) slide.background = deck.theme.background;
          if (slide.background === previous.primary) slide.background = deck.theme.primary;
          for (const element of slide.elements) {
            if (element.kind === "text" && element.color === previous.text) element.color = deck.theme.text;
            if (element.kind === "shape" && element.fill === previous.primary) element.fill = deck.theme.primary;
          }
        }
        break;
      }
      case "addImage":
        getSlide(deck, op.slideId).elements.push({ kind: "image", id: crypto.randomUUID(), assetId: op.assetId,
          x: op.x, y: op.y, w: op.w, h: op.h, alt: op.alt });
        break;
    }
  }
  refreshPageNumbers(deck);
  const parsed = DeckSchema.parse(deck);
  validateBounds(parsed);
  return parsed;
}

export function isSmallAIEdit(operations: Operation[]): boolean {
  return operations.length === 1 && ["updateText", "moveElement", "resizeElement", "updateStyle"].includes(operations[0].type);
}

export function summarizeOperations(operations: Operation[]): string {
  if (operations.some((op) => op.type === "replaceDeck")) return "プレゼンテーション全体を作成・再構成";
  const labels: Record<Operation["type"], string> = {
    replaceDeck: "全体を再構成", addSlide: "スライドを追加", deleteSlide: "スライドを削除",
    reorderSlide: "スライドを並べ替え", updateText: "文章を変更", moveElement: "要素を移動",
    resizeElement: "要素のサイズを変更", updateStyle: "見た目を変更", updateTable: "表を更新",
    updateChart: "グラフを更新", setTheme: "テーマを変更", addImage: "画像を追加",
  };
  return operations.map((op) => labels[op.type]).join("、");
}
