import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { assetPathsForProject, DATA_DIR } from "@/lib/assets";
import { db } from "@/lib/db";
import { apiError, requireUuid } from "@/lib/http";
import { buildPptx } from "@/lib/pptx";
import { getProject } from "@/lib/projects";

export const runtime = "nodejs";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const id = requireUuid((await context.params).id);
    const project = await getProject(id);
    if (!project) return Response.json({ error: "資料が見つかりません。" }, { status: 404 });
    if (!project.deck.slides.length) return Response.json({ error: "先にスライドを作成してください。" }, { status: 400 });
    const bytes = await buildPptx(project.deck, await assetPathsForProject(id));
    const dir = path.join(DATA_DIR, "exports", id);
    await mkdir(dir, { recursive: true });
    const exportId = crypto.randomUUID();
    const filePath = path.join(dir, `${exportId}.pptx`);
    await writeFile(filePath, bytes, { flag: "wx" });
    await db().query("INSERT INTO exports(id,project_id,document_version,storage_path) VALUES($1,$2,$3,$4)", [exportId, id, project.version, filePath]);
    const fileName = encodeURIComponent(`${project.title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80)}.pptx`);
    return new Response(new Uint8Array(bytes), { headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Disposition": `attachment; filename="slides.pptx"; filename*=UTF-8''${fileName}`,
      "Cache-Control": "no-store",
    } });
  } catch (error) { return apiError(error); }
}
