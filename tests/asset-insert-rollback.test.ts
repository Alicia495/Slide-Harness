import { afterAll, describe, expect, it, vi } from "vitest";
import { access, readFile } from "node:fs/promises";

// vi.hoisted は import より前に走るため、ここでしか使えない path/os は使わず固定の一時ディレクトリ名を用いる。
const { tmpDir, state } = vi.hoisted(() => {
  const tmpDir = `/tmp/slide-harness-asset-${crypto.randomUUID()}`;
  process.env.DATA_DIR = tmpDir;
  return { tmpDir, state: { failInsert: true, inserted: 0, paths: [] as string[] } };
});

function query(sql: string, values?: unknown[]) {
  if (sql.includes("INSERT INTO assets")) {
    if (state.failInsert) throw new Error("db insert failed");
    state.inserted += 1;
    state.paths.push(String(values?.[6]));
    return Promise.resolve({ rows: [], rowCount: 1 });
  }
  return Promise.reject(new Error(`Unexpected query: ${sql}`));
}

vi.mock("../lib/db", () => ({
  db: () => ({ query }),
  LOCAL_USER_ID: "00000000-0000-4000-8000-000000000001",
}));

import { saveAsset } from "../lib/assets";

const PNG_MAGIC = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function pngFile(): File {
  return new File([new Uint8Array(PNG_MAGIC)], "a.png", { type: "image/png" });
}

describe("saveAsset keeps files and DB consistent", () => {
  it("removes the written file when the DB insert fails", async () => {
    state.failInsert = true;
    await expect(saveAsset("00000000-0000-4000-8000-000000000031", pngFile())).rejects.toThrow(/insert/);
    const files = await readdirSafe(`${tmpDir}/assets/00000000-0000-4000-8000-000000000031`);
    expect(files.length).toBe(0);
  });

  it("keeps the file and returns the record when the insert succeeds", async () => {
    state.failInsert = false;
    const asset = await saveAsset("00000000-0000-4000-8000-000000000032", pngFile());
    expect(state.inserted).toBe(1);
    await expect(access(asset.storagePath)).resolves.toBeUndefined();
    expect(await readFile(asset.storagePath)).toEqual(PNG_MAGIC);
  });
});

async function readdirSafe(dir: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  try { return await readdir(dir); } catch { return []; }
}

afterAll(async () => {
  const { rm } = await import("node:fs/promises");
  await rm(tmpDir, { recursive: true, force: true });
});
