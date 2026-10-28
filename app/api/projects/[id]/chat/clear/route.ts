import { apiError, requireUuid } from "@/lib/http";
import { clearMessages, getProject } from "@/lib/projects";

export const runtime = "nodejs";
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const id = requireUuid((await context.params).id);
    if (!await getProject(id)) return Response.json({ error: "資料が見つかりません。" }, { status: 404 });
    await clearMessages(id);
    return Response.json({ ok: true });
  } catch (error) { return apiError(error); }
}
