import { z } from "zod";

export const SLIDE_W = 13.333;
export const SLIDE_H = 7.5;

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const geometry = {
  id: z.uuid(),
  x: z.number().finite().min(0).max(SLIDE_W),
  y: z.number().finite().min(0).max(SLIDE_H),
  w: z.number().finite().positive().max(SLIDE_W),
  h: z.number().finite().positive().max(SLIDE_H),
  rotation: z.number().min(0).max(360).default(0),
};

export const TextElementSchema = z.object({
  kind: z.literal("text"), ...geometry,
  text: z.string().max(8000),
  fontSize: z.number().min(8).max(96),
  color,
  bold: z.boolean().default(false),
  align: z.enum(["left", "center", "right"]).default("left"),
  valign: z.enum(["top", "mid", "bottom"]).default("top"),
  role: z.enum(["title", "subtitle", "body", "caption", "pageNumber", "other"]).default("other"),
});

export const ShapeTypeSchema = z.enum([
  // 基本図形
  "rect", "roundRect", "ellipse", "line", "triangle",
  // 基本ポリゴン
  "diamond", "hexagon", "pentagon", "octagon", "parallelogram", "trapezoid",
  "star4", "star5", "star6", "plus", "donut", "heart", "sun",
  "frame", "plaque", "corner",
  // 矢印
  "rightArrow", "leftArrow", "upArrow", "downArrow",
  "leftRightArrow", "upDownArrow", "chevron",
  "bentArrow", "bentUpArrow", "curvedRightArrow", "curvedLeftArrow",
  "quadArrow", "circularArrow",
  // 吹き出し
  "callout", "cloudCallout", "wedgeRectCallout",
  "leftArrowCallout", "rightArrowCallout",
  // フローチャート
  "flowChartTerminator", "flowChartProcess", "flowChartDecision", "flowChartInputOutput",
  "flowChartPredefinedProcess", "flowChartDocument", "flowChartMultidocument",
  "flowChartInternalStorage", "flowChartConnector", "flowChartOffpageConnector",
  "flowChartManualInput", "flowChartPreparation", "flowChartDelay",
  "flowChartMerge", "flowChartCollate", "flowChartSort",
  "flowChartSummingJunction", "flowChartOr", "flowChartExtract",
]);
export type ShapeType = z.infer<typeof ShapeTypeSchema>;

export const ShapeElementSchema = z.object({
  kind: z.literal("shape"), ...geometry,
  shape: ShapeTypeSchema,
  fill: color,
  stroke: color.optional(),
  radius: z.number().min(0).max(1).optional(),
  arrowHead: z.enum(["none", "start", "end", "both"]).optional(),
});

export const IconElementSchema = z.object({
  kind: z.literal("icon"), ...geometry,
  name: z.string().min(1).max(80),
  color,
});

export const ImageElementSchema = z.object({
  kind: z.literal("image"), ...geometry,
  assetId: z.uuid(),
  alt: z.string().max(300).default(""),
  objectFit: z.enum(["contain", "cover", "fill"]).default("contain"),
  borderRadius: z.number().min(0).max(1).optional(),
  stroke: color.optional(),
});

export const TableElementSchema = z.object({
  kind: z.literal("table"), ...geometry,
  rows: z.array(z.array(z.string().max(500)).min(1).max(8)).min(1).max(12),
  header: z.boolean().default(true),
});

export const ChartElementSchema = z.object({
  kind: z.literal("chart"), ...geometry,
  chartType: z.enum(["bar", "line", "pie"]),
  series: z.array(z.object({
    name: z.string().max(80),
    labels: z.array(z.string().max(60)).min(1).max(12),
    values: z.array(z.number().finite()).min(1).max(12),
  })).min(1).max(4),
});

