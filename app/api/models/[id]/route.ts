import { apiError, requireUuid } from "@/lib/http";
import { deleteModel, saveModel } from "@/lib/model-settings";

export const runtime = "nodejs";
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try { return Response.json({ model: await saveModel(await request.json(), requireUuid((await context.params).id)) }); }
  catch (error) { return apiError(error); }
}
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try { await deleteModel(requireUuid((await context.params).id)); return Response.json({ ok: true }); }
  catch (error) { return apiError(error); }
}
