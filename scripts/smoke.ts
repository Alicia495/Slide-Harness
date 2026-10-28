import assert from "node:assert/strict";
import JSZip from "jszip";

const base = process.env.APP_URL || "http://127.0.0.1:3000";
async function request<T>(route: string, body?: unknown): Promise<T> {
  const response = await fetch(`${base}${route}`, body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(`${route}: ${JSON.stringify(data)}`);
  return data as T;
}

const health = await request<{ status: string }>("/api/health");
assert.equal(health.status, "ok");
const created = await request<{ project: { id: string; version: number; plan: string | null } }>("/api/projects", { title: "動作確認" });
const id = created.project.id;
assert.equal(created.project.plan, null);
const invalid = await fetch(`${base}/api/projects/${id}/chat`, { method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ baseVersion: 0, prompt: "失敗する入力", modelId: "missing-model" }) });
assert.equal(invalid.status, 400);
const afterFailure = await request<{ messages: unknown[] }>(`/api/projects/${id}`);
assert.equal(afterFailure.messages.length, 0);
const planChat = await request<{ mode: string; plan: string }>(`/api/projects/${id}/chat`, {
  baseVersion: 0, prompt: "社内向けの製品提案を4枚で", modelId: "demo", mode: "plan",
});
assert.equal(planChat.mode, "plan");
assert.ok(planChat.plan.includes("## スライド構成"));
const planned = await request<{ project: { plan: string | null } }>(`/api/projects/${id}/plan`, { plan: planChat.plan });
assert.equal(planned.project.plan, planChat.plan);
const chatMessages = await request<{ messages: { role: string; metadata: { mode?: string } }[] }>(`/api/projects/${id}`);
assert.ok(chatMessages.messages.some((message) => message.role === "assistant" && message.metadata.mode === "plan"));
const buildNeedsVision = await fetch(`${base}/api/projects/${id}/chat`, { method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ baseVersion: 0, prompt: "デモでは作成できない", modelId: "demo" }) });
assert.equal(buildNeedsVision.status, 400);
const unplanned = await request<{ project: { plan: string | null } }>(`/api/projects/${id}/plan`, { plan: null });
assert.equal(unplanned.project.plan, null);
const replacement = await request<{ project: { version: number; deck: { slides: { id: string; elements: { id: string; kind: string; role?: string; text?: string }[] }[] } } }>(
  `/api/projects/${id}/operations`, {
    baseVersion: 0,
    operations: [{ type: "replaceDeck", title: "動作確認提案", slides: [
      { layout: "title", title: "元タイトル", bullets: [] },
      { layout: "cards", title: "価値", cards: [{ title: "A", body: "a" }, { title: "B", body: "b" }, { title: "C", body: "c" }] },
      { layout: "steps", title: "プロセス", steps: [{ stepNumber: 1, title: "x", body: "x" }, { stepNumber: 2, title: "y", body: "y" }] },
      { layout: "kpi", title: "成果", kpis: [{ value: "10%", label: "a" }, { value: "20%", label: "b" }] },
    ] }],
  });
assert.equal(replacement.project.version, 1);
assert.equal(replacement.project.deck.slides.length, 4);
const themed = await request<{ project: { version: number; deck: { theme: { primary: string; accent: string; background: string; text: string; fontFace: string }; slides: { id: string; elements: { id: string; kind: string; role?: string; text?: string }[] }[] } } }>(
  `/api/projects/${id}/operations`, {
    baseVersion: 1,
    operations: [{ type: "setTheme", primary: "#123456", accent: "#654321", background: "#FAFAFA", text: "#101010", fontFace: "Noto Sans JP" }],
  });
