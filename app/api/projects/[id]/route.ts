import { apiError, requireUuid } from "@/lib/http";
import { getPendingProposal, getProject, listHistory, listMessages } from "@/lib/projects";

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
