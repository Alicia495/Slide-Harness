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
};

export const TextElementSchema = z.object({
  kind: z.literal("text"), ...geometry,
  text: z.string().max(8000),
  fontSize: z.number().min(8).max(96),
  color,
  bold: z.boolean().default(false),
  align: z.enum(["left", "center", "right"]).default("left"),
  valign: z.enum(["top", "mid", "bottom"]).default("top"),
  role: z.enum(["title", "subtitle", "body", "caption", "other"]).default("other"),
});
export const ShapeElementSchema = z.object({
  kind: z.literal("shape"), ...geometry,
  shape: z.enum(["rect", "roundRect", "ellipse", "line"]),
  fill: color,
  stroke: color.optional(),
  radius: z.number().min(0).max(1).optional(),
});
export const ImageElementSchema = z.object({
  kind: z.literal("image"), ...geometry,
  assetId: z.uuid(),
  alt: z.string().max(300).default(""),
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
  TextElementSchema, ShapeElementSchema, ImageElementSchema,
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

export function emptyDeck(title = "新しいプレゼンテーション"): Deck {
  return { id: crypto.randomUUID(), title, theme: { ...DEFAULT_THEME }, slides: [] };
}

export const SlideBlueprintSchema = z.object({
  layout: z.enum(["title", "bullets", "twoColumn", "chart", "table", "section"]).default("bullets"),
  title: z.string().min(1).max(180),
  subtitle: z.string().max(240).optional(),
  bullets: z.array(z.string().max(240)).max(8).default([]),
  rightBullets: z.array(z.string().max(240)).max(8).optional(),
  chart: z.object({
    type: z.enum(["bar", "line", "pie"]),
    series: ChartElementSchema.shape.series,
  }).optional(),
  table: z.array(z.array(z.string().max(500)).min(1).max(8)).min(1).max(12).optional(),
});
export type SlideBlueprint = z.infer<typeof SlideBlueprintSchema>;

export const OperationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("replaceDeck"), title: z.string().min(1).max(160), slides: z.array(SlideBlueprintSchema).min(1).max(30) }),
  z.object({ type: z.literal("addSlide"), slide: SlideBlueprintSchema, index: z.number().int().min(0).max(50).optional() }),
  z.object({ type: z.literal("deleteSlide"), slideId: z.uuid() }),
  z.object({ type: z.literal("reorderSlide"), slideId: z.uuid(), toIndex: z.number().int().min(0).max(49) }),
  z.object({ type: z.literal("updateText"), slideId: z.uuid(), elementId: z.uuid(), text: z.string().max(8000) }),
  z.object({ type: z.literal("moveElement"), slideId: z.uuid(), elementId: z.uuid(), x: z.number().finite().min(0).max(SLIDE_W), y: z.number().finite().min(0).max(SLIDE_H) }),
  z.object({ type: z.literal("resizeElement"), slideId: z.uuid(), elementId: z.uuid(), w: z.number().finite().positive().max(SLIDE_W), h: z.number().finite().positive().max(SLIDE_H) }),
  z.object({ type: z.literal("updateStyle"), slideId: z.uuid(), elementId: z.uuid(), fontSize: z.number().min(8).max(96).optional(), color: color.optional(), bold: z.boolean().optional(), fill: color.optional() }),
  z.object({ type: z.literal("updateTable"), slideId: z.uuid(), elementId: z.uuid(), rows: TableElementSchema.shape.rows }),
  z.object({ type: z.literal("updateChart"), slideId: z.uuid(), elementId: z.uuid(), series: ChartElementSchema.shape.series }),
  z.object({ type: z.literal("setTheme"), primary: color.optional(), accent: color.optional(), background: color.optional(), text: color.optional(), fontFace: z.string().min(1).max(80).optional() }),
  z.object({ type: z.literal("addImage"), slideId: z.uuid(), assetId: z.uuid(), x: z.number().min(0).max(SLIDE_W), y: z.number().min(0).max(SLIDE_H), w: z.number().positive().max(SLIDE_W), h: z.number().positive().max(SLIDE_H), alt: z.string().max(300).default("") }),
]);
export type Operation = z.infer<typeof OperationSchema>;

