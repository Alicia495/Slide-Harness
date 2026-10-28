import { assetPathsForProject } from "@/lib/assets";
import { apiError, requireUuid } from "@/lib/http";
import { buildPptx } from "@/lib/pptx";
import { getProposal } from "@/lib/projects";
import { renderProposalSlides } from "@/lib/render";

export const runtime = "nodejs";
export async function POST(_request: Request, context: { params: Promise<{ id: string; proposalId: string }> }) {
  try {
    const { id, proposalId } = await context.params;
    requireUuid(id); requireUuid(proposalId);
    const proposal = await getProposal(id, proposalId);
    if (!proposal) return Response.json({ error: "変更案が見つかりません。" }, { status: 404 });
    if (proposal.status !== "pending") return Response.json({ error: "この変更案は確定済みです。" }, { status: 409 });
    if (!proposal.proposedDeck.slides.length) return Response.json({ error: "プレビュー表示にスライドが必要です。" }, { status: 400 });
    const pptx = await buildPptx(proposal.proposedDeck, await assetPathsForProject(id));
    const slides = await renderProposalSlides(id, proposal.id, pptx, proposal.proposedDeck.slides.length);
    return Response.json({ proposalId: proposal.id, slides });
  } catch (error) { return apiError(error); }
}
