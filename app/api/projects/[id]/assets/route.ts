import { saveAsset } from "@/lib/assets";
import { apiError, requireUuid } from "@/lib/http";
import { getProject } from "@/lib/projects";

export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const id = requireUuid((await context.params).id);
    if (!(await getProject(id))) return Response.json({ error: "資料が見つかりません。" }, { status: 404 });
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return Response.json({ error: "画像ファイルを選択してください。" }, { status: 400 });
    const asset = await saveAsset(id, file);
    return Response.json({ asset: { id: asset.id, name: asset.originalName, url: `/api/assets/${asset.id}` } }, { status: 201 });
  } catch (error) { return apiError(error); }
}
