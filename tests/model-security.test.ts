import { createCipheriv, randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

const KEY = Buffer.alloc(32, 7).toString("base64");
process.env.AI_SETTINGS_ENCRYPTION_KEY = KEY;
function encryptKey(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(KEY, "base64"), iv);
  const payload = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${payload.toString("base64url")}`;
}
const ENCRYPTED = encryptKey("stored-secret");
const MODEL_ID = "11111111-1111-1111-1111-111111111111";

process.env.VLLM_BASE_URL = "http://127.0.0.1:8000/v1";
process.env.VLLM_MODEL = "probe-model";
process.env.VLLM_CONTEXT_WINDOW = "8192";

const state = {
  inserts: [] as unknown[][],
  visionUpdates: [] as unknown[][],
  row: {
    id: MODEL_ID, label: "保存済み", provider: "azure", model_name: "dep-a",
    base_url: "https://contoso.openai.azure.com/openai/v1", resource_name: "", api_version: "2025-01-01-preview",
    legacy_urls: false, api_key_encrypted: ENCRYPTED, context_window: 8192, context_source: "manual",
    temperature: 0.2, top_p: 1, max_output_tokens: 1024, vision_supported: false, vision_checked_at: null,
  } as Record<string, unknown>,
};

vi.mock("../lib/db", () => ({
  db: () => ({ query: async (sql: string, values?: unknown[]) => {
    if (sql.includes("SELECT * FROM ai_models")) return { rows: [state.row] };
    if (sql.includes("SELECT api_key_encrypted")) return { rows: [{ api_key_encrypted: state.row.api_key_encrypted }] };
    if (sql.includes("INSERT INTO ai_models")) { state.inserts.push(values ?? []); return { rows: [], rowCount: 1 }; }
    if (sql.includes("UPDATE ai_models")) { state.visionUpdates.push(values ?? []); return { rows: [], rowCount: 1 }; }
    throw new Error(`Unexpected query: ${sql}`);
  } }),
  LOCAL_USER_ID: "00000000-0000-4000-8000-000000000001",
  LOCAL_WORKSPACE_ID: "00000000-0000-4000-8000-000000000002",
}));

import { discoverModels, endpointOf, listModels, matchesStoredTarget, recordVisionStatus, saveModel } from "../lib/model-settings";
import { isRestrictedHost } from "../lib/ssrf";

describe("SSRF host guard", () => {
  it("rejects localhost, loopback, link-local, multicast, unspecified, and private addresses", () => {
    for (const host of ["localhost", "ai.localhost", "127.0.0.1", "127.5.6.7", "0.0.0.0", "10.1.2.3",
      "172.16.0.1", "192.168.0.9", "169.254.1.1", "224.0.0.5", "239.1.1.1", "::1", "[::1]", "::",
      "fe80::1", "fd12::34", "ff02::1", "::ffff:192.168.1.5", "::ffff:10.0.0.1"]) {
      expect(isRestrictedHost(host), host).toBe(true);
    }
  });

  it("keeps public addresses and hostnames allowed", () => {
    for (const host of ["8.8.8.8", "172.32.0.1", "169.253.1.1", "example.com", "contoso.openai.azure.com"]) {
      expect(isRestrictedHost(host), host).toBe(false);
    }
  });

  it("blocks direct private URLs in discovery but allows trusted saved targets", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: "m1", max_model_len: 8192 }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const target = { provider: "vllm" as const, baseUrl: "http://127.0.0.1:8000/v1", modelName: "m1", resourceName: "", apiVersion: "" };
    await expect(discoverModels(target)).rejects.toThrow(/ローカル・プライベート/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await discoverModels({ ...target, trusted: true })).toEqual([{ id: "m1", contextWindow: 8192 }]);
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8000/v1/models", expect.anything());
    vi.unstubAllGlobals();
  });
});

describe("Stored API key reuse", () => {
  const baseInput = {
    label: "L", provider: "azure" as const, modelName: "dep-a",
    baseUrl: "https://contoso.openai.azure.com/openai/v1/", resourceName: "", apiVersion: "2025-01-01-preview",
    legacyUrls: false, apiKey: "", clearApiKey: false, contextWindow: 4096, useManualContext: true,
    temperature: 0.2, topP: 1, maxOutputTokens: 1024,
  };

  it("reuses the stored key only for the matching normalized endpoint", async () => {
    await saveModel(baseInput, MODEL_ID);
    expect(state.inserts[0]?.[10]).toBe(ENCRYPTED);
  });

  it("refuses to reuse the stored key for a different endpoint", async () => {
    state.inserts.length = 0;
    await expect(saveModel({ ...baseInput, baseUrl: "https://attacker.example.com/openai/v1" }, MODEL_ID)).rejects.toThrow(/API キー/);
    expect(state.inserts.length).toBe(0);
  });

  it("refuses to reuse the stored key when the vLLM endpoint changed", async () => {
    state.inserts.length = 0;
    state.row = { ...state.row, provider: "vllm", base_url: "http://127.0.0.1:8000/v1", resource_name: "" };
    await saveModel({ ...baseInput, provider: "vllm", baseUrl: "http://10.0.0.2:8000/v1" }, MODEL_ID);
    expect(state.inserts[0]?.[10]).toBeNull();
  });

  it("matches resource-name and URL forms of the same Azure endpoint", () => {
    expect(matchesStoredTarget({ provider: "azure", baseUrl: "", resourceName: "contoso" },
      { provider: "azure", baseUrl: "https://contoso.openai.azure.com/openai/v1", resourceName: "" })).toBe(true);
    expect(matchesStoredTarget({ provider: "azure", baseUrl: "https://contoso.openai.azure.com/openai/v1", resourceName: "" },
      { provider: "azure", baseUrl: "https://evil.example.com/openai/v1", resourceName: "" })).toBe(false);
    expect(matchesStoredTarget({ provider: "azure", baseUrl: "https://contoso.openai.azure.com/openai/v1", resourceName: "" },
      { provider: "vllm", baseUrl: "https://contoso.openai.azure.com/openai/v1", resourceName: "" })).toBe(false);
  });

  it("rejects Azure resource names that could redirect the endpoint host", async () => {
    expect(() => endpointOf({ provider: "azure", baseUrl: "", resourceName: "x/y.openai.azure.com" })).toThrow(/リソース名/);
    await expect(discoverModels({ provider: "azure", baseUrl: "", resourceName: "x/y.openai.azure.com", modelName: "m", apiVersion: "" }))
      .rejects.toThrow(/リソース名/);
  });
});

describe("Vision status storage", () => {
  it("keeps environment-model vision results in memory without DB writes", async () => {
    state.visionUpdates.length = 0;
    await recordVisionStatus("env-vllm", true);
    const models = await listModels();
    const env = models.find((model) => model.id === "env-vllm");
    expect(env?.visionSupported).toBe(true);
    expect(env?.visionCheckedAt).not.toBeNull();
    expect(state.visionUpdates.length).toBe(0);
  });

  it("starts environment models as unverified and persists status only for settings-managed models", async () => {
    state.visionUpdates.length = 0;
    expect((await listModels()).find((model) => model.id === "env-azure")?.visionSupported ?? false).toBe(false);
    await recordVisionStatus(MODEL_ID, true);
    expect(state.visionUpdates.length).toBe(1);
    expect(state.visionUpdates[0]?.[2]).toBe(true);
  });
});
