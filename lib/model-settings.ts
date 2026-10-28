import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";
import { db, LOCAL_USER_ID, LOCAL_WORKSPACE_ID } from "./db";
import { DocumentError } from "./operations";
import { assertPublicUrl } from "./ssrf";

export const ModelInputSchema = z.object({
  label: z.string().trim().min(1).max(80),
  provider: z.enum(["azure", "vllm"]),
  modelName: z.string().trim().min(1).max(240),
  baseUrl: z.string().trim().max(500).default(""),
  resourceName: z.string().trim().max(120).default(""),
  apiVersion: z.string().trim().max(80).default(""),
  legacyUrls: z.boolean().default(false),
  apiKey: z.string().max(2000).default(""),
  clearApiKey: z.boolean().default(false),
  contextWindow: z.number().int().min(512).max(2_000_000).optional(),
  useManualContext: z.boolean().default(false),
  temperature: z.number().min(0).max(2).default(0.2),
  topP: z.number().min(0.01).max(1).default(1),
  maxOutputTokens: z.number().int().min(64).max(131072).default(4096),
});
export type ModelInput = z.infer<typeof ModelInputSchema>;
export type ModelProfile = {
  id: string; label: string; provider: "azure" | "vllm" | "demo"; modelName: string;
  baseUrl: string; resourceName: string; apiVersion: string; legacyUrls: boolean;
  hasApiKey: boolean; contextWindow: number | null; contextSource: "detected" | "manual" | "unknown";
  temperature: number; topP: number; maxOutputTokens: number; managedBy: "settings" | "environment" | "demo";
  visionSupported: boolean; visionCheckedAt: string | null;
};
export type ModelConfig = ModelProfile & { apiKey?: string };
type DiscoveryInput = Pick<ModelInput, "provider" | "modelName" | "baseUrl" | "resourceName" | "apiVersion"> & { apiKey?: string; trusted?: boolean };
type DiscoveredModel = { id: string; contextWindow: number | null };

function keyBytes(): Buffer {
  const raw = process.env.AI_SETTINGS_ENCRYPTION_KEY;
  if (!raw) throw new DocumentError("API キーを保存するには AI_SETTINGS_ENCRYPTION_KEY を設定してください。", 400);
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new DocumentError("AI_SETTINGS_ENCRYPTION_KEY は32バイトのBase64値にしてください。", 500);
  return key;
}
function encrypt(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(), iv);
  const payload = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${payload.toString("base64url")}`;
}
function decrypt(value: string): string {
  const [version, iv, tag, payload] = value.split(".");
  if (version !== "v1" || !iv || !tag || !payload) throw new Error("保存済みの AI キーを読み取れません。");
  const decipher = createDecipheriv("aes-256-gcm", keyBytes(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(payload, "base64url")), decipher.final()]).toString("utf8");
}

function normalizeBaseUrl(raw: string, publicOnly = false): string {
  let url: URL;
  try { url = new URL(raw); } catch { throw new DocumentError("接続先 URL を入力してください。", 400); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new DocumentError("接続先は認証情報やクエリを含まない http(s) URL にしてください。", 400);
  }
  if (publicOnly) assertPublicUrl(url);
  return url.toString().replace(/\/$/, "");
}
function azureResourceUrl(resourceName: string, publicOnly: boolean): string {
  if (!/^[a-zA-Z0-9-]+$/.test(resourceName)) throw new DocumentError("Azure リソース名は英数字とハイフンのみにしてください。", 400);
  const url = new URL(`https://${resourceName}.openai.azure.com/openai/v1`);
  if (url.hostname !== `${resourceName}.openai.azure.com`) throw new DocumentError("Azure リソース名が不正です。", 400);
  if (publicOnly) assertPublicUrl(url);
  return url.toString().replace(/\/$/, "");
}
function endpoint(input: Pick<DiscoveryInput, "provider" | "baseUrl" | "resourceName">, publicOnly = false): string {
  if (input.baseUrl) return normalizeBaseUrl(input.baseUrl, publicOnly);
  if (input.provider === "azure" && input.resourceName) return azureResourceUrl(input.resourceName, publicOnly);
  throw new DocumentError("接続先 URL を設定してください。", 400);
}
export function endpointOf(target: Pick<DiscoveryInput, "provider" | "baseUrl" | "resourceName">): string {
  return endpoint(target);
}
type TargetRef = { provider: ModelProfile["provider"]; baseUrl: string; resourceName: string };
function sameTarget(a: TargetRef, b: TargetRef): boolean {
  if (a.provider !== b.provider || a.provider === "demo" || b.provider === "demo") return false;
  try { return endpoint({ ...a, provider: a.provider as "azure" | "vllm" }) === endpoint({ ...b, provider: b.provider as "azure" | "vllm" }); } catch { return false; }
}
export function matchesStoredTarget(stored: TargetRef, target: TargetRef): boolean {
  return sameTarget(stored, target);
}
function contextFrom(raw: unknown): number | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const nested = item.model_info && typeof item.model_info === "object" ? item.model_info as Record<string, unknown> : {};
  for (const value of [item.context_length, item.max_model_len, item.max_context_length, item.context_window, item.max_input_tokens, nested.context_length, nested.max_model_len]) {
    const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    if (Number.isInteger(number) && number >= 512 && number <= 2_000_000) return number;
  }
  return null;
}

