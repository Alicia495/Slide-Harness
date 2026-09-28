import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { emptyDeck } from "../lib/document";
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
});