export const ElementSchema = z.discriminatedUnion("kind", [
  TextElementSchema, ShapeElementSchema, IconElementSchema, ImageElementSchema,
  TableElementSchema, ChartElementSchema,
]);
export const ThemeSchema = z.object({
  name: z.string().min(1).max(80),
  primary: color,
  accent: color,
  background: color,
  text: color,
  fontFace: z.string().min(1).max(80),
});
export const SlideSchema = z.object({
  id: z.uuid(),
  background: color,
  elements: z.array(ElementSchema).max(60),
});
export const DeckSchema = z.object({
  id: z.uuid(),
  title: z.string().min(1).max(160),
  theme: ThemeSchema,
  slides: z.array(SlideSchema).max(50),
});

export type TextElement = z.infer<typeof TextElementSchema>;
export type ShapeElement = z.infer<typeof ShapeElementSchema>;
export type IconElement = z.infer<typeof IconElementSchema>;
export type ImageElement = z.infer<typeof ImageElementSchema>;
export type TableElement = z.infer<typeof TableElementSchema>;
export type ChartElement = z.infer<typeof ChartElementSchema>;
export type Element = z.infer<typeof ElementSchema>;
export type Theme = z.infer<typeof ThemeSchema>;
export type Slide = z.infer<typeof SlideSchema>;
export type Deck = z.infer<typeof DeckSchema>;

export const DEFAULT_THEME: Theme = {
  name: "クリーン", primary: "#3156D3", accent: "#65A9F0",
  background: "#FFFFFF", text: "#182230", fontFace: "Aptos",
};

export function emptyDeck(title = "新しいプレゼンテーション", theme: Theme = DEFAULT_THEME): Deck {
  return { id: crypto.randomUUID(), title, theme: { ...theme }, slides: [] };
}

export const SlideBlueprintSchema = z.object({
  layout: z.enum(["title", "bullets", "twoColumn", "chart", "table", "section", "steps", "cards", "kpi", "comparison"]).default("bullets"),
  title: z.string().min(1).max(180),
  subtitle: z.string().max(240).optional(),
  bullets: z.array(z.string().max(240)).max(8).optional(),
  rightBullets: z.array(z.string().max(240)).max(8).optional(),
  chart: z.object({
    type: z.enum(["bar", "line", "pie"]),
    series: ChartElementSchema.shape.series,
  }).optional(),
  table: z.array(z.array(z.string().max(500)).min(1).max(8)).min(1).max(12).optional(),
  steps: z.array(z.object({
    stepNumber: z.number().int().positive(),
    title: z.string().max(100),
    body: z.string().max(300),
  })).min(2).max(5).optional(),
  cards: z.array(z.object({
    title: z.string().max(100),
    body: z.string().max(300),
    icon: z.string().max(80).optional(),
  })).min(3).max(4).optional(),
  kpis: z.array(z.object({
    value: z.string().max(30),
    unit: z.string().max(20).optional(),
    label: z.string().max(80),
    note: z.string().max(160).optional(),
  })).min(2).max(4).optional(),
  comparison: z.object({
    left: z.object({
      title: z.string().max(100),
      bullets: z.array(z.string().max(240)).max(6),
      tag: z.string().max(40).optional(),
    }),
    right: z.object({
      title: z.string().max(100),
      bullets: z.array(z.string().max(240)).max(6),
      tag: z.string().max(40).optional(),
    }),
  }).optional(),
});
export type SlideBlueprint = z.input<typeof SlideBlueprintSchema>;