export async function discoverModels(input: DiscoveryInput): Promise<DiscoveredModel[]> {
  const base = endpoint(input, !input.trusted);
  const headers: Record<string, string> = {};
  if (input.apiKey) headers[input.provider === "azure" ? "api-key" : "Authorization"] = input.provider === "azure" ? input.apiKey : `Bearer ${input.apiKey}`;
  const response = await fetch(`${base}/models`, { headers, cache: "no-store", signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new DocumentError(`モデル一覧の取得に失敗しました（HTTP ${response.status}）。`, 400);
  const data = await response.json() as { data?: unknown[]; models?: unknown[] };
  const items = Array.isArray(data.data) ? data.data : Array.isArray(data.models) ? data.models : [];
  return items.filter((raw) => raw && typeof raw === "object" && (raw as Record<string, unknown>).task !== "text-to-image")
    .map((raw) => ({ id: String((raw as Record<string, unknown>).id ?? ""), contextWindow: contextFrom(raw) }))
    .filter((item) => item.id);
}

async function detectContext(input: DiscoveryInput): Promise<number | null> {
  const models = await discoverModels(input);
  const found = models.find((item) => item.id === input.modelName);
  if (found?.contextWindow) return found.contextWindow;
  const base = endpoint(input, !input.trusted);
  const headers: Record<string, string> = {};
  if (input.apiKey) headers[input.provider === "azure" ? "api-key" : "Authorization"] = input.provider === "azure" ? input.apiKey : `Bearer ${input.apiKey}`;
  const response = await fetch(`${base}/models/${encodeURIComponent(input.modelName)}`, { headers, cache: "no-store", signal: AbortSignal.timeout(8000) });
  if (!response.ok) return null;
  return contextFrom(await response.json());
}

function fromRow(row: Record<string, unknown>, withSecret = false): ModelConfig {
  return {
    id: String(row.id), label: String(row.label), provider: row.provider as "azure" | "vllm", modelName: String(row.model_name),
    baseUrl: String(row.base_url ?? ""), resourceName: String(row.resource_name ?? ""), apiVersion: String(row.api_version ?? ""),
    legacyUrls: Boolean(row.legacy_urls), hasApiKey: Boolean(row.api_key_encrypted),
    contextWindow: Number(row.context_window), contextSource: row.context_source as "detected" | "manual",
    temperature: row.provider === "vllm" ? 1 : Number(row.temperature), topP: row.provider === "vllm" ? 0.95 : Number(row.top_p), maxOutputTokens: Number(row.max_output_tokens), managedBy: "settings",
    visionSupported: Boolean(row.vision_supported), visionCheckedAt: row.vision_checked_at ? new Date(String(row.vision_checked_at)).toISOString() : null,
    ...(withSecret && row.api_key_encrypted ? { apiKey: decrypt(String(row.api_key_encrypted)) } : {}),
  };
}

const envCache = new Map<string, { value: number | null; until: number }>();
async function environmentContext(input: DiscoveryInput): Promise<number | null> {
  const key = `${input.provider}:${input.baseUrl}:${input.modelName}`;
  const cached = envCache.get(key);
  if (cached && cached.until > Date.now()) return cached.value;
  let value: number | null = null;
  try { value = await detectContext(input); } catch { /* Manual registration remains available. */ }
  envCache.set(key, { value, until: Date.now() + 5 * 60_000 });
  return value;
}
function environmentMaxOutput(contextWindow: number | null): number {
  return contextWindow ? Math.min(4096, Math.max(64, Math.floor(contextWindow * 0.2))) : 4096;
}
// 環境モデル(env-*)は DB 行を持たないため、Vision 確認状態は実行中のメモリ保持で扱う。永続化は settings 管理モデルだけ。
const envVisionStatus = new Map<string, { supported: boolean; checkedAt: string }>();

async function environmentModels(): Promise<ModelConfig[]> {
  const models: ModelConfig[] = [];
  if (process.env.VLLM_BASE_URL && process.env.VLLM_MODEL) {
    const baseUrl = process.env.VLLM_BASE_URL;
    const modelName = process.env.VLLM_MODEL;
    const apiKey = process.env.VLLM_API_KEY || undefined;
    const contextWindow = Number(process.env.VLLM_CONTEXT_WINDOW) || await environmentContext({ provider: "vllm", baseUrl, modelName, resourceName: "", apiVersion: "", apiKey, trusted: true });
    const vision = envVisionStatus.get("env-vllm");
    models.push({ id: "env-vllm", label: `OpenAI 互換 · ${modelName}`, provider: "vllm", modelName, baseUrl, resourceName: "", apiVersion: "", legacyUrls: false,
      hasApiKey: !!apiKey, apiKey, contextWindow, contextSource: process.env.VLLM_CONTEXT_WINDOW ? "manual" : contextWindow ? "detected" : "unknown",
      temperature: 1, topP: 0.95, maxOutputTokens: environmentMaxOutput(contextWindow), managedBy: "environment",
      visionSupported: vision?.supported ?? false, visionCheckedAt: vision?.checkedAt ?? null });
  }
  if (process.env.AZURE_OPENAI_DEPLOYMENT && process.env.AZURE_OPENAI_API_KEY && (process.env.AZURE_OPENAI_RESOURCE || process.env.AZURE_OPENAI_ENDPOINT)) {
    const modelName = process.env.AZURE_OPENAI_DEPLOYMENT;
    const baseUrl = process.env.AZURE_OPENAI_ENDPOINT || "";
    const resourceName = process.env.AZURE_OPENAI_RESOURCE || "";
    const apiKey = process.env.AZURE_OPENAI_API_KEY;
    const contextWindow = Number(process.env.AZURE_OPENAI_CONTEXT_WINDOW) || await environmentContext({ provider: "azure", baseUrl, resourceName, modelName, apiVersion: process.env.AZURE_OPENAI_API_VERSION || "", apiKey, trusted: true });
    const vision = envVisionStatus.get("env-azure");
    models.push({ id: "env-azure", label: `Azure OpenAI · ${modelName}`, provider: "azure", modelName, baseUrl, resourceName,
      apiVersion: process.env.AZURE_OPENAI_API_VERSION || "", legacyUrls: process.env.AZURE_OPENAI_LEGACY_URLS === "true",
      hasApiKey: true, apiKey, contextWindow, contextSource: process.env.AZURE_OPENAI_CONTEXT_WINDOW ? "manual" : contextWindow ? "detected" : "unknown",
      temperature: 0.2, topP: 1, maxOutputTokens: environmentMaxOutput(contextWindow), managedBy: "environment",
      visionSupported: vision?.supported ?? false, visionCheckedAt: vision?.checkedAt ?? null });
  }
  if (process.env.DEMO_AI === "true") models.push({ id: "demo", label: "デモ（外部AIなし）", provider: "demo", modelName: "demo", baseUrl: "", resourceName: "", apiVersion: "", legacyUrls: false,
    hasApiKey: false, contextWindow: null, contextSource: "unknown", temperature: 0.2, topP: 1, maxOutputTokens: 4096, managedBy: "demo", visionSupported: false, visionCheckedAt: null });
  return models;
}

export async function listModels(): Promise<ModelProfile[]> {
  const rows = await db().query("SELECT * FROM ai_models WHERE workspace_id=$1 ORDER BY updated_at DESC", [LOCAL_WORKSPACE_ID]);
  const registered = rows.rows.map((row) => fromRow(row));
  const env = await environmentModels();
  return [...registered, ...env.filter((item) => !registered.some((saved) => saved.provider === item.provider && saved.modelName === item.modelName && saved.baseUrl === item.baseUrl))]
    .map(({ apiKey: _secret, ...profile }) => profile);
}

export async function getModel(id: string): Promise<ModelConfig | null> {
  if (id === "demo" || id.startsWith("env-")) return (await environmentModels()).find((model) => model.id === id) ?? null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const rows = await db().query("SELECT * FROM ai_models WHERE id=$1 AND workspace_id=$2", [id, LOCAL_WORKSPACE_ID]);
  return rows.rows[0] ? fromRow(rows.rows[0], true) : null;
}

export async function saveModel(inputRaw: unknown, id?: string): Promise<ModelProfile> {
  const input = ModelInputSchema.parse(inputRaw);
  const existing = id ? await getModel(id) : null;
  if (id && (!existing || existing.managedBy !== "settings")) throw new DocumentError("編集できるモデルが見つかりません。", 404);
  const baseUrl = input.baseUrl ? normalizeBaseUrl(input.baseUrl) : "";
  if (input.provider === "vllm" && !baseUrl) throw new DocumentError("OpenAI 互換 API の URL を入力してください。", 400);
  if (input.provider === "azure" && !baseUrl && !input.resourceName) throw new DocumentError("Azure のリソース名または URL を入力してください。", 400);
  const reuseSavedKey = !!existing && existing.provider === input.provider && !input.clearApiKey &&
    sameTarget(existing, { provider: input.provider, baseUrl, resourceName: input.resourceName });
  const apiKey = input.clearApiKey ? "" : input.apiKey || (reuseSavedKey ? existing?.apiKey : "") || "";
  if (input.provider === "azure" && !apiKey) throw new DocumentError("Azure OpenAI の API キーを入力してください。", 400);
  let detected: number | null = null;
  if (!input.useManualContext) {
    try { detected = await detectContext({ ...input, baseUrl, apiKey, trusted: true }); } catch { /* Require a manual value below. */ }
  }
  const contextWindow = detected ?? input.contextWindow;
  if (!contextWindow) throw new DocumentError("コンテキスト長を自動取得できませんでした。手動で入力してください。", 400);
  if (input.maxOutputTokens >= Math.floor(contextWindow * 0.8)) throw new DocumentError("最大出力トークン数はコンテキスト長の80%未満にしてください。", 400);
  const encryptedKey = input.clearApiKey ? null : input.apiKey ? encrypt(input.apiKey) : reuseSavedKey && id ? (await db().query("SELECT api_key_encrypted FROM ai_models WHERE id=$1 AND workspace_id=$2", [id, LOCAL_WORKSPACE_ID])).rows[0]?.api_key_encrypted ?? null : null;
  const modelId = id ?? crypto.randomUUID();
  await db().query(`INSERT INTO ai_models(id,workspace_id,created_by_user_id,label,provider,model_name,base_url,resource_name,api_version,legacy_urls,api_key_encrypted,context_window,context_source,temperature,top_p,max_output_tokens)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
    ON CONFLICT(id) DO UPDATE SET label=$4,provider=$5,model_name=$6,base_url=$7,resource_name=$8,api_version=$9,legacy_urls=$10,api_key_encrypted=$11,context_window=$12,context_source=$13,temperature=$14,top_p=$15,max_output_tokens=$16,vision_supported=false,vision_checked_at=NULL,updated_at=now()`,
  [modelId, LOCAL_WORKSPACE_ID, LOCAL_USER_ID, input.label, input.provider, input.modelName, baseUrl || null, input.resourceName || null, input.apiVersion || null,
    input.legacyUrls, encryptedKey, contextWindow, detected ? "detected" : "manual", input.provider === "vllm" ? 1 : input.temperature, input.provider === "vllm" ? 0.95 : input.topP, input.maxOutputTokens]);
  const saved = await getModel(modelId);
  if (!saved) throw new Error("保存したモデルを取得できませんでした。");
  const { apiKey: _secret, ...profile } = saved;
  return profile;
}

export async function recordVisionStatus(id: string, visionSupported: boolean): Promise<void> {
  if (id.startsWith("env-")) {
    envVisionStatus.set(id, { supported: visionSupported, checkedAt: new Date().toISOString() });
    return;
  }
  await updateVisionStatus(id, visionSupported);
}

export async function updateVisionStatus(id: string, visionSupported: boolean): Promise<void> {
  const result = await db().query("UPDATE ai_models SET vision_supported=$3, vision_checked_at=now(), updated_at=now() WHERE id=$1 AND workspace_id=$2", [id, LOCAL_WORKSPACE_ID, visionSupported]);
  if (!result.rowCount) throw new DocumentError("Vision 機能を保存できるモデルが見つかりません。", 404);
}

export async function deleteModel(id: string): Promise<void> {
  const result = await db().query("DELETE FROM ai_models WHERE id=$1 AND workspace_id=$2", [id, LOCAL_WORKSPACE_ID]);
  if (!result.rowCount) throw new DocumentError("削除するモデルが見つかりません。", 404);
}
