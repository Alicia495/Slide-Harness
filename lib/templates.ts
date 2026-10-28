import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { DEFAULT_THEME, ThemeSchema, type Theme } from "./document";
import { db, LOCAL_USER_ID, LOCAL_WORKSPACE_ID } from "./db";
import { DocumentError } from "./operations";

export const MAX_TEMPLATE_BYTES = 50 * 1024 * 1024;
const POTX_MAIN_PART = "application/vnd.openxmlformats-officedocument.presentationml.template.main+xml";
const PPTX_MAIN_PART = "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml";

export type TemplateRecord = {
  id: string;
  name: string;
  originalName: string;
  sizeBytes: number;
  theme: Theme;
  createdAt: string;
};

function mapTemplate(row: Record<string, unknown>): TemplateRecord {
  return {
    id: String(row.id), name: String(row.name), originalName: String(row.original_name),
    sizeBytes: Number(row.size_bytes), theme: ThemeSchema.parse(row.theme),
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

function schemeColor(themeXml: string, tag: string): string | null {
  const block = new RegExp(`<a:${tag}>([\\s\\S]*?)</a:${tag}>`).exec(themeXml);
  const hex = block && /(?:srgbClr val|lastClr)="([0-9a-fA-F]{6})"/.exec(block[1]);
  return hex ? `#${hex[1]}` : null;
}

function fontFace(themeXml: string): string | null {
  const minor = /<a:minorFont>[\s\S]*?<a:latin typeface="([^"]+)"/.exec(themeXml);
  const major = /<a:majorFont>[\s\S]*?<a:latin typeface="([^"]+)"/.exec(themeXml);
  return minor?.[1]?.trim() || major?.[1]?.trim() || null;
}

export async function parsePotxTheme(bytes: Buffer, name: string): Promise<Theme> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new DocumentError("PowerPoint テンプレートファイル（.potx）を正しく読み込めませんでした。");
  }
  const contentTypes = await zip.file("[Content_Types].xml")?.async("string");
  if (!contentTypes) throw new DocumentError("PowerPoint テンプレートファイル（.potx）を正しく読み込めませんでした。");
  if (contentTypes.includes(PPTX_MAIN_PART) && !contentTypes.includes(POTX_MAIN_PART)) {
    throw new DocumentError("このファイルはプレゼンテーション（.pptx）です。テンプレート（.potx）を選択してください。");
  }
  if (!contentTypes.includes(POTX_MAIN_PART)) {
    throw new DocumentError("テンプレート（.potx）ではありません。拡張子と内容が PowerPoint テンプレートのファイルを選択してください。");
  }
  const themeFile = zip.file(/^ppt\/theme\/theme\d+\.xml$/).sort((a, b) => a.name.localeCompare(b.name))[0];
  if (!themeFile) throw new DocumentError("テンプレート内にテーマ定義が見つかりません。");
  const themeXml = await themeFile.async("string");
  return ThemeSchema.parse({
    name,
    primary: schemeColor(themeXml, "accent1") ?? DEFAULT_THEME.primary,
    accent: schemeColor(themeXml, "accent2") ?? DEFAULT_THEME.accent,
    background: schemeColor(themeXml, "lt1") ?? DEFAULT_THEME.background,
    text: schemeColor(themeXml, "dk1") ?? schemeColor(themeXml, "dk2") ?? DEFAULT_THEME.text,
    fontFace: fontFace(themeXml) ?? DEFAULT_THEME.fontFace,
  });
}

function templateName(file: File, requested?: string): string {
  const trimmed = requested?.trim() || file.name.replace(/\.potx$/i, "").trim();
  if (!trimmed) throw new DocumentError("テンプレート名を入力してください。");
  return trimmed.slice(0, 80);
}

export async function saveTemplate(file: File, name?: string): Promise<TemplateRecord> {
  if (file.size < 1 || file.size > MAX_TEMPLATE_BYTES) throw new DocumentError("テンプレートファイルは 50 MB 以下にしてください。");
  if (!/\.potx$/i.test(file.name)) throw new DocumentError("拡張子 .potx のテンプレートファイルを選択してください。");
  const bytes = Buffer.from(await file.arrayBuffer());
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04)) {
    throw new DocumentError("PowerPoint テンプレートファイル（.potx）を選択してください。");
  }
  const id = crypto.randomUUID();
  const theme = await parsePotxTheme(bytes, templateName(file, name));
  const dir = path.join(process.env.DATA_DIR || path.join(process.cwd(), ".data"), "templates");
  await mkdir(dir, { recursive: true });
  const storagePath = path.join(dir, `${id}.potx`);
  await writeFile(storagePath, bytes, { flag: "wx" });
  try {
    await db().query(
      "INSERT INTO templates(id,workspace_id,created_by_user_id,name,original_name,size_bytes,storage_path,theme) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [id, LOCAL_WORKSPACE_ID, LOCAL_USER_ID, theme.name, file.name.slice(0, 200), bytes.length, storagePath, JSON.stringify(theme)],
    );
  } catch (error) {
    await rm(storagePath, { force: true });
    throw error;
  }
  const created = await getTemplate(id);
  if (!created) throw new Error("テンプレートを作成できませんでした。");
  return { id: created.id, name: created.name, originalName: created.originalName, sizeBytes: created.sizeBytes, theme: created.theme, createdAt: created.createdAt };
}

export async function listTemplates(): Promise<TemplateRecord[]> {
  const result = await db().query(
    "SELECT * FROM templates WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT 100",
    [LOCAL_WORKSPACE_ID],
  );
  return result.rows.map(mapTemplate);
}

export async function getTemplate(id: string): Promise<(TemplateRecord & { storagePath: string }) | null> {
  const result = await db().query("SELECT * FROM templates WHERE id = $1 AND workspace_id = $2", [id, LOCAL_WORKSPACE_ID]);
  const row = result.rows[0];
  return row ? { ...mapTemplate(row), storagePath: String(row.storage_path) } : null;
}

export async function deleteTemplate(id: string): Promise<void> {
  const template = await getTemplate(id);
  if (!template) throw new DocumentError("テンプレートが見つかりません。", 404);
  await db().query("DELETE FROM templates WHERE id = $1", [id]);
  await rm(template.storagePath, { force: true });
}

export async function readTemplateTheme(id: string): Promise<Theme> {
  const template = await getTemplate(id);
  if (!template) throw new DocumentError("テンプレートが見つかりません。", 404);
  return template.theme;
}
