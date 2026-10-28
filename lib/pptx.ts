import PptxGenJS from "pptxgenjs";
import type { Deck, Element, ShapeType } from "./document";
import { getIconSvgDataUri } from "./icon-svg";

const hex = (value: string) => value.replace(/^#/, "");

function getPptxShapeType(pptx: PptxGenJS, shape: ShapeType): PptxGenJS.ShapeType {
  switch (shape) {
    case "rect": return pptx.ShapeType.rect;
    case "roundRect": return pptx.ShapeType.roundRect;
    case "ellipse": return pptx.ShapeType.ellipse;
    case "line": return pptx.ShapeType.line;
    case "rightArrow": return pptx.ShapeType.rightArrow;
    case "leftArrow": return pptx.ShapeType.leftArrow;
    case "upArrow": return pptx.ShapeType.upArrow;
    case "downArrow": return pptx.ShapeType.downArrow;
    case "leftRightArrow": return pptx.ShapeType.leftRightArrow;
    case "upDownArrow": return pptx.ShapeType.upDownArrow;
    case "chevron": return pptx.ShapeType.chevron;
    case "triangle": return pptx.ShapeType.triangle;
    case "callout": return pptx.ShapeType.wedgeRoundRectCallout;
    default: return pptx.ShapeType.rect;
  }
}

function addElement(pptx: PptxGenJS, slide: PptxGenJS.Slide, element: Element, fontFace: string, assetPaths: Map<string, string>): void {
  const box = { x: element.x, y: element.y, w: element.w, h: element.h };
  const rotate = element.rotation || undefined;
  switch (element.kind) {
    case "text":
      slide.addText(element.text, {
        ...box, rotate, fontFace, fontSize: element.fontSize, bold: element.bold,
        color: hex(element.color), align: element.align, valign: element.valign === "mid" ? "middle" : element.valign,
        margin: 0, breakLine: false, fit: "shrink", transparency: 0,
      });
      break;
    case "shape": {
      const shapeType = getPptxShapeType(pptx, element.shape);
      const isLine = element.shape === "line";
      const endArrowType = (element.arrowHead === "end" || element.arrowHead === "both") ? "arrow" : undefined;
      const beginArrowType = (element.arrowHead === "start" || element.arrowHead === "both") ? "arrow" : undefined;
      slide.addShape(shapeType, {
        ...(isLine ? { x: element.x, y: element.y + element.h / 2, w: element.w, h: 0 } : box),
        // PptxGenJS 4 の roundRect は rectRadius(0.0〜1.0)で角丸を指定する。
        ...(element.shape === "roundRect" ? { rectRadius: element.radius ?? 0.08 } : {}),
        rotate,
        fill: isLine ? undefined : { color: hex(element.fill) },
        line: {
          color: hex(element.stroke || element.fill),
          width: isLine ? 2 : (element.stroke ? 1 : 0),
          endArrowType,
          beginArrowType,
        },
      });
      break;
    }
    case "icon": {
      const dataUri = getIconSvgDataUri(element.name, element.color, 64);
      slide.addImage({ data: dataUri, ...box, rotate });
      break;
    }
    case "image": {
      const filePath = assetPaths.get(element.assetId);
      if (filePath) {
        const sizing = element.objectFit === "fill"
          ? undefined
          : { type: element.objectFit || "contain", w: element.w, h: element.h } as const;
        slide.addImage({
          path: filePath,
          ...box,
          rotate,
          altText: element.alt,
          sizing,
          rounding: !!element.borderRadius,
        });
        if (element.stroke) {
          slide.addShape(element.borderRadius ? pptx.ShapeType.roundRect : pptx.ShapeType.rect, {
            ...box,
            rotate,
            fill: { color: "FFFFFF", transparency: 100 },
            line: { color: hex(element.stroke), width: 1 },
          });
        }
      }
      break;
    }
    case "table":
      slide.addTable(element.rows.map((row) => row.map((text) => ({ text }))), {
        ...box, border: { type: "solid", color: "DDE3EA", pt: 0.6 },
        fill: { color: "FFFFFF" }, color: "182230", fontFace, fontSize: 15,
        margin: 0.1, breakLine: false,
        rowH: element.h / element.rows.length,
        bold: false,
      });
      break;
    case "chart": {
      const chartType = element.chartType === "bar" ? pptx.ChartType.bar : element.chartType === "line" ? pptx.ChartType.line : pptx.ChartType.pie;
      slide.addChart(chartType, element.series.map((series) => ({ name: series.name, labels: series.labels, values: series.values })), {
        ...box, showLegend: element.series.length > 1, showTitle: false,
        showValue: element.chartType === "pie",
        chartColors: ["3156D3", "65A9F0", "85C8A5", "F5B44E"],
        catAxisLabelFontFace: fontFace,
        valAxisLabelFontFace: fontFace,
      });
      break;
    }
  }
}

export async function buildPptx(deck: Deck, assetPaths: Map<string, string>): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Slide Harness";
  pptx.subject = deck.title;
  pptx.title = deck.title;
  pptx.theme = { headFontFace: deck.theme.fontFace, bodyFontFace: deck.theme.fontFace };
  for (const item of deck.slides) {
    const slide = pptx.addSlide();
    slide.background = { color: hex(item.background) };
    for (const element of item.elements) addElement(pptx, slide, element, deck.theme.fontFace, assetPaths);
  }
  const output = await pptx.write({ outputType: "nodebuffer", compression: true });
  return Buffer.from(output as Uint8Array);
}