export const OperationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("replaceDeck"), title: z.string().min(1).max(160), slides: z.array(SlideBlueprintSchema).min(1).max(30) }),
  z.object({ type: z.literal("addSlide"), slide: SlideBlueprintSchema, index: z.number().int().min(0).max(50).optional() }),
  z.object({ type: z.literal("deleteSlide"), slideId: z.uuid() }),
  z.object({ type: z.literal("reorderSlide"), slideId: z.uuid(), toIndex: z.number().int().min(0).max(49) }),
  z.object({ type: z.literal("updateText"), slideId: z.uuid(), elementId: z.uuid(), text: z.string().max(8000) }),
  z.object({ type: z.literal("moveElement"), slideId: z.uuid(), elementId: z.uuid(), x: z.number().finite().min(0).max(SLIDE_W), y: z.number().finite().min(0).max(SLIDE_H) }),
  z.object({ type: z.literal("resizeElement"), slideId: z.uuid(), elementId: z.uuid(), w: z.number().finite().positive().max(SLIDE_W), h: z.number().finite().positive().max(SLIDE_H) }),
  z.object({ type: z.literal("updateStyle"), slideId: z.uuid(), elementId: z.uuid(), fontSize: z.number().min(8).max(96).optional(), color: color.optional(), bold: z.boolean().optional(), fill: color.optional(), stroke: color.optional(), rotation: z.number().min(0).max(360).optional() }),
  z.object({ type: z.literal("updateTable"), slideId: z.uuid(), elementId: z.uuid(), rows: TableElementSchema.shape.rows }),
  z.object({ type: z.literal("updateChart"), slideId: z.uuid(), elementId: z.uuid(), series: ChartElementSchema.shape.series }),
  z.object({ type: z.literal("setTheme"), primary: color.optional(), accent: color.optional(), background: color.optional(), text: color.optional(), fontFace: z.string().min(1).max(80).optional() }),
  z.object({ type: z.literal("addImage"), slideId: z.uuid(), assetId: z.uuid(), x: z.number().min(0).max(SLIDE_W), y: z.number().min(0).max(SLIDE_H), w: z.number().positive().max(SLIDE_W), h: z.number().positive().max(SLIDE_H), alt: z.string().max(300).default(""), objectFit: z.enum(["contain", "cover", "fill"]).optional(), borderRadius: z.number().min(0).max(1).optional(), stroke: color.optional() }),
  z.object({ type: z.literal("addShape"), slideId: z.uuid(), shape: ShapeTypeSchema, x: z.number().min(0).max(SLIDE_W), y: z.number().min(0).max(SLIDE_H), w: z.number().positive().max(SLIDE_W), h: z.number().positive().max(SLIDE_H), fill: color, stroke: color.optional(), arrowHead: z.enum(["none", "start", "end", "both"]).optional(), rotation: z.number().min(0).max(360).optional() }),
  z.object({ type: z.literal("addIcon"), slideId: z.uuid(), name: z.string().min(1).max(80), x: z.number().min(0).max(SLIDE_W), y: z.number().min(0).max(SLIDE_H), w: z.number().positive().max(SLIDE_W), h: z.number().positive().max(SLIDE_H), color: color.optional(), rotation: z.number().min(0).max(360).optional() }),
  z.object({ type: z.literal("deleteElement"), slideId: z.uuid(), elementId: z.uuid() }),
  z.object({ type: z.literal("reorderElement"), slideId: z.uuid(), elementId: z.uuid(), action: z.enum(["bringToFront", "sendToBack", "bringForward", "sendBackward"]) }),
  z.object({ type: z.literal("updateImageProps"), slideId: z.uuid(), elementId: z.uuid(), objectFit: z.enum(["contain", "cover", "fill"]).optional(), borderRadius: z.number().min(0).max(1).optional(), stroke: color.nullable().optional() }),
]);
export type Operation = z.infer<typeof OperationSchema>;

function textElement(text: string, x: number, y: number, w: number, h: number, fontSize: number, theme: Theme, role: TextElement["role"], extra: Partial<TextElement> = {}): TextElement {
  return { kind: "text", id: crypto.randomUUID(), x, y, w, h, rotation: 0, text, fontSize,
    color: theme.text, bold: role === "title", align: "left", valign: "top", role, ...extra };
}

