import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { parsePotxTheme } from "../lib/templates";
import { DEFAULT_THEME, emptyDeck } from "../lib/document";

const POTX_CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.template.main+xml"/>
</Types>`;

const PPTX_CONTENT_TYPES = POTX_CONTENT_TYPES.replace("presentationml.template.main+xml", "presentationml.presentation.main+xml");

function themeXml(options: { withAccent2?: boolean; sysClrText?: boolean; font?: string; majorFont?: string } = {}): string {
  const { withAccent2 = true, sysClrText = true, font = "Yu Gothic", majorFont = "Yu Gothic UI Semibold" } = options;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Company">
 <a:themeElements>
  <a:clrScheme name="Company">
   <a:dk1>${sysClrText ? '<a:sysClr val="windowText" lastClr="111111"/>' : '<a:srgbClr val="222222"/>'}</a:dk1>
   <a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
   <a:dk2><a:srgbClr val="44546A"/></a:dk2>
   <a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>
   <a:accent1><a:srgbClr val="C00000"/></a:accent1>
   ${withAccent2 ? '<a:accent2><a:srgbClr val="ED7D31"/></a:accent2>' : ""}
   <a:hlink><a:srgbClr val="0563C1"/></a:hlink>
   <a:folHlink><a:srgbClr val="954F72"/></a:folHlink>
  </a:clrScheme>
  <a:fontScheme name="Company">
   <a:majorFont><a:latin typeface="${majorFont}"/></a:majorFont>
   <a:minorFont><a:latin typeface="${font}"/></a:minorFont>
  </a:fontScheme>
  <a:fmtScheme name="Office"/>
 </a:themeElements>
</a:theme>`;
}

async function potxBytes(contentTypes: string, theme: string | null): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", contentTypes);
  zip.file("ppt/presentation.xml", "<?xml version=\"1.0\"?><p:presentation xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\"/>");
  if (theme) zip.file("ppt/theme/theme1.xml", theme);
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("parsePotxTheme", () => {
  it("Extracts color scheme and fonts from theme of real .potx structure", async () => {
    const theme = await parsePotxTheme(await potxBytes(POTX_CONTENT_TYPES, themeXml()), "会社テンプレート");
    expect(theme).toEqual({
      name: "会社テンプレート", primary: "#C00000", accent: "#ED7D31",
      background: "#FFFFFF", text: "#111111", fontFace: "Yu Gothic",
    });
  });

  it("Falls back to DEFAULT_THEME fields when missing", async () => {
    const theme = await parsePotxTheme(await potxBytes(POTX_CONTENT_TYPES, themeXml({ withAccent2: false, font: "", majorFont: "" })), "部分のみ");
    expect(theme.accent).toBe(DEFAULT_THEME.accent);
    expect(theme.fontFace).toBe(DEFAULT_THEME.fontFace);
    expect(theme.primary).toBe("#C00000");
  });

  it("Falls back to majorFont when minorFont typeface is empty", async () => {
    const theme = await parsePotxTheme(await potxBytes(POTX_CONTENT_TYPES, themeXml({ font: "" })), "フォント代替");
    expect(theme.fontFace).toBe("Yu Gothic UI Semibold");
  });

  it("Uses srgbClr for dk1 when sysClr absent", async () => {
    const theme = await parsePotxTheme(await potxBytes(POTX_CONTENT_TYPES, themeXml({ sysClrText: false })), "別名");
    expect(theme.text).toBe("#222222");
  });

  it("Rejects .pptx content as not a template", async () => {
    const bytes = await potxBytes(PPTX_CONTENT_TYPES, themeXml());
    await expect(parsePotxTheme(bytes, "x")).rejects.toThrow(/\.potx/);
  });

  it("Rejects non-zip bytes", async () => {
    await expect(parsePotxTheme(Buffer.from("not a zip file"), "x")).rejects.toThrow(/テンプレート/);
  });

  it("Rejects zip without theme part", async () => {
    await expect(parsePotxTheme(await potxBytes(POTX_CONTENT_TYPES, null), "x")).rejects.toThrow(/テーマ/);
  });

  it("Rejects zip without content types part", async () => {
    const zip = new JSZip();
    zip.file("ppt/theme/theme1.xml", themeXml());
    await expect(parsePotxTheme(await zip.generateAsync({ type: "nodebuffer" }), "x")).rejects.toThrow(/テンプレート/);
  });
});

describe("emptyDeck with theme", () => {
  it("Builds deck from provided theme", () => {
    const deck = emptyDeck("テンプレート資料", { ...DEFAULT_THEME, name: "会社テンプレート", primary: "#C00000" });
    expect(deck.theme.primary).toBe("#C00000");
    expect(deck.theme.name).toBe("会社テンプレート");
    expect(deck.slides).toEqual([]);
  });

  it("Keeps default theme without argument", () => {
    expect(emptyDeck().theme).toEqual(DEFAULT_THEME);
  });
});
