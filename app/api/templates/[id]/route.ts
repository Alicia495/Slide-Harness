import { apiError, requireUuid } from "@/lib/http";
import { deleteTemplate } from "@/lib/templates";

export const runtime = "nodejs";
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try { await deleteTemplate(requireUuid((await context.params).id)); return Response.json({ ok: true }); }
  catch (error) { return apiError(error); }
}
