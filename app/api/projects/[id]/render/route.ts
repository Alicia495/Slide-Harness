import { assetPathsForProject } from "@/lib/assets";
import { apiError, requireUuid } from "@/lib/http";
import { buildPptx } from "@/lib/pptx";
import { getProject } from "@/lib/projects";
import { renderSlides } from "@/lib/render";

export const runtime = "nodejs";
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const id = requireUuid((await context.params).id);
    const project = await getProject(id);
    if (!project) return Response.json({ error: "資料が見つかりません。" }, { status: 404 });
    if (!project.deck.slides.length) return Response.json({ error: "先にスライドを作成してください。" }, { status: 400 });
    const pptx = await buildPptx(project.deck, await assetPathsForProject(id));
    const slides = await renderSlides(id, String(project.version), pptx, project.deck.slides.length);
    return Response.json({ version: project.version, slides });
  } catch (error) { return apiError(error); }
}
