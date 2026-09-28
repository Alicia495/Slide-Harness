import PptxGenJS from "pptxgenjs";
import type { Deck, Element } from "./document";

const hex = (value: string) => value.replace(/^#/, "");

function addElement(pptx: PptxGenJS, slide: PptxGenJS.Slide, element: Element, fontFace: string, assetPaths: Map<string, string>): void {
  const box = { x: element.x, y: element.y, w: element.w, h: element.h };
  switch (element.kind) {
    case "text":
      slide.addText(element.text, {
        ...box, fontFace, fontSize: element.fontSize, bold: element.bold,
        color: hex(element.color), align: element.align, valign: element.valign === "mid" ? "middle" : element.valign,
        margin: 0, breakLine: false, fit: "shrink", transparency: 0,
      });
      break;
    case "shape":
      slide.addShape(
        element.shape === "rect" ? pptx.ShapeType.rect : element.shape === "roundRect" ? pptx.ShapeType.roundRect : element.shape === "ellipse" ? pptx.ShapeType.ellipse : pptx.ShapeType.line,
        { ...box, fill: element.shape === "line" ? undefined : { color: hex(element.fill) },
          line: { color: hex(element.stroke || element.fill), width: element.shape === "line" ? 1.5 : 0 } },
      );
      break;
    case "image": {
      const filePath = assetPaths.get(element.assetId);
      if (filePath) slide.addImage({ path: filePath, ...box, altText: element.alt });
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
