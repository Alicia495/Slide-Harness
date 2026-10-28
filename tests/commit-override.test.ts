import { describe, expect, it, vi } from "vitest";

// vi.mock は import より先に評価されるため、mock 内で参照する値は vi.hoisted で初期化する。
const { PROJECT_ID, WORKSPACE_ID, USER_ID, SLIDE_ID, ELEMENT_ID, ISO } = vi.hoisted(() => ({
  PROJECT_ID: "00000000-0000-4000-8000-000000000021",
  WORKSPACE_ID: "00000000-0000-4000-8000-000000000002",
  USER_ID: "00000000-0000-4000-8000-000000000001",
  SLIDE_ID: "00000000-0000-4000-8000-000000000022",
  ELEMENT_ID: "00000000-0000-4000-8000-000000000023",
  ISO: "2026-01-01T00:00:00.000Z",
}));

function baseDeck() {
  return {
    id: "00000000-0000-4000-8000-000000000024", title: "ベース資料",
    theme: { name: "クリーン", primary: "#3156D3", accent: "#65A9F0", background: "#FFFFFF", text: "#182230", fontFace: "Aptos" },
    slides: [{
      id: SLIDE_ID, background: "#FFFFFF",
      elements: [{
        kind: "text" as const, id: ELEMENT_ID, x: 1, y: 1, w: 6, h: 1, rotation: 0,
        text: "元の文章", fontSize: 24, color: "#182230", bold: false, align: "left" as const, valign: "top" as const, role: "body" as const,
      }],
    }],
  };
}

const state = {
  version: 3,
  title: "ベース資料",
  document: baseDeck(),
  updates: [] as unknown[][],
  versions: [] as unknown[][],
  ops: [] as unknown[][],
};

function projectRow() {
  return {
    id: PROJECT_ID, workspace_id: WORKSPACE_ID, title: state.title, version: state.version,
    document: JSON.parse(JSON.stringify(state.document)), plan: null, created_at: ISO, updated_at: ISO,
  };
}

async function query(sql: string, values?: unknown[]) {
  if (sql.includes("FROM projects") && sql.includes("FOR UPDATE")) return { rows: [projectRow()] };
  if (sql.includes("UPDATE projects SET")) {
    const [, title, version, document] = values!;
    state.title = String(title);
    state.version = Number(version);
    state.document = JSON.parse(String(document));
    state.updates.push(values!);
    return { rows: [], rowCount: 1 };
  }
  if (sql.includes("INSERT INTO document_versions")) { state.versions.push(values!); return { rows: [], rowCount: 1 }; }
  if (sql.includes("INSERT INTO operations")) { state.ops.push(values!); return { rows: [], rowCount: 1 }; }
  if (sql.includes("SELECT * FROM projects WHERE id = $1 AND workspace_id = $2")) return { rows: [projectRow()] };
  if (sql.includes("FROM assets")) return { rows: [] };
  throw new Error(`Unexpected query: ${sql}`);
}

vi.mock("../lib/db", () => ({
  db: () => ({ query }),
  transaction: async (fn: (client: { query: typeof query }) => Promise<unknown>) => fn({ query }),
  LOCAL_USER_ID: USER_ID,
  LOCAL_WORKSPACE_ID: WORKSPACE_ID,
}));

import { commitOperations } from "../lib/projects";
import { type Deck, type Operation } from "../lib/document";

function updateTextOperation(text: string): Operation {
  return { type: "updateText", slideId: SLIDE_ID, elementId: ELEMENT_ID, text };
}

function resetState() {
  state.version = 3;
  state.title = "ベース資料";
  state.document = baseDeck();
  state.updates.length = 0;
  state.versions.length = 0;
  state.ops.length = 0;
}

describe("commitOperations reviewedDeck override", () => {
  it("commits the reviewed deck directly for a small AI edit without re-applying operations", async () => {
    resetState();
    const reviewedDeck: Deck = { ...baseDeck(), title: "レビュー済み資料" } as Deck;
    const project = await commitOperations(PROJECT_ID, 3, [updateTextOperation("操作を直接適用しない")], "ai", reviewedDeck);
    expect(project.version).toBe(4);
    expect(project.title).toBe("レビュー済み資料");
    expect(project.deck).toEqual(reviewedDeck);
    expect(state.updates.length).toBe(1);
    expect(state.versions.length).toBe(1);
    expect(state.ops.length).toBe(1);
    expect(state.ops[0]?.[4]).toBe("ai");
  });

  it("keeps baseVersion optimistic locking for overridden commits", async () => {
    resetState();
    const reviewedDeck: Deck = { ...baseDeck(), title: "レビュー済み資料" } as Deck;
    await expect(commitOperations(PROJECT_ID, 2, [updateTextOperation("更新")], "ai", reviewedDeck)).rejects.toThrow(/保存されました/);
    expect(state.updates.length).toBe(0);
    expect(state.versions.length).toBe(0);
  });

  it("rejects an override that fails DeckSchema before writing", async () => {
    resetState();
    const invalid = { ...baseDeck(), title: "" } as Deck;
    await expect(commitOperations(PROJECT_ID, 3, [updateTextOperation("更新")], "ai", invalid)).rejects.toThrow();
    expect(state.updates.length).toBe(0);
  });

  it("applies operations as before when no override is given", async () => {
    resetState();
    const project = await commitOperations(PROJECT_ID, 3, [updateTextOperation("手動更新")], "manual");
    expect(project.version).toBe(4);
    expect(project.deck.slides[0]?.elements[0]).toMatchObject({ kind: "text", text: "手動更新" });
  });
});
