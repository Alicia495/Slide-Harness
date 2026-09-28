import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { db, LOCAL_USER_ID } from "./db";
import { DocumentError } from "./operations";

export type AssetRecord = { id: string; projectId: string; originalName: string; mimeType: string; sizeBytes: number; storagePath: string };
export const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), ".data");

export async function saveAsset(projectId: string, file: File): Promise<AssetRecord> {
  if (file.size < 1 || file.size > 10 * 1024 * 1024) throw new DocumentError("画像は 10 MB 以下にしてください。");
  const bytes = Buffer.from(await file.arrayBuffer());
  const isPng = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (!isPng && !isJpeg) throw new DocumentError("PNG または JPEG 画像を選択してください。");
  const id = crypto.randomUUID();
  const ext = isPng ? ".png" : ".jpg";
  const dir = path.join(DATA_DIR, "assets", projectId);
  await mkdir(dir, { recursive: true });
  const storagePath = path.join(dir, `${id}${ext}`);
  await writeFile(storagePath, bytes, { flag: "wx" });
  const mimeType = isPng ? "image/png" : "image/jpeg";
  const asset: AssetRecord = { id, projectId, originalName: file.name.slice(0, 200), mimeType, sizeBytes: bytes.length, storagePath };
  await db().query(
    "INSERT INTO assets(id,project_id,created_by_user_id,original_name,mime_type,size_bytes,storage_path) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [id, projectId, LOCAL_USER_ID, asset.originalName, mimeType, bytes.length, storagePath],
  );
  return asset;
}

export async function getAsset(id: string, projectId?: string): Promise<AssetRecord | null> {
  const result = await db().query(
    `SELECT * FROM assets WHERE id=$1 ${projectId ? "AND project_id=$2" : ""}`,
    projectId ? [id, projectId] : [id],
  );
  const row = result.rows[0];
  return row ? { id: row.id, projectId: row.project_id, originalName: row.original_name, mimeType: row.mime_type, sizeBytes: row.size_bytes, storagePath: row.storage_path } : null;
}

export async function readAsset(id: string): Promise<{ bytes: Buffer; mimeType: string } | null> {
  const asset = await getAsset(id);
  if (!asset) return null;
  return { bytes: await readFile(asset.storagePath), mimeType: asset.mimeType };
}

export async function assetPathsForProject(projectId: string): Promise<Map<string, string>> {
  const result = await db().query("SELECT id, storage_path FROM assets WHERE project_id=$1", [projectId]);
  return new Map(result.rows.map((row) => [row.id as string, row.storage_path as string]));
}
