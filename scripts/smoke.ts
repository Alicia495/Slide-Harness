import assert from "node:assert/strict";

const base = process.env.APP_URL || "http://127.0.0.1:3000";
async function request<T>(route: string, body?: unknown): Promise<T> {
  const response = await fetch(`${base}${route}`, body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(`${route}: ${JSON.stringify(data)}`);
  return data as T;
}

const health = await request<{ status: string }>("/api/health");
assert.equal(health.status, "ok");
const created = await request<{ project: { id: string; version: number } }>("/api/projects", { title: "動作確認" });
const id = created.project.id;
const invalid = await fetch(`${base}/api/projects/${id}/chat`, { method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ baseVersion: 0, prompt: "失敗する入力", modelId: "missing-model" }) });
assert.equal(invalid.status, 400);
const afterFailure = await request<{ messages: unknown[] }>(`/api/projects/${id}`);
assert.equal(afterFailure.messages.length, 0);
const chat = await request<{ mode: string; proposal: { id: string } }>(`/api/projects/${id}/chat`, {
  baseVersion: 0, prompt: "社内向けの製品提案を4枚で", modelId: "demo",
});
assert.equal(chat.mode, "proposal");
const whilePending = await fetch(`${base}/api/projects/${id}/chat`, { method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ baseVersion: 0, prompt: "重複する提案", modelId: "demo" }) });
assert.equal(whilePending.status, 409);
const pendingHistory = await request<{ messages: unknown[] }>(`/api/projects/${id}`);
assert.equal(pendingHistory.messages.length, 2);
const rejected = await request<{ project: null }>(`/api/projects/${id}/proposals/${chat.proposal.id}`, { accept: false });
assert.equal(rejected.project, null);
const afterReject = await request<{ project: { version: number }; proposal: null }>(`/api/projects/${id}`);
assert.equal(afterReject.project.version, 0);
assert.equal(afterReject.proposal, null);
const replacement = await request<{ mode: string; proposal: { id: string } }>(`/api/projects/${id}/chat`, {
  baseVersion: 0, prompt: "社内向けの製品提案を4枚で", modelId: "demo",
});
assert.equal(replacement.mode, "proposal");
const accepted = await request<{ project: { version: number; deck: { slides: { id: string; elements: { id: string; kind: string; role?: string }[] }[] } } }>(
  `/api/projects/${id}/proposals/${replacement.proposal.id}`, { accept: true });
assert.equal(accepted.project.version, 1);
assert.equal(accepted.project.deck.slides.length, 4);
const slide = accepted.project.deck.slides[0];
const title = slide.elements.find((element) => element.kind === "text" && element.role === "title");
assert.ok(title);
const edit = await request<{ project: { version: number } }>(`/api/projects/${id}/operations`, {
  baseVersion: 1, operations: [{ type: "updateText", slideId: slide.id, elementId: title.id, text: "確定したタイトル" }],
});
assert.equal(edit.project.version, 2);
const aiEdit = await request<{ mode: string; project: { version: number } }>(`/api/projects/${id}/chat`, {
  baseVersion: 2, prompt: "タイトルを調整して", modelId: "demo", target: { slideId: slide.id, elementId: title.id },
});
assert.equal(aiEdit.mode, "applied");
assert.equal(aiEdit.project.version, 3);
const restored = await request<{ project: { version: number; deck: { slides: { elements: { text?: string }[] }[] } } }>(`/api/projects/${id}/restore`, {
  baseVersion: 3, restoreVersion: 2,
});
assert.equal(restored.project.version, 4);
assert.ok(restored.project.deck.slides[0].elements.some((element) => element.text === "確定したタイトル"));
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
console.log(`Smoke passed: project ${id}, version 5, image and PPTX exported`);
