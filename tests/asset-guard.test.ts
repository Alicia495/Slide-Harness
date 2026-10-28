import { describe, expect, it, vi } from "vitest";

const PROJECT_A = "00000000-0000-4000-8000-000000000011";
const PROJECT_B = "00000000-0000-4000-8000-000000000012";
const SLIDE_ID = "00000000-0000-4000-8000-000000000014";
const ASSET_IN_A = "00000000-0000-4000-8000-000000000013";
const ASSET_IN_B = "00000000-0000-4000-8000-000000000015";

const knownAssets = new Map<string, string>([
  [ASSET_IN_A, PROJECT_A],
  [ASSET_IN_B, PROJECT_B],
]);
const queries: string[] = [];

vi.mock("../lib/db", () => ({
  db: () => ({ query: async (sql: string, values?: unknown[]) => {
    queries.push(sql);
    if (sql.includes("FROM assets")) {
      const id = String(values?.[0]);
      const projectId = values && values.length > 1 ? String(values[1]) : null;
      const owner = knownAssets.get(id);
      return { rows: owner && (!projectId || owner === projectId) ? [{ id, project_id: owner }] : [] };
    }
    throw new Error(`Unexpected query: ${sql}`);
  } }),
  LOCAL_USER_ID: "00000000-0000-4000-8000-000000000001",
}));

import { assertImagesForProject } from "../lib/assets";
import { type Operation } from "../lib/document";

function addImage(assetId: string): Operation {
  return { type: "addImage", slideId: SLIDE_ID, assetId, x: 1, y: 1, w: 2, h: 2, alt: "画像" };
}

describe("addImage asset guard at commit boundaries", () => {
  it("accepts addImage when the asset belongs to the project", async () => {
    await expect(assertImagesForProject(PROJECT_A, [addImage(ASSET_IN_A)])).resolves.toBeUndefined();
  });

  it("rejects an asset owned by another project", async () => {
    await expect(assertImagesForProject(PROJECT_A, [addImage(ASSET_IN_B)])).rejects.toThrow(/画像/);
  });

  it("rejects a non-existent asset id", async () => {
    await expect(assertImagesForProject(PROJECT_A, [addImage("00000000-0000-4000-8000-000000000099")])).rejects.toThrow(/画像/);
  });

  it("does not touch the database when no operation adds an image", async () => {
    queries.length = 0;
    const move: Operation = { type: "moveElement", slideId: SLIDE_ID, elementId: SLIDE_ID, x: 2, y: 2 };
    await expect(assertImagesForProject(PROJECT_A, [move])).resolves.toBeUndefined();
    expect(queries.length).toBe(0);
  });
});
