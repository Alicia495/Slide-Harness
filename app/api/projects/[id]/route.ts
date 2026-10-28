import { apiError, requireUuid } from "@/lib/http";
import { deleteProject, getPendingProposal, getProject, listHistory, listMessages } from "@/lib/projects";

export const runtime = "nodejs";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const id = requireUuid((await context.params).id);
    const project = await getProject(id);
    if (!project) return Response.json({ error: "資料が見つかりません。" }, { status: 404 });
    const [history, messages, proposal] = await Promise.all([listHistory(id), listMessages(id), getPendingProposal(id)]);
    return Response.json({ project, history, messages, proposal });
  } catch (error) { return apiError(error); }
}
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const id = requireUuid((await context.params).id);
    await deleteProject(id);
    return Response.json({ ok: true });
  } catch (error) { return apiError(error); }
}
