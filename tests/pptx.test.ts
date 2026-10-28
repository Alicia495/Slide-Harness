import JSZip from "jszip";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { emptyDeck, ShapeTypeSchema, type Operation, type ShapeType } from "../lib/document";
import { getIconSvgDataUri } from "../lib/icon-svg";
import { applyOperations } from "../lib/operations";
import { buildPptx } from "../lib/pptx";

describe("PPTX export", () => {
  it("writes editable text, table and chart objects into OOXML", async () => {
    const deck = applyOperations(emptyDeck(), [{ type: "replaceDeck", title: "出力テスト", slides: [
      { layout: "title", title: "出力テスト", subtitle: "編集できます", bullets: [] },
      { layout: "table", title: "表", bullets: [], table: [["項目", "値"], ["A", "10"]] },
      { layout: "chart", title: "グラフ", bullets: [], chart: { type: "bar", series: [{ name: "売上", labels: ["4月", "5月"], values: [10, 18] }] } },
    ] }]);
    const bytes = await buildPptx(deck, new Map());
    expect(bytes.subarray(0, 2).toString()).toBe("PK");
    const zip = await JSZip.loadAsync(bytes);
    const slide1 = await zip.file("ppt/slides/slide1.xml")?.async("string");
    const slide2 = await zip.file("ppt/slides/slide2.xml")?.async("string");
    const slide3 = await zip.file("ppt/slides/slide3.xml")?.async("string");
    expect(slide1).toContain("出力テスト");
    expect(slide1).toContain("<p:sp>");
    expect(slide2).toContain("<a:tbl>");
    expect(slide3).toContain("<c:chart");
  });

  it("exports arrows, icons, and rich layouts into PPTX without error", async () => {
    const deck = applyOperations(emptyDeck(), [{
      type: "replaceDeck", title: "リッチ出力テスト", slides: [
        {
          layout: "steps", title: "3ステップ",
          steps: [
            { stepNumber: 1, title: "計画", body: "詳細な計画を立てる" },
            { stepNumber: 2, title: "実行", body: "迅速に行動する" },
            { stepNumber: 3, title: "改善", body: "振り返りと改善" },
          ],
        },
        {
          layout: "cards", title: "特徴",
          cards: [
            { title: "高信頼性", body: "24時間365日稼働", icon: "Shield" },
            { title: "高速", body: "瞬時に処理", icon: "Zap" },
            { title: "拡張性", body: "段階的に拡張", icon: "Boxes" },
          ],
        },
      ],
    }]);

    const slideId = deck.slides[0].id;
    const withCustomIconAndArrow = applyOperations(deck, [
      { type: "addShape", slideId, shape: "chevron", x: 2, y: 1, w: 1, h: 0.5, fill: "#3156D3", rotation: 30 },
      { type: "addShape", slideId, shape: "line", x: 2, y: 1.7, w: 1, h: 0.2, fill: "#3156D3", arrowHead: "both" },
      { type: "addIcon", slideId, name: "Rocket", x: 4, y: 1, w: 0.8, h: 0.8, color: "#65A9F0" },
    ]);

    const bytes = await buildPptx(withCustomIconAndArrow, new Map());
    expect(bytes.subarray(0, 2).toString()).toBe("PK");

    const zip = await JSZip.loadAsync(bytes);
    const slide1 = await zip.file("ppt/slides/slide1.xml")?.async("string");
    const slide2 = await zip.file("ppt/slides/slide2.xml")?.async("string");
    expect(slide1).toBeDefined();
    expect(slide2).toBeDefined();
    expect(slide1).toContain("<p:sp>");
    expect(slide1).toContain("<p:pic>");
    expect(slide1).toContain('<a:headEnd type="arrow"/>');
    expect(slide1).toContain('<a:tailEnd type="arrow"/>');
    expect(slide2).toContain("<p:pic>");
    const svgFiles = Object.keys(zip.files).filter((name) => name.endsWith(".svg"));
    expect(svgFiles.length).toBeGreaterThan(0);
    const svg = await zip.file(svgFiles[0])?.async("string");
    expect(svg).toContain("<path");
  });

  it("renders the requested Lucide icon instead of the fallback", () => {
    const uri = getIconSvgDataUri("Rocket", "#123456");
    const svg = Buffer.from(uri.split(",")[1], "base64").toString();
    expect(svg).toContain("<path");
    expect(svg).toContain("#123456");
    expect(svg).toContain("M4.5 16.5c-1.5 1.26-2 5-2 5");
  });

  it("maps every supported shape to an editable PowerPoint shape", async () => {
    const deck = applyOperations(emptyDeck(), [{ type: "replaceDeck", title: "図形テスト", slides: [
      { layout: "title", title: "図形テスト" },
      { layout: "section", title: "図形グリッド" },
    ] }]);
    const slideId = deck.slides[1].id;
    const operations: Operation[] = ShapeTypeSchema.options.map((shape, index) => ({
      type: "addShape",
      slideId,
      shape,
      x: 0.2 + index % 8 * 1.6,
      y: 0.35 + Math.floor(index / 8) * 0.85,
      w: 1.2,
      h: 0.8,
      fill: "#3156D3",
    }));
    const filled = operations.reduce((deck, _, index) => index % 30 === 0
      ? applyOperations(deck, operations.slice(index, index + 30))
      : deck, deck);
    const bytes = await buildPptx(filled, new Map());
    const zip = await JSZip.loadAsync(bytes);
    const slide = await zip.file("ppt/slides/slide2.xml")?.async("string");
    const presetByShape: Record<ShapeType, string> = {
      rect: "rect",
      roundRect: "roundRect",
      ellipse: "ellipse",
      line: "line",
      rightArrow: "rightArrow",
      leftArrow: "leftArrow",
      upArrow: "upArrow",
      downArrow: "downArrow",
      leftRightArrow: "leftRightArrow",
      upDownArrow: "upDownArrow",
      chevron: "chevron",
      triangle: "triangle",
      callout: "wedgeRoundRectCallout",
      diamond: "diamond",
      hexagon: "hexagon",
      pentagon: "pentagon",
      octagon: "octagon",
      parallelogram: "parallelogram",
      trapezoid: "trapezoid",
      star4: "star4",
      star5: "star5",
      star6: "star6",
      plus: "plus",
      donut: "donut",
      heart: "heart",
      sun: "sun",
      frame: "frame",
      plaque: "plaque",
      corner: "corner",
      bentArrow: "bentArrow",
      bentUpArrow: "bentUpArrow",
      curvedRightArrow: "curvedRightArrow",
      curvedLeftArrow: "curvedLeftArrow",
      quadArrow: "quadArrow",
      circularArrow: "circularArrow",
      cloudCallout: "cloudCallout",
      wedgeRectCallout: "wedgeRectCallout",
      leftArrowCallout: "leftArrowCallout",
      rightArrowCallout: "rightArrowCallout",
      flowChartTerminator: "flowChartTerminator",
      flowChartProcess: "flowChartProcess",
      flowChartDecision: "flowChartDecision",
      flowChartInputOutput: "flowChartInputOutput",
      flowChartPredefinedProcess: "flowChartPredefinedProcess",
      flowChartDocument: "flowChartDocument",
      flowChartMultidocument: "flowChartMultidocument",
      flowChartInternalStorage: "flowChartInternalStorage",
      flowChartConnector: "flowChartConnector",
      flowChartOffpageConnector: "flowChartOffpageConnector",
      flowChartManualInput: "flowChartManualInput",
      flowChartPreparation: "flowChartPreparation",
      flowChartDelay: "flowChartDelay",
      flowChartMerge: "flowChartMerge",
      flowChartCollate: "flowChartCollate",
      flowChartSort: "flowChartSort",
      flowChartSummingJunction: "flowChartSummingJunction",
      flowChartOr: "flowChartOr",
      flowChartExtract: "flowChartExtract",
    };
    for (const preset of Object.values(presetByShape)) expect(slide).toContain(`prst="${preset}"`);
  });

  it("exports image fill sizing, rounded corners, and a visible border", async () => {
    const directory = await mkdtemp(join(tmpdir(), "slide-harness-pptx-"));
    const imagePath = join(directory, "pixel.png");
    const imageBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
    await writeFile(imagePath, imageBytes);
    try {
      const deck = applyOperations(emptyDeck(), [{ type: "replaceDeck", title: "画像テスト", slides: [{ layout: "title", title: "画像テスト" }] }]);
      const slideId = deck.slides[0].id;
      const assetId = crypto.randomUUID();
      const withImage = applyOperations(deck, [{
        type: "addImage",
        slideId,
        assetId,
        x: 2,
        y: 2,
        w: 4,
        h: 2,
        alt: "装飾画像",
        objectFit: "fill",
        borderRadius: 0.2,
        stroke: "#D24646",
      }]);
            const bytes = await buildPptx(withImage, new Map([[assetId, imagePath]]));
      const zip = await JSZip.loadAsync(bytes);
      const slide = await zip.file("ppt/slides/slide1.xml")?.async("string");
      expect(slide).toContain("装飾画像");
      expect(slide).toContain("D24646");
      expect(slide).toContain("<p:pic>");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
