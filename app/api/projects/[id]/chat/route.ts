import { z } from "zod";
import { generateOperations } from "@/lib/ai";
import { apiError, requireUuid } from "@/lib/http";
import { DocumentError, isSmallAIEdit } from "@/lib/operations";
import { addMessage, commitOperations, createProposal, getPendingProposal, getProject } from "@/lib/projects";

export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const id = requireUuid((await context.params).id);
    const body = z.object({
      baseVersion: z.number().int().nonnegative(),
      prompt: z.string().trim().min(1).max(4000),
      modelId: z.string().min(1).max(80),
      target: z.object({ slideId: z.uuid().optional(), elementId: z.uuid().optional() }).optional(),
    }).parse(await request.json());
    const project = await getProject(id);
    if (!project) throw new DocumentError("資料が見つかりません。", 404);
    if (project.version !== body.baseVersion) throw new DocumentError("別の変更が先に保存されました。画面を更新してください。", 409);
    if (await getPendingProposal(id)) throw new DocumentError("確認待ちの変更案を先に適用または破棄してください。", 409);
    const generated = await generateOperations(id, project.deck, body.prompt, body.modelId, body.target);
    if (isSmallAIEdit(generated.operations)) {
      const updated = await commitOperations(id, body.baseVersion, generated.operations, "ai");
      await addMessage(id, "user", body.prompt, { modelId: body.modelId, target: body.target });
      await addMessage(id, "assistant", generated.reply, { mode: "applied", version: updated.version });
      return Response.json({ mode: "applied", reply: generated.reply, project: updated, compacted: !!generated.compacted });
    }
    const proposal = await createProposal(id, body.baseVersion, generated.operations);
    await addMessage(id, "user", body.prompt, { modelId: body.modelId, target: body.target });
    await addMessage(id, "assistant", generated.reply, { mode: "proposal", proposalId: proposal.id });
    return Response.json({ mode: "proposal", reply: generated.reply, proposal, compacted: !!generated.compacted });
  } catch (error) { return apiError(error); }
}