function textElement(text: string, x: number, y: number, w: number, h: number, fontSize: number, theme: Theme, role: TextElement["role"], extra: Partial<TextElement> = {}): TextElement {
  return { kind: "text", id: crypto.randomUUID(), x, y, w, h, text, fontSize,
    color: theme.text, bold: role === "title", align: "left", valign: "top", role, ...extra };
}

export function slideFromBlueprint(input: SlideBlueprint, theme: Theme, index: number): Slide {
  const bp = SlideBlueprintSchema.parse(input);
  const elements: Element[] = [];
  const bg = bp.layout === "section" ? theme.primary : theme.background;
  if (bp.layout === "title") {
    elements.push(textElement(bp.title, 0.9, 1.45, 11.5, 1.25, 38, theme, "title"));
    if (bp.subtitle) elements.push(textElement(bp.subtitle, 0.95, 3.0, 10.8, 1.0, 20, theme, "subtitle", { color: "#667085" }));
    elements.push({ kind: "shape", id: crypto.randomUUID(), x: 0.95, y: 5.75, w: 1.2, h: 0.08, shape: "rect", fill: theme.primary });
  } else if (bp.layout === "section") {
    elements.push(textElement(bp.title, 0.9, 2.3, 11.3, 1.4, 38, theme, "title", { color: "#FFFFFF" }));
    if (bp.subtitle) elements.push(textElement(bp.subtitle, 0.95, 4.0, 10.8, 0.7, 19, theme, "subtitle", { color: "#FFFFFF" }));
  } else {
    elements.push({ kind: "shape", id: crypto.randomUUID(), x: 0.66, y: 0.62, w: 0.1, h: 0.58, shape: "rect", fill: theme.primary });
    elements.push(textElement(bp.title, 0.95, 0.6, 11.4, 0.7, 29, theme, "title"));
    if (bp.subtitle) elements.push(textElement(bp.subtitle, 0.98, 1.4, 11.0, 0.5, 16, theme, "subtitle", { color: "#667085" }));
    const bodyY = bp.subtitle ? 2.12 : 1.8;
    if (bp.layout === "chart" && bp.chart) {
      elements.push({ kind: "chart", id: crypto.randomUUID(), x: 0.9, y: bodyY, w: 11.4, h: 4.65, chartType: bp.chart.type, series: bp.chart.series });
    } else if (bp.layout === "table" && bp.table) {
      elements.push({ kind: "table", id: crypto.randomUUID(), x: 0.9, y: bodyY, w: 11.4, h: 4.65, rows: bp.table, header: true });
    } else if (bp.layout === "twoColumn") {
      const left = bp.bullets.map((v) => `• ${v}`).join("\n\n");
      const right = (bp.rightBullets ?? []).map((v) => `• ${v}`).join("\n\n");
      elements.push(textElement(left, 0.95, bodyY, 5.45, 4.9, 19, theme, "body"));
      elements.push({ kind: "shape", id: crypto.randomUUID(), x: 6.65, y: bodyY, w: 0.02, h: 4.7, shape: "rect", fill: "#DDE3EA" });
      elements.push(textElement(right, 6.95, bodyY, 5.4, 4.9, 19, theme, "body"));
    } else {
      elements.push(textElement(bp.bullets.map((v) => `• ${v}`).join("\n\n") || bp.subtitle || "", 1.0, bodyY, 11.2, 4.95, 21, theme, "body"));
    }
  }
  if (bp.layout !== "title" && bp.layout !== "section") {
    elements.push(textElement(String(index + 1).padStart(2, "0"), 12.0, 7.04, 0.45, 0.25, 10, theme, "caption", { color: "#98A2B3", align: "right" }));
  }
  return SlideSchema.parse({ id: crypto.randomUUID(), background: bg, elements });
}

export function slideTitle(slide: Slide): string {
  const title = slide.elements.find((e): e is TextElement => e.kind === "text" && e.role === "title");
  return title?.text || "無題のスライド";
}