export function slideFromBlueprint(input: SlideBlueprint, theme: Theme, index: number): Slide {
  const bp = SlideBlueprintSchema.parse(input);
  const elements: Element[] = [];
  const bg = bp.layout === "section" ? theme.primary : theme.background;
  if (bp.layout === "title") {
    elements.push(textElement(bp.title, 0.9, 1.45, 11.5, 1.25, 38, theme, "title"));
    if (bp.subtitle) elements.push(textElement(bp.subtitle, 0.95, 3.0, 10.8, 1.0, 20, theme, "subtitle", { color: "#667085" }));
    elements.push({ kind: "shape", id: crypto.randomUUID(), x: 0.95, y: 5.75, w: 1.2, h: 0.08, shape: "rect", fill: theme.primary, rotation: 0 });
  } else if (bp.layout === "section") {
    elements.push(textElement(bp.title, 0.9, 2.3, 11.3, 1.4, 38, theme, "title", { color: "#FFFFFF" }));
    if (bp.subtitle) elements.push(textElement(bp.subtitle, 0.95, 4.0, 10.8, 0.7, 19, theme, "subtitle", { color: "#FFFFFF" }));
  } else {
    elements.push({ kind: "shape", id: crypto.randomUUID(), x: 0.66, y: 0.62, w: 0.1, h: 0.58, shape: "rect", fill: theme.primary, rotation: 0 });
    elements.push(textElement(bp.title, 0.95, 0.6, 11.4, 0.7, 29, theme, "title"));
    if (bp.subtitle) elements.push(textElement(bp.subtitle, 0.98, 1.4, 11.0, 0.5, 16, theme, "subtitle", { color: "#667085" }));
    const bodyY = bp.subtitle ? 2.12 : 1.8;
    if (bp.layout === "chart" && bp.chart) {
      elements.push({ kind: "chart", id: crypto.randomUUID(), x: 0.9, y: bodyY, w: 11.4, h: 4.65, chartType: bp.chart.type, series: bp.chart.series, rotation: 0 });
    } else if (bp.layout === "table" && bp.table) {
      elements.push({ kind: "table", id: crypto.randomUUID(), x: 0.9, y: bodyY, w: 11.4, h: 4.65, rows: bp.table, header: true, rotation: 0 });
    } else if (bp.layout === "twoColumn") {
      const left = (bp.bullets ?? []).map((v) => `• ${v}`).join("\n\n");
      const right = (bp.rightBullets ?? []).map((v) => `• ${v}`).join("\n\n");
      elements.push(textElement(left, 0.95, bodyY, 5.45, 4.9, 19, theme, "body"));
      elements.push({ kind: "shape", id: crypto.randomUUID(), x: 6.65, y: bodyY, w: 0.02, h: 4.7, shape: "rect", fill: "#DDE3EA", rotation: 0 });
      elements.push(textElement(right, 6.95, bodyY, 5.4, 4.9, 19, theme, "body"));
    } else if (bp.layout === "steps") {
      const items = bp.steps && bp.steps.length ? bp.steps : (bp.bullets ?? []).slice(0, 4).map((b, i) => ({ stepNumber: i + 1, title: `ステップ ${i + 1}`, body: b }));
      const count = Math.min(Math.max(items.length, 2), 5);
      const totalW = 11.4;
      const arrowW = 0.35;
      const arrowGap = 0.15;
      const cardW = (totalW - (count - 1) * (arrowW + arrowGap * 2)) / count;
      const cardH = 4.75;
      for (let i = 0; i < count; i++) {
        const item = items[i] || { stepNumber: i + 1, title: `ステップ ${i + 1}`, body: "" };
        const cardX = 0.95 + i * (cardW + arrowW + arrowGap * 2);
        elements.push({ kind: "shape", id: crypto.randomUUID(), shape: "roundRect", x: cardX, y: bodyY, w: cardW, h: cardH, fill: "#F8FAFC", stroke: "#B4C7E7", radius: 0.08, rotation: 0 });
        elements.push({ kind: "shape", id: crypto.randomUUID(), shape: "ellipse", x: cardX + (cardW - 0.65) / 2, y: bodyY + 0.35, w: 0.65, h: 0.65, fill: theme.primary, rotation: 0 });
        elements.push(textElement(String(item.stepNumber), cardX, bodyY + 0.45, cardW, 0.45, 17, theme, "title", { color: "#FFFFFF", align: "center", bold: true }));
        elements.push(textElement(item.title, cardX + 0.15, bodyY + 1.25, cardW - 0.3, 0.65, 16, theme, "title", { align: "center", bold: true }));
        elements.push(textElement(item.body, cardX + 0.15, bodyY + 2.0, cardW - 0.3, 2.5, 13, theme, "body", { color: "#475467" }));
        if (i < count - 1) {
          const arrowX = cardX + cardW + arrowGap;
          elements.push({ kind: "shape", id: crypto.randomUUID(), shape: "rightArrow", x: arrowX, y: bodyY + 2.1, w: arrowW, h: 0.35, fill: theme.accent, rotation: 0 });
        }
      }
    } else if (bp.layout === "cards") {
      const items = bp.cards && bp.cards.length ? bp.cards : (bp.bullets ?? []).slice(0, 4).map((b, i) => ({ title: `項目 ${i + 1}`, body: b, icon: "Sparkles" }));
      const count = Math.min(Math.max(items.length, 3), 4);
      const totalW = 11.4;
      const gap = 0.35;
      const cardW = (totalW - (count - 1) * gap) / count;
      const cardH = 4.75;
      for (let i = 0; i < count; i++) {
        const item = items[i] || { title: `項目 ${i + 1}`, body: "", icon: "Sparkles" };
        const cardX = 0.95 + i * (cardW + gap);
        elements.push({ kind: "shape", id: crypto.randomUUID(), shape: "roundRect", x: cardX, y: bodyY, w: cardW, h: cardH, fill: "#FFFFFF", stroke: "#B4C7E7", radius: 0.08, rotation: 0 });
        if (item.icon) {
          elements.push({ kind: "icon", id: crypto.randomUUID(), name: item.icon, color: theme.primary, x: cardX + 0.3, y: bodyY + 0.35, w: 0.55, h: 0.55, rotation: 0 });
        }
        elements.push(textElement(item.title, cardX + 0.3, bodyY + 1.1, cardW - 0.6, 0.7, 17, theme, "title", { bold: true }));
        elements.push(textElement(item.body, cardX + 0.3, bodyY + 1.9, cardW - 0.6, 2.6, 14, theme, "body", { color: "#475467" }));
      }
    } else if (bp.layout === "kpi") {
      const items = bp.kpis && bp.kpis.length ? bp.kpis : [
        { value: "150%", label: "成長率", note: "前年同期比" },
        { value: "1,200", unit: "社", label: "導入実績", note: "国内企業" },
        { value: "99.9%", label: "継続率", note: "直近1年間" },
      ];
      const count = Math.min(Math.max(items.length, 2), 4);
      const totalW = 11.4;
      const gap = 0.4;
      const cardW = (totalW - (count - 1) * gap) / count;
      const cardH = 4.3;
      for (let i = 0; i < count; i++) {
        const item = items[i] || { value: "-", label: `指標 ${i + 1}` };
        const cardX = 0.95 + i * (cardW + gap);
        elements.push({ kind: "shape", id: crypto.randomUUID(), shape: "roundRect", x: cardX, y: bodyY + 0.2, w: cardW, h: cardH, fill: "#F8FAFC", stroke: "#B4C7E7", radius: 0.08, rotation: 0 });
        elements.push({ kind: "shape", id: crypto.randomUUID(), shape: "rect", x: cardX + 0.3, y: bodyY + 0.2, w: cardW - 0.6, h: 0.06, fill: theme.primary, rotation: 0 });
        const valText = item.unit ? `${item.value} ${item.unit}` : item.value;
        elements.push(textElement(valText, cardX + 0.15, bodyY + 0.8, cardW - 0.3, 1.2, 36, theme, "title", { color: theme.primary, align: "center", bold: true, valign: "mid" }));
        elements.push(textElement(item.label, cardX + 0.15, bodyY + 2.1, cardW - 0.3, 0.7, 18, theme, "subtitle", { align: "center", bold: true }));
        if (item.note) {
          elements.push(textElement(item.note, cardX + 0.15, bodyY + 2.9, cardW - 0.3, 1.2, 13, theme, "caption", { color: "#667085", align: "center" }));
        }
      }
    } else if (bp.layout === "comparison") {
      const bList = bp.bullets ?? [];
      const comp = bp.comparison ?? {
        left: {
          title: "従来方式 / 課題",
          bullets: bList.slice(0, 3).length ? bList.slice(0, 3) : ["工数がかかる", "属人化している", "ミスが発生しやすい"],
        },
        right: {
          title: "新提案 / 効果",
          bullets: (bp.rightBullets && bp.rightBullets.length ? bp.rightBullets : bList.slice(3, 6)).length ? (bp.rightBullets && bp.rightBullets.length ? bp.rightBullets : bList.slice(3, 6)) : ["自動化による効率化", "標準化による品質向上", "コスト半減"],
        },
      };
      const cardW = 5.25;
      const cardH = 4.75;
      elements.push({ kind: "shape", id: crypto.randomUUID(), shape: "roundRect", x: 0.95, y: bodyY, w: cardW, h: cardH, fill: "#F8FAFC", stroke: "#B4C7E7", radius: 0.08, rotation: 0 });
      elements.push({ kind: "shape", id: crypto.randomUUID(), shape: "roundRect", x: 1.15, y: bodyY + 0.25, w: cardW - 0.4, h: 0.65, fill: "#E2E8F0", radius: 0.04, rotation: 0 });
      elements.push(textElement(comp.left.title, 1.3, bodyY + 0.32, cardW - 0.7, 0.5, 17, theme, "title", { color: "#334155", bold: true, align: "center" }));
      if (comp.left.tag) elements.push(textElement(comp.left.tag, 1.3, bodyY + 1.05, cardW - 0.7, 0.3, 10, theme, "caption", { color: theme.primary, bold: true, align: "center" }));
      elements.push(textElement(comp.left.bullets.map((v) => `• ${v}`).join("\n\n"), 1.3, bodyY + (comp.left.tag ? 1.5 : 1.2), cardW - 0.7, comp.left.tag ? 3.0 : 3.3, 15, theme, "body", { color: "#475467" }));
      elements.push({ kind: "shape", id: crypto.randomUUID(), shape: "rightArrow", x: 6.45, y: bodyY + 2.05, w: 0.45, h: 0.4, fill: theme.accent, rotation: 0 });
      elements.push({ kind: "shape", id: crypto.randomUUID(), shape: "roundRect", x: 7.15, y: bodyY, w: cardW, h: cardH, fill: "#FFFFFF", stroke: theme.primary, radius: 0.08, rotation: 0 });
      elements.push({ kind: "shape", id: crypto.randomUUID(), shape: "roundRect", x: 7.35, y: bodyY + 0.25, w: cardW - 0.4, h: 0.65, fill: theme.primary, radius: 0.04, rotation: 0 });
      elements.push(textElement(comp.right.title, 7.5, bodyY + 0.32, cardW - 0.7, 0.5, 17, theme, "title", { color: "#FFFFFF", bold: true, align: "center" }));
      if (comp.right.tag) elements.push(textElement(comp.right.tag, 7.5, bodyY + 1.05, cardW - 0.7, 0.3, 10, theme, "caption", { color: theme.primary, bold: true, align: "center" }));
      elements.push(textElement(comp.right.bullets.map((v) => `• ${v}`).join("\n\n"), 7.5, bodyY + (comp.right.tag ? 1.5 : 1.2), cardW - 0.7, comp.right.tag ? 3.0 : 3.3, 15, theme, "body"));
    } else {
      elements.push(textElement((bp.bullets ?? []).map((v) => `• ${v}`).join("\n\n") || bp.subtitle || "", 1.0, bodyY, 11.2, 4.95, 21, theme, "body"));
    }
  }
  if (bp.layout !== "title" && bp.layout !== "section") {
    elements.push(textElement(String(index + 1).padStart(2, "0"), 12.0, 7.04, 0.45, 0.25, 10, theme, "pageNumber", { color: "#98A2B3", align: "right" }));
  }
  return SlideSchema.parse({ id: crypto.randomUUID(), background: bg, elements });
}

export function slideTitle(slide: Slide): string {
  const title = slide.elements.find((e): e is TextElement => e.kind === "text" && e.role === "title");
  return title?.text || "無題のスライド";
}