assert.equal(themed.project.deck.theme.primary, "#123456");
assert.equal(themed.project.deck.theme.background, "#FAFAFA");
assert.equal(themed.project.deck.theme.fontFace, "Noto Sans JP");
const slide = themed.project.deck.slides[0];
const title = slide.elements.find((element) => element.kind === "text" && element.role === "title");
assert.ok(title);
const edit = await request<{ project: { version: number } }>(`/api/projects/${id}/operations`, {
  baseVersion: 2, operations: [{ type: "updateText", slideId: slide.id, elementId: title.id, text: "確定したタイトル" }],
});
assert.equal(edit.project.version, 3);
const restored = await request<{ project: { version: number; deck: { slides: { elements: { text?: string }[] }[] } } }>(`/api/projects/${id}/restore`, {
  baseVersion: 3, restoreVersion: 2,
});
assert.equal(restored.project.version, 4);
assert.ok(restored.project.deck.slides[0].elements.some((element) => element.text === "元タイトル"));
const imageBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO3BhtEAAAAASUVORK5CYII=", "base64");
const form = new FormData();
form.set("file", new File([imageBytes], "pixel.png", { type: "image/png" }));
const uploaded = await fetch(`${base}/api/projects/${id}/assets`, { method: "POST", body: form });
assert.equal(uploaded.status, 201);
const asset = await uploaded.json() as { asset: { id: string; url: string } };
const servedImage = await fetch(`${base}${asset.asset.url}`);
assert.equal(servedImage.status, 200);
assert.equal((await servedImage.arrayBuffer()).byteLength, imageBytes.length);
const withImage = await request<{ project: { version: number } }>(`/api/projects/${id}/operations`, {
  baseVersion: 4, operations: [{ type: "addImage", slideId: slide.id, assetId: asset.asset.id, x: 8, y: 3, w: 2, h: 2, alt: "動作確認画像" }],
});
assert.equal(withImage.project.version, 5);
const pptx = await fetch(`${base}/api/projects/${id}/export`);
assert.equal(pptx.status, 200);
assert.equal((await pptx.arrayBuffer()).byteLength > 1000, true);

const potxZip = new JSZip();
potxZip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.template.main+xml"/></Types>`);
potxZip.file("ppt/presentation.xml", "<?xml version=\"1.0\"?><p:presentation xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\"/>");
potxZip.file("ppt/theme/theme1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Smoke"><a:themeElements><a:clrScheme name="Smoke"><a:dk1><a:sysClr val="windowText" lastClr="111111"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="C00000"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2></a:clrScheme><a:fontScheme name="Smoke"><a:majorFont><a:latin typeface="Yu Gothic UI Semibold"/></a:majorFont><a:minorFont><a:latin typeface="Yu Gothic"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`);
const potxBytes = await potxZip.generateAsync({ type: "nodebuffer" });
const templateForm = new FormData();
templateForm.set("file", new File([new Uint8Array(potxBytes)], "スモークテンプレート.potx", { type: "application/vnd.openxmlformats-officedocument.presentationml.template" }));
const templateResponse = await fetch(`${base}/api/templates`, { method: "POST", body: templateForm });
assert.equal(templateResponse.status, 201);
const { template } = await templateResponse.json() as { template: { id: string; theme: { primary: string; text: string; fontFace: string } } };
assert.equal(template.theme.primary, "#C00000");
assert.equal(template.theme.text, "#111111");
assert.equal(template.theme.fontFace, "Yu Gothic");
const notTemplateForm = new FormData();
notTemplateForm.set("file", new File([new Uint8Array(potxBytes.subarray(0, 64))], "broken.potx", { type: "application/octet-stream" }));
const notTemplateResponse = await fetch(`${base}/api/templates`, { method: "POST", body: notTemplateForm });
assert.equal(notTemplateResponse.status, 400);
const templateList = await fetch(`${base}/api/templates`);
assert.equal((await templateList.json() as { templates: { id: string }[] }).templates.some((item) => item.id === template.id), true);
const templated = await request<{ project: { id: string; deck: { theme: { primary: string; accent: string; background: string; text: string; fontFace: string } } } }>("/api/projects", { templateId: template.id });
assert.equal(templated.project.deck.theme.primary, "#C00000");
assert.equal(templated.project.deck.theme.background, "#FFFFFF");
assert.equal(templated.project.deck.theme.fontFace, "Yu Gothic");
const removed = await fetch(`${base}/api/templates/${template.id}`, { method: "DELETE" });
assert.equal(removed.status, 200);

const deleted = await fetch(`${base}/api/projects/${id}`, { method: "DELETE" });
assert.equal(deleted.status, 200);
const afterDelete = await fetch(`${base}/api/projects/${id}`);
assert.equal(afterDelete.status, 404);
const templateProjectDelete = await fetch(`${base}/api/projects/${templated.project.id}`, { method: "DELETE" });
assert.equal(templateProjectDelete.status, 200);
console.log(`Smoke passed: plan phase, full setTheme, potx template handoff, project delete`);
