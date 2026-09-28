import { z } from "zod";
import { apiError, requireUuid } from "@/lib/http";
import { decideProposal } from "@/lib/projects";

export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string; proposalId: string }> }) {
  try {
    const { id, proposalId } = await context.params;
    requireUuid(id); requireUuid(proposalId);
    const body = z.object({ accept: z.boolean() }).parse(await request.json());
    const project = await decideProposal(id, proposalId, body.accept);
    return Response.json({ project, accepted: body.accept });
  } catch (error) { return apiError(error); }
}
