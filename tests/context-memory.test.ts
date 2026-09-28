import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelProfile } from "../lib/model-settings";

const state = vi.hoisted(() => ({ messages: [] as Record<string, unknown>[], saved: [] as unknown[][] }));
vi.mock("../lib/db", () => ({
  db: () => ({ query: async (sql: string, values?: unknown[]) => {
    if (sql.includes("SELECT id FROM conversations")) return { rows: [{ id: "conversation-1" }] };
    if (sql.includes("SELECT * FROM conversation_memory")) return { rows: [] };
    if (sql.includes("SELECT * FROM messages")) return { rows: state.messages };
    if (sql.includes("INSERT INTO conversation_memory")) { state.saved.push(values ?? []); return { rows: [] }; }
    throw new Error(`Unexpected query: ${sql}`);
  } }),
}));

import { assembleContext, compactionThreshold, prepareConversationContext, shouldCompact } from "../lib/context-memory";

const profile: ModelProfile = {
  id: "test", label: "test", provider: "vllm", modelName: "test", baseUrl: "http://localhost/v1", resourceName: "", apiVersion: "",
  legacyUrls: false, hasApiKey: false, contextWindow: 3000, contextSource: "manual", temperature: 0.2, topP: 1,
  maxOutputTokens: 400, managedBy: "settings",
};
beforeEach(() => { state.messages = []; state.saved = []; });

describe("conversation memory", () => {
  it("triggers at 80% including the output reserve", () => {
    expect(compactionThreshold(3000)).toBe(2400);
    expect(shouldCompact(1999, 400, 3000)).toBe(false);
    expect(shouldCompact(2000, 400, 3000)).toBe(true);
  });

  it("keeps recent turns verbatim and records older decisions with a durable boundary", async () => {
    state.messages = Array.from({ length: 10 }, (_, index) => ({
      id: `message-${index}`, role: index % 2 ? "assistant" : "user",
      content: index === 0 ? `最初の方針は濃紺。${"背景説明。".repeat(90)}` : index === 2 ? `最終決定は明るいグレー。${"背景説明。".repeat(90)}` : `発言${index}。${"詳細。".repeat(90)}`,
      metadata: {}, created_at: new Date(Date.UTC(2026, 8, 29, 0, index)).toISOString(),
    }));
    const prompts: string[] = [];
    const result = await prepareConversationContext("project-1", profile, "スライドの現在状態", async (prompt) => {
      prompts.push(prompt);
      return "- [決定] 濃紺案から明るいグレーに変更した。\n- [制約] 説明は簡潔にする。";
    });
    expect(result.compacted).toBe(true);
    expect(prompts[0]).toContain("最初の方針は濃紺");
    expect(prompts[0]).toContain("最終決定は明るいグレー");
    expect(result.text).toContain("濃紺案から明るいグレーに変更");
    expect(result.text).toContain("発言9");
    expect(result.text).not.toContain("背景説明。".repeat(90));
    expect(state.saved).toHaveLength(1);
    expect(state.saved[0][3]).toBe("message-5");
  });

  it("preserves exact recent wording in assembled context", () => {
    const text = assembleContext({ observations: [], reflection: "目的: 社内提案", lastCompactedMessageId: null, compactionCount: 0 }, [
      { id: "1", role: "user", content: "タイトルは『次の一歩』", metadata: {}, createdAt: "2026-09-29T00:00:00Z" },
    ]);
    expect(text).toContain("目的: 社内提案");
    expect(text).toContain("タイトルは『次の一歩』");
  });

  it("includes the current request without writing it to message history", async () => {
    const pending = { id: "pending", role: "user" as const, content: "今回の依頼は一枚だけ", metadata: {}, createdAt: "2026-09-29T00:00:00Z" };
    const result = await prepareConversationContext("project-1", profile, "現在の資料", async () => "", pending);
    expect(result.text).toContain("今回の依頼は一枚だけ");
    expect(state.saved).toHaveLength(0);
  });
});
